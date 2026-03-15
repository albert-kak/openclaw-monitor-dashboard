const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");

const PORT = 17788;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
const CONFIG_PATH = path.join(OPENCLAW_DIR, "openclaw.json");
const LOG_PATHS = {
  gateway: path.join(OPENCLAW_DIR, "logs", "gateway.log"),
  gatewayError: path.join(OPENCLAW_DIR, "logs", "gateway.err.log"),
};

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

function buildAgentStatus(config, logLines) {
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

    const lastEventAt = mostRecent?.lastEventAt ?? null;
    return {
      id: agent.id,
      default: Boolean(agent.default),
      model: agent.model ?? defaults?.model?.primary ?? "unknown",
      workspace: agent.workspace ?? defaults?.workspace ?? "unknown",
      mentionPatterns: agent.groupChat?.mentionPatterns ?? [],
      bindings: agentBindings,
      lastEventAt,
      state: classifyFreshness(lastEventAt),
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

const server = http.createServer(async (req, res) => {
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
    sendJson(res, 200, { agents: buildAgentStatus(config, logLines) });
    return;
  }

  if (requestUrl.pathname === "/api/logs") {
    const type = requestUrl.searchParams.get("type") ?? "gateway";
    const lines = Number(requestUrl.searchParams.get("lines") ?? 200);
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
});

server.listen(PORT, () => {
  console.log(`OpenClaw monitor dashboard running on http://localhost:${PORT}`);
});
