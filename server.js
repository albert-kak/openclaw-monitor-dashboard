const http = require("http");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const { URL } = require("url");
const { loadEnvFile } = require("./env-file");

const ROOT_DIR = __dirname;
const ENV_FILE_PATH = path.join(ROOT_DIR, ".env");
const ENV_FILE_RESULT = loadEnvFile(ENV_FILE_PATH);
const {
  resolveRuntimePaths,
  validateRuntimeLayout,
  formatValidationReport,
} = require("./runtime-paths");

const PORT = 17788;
const PUBLIC_DIR = path.join(__dirname, "public");
const RUNTIME_PATHS = resolveRuntimePaths(process.env, { dashboardRootDir: ROOT_DIR });
const RUNTIME_VALIDATION = validateRuntimeLayout(RUNTIME_PATHS);
const AGENTS_DIR = RUNTIME_PATHS.agentsDir.path;
const CONFIG_PATH = RUNTIME_PATHS.configPath.path;
const CRON_JOBS_PATH = RUNTIME_PATHS.cronJobsPath.path;
const OPENCLAW_SKILLS_DIR = RUNTIME_PATHS.skillsDir.path;
const OPENCLAW_INSTALL_DIR_OVERRIDE = RUNTIME_PATHS.openclawInstallDir.path;
const LOG_PATHS = {
  gateway: RUNTIME_PATHS.gatewayLogPath.path,
  gatewayError: RUNTIME_PATHS.gatewayErrorLogPath.path,
};
const SESSION_LOG_GLOB = RUNTIME_PATHS.sessionLogGlob.path;
const HOT_RELOAD_CHILD_ENV = "OPENCLAW_DASHBOARD_CHILD";
const HOT_RELOAD_DISABLED = process.env.OPENCLAW_HOT_RELOAD === "0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function isLoopbackRequest(req) {
  const remote = req?.socket?.remoteAddress ?? "";
  return remote === "127.0.0.1"
    || remote === "::1"
    || remote.startsWith("::ffff:127.")
    || remote === "localhost";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

function sendMethodNotAllowed(res, allowed = ["GET"]) {
  res.writeHead(405, {
    "Content-Type": "text/plain; charset=utf-8",
    Allow: allowed.join(", "),
  });
  res.end("Method Not Allowed");
}

function readRequestBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function formatBackupSuffix(date = new Date()) {
  const iso = date.toISOString(); // 2026-03-15T12:34:56.789Z
  return iso
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replaceAll(".", "")
    .replace("T", "-")
    .replace("Z", "Z");
}

async function writeFileAtomically(filePath, content, options = {}) {
  const dir = path.dirname(filePath);
  const now = Date.now();
  const tempPath = `${filePath}.tmp-${process.pid}-${now}`;
  const mode = options.mode;
  await fs.promises.writeFile(tempPath, content, { encoding: "utf8", mode });
  await fs.promises.rename(tempPath, filePath);
}

async function runCommand(commandPath, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25000;
  const maxOutputBytes = options.maxOutputBytes ?? 96 * 1024;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = require("child_process").spawn(commandPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;

    const append = (target, chunk) => {
      if (!chunk || chunk.length === 0) return target;
      if (target.length >= maxOutputBytes) return target;
      const remaining = maxOutputBytes - target.length;
      return Buffer.concat([target, chunk.slice(0, remaining)]);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
  });
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

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveExecutablePathFromPath(binName) {
  const pathValue = process.env.PATH ?? "";
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binName);
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveOpenclawInstallDir() {
  const checked = new Set();
  const candidates = [];

  if (OPENCLAW_INSTALL_DIR_OVERRIDE) {
    candidates.push(OPENCLAW_INSTALL_DIR_OVERRIDE);
  }

  const executablePath = resolveExecutablePathFromPath("openclaw");

  if (executablePath) {
    candidates.push(executablePath);
    try {
      candidates.push(fs.realpathSync(executablePath));
    } catch (error) {
      // ignore broken links
    }
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    candidates.push(path.resolve(entry, "..", "lib", "node_modules", "openclaw"));
    candidates.push(path.resolve(entry, "..", "node_modules", "openclaw"));
  }

  for (const rawCandidate of candidates) {
    if (!rawCandidate) continue;
    const normalized = path.resolve(rawCandidate);
    if (checked.has(normalized)) continue;
    checked.add(normalized);

    if (fileExists(path.join(normalized, "package.json")) && safeStat(normalized)?.isDirectory()) {
      return normalized;
    }

    const parent = path.dirname(normalized);
    if (
      fileExists(path.join(parent, "package.json"))
      && (fileExists(path.join(parent, "openclaw.mjs")) || fileExists(path.join(parent, "dist")))
    ) {
      return parent;
    }

    const guessedByBin = path.resolve(path.dirname(normalized), "..", "lib", "node_modules", "openclaw");
    if (fileExists(path.join(guessedByBin, "package.json"))) {
      return guessedByBin;
    }
  }

  return null;
}

function serializeRuntimePaths() {
  return Object.fromEntries(
    Object.entries(RUNTIME_PATHS).map(([key, value]) => {
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "path")) {
        return [key, { path: value.path, source: value.source ?? "unknown" }];
      }
      return [key, value];
    }),
  );
}

function serializeEnvFileLoadResult() {
  return {
    path: ENV_FILE_RESULT.filePath,
    loaded: ENV_FILE_RESULT.loaded,
    parsedKeys: ENV_FILE_RESULT.parsedKeys,
    appliedKeys: ENV_FILE_RESULT.appliedKeys,
    warnings: ENV_FILE_RESULT.warnings,
  };
}

function printEnvFileWarnings() {
  for (const warning of ENV_FILE_RESULT.warnings) {
    console.warn(`[startup] [WARN] env: ${warning}`);
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

function previewText(value, maxChars = 180) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1)}…`;
}

function sortByTimeDesc(items, timeField) {
  return items.slice().sort((a, b) => {
    const aTime = Date.parse(a?.[timeField] ?? "") || 0;
    const bTime = Date.parse(b?.[timeField] ?? "") || 0;
    return bTime - aTime;
  });
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

function readCronJobs() {
  const data = safeReadJson(CRON_JOBS_PATH);
  if (!Array.isArray(data?.jobs)) {
    return [];
  }
  return data.jobs
    .filter((job) => job && typeof job === "object")
    .map((job) => {
      const state = job.state ?? {};
      const delivery = job.delivery ?? {};
      const payload = job.payload ?? {};
      return {
        id: job.id ?? "unknown",
        name: job.name ?? "unnamed-job",
        agentId: job.agentId ?? "unknown",
        enabled: Boolean(job.enabled),
        createdAt: toIsoTimestamp(job.createdAtMs),
        updatedAt: toIsoTimestamp(job.updatedAtMs),
        schedule: {
          kind: job.schedule?.kind ?? "unknown",
          expr: job.schedule?.expr ?? "",
          tz: job.schedule?.tz ?? "",
        },
        payload: {
          kind: payload.kind ?? "unknown",
          message: typeof payload.message === "string" ? payload.message : "",
          preview: previewText(payload.message ?? ""),
        },
        delivery: {
          mode: delivery.mode ?? "unknown",
          channel: delivery.channel ?? null,
          target: delivery.target ?? null,
          to: delivery.to ?? null,
          im: delivery.im ?? null,
        },
        state: {
          nextRunAt: toIsoTimestamp(state.nextRunAtMs),
          lastRunAt: toIsoTimestamp(state.lastRunAtMs),
          lastStatus: state.lastStatus ?? state.lastRunStatus ?? "unknown",
          lastDurationMs: typeof state.lastDurationMs === "number" ? state.lastDurationMs : null,
          consecutiveErrors: typeof state.consecutiveErrors === "number" ? state.consecutiveErrors : 0,
          lastDeliveryStatus: state.lastDeliveryStatus ?? "unknown",
          lastError: previewText(state.lastError ?? "", 220),
        },
      };
    });
}

function buildCronSummary(jobs) {
  const enabled = jobs.filter((job) => job.enabled).length;
  const disabled = jobs.length - enabled;
  const errors = jobs.filter((job) => job.state.lastStatus === "error").length;
  const nextRunCandidates = jobs
    .map((job) => job.state.nextRunAt)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    total: jobs.length,
    enabled,
    disabled,
    errors,
    nextRunAt: nextRunCandidates[0] ?? null,
  };
}

function collectSkillMarkdownFiles(rootDir, maxDepth = 6) {
  const rootStat = safeStat(rootDir);
  if (!rootStat?.isDirectory()) {
    return [];
  }

  const stack = [{ dir: rootDir, depth: 0 }];
  const results = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        results.push(entryPath);
        continue;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

function pickSkillDescription(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("```")) continue;
    return line;
  }
  return "";
}

function parseSkillFile(skillFilePath, source) {
  const content = safeReadText(skillFilePath);
  if (!content) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  const heading = lines.find((line) => /^#\s+/.test(line)) ?? "";
  const relativePath = path.relative(source.root, path.dirname(skillFilePath)) || ".";
  const stat = safeStat(skillFilePath);
  return {
    id: `${source.id}:${relativePath}`,
    name: heading.replace(/^#\s+/, "").trim() || path.basename(path.dirname(skillFilePath)),
    description: previewText(pickSkillDescription(content), 220),
    source: source.id,
    sourceLabel: source.label,
    scope: source.scope ?? "custom",
    relativePath,
    path: skillFilePath,
    updatedAt: toIsoTimestamp(stat?.mtimeMs ?? null),
  };
}

function readSkillsInventory() {
  const installDir = resolveOpenclawInstallDir();
  const sources = [
    {
      id: "openclaw-custom",
      label: "OpenClaw 自定义",
      root: OPENCLAW_SKILLS_DIR,
      scope: "custom",
    },
  ];
  if (installDir) {
    sources.push(
      {
        id: "openclaw-system-core",
        label: "OpenClaw 系统",
        root: path.join(installDir, "skills"),
        scope: "system",
      },
      {
        id: "openclaw-system-extensions",
        label: "OpenClaw 扩展",
        root: path.join(installDir, "extensions"),
        scope: "system",
      },
    );
  }

  const skills = [];
  for (const source of sources) {
    const files = collectSkillMarkdownFiles(source.root);
    for (const skillFile of files) {
      const parsed = parseSkillFile(skillFile, source);
      if (parsed) {
        skills.push(parsed);
      }
    }
  }

  const sorted = sortByTimeDesc(skills, "updatedAt");
  const summary = {
    total: sorted.length,
    system: sorted.filter((item) => item.scope === "system").length,
    custom: sorted.filter((item) => item.scope === "custom").length,
    sources: sources.map((source) => ({
      id: source.id,
      label: source.label,
      count: sorted.filter((item) => item.source === source.id).length,
    })),
    installDir,
  };

  return {
    summary,
    skills: sorted,
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

    if (requestUrl.pathname === "/api/runtime") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, {
        envFile: serializeEnvFileLoadResult(),
        paths: serializeRuntimePaths(),
        validation: RUNTIME_VALIDATION,
      });
      return;
    }

    if (requestUrl.pathname === "/api/summary") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      const config = safeReadJson(CONFIG_PATH);
      const logTail = await readTail(LOG_PATHS.gateway);
      const logLines = parseLogLines(logTail);
      sendJson(res, 200, buildSummary(config, logLines));
      return;
    }

    if (requestUrl.pathname === "/api/agents") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      const config = safeReadJson(CONFIG_PATH);
      const logTail = await readTail(LOG_PATHS.gateway);
      const logLines = parseLogLines(logTail);
      const sessionStatusByAgent = buildSessionStatusByAgent(config);
      sendJson(res, 200, { agents: buildAgentStatus(config, logLines, sessionStatusByAgent) });
      return;
    }

    if (requestUrl.pathname === "/api/logs") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
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
          path: SESSION_LOG_GLOB,
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
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      const config = safeReadJson(CONFIG_PATH);
      sendJson(res, 200, sanitizeConfig(config));
      return;
    }

    if (requestUrl.pathname === "/api/config/file") {
      if (!isLoopbackRequest(req)) {
        sendText(res, 403, "Forbidden");
        return;
      }
      if (req.method === "GET") {
        const stat = safeStat(CONFIG_PATH);
        const content = stat?.isFile() ? safeReadText(CONFIG_PATH) : "";
        let parseError = null;
        if (content) {
          try {
            JSON.parse(content);
          } catch (error) {
            parseError = error?.message ?? "Invalid JSON";
          }
        }
        sendJson(res, 200, {
          path: CONFIG_PATH,
          exists: Boolean(stat?.isFile()),
          size: stat?.isFile() ? stat.size : 0,
          mtimeMs: stat?.isFile() ? stat.mtimeMs : null,
          mtimeIso: stat?.isFile() ? toIsoTimestamp(stat.mtimeMs) : null,
          content,
          parseError,
        });
        return;
      }
      if (req.method === "POST") {
        try {
          const rawBody = await readRequestBody(req, 2 * 1024 * 1024);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const content = body?.content;
          if (typeof content !== "string") {
            sendJson(res, 400, { ok: false, error: "Missing field: content (string)" });
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch (error) {
            sendJson(res, 400, { ok: false, error: `Invalid JSON: ${error?.message ?? "parse error"}` });
            return;
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            sendJson(res, 400, { ok: false, error: "Config must be a JSON object." });
            return;
          }

          await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
          const existingStat = safeStat(CONFIG_PATH);
          const mode = existingStat?.isFile() ? (existingStat.mode & 0o777) : 0o600;

          let backupPath = null;
          if (existingStat?.isFile()) {
            backupPath = `${CONFIG_PATH}.bak-${formatBackupSuffix(new Date())}`;
            try {
              await fs.promises.copyFile(CONFIG_PATH, backupPath);
            } catch (error) {
              backupPath = null;
            }
          }

          await writeFileAtomically(CONFIG_PATH, content, { mode });
          const stat = safeStat(CONFIG_PATH);
          sendJson(res, 200, {
            ok: true,
            path: CONFIG_PATH,
            backupPath,
            size: stat?.isFile() ? stat.size : null,
            mtimeMs: stat?.isFile() ? stat.mtimeMs : null,
            mtimeIso: stat?.isFile() ? toIsoTimestamp(stat.mtimeMs) : null,
          });
        } catch (error) {
          const message = error?.message ?? "Failed to save config";
          if (message.toLowerCase().includes("too large")) {
            sendJson(res, 413, { ok: false, error: message });
            return;
          }
          sendJson(res, 500, { ok: false, error: message });
        }
        return;
      }

      sendMethodNotAllowed(res, ["GET", "POST"]);
      return;
    }

    if (requestUrl.pathname === "/api/gateway/restart") {
      if (!isLoopbackRequest(req)) {
        sendText(res, 403, "Forbidden");
        return;
      }
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, ["POST"]);
        return;
      }

      req.resume();
      const openclawPath = resolveExecutablePathFromPath("openclaw");
      if (!openclawPath) {
        sendJson(res, 500, { ok: false, error: "openclaw executable not found on PATH" });
        return;
      }

      const result = await runCommand(openclawPath, ["daemon", "restart"], {
        timeoutMs: 30000,
        maxOutputBytes: 128 * 1024,
      });
      sendJson(res, 200, {
        ok: !result.timedOut && (result.code === 0 || result.code == null),
        openclawPath,
        ...result,
      });
      return;
    }

    if (requestUrl.pathname === "/api/schedules") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      const jobs = readCronJobs();
      sendJson(res, 200, {
        summary: buildCronSummary(jobs),
        jobs: jobs.sort((a, b) => {
          const aNext = Date.parse(a.state.nextRunAt ?? "") || Number.MAX_SAFE_INTEGER;
          const bNext = Date.parse(b.state.nextRunAt ?? "") || Number.MAX_SAFE_INTEGER;
          return aNext - bNext;
        }),
      });
      return;
    }

    if (requestUrl.pathname === "/api/skills") {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, readSkillsInventory());
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
  printEnvFileWarnings();

  if (!RUNTIME_VALIDATION.ok) {
    console.error("[startup] runtime path validation failed.");
    for (const line of formatValidationReport(RUNTIME_VALIDATION)) {
      console.error(`[startup] ${line}`);
    }
    console.error(
      "[startup] Set OPENCLAW_HOME or OPENCLAW_* path variables to match your deployment directories.",
    );
    process.exit(1);
  }

  if (RUNTIME_VALIDATION.hasWarnings) {
    for (const check of RUNTIME_VALIDATION.checks.filter((item) => item.status === "warn")) {
      console.warn(`[startup] [WARN] ${check.name}: ${check.path} (${check.message})`);
    }
  }

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
  if (fs.existsSync(ENV_FILE_PATH)) {
    watchTargets.push(ENV_FILE_PATH);
  }

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
