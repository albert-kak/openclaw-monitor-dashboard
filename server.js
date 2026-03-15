const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fork } = require("child_process");
const { URL } = require("url");

const PORT = 17788;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
const AGENTS_DIR = path.join(OPENCLAW_DIR, "agents");
const CONFIG_PATH = path.join(OPENCLAW_DIR, "openclaw.json");
const LOG_PATHS = {
  gateway: path.join(OPENCLAW_DIR, "logs", "gateway.log"),
  gatewayError: path.join(OPENCLAW_DIR, "logs", "gateway.err.log"),
};
const HOT_RELOAD_CHILD_ENV = "OPENCLAW_DASHBOARD_CHILD";
const HOT_RELOAD_DISABLED = process.env.OPENCLAW_HOT_RELOAD === "0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

async function readTail(filePath, maxBytes = 512 * 1024) {
  try {
    const stat = await fs.promises.stat(filePath);
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const handle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    await handle.close();
    return buffer.toString("utf8");
  } catch (error) {
    return "";
  }
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toIsoTimestamp(value) {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function collectContentText(content, options = {}) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const includeThinking = Boolean(options.includeThinking);
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    if (!includeThinking && item.type === "thinking") {
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }
    if (item.type === "toolCall") {
      const command = typeof item.arguments?.command === "string"
        ? ` ${item.arguments.command}`
        : "";
      parts.push(`toolCall ${item.name ?? "tool"}${command}`);
      continue;
    }
    if (typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join(" | ");
}

function summarizeSessionRecord(record) {
  const message = record?.message ?? {};
  const role = message.role ?? record?.type ?? "event";
  if (role === "toolResult") {
    const toolName = message.toolName ?? "tool";
    const detail = message.details?.aggregated ?? collectContentText(message.content, { includeThinking: false });
    return `toolResult ${toolName}: ${normalizeText(detail || "completed")}`;
  }
  if (role === "assistant") {
    const detail = collectContentText(message.content, { includeThinking: false });
    return `assistant: ${normalizeText(detail || "response")}`;
  }
  if (role === "user") {
    const detail = collectContentText(message.content, { includeThinking: false });
    return `user: ${normalizeText(detail || "message")}`;
  }
  const fallback = collectContentText(message.content, { includeThinking: false })
    || message.text
    || JSON.stringify(message);
  return `${role}: ${normalizeText(fallback || "event")}`;
}

function formatSessionLogLine(rawLine, agentId) {
  if (!rawLine) return null;
  try {
    const record = JSON.parse(rawLine);
    const timestampIso = toIsoTimestamp(record.timestamp ?? record.message?.timestamp ?? null);
    const summary = summarizeSessionRecord(record);
    const decorated = `[${agentId}] ${summary}`;
    return timestampIso
      ? `${timestampIso} ${redactSecrets(decorated)}`
      : redactSecrets(decorated);
  } catch (error) {
    const fallback = `[${agentId}] raw: ${normalizeText(rawLine)}`;
    return redactSecrets(fallback);
  }
}

function resolveSessionFile(sessionFile, sessionsDir) {
  if (typeof sessionFile !== "string" || !sessionFile) {
    return null;
  }
  const candidate = path.isAbsolute(sessionFile)
    ? sessionFile
    : path.join(sessionsDir, sessionFile);
  return safeStat(candidate)?.isFile() ? candidate : null;
}

function resolveSessionFileFromId(sessionId, sessionsDir) {
  if (typeof sessionId !== "string" || !sessionId) {
    return null;
  }
  const candidate = path.join(sessionsDir, `${sessionId}.jsonl`);
  return safeStat(candidate)?.isFile() ? candidate : null;
}

function normalizeUpdatedAtMs(updatedAt, fallbackFilePath = null) {
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  if (typeof updatedAt === "string") {
    const parsed = Date.parse(updatedAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (fallbackFilePath) {
    const stat = safeStat(fallbackFilePath);
    if (stat?.mtimeMs) {
      return stat.mtimeMs;
    }
  }
  return null;
}

function pickSessionFileFromIndex(indexData, sessionsDir) {
  if (!indexData || typeof indexData !== "object") {
    return null;
  }
  let best = null;
  for (const item of Object.values(indexData)) {
    const sessionFile = resolveSessionFile(item?.sessionFile, sessionsDir)
      ?? resolveSessionFileFromId(item?.sessionId, sessionsDir);
    if (!sessionFile) {
      continue;
    }
    const rank = normalizeUpdatedAtMs(item?.updatedAt, sessionFile) ?? 0;
    if (!best || rank > best.rank) {
      best = { sessionFile, rank };
    }
  }
  return best?.sessionFile ?? null;
}

function pickLatestSessionFileFromDir(sessionsDir) {
  try {
    const candidates = fs.readdirSync(sessionsDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const filePath = path.join(sessionsDir, name);
        const stat = safeStat(filePath);
        return stat?.isFile() ? { filePath, mtimeMs: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.filePath ?? null;
  } catch (error) {
    return null;
  }
}

function resolveAgentSessionFile(agentId) {
  const sessionsDir = path.join(AGENTS_DIR, agentId, "sessions");
  const indexPath = path.join(sessionsDir, "sessions.json");
  const indexData = safeReadJson(indexPath);
  return pickSessionFileFromIndex(indexData, sessionsDir)
    ?? pickLatestSessionFileFromDir(sessionsDir);
}

function readLatestAgentSessionEventAt(agentId) {
  const sessionsDir = path.join(AGENTS_DIR, agentId, "sessions");
  const indexPath = path.join(sessionsDir, "sessions.json");
  const indexData = safeReadJson(indexPath);
  let bestMs = null;

  if (indexData && typeof indexData === "object") {
    for (const item of Object.values(indexData)) {
      const sessionFile = resolveSessionFile(item?.sessionFile, sessionsDir)
        ?? resolveSessionFileFromId(item?.sessionId, sessionsDir);
      const updatedAtMs = normalizeUpdatedAtMs(item?.updatedAt, sessionFile);
      if (updatedAtMs == null) {
        continue;
      }
      if (bestMs == null || updatedAtMs > bestMs) {
        bestMs = updatedAtMs;
      }
    }
  }

  if (bestMs == null) {
    const latestFile = pickLatestSessionFileFromDir(sessionsDir);
    if (latestFile) {
      bestMs = normalizeUpdatedAtMs(null, latestFile);
    }
  }

  if (bestMs == null) {
    return null;
  }
  const date = new Date(bestMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildSessionStatusByAgent(config) {
  const statusByAgent = {};
  for (const agentId of listAgentIds(config)) {
    const lastEventAt = readLatestAgentSessionEventAt(agentId);
    statusByAgent[agentId] = {
      lastEventAt,
      state: classifyFreshness(lastEventAt),
    };
  }
  return statusByAgent;
}

function listAgentIds(config) {
  const fromConfig = (config?.agents?.list ?? [])
    .map((agent) => agent?.id)
    .filter(Boolean);
  try {
    const fromDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    return Array.from(new Set([...fromConfig, ...fromDirs]));
  } catch (error) {
    return Array.from(new Set(fromConfig));
  }
}

async function readAgentSessionLogs(config, maxLines = 350) {
  const agentIds = listAgentIds(config);
  const bucket = [];
  const sessionFiles = [];
  const perAgentLines = Math.max(80, Math.ceil((maxLines * 2) / Math.max(agentIds.length, 1)));

  for (const agentId of agentIds) {
    const sessionFile = resolveAgentSessionFile(agentId);
    if (!sessionFile) {
      continue;
    }
    sessionFiles.push(sessionFile);
    const tail = await readTail(sessionFile, 384 * 1024);
    const rawLines = tail.split(/\r?\n/).filter(Boolean).slice(-perAgentLines);
    for (const rawLine of rawLines) {
      const line = formatSessionLogLine(rawLine, agentId);
      if (!line) {
        continue;
      }
      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/);
      const tsMs = tsMatch ? Date.parse(tsMatch[1]) : Number.NaN;
      bucket.push({
        line,
        tsMs: Number.isNaN(tsMs) ? 0 : tsMs,
      });
    }
  }

  bucket.sort((a, b) => a.tsMs - b.tsMs);
  return {
    sessionFiles,
    lines: bucket.map((item) => item.line).slice(-maxLines),
  };
}

function parseLogLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const sanitizedLine = redactSecrets(line);
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/);
      const timestamp = match ? new Date(match[1]) : null;
      return {
        line: sanitizedLine,
        timestamp,
        timestampIso: timestamp && !Number.isNaN(timestamp.getTime())
          ? timestamp.toISOString()
          : null,
      };
    });
}

function redactSecrets(line) {
  if (!line) return line;
  let result = line;
  result = result.replace(
    /("?(?:token|apiKey|botToken|appSecret|password|secret)"?\s*[:=]\s*)"[^"]+"/gi,
    '$1"***"',
  );
  result = result.replace(/(sk-[A-Za-z0-9\-_]+)/g, "sk-***");
  return result;
}

function classifyFreshness(timestampIso) {
  if (!timestampIso) {
    return "unknown";
  }
  const now = Date.now();
  const ts = Date.parse(timestampIso);
  if (Number.isNaN(ts)) {
    return "unknown";
  }
  const minutes = Math.floor((now - ts) / (1000 * 60));
  if (minutes <= 10) return "active";
  if (minutes <= 60) return "idle";
  if (minutes <= 1440) return "stale";
  return "offline";
}

function summarizeBindings(bindings, logLines) {
  const statusByBinding = {};
  const pending = new Set(bindings.map((binding) => `${binding.channel}:${binding.accountId}`));

  for (let index = logLines.length - 1; index >= 0 && pending.size > 0; index -= 1) {
    const { line, timestampIso } = logLines[index];
    for (const key of Array.from(pending)) {
      const [channel, accountId] = key.split(":");
      if (line.includes(accountId)) {
        statusByBinding[key] = {
          channel,
          accountId,
          lastEventAt: timestampIso,
          lastEvent: line.slice(0, 220),
          state: classifyFreshness(timestampIso),
        };
        pending.delete(key);
      }
    }
  }

  for (const key of pending) {
    const [channel, accountId] = key.split(":");
    statusByBinding[key] = {
      channel,
      accountId,
      lastEventAt: null,
      lastEvent: "No recent log entry found.",
      state: "unknown",
    };
  }

  return statusByBinding;
}

function buildAgentStatus(config, logLines, sessionStatusByAgent = {}) {
  const agents = config?.agents?.list ?? [];
  const bindings = config?.bindings ?? [];
  const defaults = config?.agents?.defaults ?? {};
  const bindingStatus = summarizeBindings(
    bindings.map((binding) => ({
      channel: binding?.match?.channel ?? "unknown",
      accountId: binding?.match?.accountId ?? "unknown",
      agentId: binding?.agentId ?? "unknown",
    })),
    logLines,
  );

  return agents.map((agent) => {
    const agentBindings = bindings
      .filter((binding) => binding.agentId === agent.id)
      .map((binding) => {
        const channel = binding?.match?.channel ?? "unknown";
        const accountId = binding?.match?.accountId ?? "unknown";
        const statusKey = `${channel}:${accountId}`;
        return {
          channel,
          accountId,
          status: bindingStatus[statusKey],
        };
      });

    const mostRecent = agentBindings
      .map((binding) => binding.status)
      .filter((status) => Boolean(status?.lastEventAt))
      .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt))[0];

    const sessionStatus = sessionStatusByAgent[agent.id] ?? {};
    const lastEventAt = sessionStatus.lastEventAt ?? mostRecent?.lastEventAt ?? null;
    return {
      id: agent.id,
      default: Boolean(agent.default),
      model: agent.model ?? defaults?.model?.primary ?? "unknown",
      workspace: agent.workspace ?? defaults?.workspace ?? "unknown",
      mentionPatterns: agent.groupChat?.mentionPatterns ?? [],
      bindings: agentBindings,
      lastEventAt,
      state: sessionStatus.state ?? classifyFreshness(lastEventAt),
      stateSource: sessionStatus.lastEventAt ? "session" : "gateway",
    };
  });
}

function buildSummary(config, logLines) {
  const meta = config?.meta ?? {};
  const wizard = config?.wizard ?? {};
  const gateway = config?.gateway ?? {};
  const channels = config?.channels ?? {};
  const lastLog = logLines
    .filter((entry) => Boolean(entry.timestampIso))
    .slice(-1)[0];

  return {
    lastTouchedAt: meta.lastTouchedAt ?? null,
    lastTouchedVersion: meta.lastTouchedVersion ?? null,
    lastRunAt: wizard.lastRunAt ?? null,
    lastRunCommand: wizard.lastRunCommand ?? null,
    lastRunMode: wizard.lastRunMode ?? null,
    gateway: {
      port: gateway.port ?? null,
      mode: gateway.mode ?? null,
      bind: gateway.bind ?? null,
    },
    agents: {
      count: config?.agents?.list?.length ?? 0,
      defaultModel: config?.agents?.defaults?.model?.primary ?? null,
      workspace: config?.agents?.defaults?.workspace ?? null,
    },
    channels: Object.entries(channels).map(([key, value]) => ({
      id: key,
      enabled: Boolean(value?.enabled),
    })),
    logs: {
      lastEventAt: lastLog?.timestampIso ?? null,
    },
  };
}

function sanitizeConfig(config) {
  if (!config) return null;
  return {
    meta: config.meta ?? {},
    wizard: config.wizard ?? {},
    agents: config.agents ?? {},
    bindings: config.bindings ?? [],
    gateway: {
      port: config.gateway?.port ?? null,
      mode: config.gateway?.mode ?? null,
      bind: config.gateway?.bind ?? null,
    },
    channels: Object.fromEntries(
      Object.entries(config.channels ?? {}).map(([key, value]) => [
        key,
        {
          enabled: Boolean(value?.enabled),
          dmPolicy: value?.dmPolicy ?? null,
          groupPolicy: value?.groupPolicy ?? null,
          stream: value?.streaming ?? null,
        },
      ]),
    ),
  };
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

function createRequestHandler() {
  return async (req, res) => {
    if (!req.url) {
      sendText(res, 400, "Bad request");
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/summary") {
      const config = safeReadJson(CONFIG_PATH);
      const logTail = await readTail(LOG_PATHS.gateway);
      const logLines = parseLogLines(logTail);
      sendJson(res, 200, buildSummary(config, logLines));
      return;
    }

    if (requestUrl.pathname === "/api/agents") {
      const config = safeReadJson(CONFIG_PATH);
      const logTail = await readTail(LOG_PATHS.gateway);
      const logLines = parseLogLines(logTail);
      const sessionStatusByAgent = buildSessionStatusByAgent(config);
      sendJson(res, 200, { agents: buildAgentStatus(config, logLines, sessionStatusByAgent) });
      return;
    }

    if (requestUrl.pathname === "/api/logs") {
      const type = requestUrl.searchParams.get("type") ?? "gateway";
      const requestedLines = Number(requestUrl.searchParams.get("lines") ?? 200);
      const lines = Number.isFinite(requestedLines)
        ? Math.min(Math.max(Math.trunc(requestedLines), 1), 1200)
        : 200;
      if (type === "session") {
        const config = safeReadJson(CONFIG_PATH);
        const sessionData = await readAgentSessionLogs(config, lines);
        sendJson(res, 200, {
          type,
          path: "~/.openclaw/agents/*/sessions/*.jsonl",
          sessionFiles: sessionData.sessionFiles,
          totalLines: sessionData.lines.length,
          lines: sessionData.lines,
        });
        return;
      }
      const pathChoice = type === "gatewayError" ? LOG_PATHS.gatewayError : LOG_PATHS.gateway;
      const text = await readTail(pathChoice, 1024 * 1024);
      const tailLines = text
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-lines)
        .map((line) => redactSecrets(line));
      sendJson(res, 200, {
        type,
        path: pathChoice,
        totalLines: tailLines.length,
        lines: tailLines,
      });
      return;
    }

    if (requestUrl.pathname === "/api/config") {
      const config = safeReadJson(CONFIG_PATH);
      sendJson(res, 200, sanitizeConfig(config));
      return;
    }

    let filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
    if (requestUrl.pathname === "/") {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    serveStatic(res, filePath);
  };
}

function startDashboardServer() {
  const server = http.createServer(createRequestHandler());
  server.listen(PORT, () => {
    console.log(`OpenClaw monitor dashboard running on http://localhost:${PORT}`);
  });
  return server;
}

function createDebouncedRestart(callback, delayMs) {
  let timer = null;
  return (reason) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      callback(reason);
    }, delayMs);
  };
}

function spawnServerWorker() {
  const worker = fork(__filename, [], {
    env: {
      ...process.env,
      [HOT_RELOAD_CHILD_ENV]: "1",
    },
    stdio: "inherit",
  });
  return worker;
}

function startHotReloadSupervisor() {
  let worker = spawnServerWorker();
  let shuttingDown = false;
  let restarting = false;
  let queuedRestart = false;
  const watchers = [];

  const restartWorker = (reason) => {
    if (shuttingDown || !worker) {
      return;
    }
    if (restarting) {
      queuedRestart = true;
      return;
    }

    restarting = true;
    console.log(`[hot] change detected (${reason}), restarting server...`);
    const previousWorker = worker;

    previousWorker.once("exit", () => {
      if (shuttingDown) {
        return;
      }
      worker = spawnServerWorker();
      restarting = false;
      if (queuedRestart) {
        queuedRestart = false;
        restartWorker("queued-change");
      }
    });

    previousWorker.kill("SIGTERM");
    setTimeout(() => {
      if (previousWorker.exitCode === null && previousWorker.signalCode === null) {
        previousWorker.kill("SIGKILL");
      }
    }, 1200);
  };

  const scheduleRestart = createDebouncedRestart(restartWorker, 180);
  const watchTargets = [__filename, PUBLIC_DIR];

  for (const target of watchTargets) {
    const watcher = fs.watch(target, (eventType, fileName) => {
      const fileHint = fileName ? `${target}/${fileName}` : target;
      scheduleRestart(`${eventType}:${fileHint}`);
    });
    watchers.push(watcher);
  }

  worker.on("exit", (code, signal) => {
    if (shuttingDown || restarting) {
      return;
    }
    const reason = signal ? `signal:${signal}` : `code:${code ?? "unknown"}`;
    console.log(`[hot] server worker exited (${reason}), waiting for file changes...`);
  });

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const watcher of watchers) {
      watcher.close();
    }
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      setTimeout(() => {
        if (worker && worker.exitCode === null && worker.signalCode === null) {
          worker.kill("SIGKILL");
        }
      }, 1200);
    }
  };

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
}

function bootstrap() {
  if (process.env[HOT_RELOAD_CHILD_ENV] === "1" || HOT_RELOAD_DISABLED) {
    startDashboardServer();
    return;
  }
  console.log("[hot] hot reload enabled (set OPENCLAW_HOT_RELOAD=0 to disable)");
  startHotReloadSupervisor();
}

bootstrap();
