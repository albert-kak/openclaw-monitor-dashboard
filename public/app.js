const state = {
  summary: null,
  agents: [],
  config: null,
  configFile: null,
  configFileLoadedContent: "",
  configFileDirty: false,
  configFileReadOnly: false,
  configSaveInFlight: false,
  gatewayRestartInFlight: false,
  configMonaco: null,
  configEditorSilent: false,
  configEditorWrap: false,
  configValidationTimer: null,
  schedules: [],
  scheduleSummary: null,
  scheduleExpandedKeys: new Set(),
  tokenUsage: null,
  tokenUsageError: "",
  tokenUsageInFlight: false,
  tokenUsageLastUpdateAt: null,
  tokenDateFrom: "",
  tokenDateTo: "",
  tokenTrendGranularity: "hour",
  skills: [],
  skillSummary: null,
  skillScrollTopBySection: {},
  refreshInFlight: false,
  logRawLines: [],
  logSearchQuery: "",
  logLevelFilter: "all",
  logExpandedKeys: new Set(),
  logAutoScroll: true,
  logLastUpdateAt: null,
  realtimeLogFilter: "全部",
  realtimeLogRawLines: [],
  realtimeLatestByAgent: new Map(),
  realtimeLogExpandedKeys: new Set(),
  realtimeLogAutoScroll: true,
  realtimeLogLastUpdateAt: null,
};

const elements = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".panel"),
  agentStatus: document.getElementById("agent-status"),
  agentMeta: document.getElementById("agent-meta"),
  agentList: document.getElementById("agent-list"),
  tokenUsageMeta: document.getElementById("token-usage-meta"),
  tokenUsageSummary: document.getElementById("token-usage-summary"),
  tokenUsageTableBody: document.getElementById("token-usage-table-body"),
  tokenTrendLegend: document.getElementById("token-trend-legend"),
  tokenTrendChart: document.getElementById("token-trend-chart"),
  tokenDateFrom: document.getElementById("token-date-from"),
  tokenDateTo: document.getElementById("token-date-to"),
  tokenFilterApply: document.getElementById("token-filter-apply"),
  tokenFilterToday: document.getElementById("token-filter-today"),
  tokenFilterReset: document.getElementById("token-filter-reset"),
  tokenRefresh: document.getElementById("token-refresh"),
  tokenGranularityDay: document.getElementById("token-granularity-day"),
  tokenGranularityHour: document.getElementById("token-granularity-hour"),
  logBox: document.getElementById("log-box"),
  logViewport: document.getElementById("log-viewport"),
  logSearch: document.getElementById("log-search"),
  logLevelAll: document.getElementById("log-level-all"),
  logLevelIssues: document.getElementById("log-level-issues"),
  logStats: document.getElementById("log-stats"),
  clearLogs: document.getElementById("clear-logs"),
  logAutoScrollButton: document.getElementById("log-autoscroll"),
  refreshLogs: document.getElementById("refresh-logs"),
  configEditorMonaco: document.getElementById("config-editor-monaco"),
  configEditor: document.getElementById("config-editor"),
  configFilePath: document.getElementById("config-file-path"),
  configFileMeta: document.getElementById("config-file-meta"),
  configMessage: document.getElementById("config-message"),
  configReload: document.getElementById("config-reload"),
  configFormat: document.getElementById("config-format"),
  configValidate: document.getElementById("config-validate"),
  configWrap: document.getElementById("config-wrap"),
  configSave: document.getElementById("config-save"),
  configCursorStatus: document.getElementById("config-cursor-status"),
  configJsonStatus: document.getElementById("config-json-status"),
  gatewayRestart: document.getElementById("gateway-restart"),
  gatewayActionMeta: document.getElementById("gateway-action-meta"),
  gatewayActionOutput: document.getElementById("gateway-action-output"),
  gatewayDot: document.getElementById("gateway-dot"),
  gatewayText: document.getElementById("gateway-text"),
  realtimeLogMeta: document.getElementById("realtime-log-meta"),
  realtimeLogFilters: document.getElementById("realtime-log-filters"),
  realtimeLogViewport: document.getElementById("realtime-log-viewport"),
  realtimeLogLines: document.getElementById("realtime-log-lines"),
  scheduleMeta: document.getElementById("schedule-meta"),
  scheduleList: document.getElementById("schedule-list"),
  skillMeta: document.getElementById("skill-meta"),
  skillList: document.getElementById("skill-list"),
};

const statusLabels = {
  active: "运行中",
  idle: "空闲",
  stale: "待关注",
  offline: "离线",
  unknown: "未知",
};

const REALTIME_LOG_PREVIEW_CHARS = 220;
const AGENT_ACTIVITY_PREVIEW_CHARS = 140;
const LOG_STREAM_PREVIEW_CHARS = 320;
const SCHEDULE_PREVIEW_CHARS = 260;
const MONACO_VS_BASE_URL = "/vendor/monaco/vs";
const TAB_STORAGE_KEY = "ocd.activeTab";
const INTEGER_FORMATTER = new Intl.NumberFormat();
const COST_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const COMPACT_INTEGER_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const TOKEN_TREND_COLORS = [
  "#22d3ee",
  "#f97316",
  "#a3e635",
  "#f43f5e",
  "#60a5fa",
];

let monacoLoadPromise = null;

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return INTEGER_FORMATTER.format(Math.round(numeric));
}

function formatCost(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "$0.0000";
  }
  return `$${COST_FORMATTER.format(numeric)}`;
}

function formatCompactInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return COMPACT_INTEGER_FORMATTER.format(Math.round(numeric));
}

function compactLabel(value, maxLength = 26) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function statusDotClass(state) {
  return `status-dot status-dot--${state || "unknown"}`;
}

function resolveAgentEmoji() {
  return "🧑‍💻";
}

function resolveStateEmoji(state) {
  if (state === "active") return "⌨️";
  if (state === "idle") return "☕";
  if (state === "stale") return "⏳";
  if (state === "offline") return "💤";
  return "❔";
}

function renderStateEmojiMarkup(state) {
  if (state === "active") {
    return `
      <span class="agent-node__typing-stack">
        <span class="agent-node__typing-keyboard">⌨️</span>
        <span class="agent-node__typing-hands">
          <span class="agent-node__typing-hand agent-node__typing-hand--left">👆</span>
          <span class="agent-node__typing-hand agent-node__typing-hand--right">👆</span>
        </span>
      </span>
    `;
  }
  return resolveStateEmoji(state);
}

function resolveAgentRole(isRoot) {
  return isRoot ? "主控" : "子代理";
}

function buildAgentRuntimeLine(agent) {
  if (agent?.state === "active") {
    const agentKey = normalizeText(agent?.id).toLowerCase();
    const latest = agentKey ? state.realtimeLatestByAgent.get(agentKey) : "";
    const text = latest || "实时日志流暂无新动态";
    return `<div class="agent-node__line">动态: ${escapeHtml(text)}</div>`;
  }
  return `<div class="agent-node__line">最近: ${escapeHtml(formatDate(agent?.lastEventAt))}</div>`;
}

function renderSummary() {
  if (state.summary?.logs?.lastEventAt) {
    if (elements.gatewayDot) {
      elements.gatewayDot.className = statusDotClass(
        deriveGatewayStatus(state.summary.logs.lastEventAt),
      );
    }
    if (elements.gatewayText) {
      elements.gatewayText.textContent = `Gateway · ${formatDate(state.summary.logs.lastEventAt)}`;
    }
  }
}

function deriveGatewayStatus(lastEventAt) {
  if (!lastEventAt) return "unknown";
  const minutes = Math.floor((Date.now() - Date.parse(lastEventAt)) / 60000);
  if (minutes <= 5) return "active";
  if (minutes <= 30) return "idle";
  if (minutes <= 180) return "stale";
  return "offline";
}

function renderAgentStatus() {
  if (!elements.agentStatus) {
    return;
  }
  if (!state.agents.length) {
    elements.agentStatus.innerHTML = `<div class="card">No agents found.</div>`;
    if (elements.agentMeta) {
      elements.agentMeta.textContent = "";
    }
    return;
  }

  const rootAgent = state.agents.find((agent) => agent.default) ?? state.agents[0];
  const childAgents = state.agents.filter((agent) => agent.id !== rootAgent.id);
  const rootEmoji = resolveAgentEmoji();
  const rootStateEmoji = renderStateEmojiMarkup(rootAgent.state);
  const rootRole = resolveAgentRole(true);

  const childMarkup = childAgents
    .map((agent) => {
      const agentEmoji = resolveAgentEmoji();
      const stateEmoji = renderStateEmojiMarkup(agent.state);
      const role = resolveAgentRole(false);
      const runtimeLine = buildAgentRuntimeLine(agent);

      return `
        <article class="agent-node agent-node--child">
          <div class="agent-node__hero">
            <span class="agent-node__emoji-pack">
              <span class="agent-node__emoji agent-node__emoji--avatar">${agentEmoji}</span>
              <span class="agent-node__emoji agent-node__emoji--state ${agent.state === "active" ? "agent-node__emoji--typing" : ""}">${stateEmoji}</span>
              ${agent.state === "active" ? '<span class="agent-node__typing-dots">...</span>' : ""}
              <span class="agent-node__spark agent-node__spark--a">✨</span>
              <span class="agent-node__spark agent-node__spark--b">•</span>
            </span>
          </div>
          <div class="agent-node__meta-row">
            <div class="agent-node__meta-left">
              <span class="agent-node__dot agent-node__dot--${agent.state ?? "unknown"}"></span>
              <div>
                <div class="agent-node__title">${agent.id}</div>
                <div class="agent-node__role">${role}</div>
              </div>
            </div>
            <span class="state-pill state-pill--${agent.state ?? "unknown"}">${statusLabels[agent.state] ?? statusLabels.unknown}</span>
          </div>
          <div class="agent-node__line agent-node__line--current">当前模型: ${escapeHtml(normalizeText(agent.model) || "unknown")}</div>
          ${runtimeLine}
        </article>
      `;
    })
    .join("");

  if (elements.agentMeta) {
    elements.agentMeta.textContent = `Last refresh: ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })}`;
  }
  elements.agentStatus.innerHTML = `
    <div class="agent-topology">
      <article class="agent-node agent-node--root">
        <div class="agent-node__hero">
          <span class="agent-node__emoji-pack">
            <span class="agent-node__emoji agent-node__emoji--avatar">${rootEmoji}</span>
            <span class="agent-node__emoji agent-node__emoji--state ${rootAgent.state === "active" ? "agent-node__emoji--typing" : ""}">${rootStateEmoji}</span>
            ${rootAgent.state === "active" ? '<span class="agent-node__typing-dots">...</span>' : ""}
            <span class="agent-node__spark agent-node__spark--a">✨</span>
            <span class="agent-node__spark agent-node__spark--b">•</span>
          </span>
        </div>
        <div class="agent-node__meta-row">
          <div class="agent-node__meta-left">
            <span class="agent-node__dot agent-node__dot--${rootAgent.state ?? "unknown"}"></span>
            <div>
              <div class="agent-node__title">${rootAgent.id}</div>
              <div class="agent-node__role">${rootRole}</div>
            </div>
          </div>
          <span class="state-pill state-pill--${rootAgent.state ?? "unknown"}">${statusLabels[rootAgent.state] ?? statusLabels.unknown}</span>
        </div>
        <div class="agent-node__line agent-node__line--current">当前模型: ${escapeHtml(normalizeText(rootAgent.model) || "unknown")}</div>
        ${buildAgentRuntimeLine(rootAgent)}
      </article>
      <div class="agent-links"></div>
      <div class="agent-children ${childAgents.length <= 1 ? "agent-children--single" : ""}">
        ${childMarkup || '<article class="agent-node agent-node--child"><div class="agent-node__line">No sub agent</div></article>'}
      </div>
    </div>
  `;
}

function renderAgentList() {
  if (!elements.agentList) {
    return;
  }
  if (!state.agents.length) {
    elements.agentList.innerHTML = `<div class="card">No agent data available.</div>`;
    return;
  }
  elements.agentList.innerHTML = state.agents
    .map((agent) => {
      const bindingLines = agent.bindings
        .map(
          (binding) =>
            `${binding.channel}:${binding.accountId} · ${statusLabels[binding.status?.state ?? "unknown"]}`,
        )
        .join("<br />");

      return `
        <article class="agent-row">
          <h3>${agent.id}${agent.default ? " (default)" : ""}</h3>
          <div class="agent-row__grid">
            <div class="agent-row__item">
              <strong>Status</strong>
              ${statusLabels[agent.state] ?? statusLabels.unknown}
            </div>
            <div class="agent-row__item">
              <strong>Model</strong>
              ${agent.model}
            </div>
            <div class="agent-row__item">
              <strong>Workspace</strong>
              ${agent.workspace}
            </div>
            <div class="agent-row__item">
              <strong>Last Event</strong>
              ${formatDate(agent.lastEventAt)}
            </div>
            <div class="agent-row__item">
              <strong>Bindings</strong>
              ${bindingLines || "—"}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function fetchJson(url, options = undefined) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || `Request failed: ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

function setInlineMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text || "";
  element.className = `inline-message${kind ? ` inline-message--${kind}` : ""}`;
}

function setConfigJsonStatus(valid, detail = "") {
  if (!elements.configJsonStatus) return;
  if (valid == null) {
    elements.configJsonStatus.textContent = "JSON status: unknown";
    elements.configJsonStatus.className = "";
    return;
  }
  if (valid) {
    elements.configJsonStatus.textContent = "JSON status: valid";
    elements.configJsonStatus.className = "config-json-status config-json-status--valid";
    return;
  }
  elements.configJsonStatus.textContent = detail
    ? `JSON status: invalid (${detail})`
    : "JSON status: invalid";
  elements.configJsonStatus.className = "config-json-status config-json-status--invalid";
}

function parseJsonValidationError(error) {
  const message = String(error?.message ?? "Invalid JSON");
  const line = message.match(/line\s+(\d+)/i)?.[1];
  const column = message.match(/column\s+(\d+)/i)?.[1];
  if (line && column) {
    return `line ${line}, col ${column}`;
  }
  return message.slice(0, 90);
}

function evaluateConfigJson(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        valid: false,
        detail: "root must be object",
      };
    }
    return { valid: true, detail: "" };
  } catch (error) {
    return {
      valid: false,
      detail: parseJsonValidationError(error),
    };
  }
}

function refreshConfigCursorStatus() {
  if (!elements.configCursorStatus) return;
  if (state.configMonaco) {
    const cursor = state.configMonaco.getPosition();
    const line = cursor?.lineNumber ?? 1;
    const col = cursor?.column ?? 1;
    elements.configCursorStatus.textContent = `Ln ${line}, Col ${col}`;
    return;
  }
  const text = getConfigEditorText();
  const position = elements.configEditor?.selectionStart ?? 0;
  const before = text.slice(0, position);
  const lines = before.split("\n");
  const line = lines.length;
  const col = (lines[lines.length - 1] ?? "").length + 1;
  elements.configCursorStatus.textContent = `Ln ${line}, Col ${col}`;
}

function refreshConfigJsonValidation() {
  const result = evaluateConfigJson(getConfigEditorText());
  setConfigJsonStatus(result.valid, result.detail);
}

function scheduleConfigJsonValidation(delayMs = 150) {
  if (state.configValidationTimer) {
    clearTimeout(state.configValidationTimer);
  }
  state.configValidationTimer = setTimeout(() => {
    state.configValidationTimer = null;
    refreshConfigJsonValidation();
  }, delayMs);
}

function renderConfigWrapButton() {
  if (!elements.configWrap) return;
  elements.configWrap.textContent = `Soft Wrap: ${state.configEditorWrap ? "On" : "Off"}`;
  elements.configWrap.classList.toggle("btn--active", state.configEditorWrap);
}

function setMonacoEditorVisible(enabled) {
  if (elements.configEditor) {
    elements.configEditor.classList.toggle("is-hidden", Boolean(enabled));
  }
  if (elements.configEditorMonaco) {
    elements.configEditorMonaco.classList.toggle("is-active", Boolean(enabled));
  }
}

function layoutConfigMonacoEditor() {
  if (state.configMonaco) {
    state.configMonaco.layout();
  }
}

function setConfigEditorWrap(enabled) {
  state.configEditorWrap = Boolean(enabled);
  if (state.configMonaco) {
    state.configMonaco.updateOptions({
      wordWrap: state.configEditorWrap ? "on" : "off",
    });
  } else if (elements.configEditor) {
    elements.configEditor.style.whiteSpace = state.configEditorWrap ? "pre-wrap" : "pre";
    elements.configEditor.style.overflowX = state.configEditorWrap ? "hidden" : "auto";
  }
  renderConfigWrapButton();
}

function setupConfigTextareaFallback() {
  if (!elements.configEditor) {
    return;
  }
  elements.configEditor.addEventListener("input", () => {
    updateConfigDirtyState();
    scheduleConfigJsonValidation();
    refreshConfigCursorStatus();
  });
  elements.configEditor.addEventListener("click", refreshConfigCursorStatus);
  elements.configEditor.addEventListener("keyup", refreshConfigCursorStatus);
  setConfigEditorWrap(state.configEditorWrap);
  refreshConfigCursorStatus();
  refreshConfigJsonValidation();
}

function loadMonacoApi() {
  if (window.monaco?.editor) {
    return Promise.resolve(window.monaco);
  }
  if (monacoLoadPromise) {
    return monacoLoadPromise;
  }
  if (typeof window.require !== "function" || typeof window.require.config !== "function") {
    return Promise.reject(new Error("Monaco loader unavailable"));
  }

  window.MonacoEnvironment = {
    getWorkerUrl() {
      const bootstrap = [
        `self.MonacoEnvironment = { baseUrl: "${MONACO_VS_BASE_URL}/" };`,
        `importScripts("${MONACO_VS_BASE_URL}/base/worker/workerMain.js");`,
      ].join("\n");
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(bootstrap)}`;
    },
  };

  window.require.config({ paths: { vs: MONACO_VS_BASE_URL } });
  monacoLoadPromise = new Promise((resolve, reject) => {
    window.require(
      ["vs/editor/editor.main"],
      () => {
        if (!window.monaco?.editor) {
          reject(new Error("Monaco initialization failed"));
          return;
        }
        resolve(window.monaco);
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error ?? "Monaco load failed")));
      },
    );
  });
  return monacoLoadPromise;
}

function setupMonacoEditor(monaco) {
  if (!elements.configEditor || !elements.configEditorMonaco || state.configMonaco) {
    return;
  }
  setMonacoEditorVisible(true);

  monaco.languages?.json?.jsonDefaults?.setDiagnosticsOptions?.({
    validate: true,
    allowComments: false,
  });

  const editor = monaco.editor.create(elements.configEditorMonaco, {
    value: elements.configEditor.value ?? "",
    language: "json",
    theme: "vs-dark",
    lineNumbers: "on",
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,
    readOnly: Boolean(state.configFileReadOnly),
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    renderWhitespace: "selection",
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 18,
    wordWrap: state.configEditorWrap ? "on" : "off",
    automaticLayout: false,
  });

  editor.onDidChangeModelContent(() => {
    updateConfigDirtyState();
    scheduleConfigJsonValidation();
    refreshConfigCursorStatus();
  });
  editor.onDidChangeCursorPosition(refreshConfigCursorStatus);

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveConfigFile());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => formatConfigFile());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
    editor.getAction("editor.action.nextMatchFindAction").run();
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG, () => {
    editor.getAction("editor.action.previousMatchFindAction").run();
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ, () => {
    editor.getAction("editor.toggleFold").run();
  });

  state.configMonaco = editor;
  renderConfigWrapButton();
  refreshConfigCursorStatus();
  refreshConfigJsonValidation();
  requestAnimationFrame(() => layoutConfigMonacoEditor());
}

function setupConfigCodeEditor() {
  setupConfigTextareaFallback();
  if (!elements.configEditorMonaco) {
    return;
  }
  setMonacoEditorVisible(false);
  loadMonacoApi()
    .then((monaco) => {
      setupMonacoEditor(monaco);
    })
    .catch((error) => {
      console.warn("Monaco unavailable, fallback to textarea editor:", error);
      setMonacoEditorVisible(false);
    });
}

function getConfigEditorText() {
  if (state.configMonaco) {
    return state.configMonaco.getValue();
  }
  return elements.configEditor?.value ?? "";
}

function setConfigEditorText(text) {
  const next = text ?? "";
  if (elements.configEditor) {
    elements.configEditor.value = next;
  }
  if (state.configMonaco) {
    state.configMonaco.setValue(next);
    refreshConfigCursorStatus();
    scheduleConfigJsonValidation(0);
    return;
  }
  if (elements.configEditor) {
    refreshConfigCursorStatus();
    scheduleConfigJsonValidation(0);
  }
}

function setConfigEditorReadOnly(readOnly) {
  if (state.configMonaco) {
    state.configMonaco.updateOptions({ readOnly: Boolean(readOnly) });
    return;
  }
  if (elements.configEditor) {
    elements.configEditor.readOnly = Boolean(readOnly);
  }
}

async function refreshSummary() {
  state.summary = await fetchJson("/api/summary");
  renderSummary();
}

async function refreshAgents() {
  const data = await fetchJson("/api/agents");
  state.agents = data.agents ?? [];
  renderAgentStatus();
  renderAgentList();
  renderSummary();
}

async function refreshLogs() {
  if (!elements.logBox) {
    return;
  }
  const data = await fetchJson("/api/logs?lines=200");
  state.logRawLines = Array.isArray(data?.lines) ? data.lines : [];
  state.logLastUpdateAt = Date.now();
  renderGatewayLogs();
}

function deriveGatewayLogKind(text) {
  if (!text) return "info";
  const lower = text.toLowerCase();
  if (/\b(error|fatal|exception|traceback|panic|failed)\b/i.test(text) || /(enoent|econn|timed out)/i.test(text)) {
    return "error";
  }
  if (/\b(warn|warning|deprecated|retry|timeout)\b/i.test(text) || /( 4\d\d | 5\d\d )/.test(` ${lower} `)) {
    return "warn";
  }
  if (/\b(debug|trace|verbose)\b/i.test(text)) {
    return "debug";
  }
  return "info";
}

function buildGatewayLogEntries(rawLines) {
  return rawLines.map((line, index) => {
    const { timestampIso, rest } = extractTimestamp(line);
    const text = (rest ?? "").trimStart() || line;
    const kind = deriveGatewayLogKind(text);
    const level = kind.toUpperCase();
    const time = timestampIso
      ? formatTime(timestampIso)
      : (line.match(/^(\d{2}:\d{2}:\d{2})/)?.[1] ?? "--:--:--");
    return {
      key: `${index}|${line}`,
      line,
      text,
      kind,
      level,
      time,
    };
  });
}

function renderLogAutoScrollButton() {
  if (!elements.logAutoScrollButton) return;
  elements.logAutoScrollButton.textContent = `Auto Scroll: ${state.logAutoScroll ? "On" : "Off"}`;
  elements.logAutoScrollButton.classList.toggle("btn--active", state.logAutoScroll);
}

function renderLogLevelFilterButtons() {
  if (elements.logLevelAll) {
    elements.logLevelAll.classList.toggle("btn--active", state.logLevelFilter === "all");
  }
  if (elements.logLevelIssues) {
    elements.logLevelIssues.classList.toggle("btn--active", state.logLevelFilter === "issues");
  }
}

function renderGatewayLogs() {
  if (!elements.logBox || !elements.logViewport) {
    return;
  }

  const viewport = elements.logViewport;
  const shouldStick = state.logAutoScroll || isNearBottom(viewport);
  const previousScrollTop = viewport.scrollTop;
  const allEntries = buildGatewayLogEntries(state.logRawLines);
  const query = state.logSearchQuery.trim().toLowerCase();
  const queryFiltered = query
    ? allEntries.filter((entry) => entry.text.toLowerCase().includes(query) || entry.line.toLowerCase().includes(query))
    : allEntries;
  const entries = state.logLevelFilter === "issues"
    ? queryFiltered.filter((entry) => entry.kind === "error" || entry.kind === "warn")
    : queryFiltered;

  const counters = entries.reduce(
    (acc, entry) => {
      acc.total += 1;
      if (entry.kind === "error") acc.error += 1;
      if (entry.kind === "warn") acc.warn += 1;
      if (entry.kind === "info") acc.info += 1;
      if (entry.kind === "debug") acc.debug += 1;
      return acc;
    },
    { total: 0, error: 0, warn: 0, info: 0, debug: 0 },
  );

  if (!entries.length) {
    elements.logBox.innerHTML = '<div class="log-stream__empty">No logs matched current filters.</div>';
  } else {
    elements.logBox.innerHTML = entries
      .map((entry) => {
        const preview = buildLogPreview(entry.text, LOG_STREAM_PREVIEW_CHARS);
        const expanded = state.logExpandedKeys.has(entry.key);
        const displayText = expanded ? entry.text : preview.preview;
        const toggleMarkup = preview.truncated
          ? `<button class="log-line__toggle" type="button" data-gateway-expand="${escapeHtml(entry.key)}">${expanded ? "收起" : "展开"}</button>`
          : "";
        return `
          <article class="log-stream-line log-stream-line--${escapeHtml(entry.kind)}">
            <div class="log-stream-line__time">${escapeHtml(entry.time)}</div>
            <div class="log-stream-line__axis"><span class="log-stream-line__dot"></span></div>
            <div class="log-stream-line__card">
              <div class="log-stream-line__meta"><span class="log-stream-line__level">${escapeHtml(entry.level)}</span></div>
              <div class="log-stream-line__text">${decorateLogText(displayText)}</div>
              ${toggleMarkup}
            </div>
          </article>
        `;
      })
      .join("");
  }

  elements.logBox.querySelectorAll("[data-gateway-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.gatewayExpand;
      if (!key) return;
      if (state.logExpandedKeys.has(key)) {
        state.logExpandedKeys.delete(key);
      } else {
        state.logExpandedKeys.add(key);
      }
      renderGatewayLogs();
    });
  });

  if (shouldStick) {
    viewport.scrollTop = viewport.scrollHeight;
  } else {
    viewport.scrollTop = previousScrollTop;
  }

  if (elements.logStats) {
    const updatedAt = state.logLastUpdateAt
      ? new Date(state.logLastUpdateAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      : "-";
    const filteredHint = query ? ` · filter "${state.logSearchQuery}"` : "";
    const levelHint = state.logLevelFilter === "issues" ? " · mode issues" : "";
    elements.logStats.textContent = `${counters.total}/${allEntries.length} lines · error ${counters.error} · warn ${counters.warn} · info ${counters.info} · debug ${counters.debug} · updated ${updatedAt}${filteredHint}${levelHint}`;
  }

  renderLogLevelFilterButtons();
  renderLogAutoScrollButton();
}

function clearGatewayLogsView() {
  state.logRawLines = [];
  state.logExpandedKeys.clear();
  state.logLastUpdateAt = Date.now();
  renderGatewayLogs();
}

function renderConfigFileInfo(fileData) {
  if (elements.configFilePath) {
    const label = fileData?.path ? fileData.path : "—";
    elements.configFilePath.textContent = label;
  }
  if (elements.configFileMeta) {
    if (!fileData) {
      elements.configFileMeta.textContent = "";
      return;
    }
    const existsLabel = fileData.exists ? "exists" : "missing";
    const mtime = fileData.mtimeIso ? formatDate(fileData.mtimeIso) : "—";
    const size = Number.isFinite(fileData.size) ? `${fileData.size} bytes` : "—";
    const parseHint = fileData.parseError ? " · invalid JSON" : "";
    elements.configFileMeta.textContent = `${existsLabel} · mtime ${mtime} · ${size}${parseHint}`;
  }
}

function renderGatewayAction(result, error) {
  if (elements.gatewayActionMeta) {
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    if (error) {
      elements.gatewayActionMeta.textContent = `Last attempt ${now} · error`;
    } else if (result) {
      const ok = Boolean(result.ok);
      const duration = Number.isFinite(result.durationMs) ? `${result.durationMs} ms` : "—";
      elements.gatewayActionMeta.textContent = `Last attempt ${now} · ${ok ? "ok" : "failed"} · ${duration}`;
    } else {
      elements.gatewayActionMeta.textContent = "";
    }
  }

  if (elements.gatewayActionOutput) {
    if (error) {
      elements.gatewayActionOutput.textContent = String(error?.message ?? error);
      elements.gatewayActionOutput.style.display = "block";
      return;
    }
    if (!result) {
      elements.gatewayActionOutput.textContent = "";
      elements.gatewayActionOutput.style.display = "none";
      return;
    }
    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const pieces = [];
    if (stdout) pieces.push(`stdout:\n${stdout}`);
    if (stderr) pieces.push(`stderr:\n${stderr}`);
    if (!pieces.length) {
      pieces.push(result.ok ? "OK" : "No output");
    }
    elements.gatewayActionOutput.textContent = pieces.join("\n\n");
    elements.gatewayActionOutput.style.display = "block";
  }
}

function updateConfigControls() {
  const readOnly = Boolean(state.configFileReadOnly);
  const saving = Boolean(state.configSaveInFlight);
  const restarting = Boolean(state.gatewayRestartInFlight);
  const dirty = Boolean(state.configFileDirty);

  if (elements.configReload) elements.configReload.disabled = saving;
  if (elements.configFormat) elements.configFormat.disabled = saving;
  if (elements.configValidate) elements.configValidate.disabled = saving;
  if (elements.configWrap) elements.configWrap.disabled = false;
  if (elements.configSave) elements.configSave.disabled = readOnly || saving || !dirty;
  if (elements.gatewayRestart) elements.gatewayRestart.disabled = readOnly || restarting;
}

async function loadConfigFile(options = {}) {
  if (!elements.configEditor) {
    return;
  }
  const force = Boolean(options.force);
  if (state.configSaveInFlight || state.gatewayRestartInFlight) {
    return;
  }
  if (state.configFileDirty && !force) {
    updateConfigControls();
    return;
  }

  try {
    const data = await fetchJson("/api/config/file");
    state.configFile = data;
    state.configFileReadOnly = false;
    setConfigEditorReadOnly(false);

    renderConfigFileInfo(data);
    state.configEditorSilent = true;
    setConfigEditorText(data.content ?? "");
    state.configEditorSilent = false;
    state.configFileLoadedContent = getConfigEditorText();
    state.configFileDirty = false;

    if (data.parseError) {
      setInlineMessage(elements.configMessage, `JSON 解析失败：${data.parseError}`, "warn");
    } else {
      setInlineMessage(elements.configMessage, "");
    }
  } catch (error) {
    if (error?.status === 403) {
      state.configFileReadOnly = true;
      setConfigEditorReadOnly(true);
      updateConfigControls();

      state.config = await fetchJson("/api/config");
      state.configEditorSilent = true;
      setConfigEditorText(JSON.stringify(state.config, null, 2));
      state.configEditorSilent = false;
      state.configFileLoadedContent = getConfigEditorText();
      state.configFileDirty = false;
      renderConfigFileInfo({
        path: "Sanitized view (remote access blocked)",
        exists: true,
        size: getConfigEditorText().length,
        mtimeIso: null,
        parseError: null,
      });
      setInlineMessage(
        elements.configMessage,
        "当前非本机访问：为安全起见禁用读取/写入真实配置文件与 gateway 控制。",
        "warn",
      );
      return;
    }

    setInlineMessage(elements.configMessage, `加载失败：${error?.message ?? "unknown error"}`, "error");
  } finally {
    updateConfigControls();
  }
}

async function refreshConfig() {
  const configPanel = document.getElementById("config");
  const isActive = Boolean(configPanel?.classList.contains("panel--active"));
  if (!isActive && !state.configFileDirty) {
    return;
  }
  await loadConfigFile({ force: false });
}

function updateConfigDirtyState() {
  if (!elements.configEditor || state.configFileReadOnly) {
    return;
  }
  if (state.configEditorSilent) {
    return;
  }
  state.configFileDirty = getConfigEditorText() !== state.configFileLoadedContent;
  if (state.configFileDirty) {
    setInlineMessage(elements.configMessage, "有未保存更改。", "warn");
  } else {
    setInlineMessage(elements.configMessage, "");
  }
  updateConfigControls();
}

async function saveConfigFile() {
  if (!elements.configEditor || state.configFileReadOnly || state.configSaveInFlight) {
    return;
  }
  state.configSaveInFlight = true;
  updateConfigControls();
  setInlineMessage(elements.configMessage, "保存中…");

  try {
    const content = getConfigEditorText();
    const result = await postJson("/api/config/file", { content });
    state.configFileLoadedContent = content;
    state.configFileDirty = false;
    renderConfigFileInfo({
      path: result.path ?? state.configFile?.path ?? "—",
      exists: true,
      size: result.size ?? content.length,
      mtimeIso: result.mtimeIso ?? null,
      parseError: null,
    });
    const backupHint = result.backupPath ? `（备份: ${result.backupPath}）` : "";
    setInlineMessage(elements.configMessage, `已保存。${backupHint}`, "success");
  } catch (error) {
    setInlineMessage(elements.configMessage, `保存失败：${error?.message ?? "unknown error"}`, "error");
  } finally {
    state.configSaveInFlight = false;
    updateConfigControls();
  }
}

async function reloadConfigFile() {
  if (state.configFileReadOnly) {
    await loadConfigFile({ force: true });
    return;
  }
  if (state.configFileDirty) {
    const ok = window.confirm("存在未保存更改，确定要丢弃并重新加载吗？");
    if (!ok) return;
  }
  await loadConfigFile({ force: true });
}

function formatConfigFile() {
  if (!elements.configEditor || state.configFileReadOnly) {
    return;
  }
  try {
    const parsed = JSON.parse(getConfigEditorText() || "{}");
    state.configEditorSilent = true;
    setConfigEditorText(`${JSON.stringify(parsed, null, 2)}\n`);
    state.configEditorSilent = false;
    updateConfigDirtyState();
    setInlineMessage(elements.configMessage, "已格式化（未保存）。", "warn");
  } catch (error) {
    setInlineMessage(elements.configMessage, `格式化失败：${error?.message ?? "invalid JSON"}`, "error");
  }
}

function validateConfigEditor() {
  if (!elements.configEditor) {
    return;
  }
  const result = evaluateConfigJson(getConfigEditorText());
  setConfigJsonStatus(result.valid, result.detail);
  if (result.valid) {
    setInlineMessage(elements.configMessage, "JSON 校验通过。", "success");
    return;
  }
  setInlineMessage(elements.configMessage, `JSON 校验失败：${result.detail}`, "error");
}

function toggleConfigEditorWrap() {
  setConfigEditorWrap(!state.configEditorWrap);
}

async function restartGateway() {
  if (state.configFileReadOnly || state.gatewayRestartInFlight) {
    return;
  }
  const ok = window.confirm("确定要重启 Gateway 服务吗？");
  if (!ok) return;

  state.gatewayRestartInFlight = true;
  updateConfigControls();
  renderGatewayAction(null, null);
  setInlineMessage(elements.configMessage, "正在重启 gateway…");

  try {
    const result = await postJson("/api/gateway/restart", {});
    renderGatewayAction(result, null);
    if (result.ok) {
      setInlineMessage(elements.configMessage, "Gateway 已触发重启。", "success");
    } else {
      setInlineMessage(elements.configMessage, "Gateway 重启失败（查看下方输出）。", "error");
    }
  } catch (error) {
    renderGatewayAction(null, error);
    setInlineMessage(elements.configMessage, `Gateway 重启请求失败：${error?.message ?? "unknown error"}`, "error");
  } finally {
    state.gatewayRestartInFlight = false;
    updateConfigControls();
  }
}

function statusLabelForSchedule(status) {
  if (status === "ok") return "成功";
  if (status === "error") return "失败";
  if (status === "running") return "运行中";
  if (status === "queued") return "排队";
  return "未知";
}

function scopeLabelForSkill(scope) {
  if (scope === "system") return "系统";
  return "自定义";
}

function deriveDeliveryImInfo(delivery) {
  const target = delivery?.to || delivery?.target || delivery?.im?.to || delivery?.im?.target || "—";
  let im = delivery?.channel || delivery?.im?.channel || delivery?.im?.provider || delivery?.im?.platform || "";
  if (!im && typeof target === "string") {
    const prefix = target.split(":")[0] || "";
    if (prefix && !["channel", "user", "dm", "group"].includes(prefix)) {
      im = prefix;
    }
  }
  return {
    im: im || "—",
    target,
  };
}

function renderSkillSection(sectionKey, title, skills, emptyText) {
  const items = skills
    .map((skill) => {
      const absoluteDir = (skill.path || "").replace(/\/SKILL\.md$/i, "") || "—";
      return `
      <article class="skill-card">
        <div class="skill-card__header">
          <h3>${escapeHtml(skill.name || "Unnamed Skill")}</h3>
          <div class="skill-card__badges">
            <span class="pill">${escapeHtml(skill.sourceLabel || skill.source || "OpenClaw")}</span>
            <span class="pill">${escapeHtml(scopeLabelForSkill(skill.scope))}</span>
          </div>
        </div>
        <div class="skill-card__desc">${escapeHtml(skill.description || "No description")}</div>
        <div class="skill-card__line"><strong>目录:</strong> <code>${escapeHtml(absoluteDir)}</code></div>
        <div class="skill-card__line"><strong>更新时间:</strong> ${escapeHtml(formatDate(skill.updatedAt))}</div>
      </article>
    `;
    })
    .join("");

  return `
    <section class="skill-section">
      <div class="skill-section__header">
        <h3>${escapeHtml(title)}</h3>
        <span class="pill">${skills.length}</span>
      </div>
      <div class="skill-section__list" data-skill-section="${escapeHtml(sectionKey)}">
        ${items || `<div class="card">${escapeHtml(emptyText)}</div>`}
      </div>
    </section>
  `;
}

function renderSchedules() {
  if (!elements.scheduleList) {
    return;
  }

  if (!state.schedules.length) {
    elements.scheduleList.innerHTML = `<div class="card">No scheduled jobs found.</div>`;
    if (elements.scheduleMeta) {
      elements.scheduleMeta.textContent = "未找到定时任务";
    }
    return;
  }

  if (elements.scheduleMeta) {
    const summary = state.scheduleSummary ?? {};
    elements.scheduleMeta.textContent = `共 ${summary.total ?? state.schedules.length} 个任务 · 启用 ${summary.enabled ?? 0} · 错误 ${summary.errors ?? 0} · 下次执行 ${formatDate(summary.nextRunAt)}`;
  }

  elements.scheduleList.innerHTML = state.schedules
    .map((job) => {
      const status = job.state?.lastStatus ?? "unknown";
      const deliveryInfo = deriveDeliveryImInfo(job.delivery);
      const fullPayload = job.payload?.message || job.payload?.preview || "—";
      const payloadPreview = buildLogPreview(fullPayload, SCHEDULE_PREVIEW_CHARS);
      const isExpanded = state.scheduleExpandedKeys.has(job.id);
      const payloadText = isExpanded ? fullPayload : payloadPreview.preview;
      const payloadToggle = payloadPreview.truncated
        ? `<button class="schedule-card__toggle" type="button" data-schedule-expand="${escapeHtml(job.id)}">${isExpanded ? "收起" : "展开"}</button>`
        : "";
      const errorLine = job.state?.lastError
        ? `<div class="schedule-card__line schedule-card__line--error">错误: ${escapeHtml(job.state.lastError)}</div>`
        : "";
      return `
        <article class="schedule-card">
          <div class="schedule-card__header">
            <h3>${escapeHtml(job.name || "unnamed-job")}</h3>
            <span class="schedule-status schedule-status--${escapeHtml(status)}">${escapeHtml(statusLabelForSchedule(status))}</span>
          </div>
          <div class="schedule-card__meta">
            <span class="pill ${job.enabled ? "pill--on" : "pill--off"}">${job.enabled ? "启用" : "禁用"}</span>
            <span class="pill">${escapeHtml(job.agentId || "unknown")}</span>
            <span class="pill">${escapeHtml(job.schedule?.kind || "unknown")}</span>
          </div>
          <div class="schedule-card__line"><strong>表达式:</strong> ${escapeHtml(job.schedule?.expr || "—")} (${escapeHtml(job.schedule?.tz || "local")})</div>
          <div class="schedule-card__line"><strong>下次执行:</strong> ${escapeHtml(formatDate(job.state?.nextRunAt))}</div>
          <div class="schedule-card__line"><strong>上次执行:</strong> ${escapeHtml(formatDate(job.state?.lastRunAt))} · ${escapeHtml(formatDurationMs(job.state?.lastDurationMs))}</div>
          <div class="schedule-card__line">
            <strong>投递:</strong>
            IM ${escapeHtml(deliveryInfo.im)} · 频道 ${escapeHtml(deliveryInfo.target)} · ${escapeHtml(job.state?.lastDeliveryStatus || "unknown")}
          </div>
          <div class="schedule-card__line schedule-card__line--preview">
            <strong>任务内容:</strong>
            <div class="schedule-card__preview">${escapeHtml(payloadText)}</div>
            ${payloadToggle}
          </div>
          ${errorLine}
        </article>
      `;
    })
    .join("");

  elements.scheduleList.querySelectorAll("[data-schedule-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-schedule-expand");
      if (!key) return;
      if (state.scheduleExpandedKeys.has(key)) {
        state.scheduleExpandedKeys.delete(key);
      } else {
        state.scheduleExpandedKeys.add(key);
      }
      renderSchedules();
    });
  });
}

function renderSkills() {
  if (!elements.skillList) {
    return;
  }

  const previousScrollTopBySection = {};
  elements.skillList.querySelectorAll("[data-skill-section]").forEach((section) => {
    const key = section.getAttribute("data-skill-section");
    if (!key) return;
    previousScrollTopBySection[key] = section.scrollTop;
  });
  state.skillScrollTopBySection = {
    ...state.skillScrollTopBySection,
    ...previousScrollTopBySection,
  };

  if (!state.skills.length) {
    elements.skillList.innerHTML = `<div class="card">No skill found under ~/.openclaw/skills.</div>`;
    if (elements.skillMeta) {
      elements.skillMeta.textContent = "未找到技能";
    }
    return;
  }

  if (elements.skillMeta) {
    const summary = state.skillSummary ?? {};
    const installDirText = summary.installDir ? ` · 安装目录 ${summary.installDir}` : "";
    elements.skillMeta.textContent = `共 ${summary.total ?? state.skills.length} 个技能 · 自定义 ${summary.custom ?? 0} · 系统 ${summary.system ?? 0}${installDirText}`;
  }

  const customSkills = state.skills.filter((skill) => skill.scope !== "system");
  const systemSkills = state.skills.filter((skill) => skill.scope === "system");

  elements.skillList.innerHTML = [
    renderSkillSection("custom", "🧪 自定义技能", customSkills, "暂无自定义技能"),
    renderSkillSection("system", "🧰 系统技能", systemSkills, "暂无系统技能"),
  ].join("");

  elements.skillList.querySelectorAll("[data-skill-section]").forEach((section) => {
    const key = section.getAttribute("data-skill-section");
    if (!key) return;
    const nextScrollTop = state.skillScrollTopBySection[key];
    if (Number.isFinite(nextScrollTop)) {
      section.scrollTop = nextScrollTop;
    }
    section.addEventListener("scroll", () => {
      state.skillScrollTopBySection[key] = section.scrollTop;
    });
  });
}

async function refreshSchedules() {
  if (!elements.scheduleList) {
    return;
  }
  const data = await fetchJson("/api/schedules");
  state.schedules = data.jobs ?? [];
  state.scheduleSummary = data.summary ?? null;
  renderSchedules();
}

async function refreshSkills() {
  if (!elements.skillList) {
    return;
  }
  const data = await fetchJson("/api/skills");
  state.skills = data.skills ?? [];
  state.skillSummary = data.summary ?? null;
  renderSkills();
}

function syncTokenFilterInputs() {
  if (elements.tokenDateFrom) {
    elements.tokenDateFrom.value = state.tokenDateFrom;
  }
  if (elements.tokenDateTo) {
    elements.tokenDateTo.value = state.tokenDateTo;
  }
}

function buildTokenUsageQuery() {
  const params = new URLSearchParams();
  if (state.tokenDateFrom) {
    params.set("from", state.tokenDateFrom);
  }
  if (state.tokenDateTo) {
    params.set("to", state.tokenDateTo);
  }
  params.set("granularity", state.tokenTrendGranularity || "day");
  return params.toString();
}

function renderTokenUsageControls() {
  const disabled = Boolean(state.tokenUsageInFlight);
  if (elements.tokenDateFrom) elements.tokenDateFrom.disabled = disabled;
  if (elements.tokenDateTo) elements.tokenDateTo.disabled = disabled;
  if (elements.tokenFilterApply) elements.tokenFilterApply.disabled = disabled;
  if (elements.tokenFilterToday) elements.tokenFilterToday.disabled = disabled;
  if (elements.tokenFilterReset) elements.tokenFilterReset.disabled = disabled;
  if (elements.tokenRefresh) elements.tokenRefresh.disabled = disabled;
  if (elements.tokenGranularityDay) elements.tokenGranularityDay.disabled = disabled;
  if (elements.tokenGranularityHour) elements.tokenGranularityHour.disabled = disabled;
}

function renderTokenGranularityButtons() {
  if (elements.tokenGranularityDay) {
    elements.tokenGranularityDay.classList.toggle("btn--active", state.tokenTrendGranularity === "day");
  }
  if (elements.tokenGranularityHour) {
    elements.tokenGranularityHour.classList.toggle("btn--active", state.tokenTrendGranularity === "hour");
  }
}

function renderTokenTrend() {
  if (!elements.tokenTrendChart || !elements.tokenTrendLegend) {
    return;
  }

  const setEmpty = (text) => {
    elements.tokenTrendLegend.innerHTML = "";
    elements.tokenTrendChart.innerHTML = `<div class="token-trend__empty">${escapeHtml(text)}</div>`;
  };

  if (state.tokenUsageError) {
    setEmpty(`加载失败: ${state.tokenUsageError}`);
    return;
  }
  if (state.tokenUsageInFlight && !state.tokenUsage) {
    setEmpty("趋势图加载中…");
    return;
  }

  const trend = state.tokenUsage?.trend ?? {};
  const granularity = trend.granularity || state.tokenTrendGranularity || "day";
  const daySeries = Array.isArray(trend.days) ? trend.days : [];
  const modelSeries = Array.isArray(trend.byModel) ? trend.byModel : [];
  if (!daySeries.length) {
    setEmpty("当前筛选条件下没有可视化数据。");
    return;
  }

  const chartSeries = [];
  chartSeries.push({
    id: "total",
    label: "Total",
    color: TOKEN_TREND_COLORS[0],
    points: daySeries.map((item) => ({
      date: item.date,
      value: Number(item.totalTokens) || 0,
    })),
  });

  const topModelSeries = modelSeries
    .slice()
    .sort((a, b) => (Number(b.totalTokens) || 0) - (Number(a.totalTokens) || 0))
    .slice(0, 4);

  topModelSeries.forEach((item, index) => {
    const points = Array.isArray(item.points) ? item.points : [];
    const pointByDay = new Map(points.map((point) => [point.date, Number(point.totalTokens) || 0]));
    chartSeries.push({
      id: `model-${index}`,
      label: compactLabel(item.model || "unknown"),
      color: TOKEN_TREND_COLORS[(index + 1) % TOKEN_TREND_COLORS.length],
      points: daySeries.map((day) => ({
        date: day.date,
        value: pointByDay.get(day.date) ?? 0,
      })),
    });
  });

  elements.tokenTrendLegend.innerHTML = chartSeries
    .map((series) => `
      <span class="token-trend__legend-item">
        <span class="token-trend__legend-dot" style="background:${escapeHtml(series.color)}"></span>
        <span>${escapeHtml(series.label)}</span>
      </span>
    `)
    .join("");

  const width = Math.max(elements.tokenTrendChart.clientWidth || 0, 360);
  const height = 260;
  const padding = { top: 16, right: 12, bottom: 28, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(
    1,
    ...chartSeries.flatMap((series) => series.points.map((point) => point.value)),
  );
  const pointCount = daySeries.length;

  const xFor = (index) => {
    if (pointCount <= 1) {
      return padding.left + (plotWidth / 2);
    }
    return padding.left + ((plotWidth * index) / (pointCount - 1));
  };

  const yFor = (value) => {
    const ratio = Math.max(0, Math.min(1, value / maxValue));
    return padding.top + plotHeight - (plotHeight * ratio);
  };

  const yTicks = [1, 0.5, 0].map((ratio) => ({
    ratio,
    value: Math.round(maxValue * ratio),
  }));
  const maxTickCount = 6;
  const xTickIndexes = [];
  if (pointCount <= maxTickCount) {
    for (let index = 0; index < pointCount; index += 1) {
      xTickIndexes.push(index);
    }
  } else {
    const step = (pointCount - 1) / (maxTickCount - 1);
    for (let tick = 0; tick < maxTickCount; tick += 1) {
      xTickIndexes.push(Math.round(step * tick));
    }
  }
  const uniqueXTickIndexes = Array.from(new Set(xTickIndexes));
  const distinctDateCount = new Set(
    daySeries
      .map((item) => String(item.date || "").split(" ", 1)[0])
      .filter(Boolean),
  ).size;

  const gridLines = yTicks
    .map((tick) => {
      const y = yFor(tick.value);
      return `<line x1="${padding.left}" y1="${y}" x2="${padding.left + plotWidth}" y2="${y}" class="token-trend__grid-line" />`;
    })
    .join("");

  const yLabels = yTicks
    .map((tick) => {
      const y = yFor(tick.value);
      return `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" class="token-trend__axis-label">${escapeHtml(formatCompactInteger(tick.value))}</text>`;
    })
    .join("");

  const xLabels = uniqueXTickIndexes
    .map((index) => {
      const x = xFor(index);
      const rawLabel = String(daySeries[index]?.date ?? "");
      let label = rawLabel;
      if (granularity === "hour") {
        const [datePart = "", hourPart = ""] = rawLabel.split(" ");
        if (distinctDateCount <= 1) {
          label = hourPart || rawLabel;
        } else {
          const shortDate = datePart.length >= 10 ? datePart.slice(5) : datePart;
          label = `${shortDate} ${hourPart}`.trim();
        }
      } else if (rawLabel.length >= 10) {
        label = rawLabel.slice(5);
      }
      return `<text x="${x}" y="${height - 6}" text-anchor="middle" class="token-trend__axis-label">${escapeHtml(label)}</text>`;
    })
    .join("");

  const seriesPaths = chartSeries
    .map((series) => {
      const path = series.points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.value)}`)
        .join(" ");
      const lastPoint = series.points[series.points.length - 1];
      const lastX = xFor(series.points.length - 1);
      const lastY = yFor(lastPoint?.value ?? 0);
      return `
        <path d="${path}" class="token-trend__line" style="stroke:${escapeHtml(series.color)}"></path>
        <circle cx="${lastX}" cy="${lastY}" r="3" class="token-trend__dot" style="fill:${escapeHtml(series.color)}"></circle>
      `;
    })
    .join("");

  elements.tokenTrendChart.innerHTML = `
    <svg class="token-trend__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Token usage trend">
      ${gridLines}
      ${seriesPaths}
      ${yLabels}
      ${xLabels}
    </svg>
  `;
}

function renderTokenUsage() {
  if (!elements.tokenUsageSummary || !elements.tokenUsageTableBody) {
    return;
  }

  renderTokenUsageControls();
  renderTokenGranularityButtons();
  const data = state.tokenUsage;
  const summary = data?.summary ?? {};
  const models = Array.isArray(data?.models) ? data.models : [];
  const activeRange = state.tokenDateFrom || state.tokenDateTo
    ? `${state.tokenDateFrom || "…"} ~ ${state.tokenDateTo || "…"}`
    : "全部日期";

  if (elements.tokenUsageMeta) {
    const updatedAt = state.tokenUsageLastUpdateAt
      ? new Date(state.tokenUsageLastUpdateAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      : "—";
    const availableRange = data?.range?.availableFrom && data?.range?.availableTo
      ? `${data.range.availableFrom} ~ ${data.range.availableTo}`
      : "—";
    const granularity = data?.trend?.granularity || state.tokenTrendGranularity || "day";
    const granularityLabel = granularity === "hour" ? "Hourly" : "Daily";
    if (state.tokenUsageError) {
      elements.tokenUsageMeta.className = "token-usage__meta token-usage__meta--error";
      elements.tokenUsageMeta.textContent = `加载失败: ${state.tokenUsageError}`;
    } else if (state.tokenUsageInFlight && !data) {
      elements.tokenUsageMeta.className = "token-usage__meta";
      elements.tokenUsageMeta.textContent = "加载中…";
    } else {
      elements.tokenUsageMeta.className = "token-usage__meta";
      elements.tokenUsageMeta.textContent = `过滤: ${activeRange} · 粒度: ${granularityLabel} · 可用范围: ${availableRange} · 更新: ${updatedAt}`;
    }
  }

  elements.tokenUsageSummary.innerHTML = [
    {
      label: "模型数",
      value: formatInteger(summary.modelCount ?? models.length),
      meta: "按 model+provider 分组",
    },
    {
      label: "调用数",
      value: formatInteger(summary.calls ?? 0),
      meta: "assistant messages with usage",
    },
    {
      label: "总 Token",
      value: formatInteger(summary.totalTokens ?? 0),
      meta: `Input ${formatInteger(summary.inputTokens ?? 0)} · Output ${formatInteger(summary.outputTokens ?? 0)}`,
    },
    {
      label: "总成本",
      value: formatCost(summary.totalCost ?? 0),
      meta: `Cache Read ${formatInteger(summary.cacheReadTokens ?? 0)} · Cache Write ${formatInteger(summary.cacheWriteTokens ?? 0)}`,
    },
  ]
    .map((item) => `
      <article class="card">
        <div class="card__label">${escapeHtml(item.label)}</div>
        <div class="card__value">${escapeHtml(item.value)}</div>
        <div class="card__meta">${escapeHtml(item.meta)}</div>
      </article>
    `)
    .join("");

  renderTokenTrend();

  if (state.tokenUsageError) {
    elements.tokenUsageTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="token-table__empty">加载失败: ${escapeHtml(state.tokenUsageError)}</td>
      </tr>
    `;
    return;
  }

  if (state.tokenUsageInFlight && !data) {
    elements.tokenUsageTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="token-table__empty">Loading token usage...</td>
      </tr>
    `;
    return;
  }

  if (!models.length) {
    elements.tokenUsageTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="token-table__empty">当前筛选条件下没有 usage 数据。</td>
      </tr>
    `;
    return;
  }

  elements.tokenUsageTableBody.innerHTML = models
    .map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td title="${escapeHtml(item.model)}">${escapeHtml(item.model)}</td>
        <td>${escapeHtml(item.provider)}</td>
        <td>${escapeHtml(formatInteger(item.calls))}</td>
        <td>${escapeHtml(formatInteger(item.inputTokens))}</td>
        <td>${escapeHtml(formatInteger(item.outputTokens))}</td>
        <td>${escapeHtml(formatInteger(item.totalTokens))}</td>
        <td>${escapeHtml(formatCost(item.totalCost))}</td>
        <td>${escapeHtml(formatDate(item.lastUsedAt))}</td>
      </tr>
    `)
    .join("");
}

async function refreshTokenUsage() {
  if (!elements.tokenUsageTableBody) {
    return;
  }
  if (state.tokenUsageInFlight) {
    return;
  }

  if (state.tokenDateFrom && state.tokenDateTo && state.tokenDateFrom > state.tokenDateTo) {
    state.tokenUsageError = "日期范围不合法：开始日期不能晚于结束日期。";
    renderTokenUsage();
    return;
  }

  state.tokenUsageInFlight = true;
  state.tokenUsageError = "";
  renderTokenUsage();

  try {
    const query = buildTokenUsageQuery();
    const data = await fetchJson(query ? `/api/token-usage?${query}` : "/api/token-usage");
    state.tokenUsage = data;
    state.tokenUsageLastUpdateAt = Date.now();
    state.tokenUsageError = "";
  } catch (error) {
    state.tokenUsageError = error?.message ?? "unknown error";
  } finally {
    state.tokenUsageInFlight = false;
    renderTokenUsage();
  }
}

function applyTokenDateFilter() {
  state.tokenDateFrom = elements.tokenDateFrom?.value ?? "";
  state.tokenDateTo = elements.tokenDateTo?.value ?? "";
  refreshTokenUsage();
}

function resetTokenDateFilter() {
  state.tokenDateFrom = "";
  state.tokenDateTo = "";
  syncTokenFilterInputs();
  refreshTokenUsage();
}

function applyTodayTokenDateFilter() {
  const today = formatDateInputValue(new Date());
  state.tokenDateFrom = today;
  state.tokenDateTo = today;
  syncTokenFilterInputs();
  refreshTokenUsage();
}

function setTokenTrendGranularity(granularity) {
  const next = granularity === "hour" ? "hour" : "day";
  if (state.tokenTrendGranularity === next) {
    return;
  }
  state.tokenTrendGranularity = next;
  renderTokenGranularityButtons();
  refreshTokenUsage();
}

const realtimeLogFilters = [
  { id: "全部", icon: "●" },
  { id: "User", icon: "🦞" },
  { id: "工具调用", icon: "🛠" },
  { id: "文字输出", icon: "📝" },
  { id: "执行结果", icon: "✅" },
];

const realtimeLogIconByTag = {
  User: "🦞",
  工具调用: "🛠",
  文字输出: "📝",
  执行结果: "✅",
};

function extractTimestamp(line) {
  if (!line) return { timestampIso: null, rest: "" };
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)\s+(.*)$/);
  if (isoMatch) {
    const iso = isoMatch[1];
    const rest = isoMatch[2] ?? "";
    const date = new Date(iso);
    return {
      timestampIso: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      rest,
    };
  }
  const parsedJsonLog = parseJsonLogLine(line);
  if (parsedJsonLog) {
    return parsedJsonLog;
  }
  const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
  if (timeMatch) {
    return { timestampIso: null, rest: timeMatch[2] ?? "" };
  }
  return { timestampIso: null, rest: line };
}

function formatJsonLogValue(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return formatJsonLogValue(JSON.parse(trimmed));
      } catch (error) {
        // keep raw string when it's not valid JSON
      }
    }
    return normalizeText(trimmed);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatJsonLogValue(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        if (item == null) return key;
        const rendered = formatJsonLogValue(item);
        if (!rendered) return key;
        if (Array.isArray(item)) {
          return `${key}=[${rendered}]`;
        }
        if (typeof item === "object") {
          return `${key}={${rendered}}`;
        }
        return `${key}=${rendered}`;
      })
      .join(" ");
  }
  return String(value);
}

function parseJsonLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  let record;
  try {
    record = JSON.parse(trimmed);
  } catch (error) {
    return null;
  }

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const tsRaw = record.time ?? record.timestamp ?? record._meta?.date ?? null;
  const tsDate = tsRaw ? new Date(tsRaw) : null;
  const timestampIso = tsDate && !Number.isNaN(tsDate.getTime()) ? tsDate.toISOString() : null;

  const messageParts = Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => formatJsonLogValue(record[key]))
    .filter(Boolean);

  if (!messageParts.length && record.message != null) {
    messageParts.push(formatJsonLogValue(record.message));
  }
  if (!messageParts.length && record.msg != null) {
    messageParts.push(formatJsonLogValue(record.msg));
  }

  return {
    timestampIso,
    rest: messageParts.join(" · ").trim() || line,
  };
}

function parseRealtimeMessageContext(text) {
  const normalized = String(text ?? "").trimStart();
  const structuredMatch = normalized.match(/^\[([^\]]+)\]\s+([^:]+):\s*(.*)$/);
  if (!structuredMatch) {
    return {
      raw: normalized,
      agentId: "",
      roleRaw: "",
      roleLower: "",
      payload: normalized,
    };
  }
  const [, agentRaw, roleRaw, payloadRaw] = structuredMatch;
  const normalizedRoleRaw = String(roleRaw ?? "").trim();
  const roleToken = normalizedRoleRaw.split(/\s+/, 1)[0] ?? "";
  return {
    raw: normalized,
    agentId: String(agentRaw ?? "").trim().toLowerCase(),
    roleRaw: normalizedRoleRaw,
    roleLower: roleToken.toLowerCase(),
    payload: String(payloadRaw ?? "").trimStart(),
  };
}

function detectRealtimeToolState(sourceText, roleLower = "") {
  const lower = sourceText.toLowerCase();
  const isToolCall = roleLower === "toolcall"
    || (roleLower === "assistant" && /\btoolcall\b/i.test(sourceText))
    || /\btoolcall\b/i.test(sourceText)
    || /\b(exec|read|write|spawn|curl|find|grep|web_search|web_fetch|apply_patch)\([^)]*\)/i.test(sourceText);
  const isToolResult = roleLower === "toolresult"
    || /\btoolresult\b/i.test(sourceText)
    || /\b(exec|read|write|spawn|curl|find|grep|web_search|web_fetch|apply_patch)\s*:/i.test(sourceText)
    || /\(no output\)/i.test(lower);
  return { isToolCall, isToolResult };
}

function isRealtimeUserEvent(context = {}) {
  const role = context.roleLower || "";
  if (["session", "thinking_level_change", "custom", "user", "model_change"].includes(role)) {
    return true;
  }
  const raw = String(context.raw ?? "");
  return /\b(session|thinking_level_change|custom|user|model_change)\s*:/.test(raw);
}

function deriveRealtimeTags(text, context = parseRealtimeMessageContext(text)) {
  const sourceText = context.payload || context.raw;
  const { isToolCall, isToolResult } = detectRealtimeToolState(sourceText, context.roleLower);
  const isUserEvent = isRealtimeUserEvent(context);
  const primaryTag = isUserEvent
    ? "User"
    : (isToolCall
      ? "工具调用"
      : (isToolResult ? "执行结果" : "文字输出"));

  return new Set([primaryTag]);
}

function deriveRealtimeKind(tags, text, context = parseRealtimeMessageContext(text)) {
  const sourceText = context.payload || context.raw;
  const lower = sourceText.toLowerCase();
  const { isToolCall, isToolResult } = detectRealtimeToolState(sourceText, context.roleLower);

  if (/\b(error|fatal|exception|traceback)\b/i.test(sourceText) || lower.includes("enoent")) {
    return "error";
  }
  if (/\b(warn|warning|deprecated|missing)\b/i.test(sourceText)) {
    return "warn";
  }
  if (isToolCall) return "tool-call";
  if (isToolResult) return "tool-result";
  return "output";
}

function iconForTags(tags, preferredTag = "") {
  if (preferredTag && preferredTag !== "全部" && tags.has(preferredTag)) {
    return realtimeLogIconByTag[preferredTag] ?? realtimeLogIconByTag.文字输出;
  }
  const priority = ["User", "工具调用", "执行结果", "文字输出"];
  for (const tag of priority) {
    if (tags.has(tag)) {
      return realtimeLogIconByTag[tag];
    }
  }
  return realtimeLogIconByTag.文字输出;
}

function buildLogPreview(text, maxChars = REALTIME_LOG_PREVIEW_CHARS) {
  const normalized = String(text ?? "");
  if (normalized.length <= maxChars) {
    return {
      preview: normalized,
      truncated: false,
    };
  }
  return {
    preview: `${normalized.slice(0, maxChars)}…`,
    truncated: true,
  };
}

function decorateLogText(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(
      /(\b(?:exec|read|write|spawn|curl|find|grep)\([^)]*\))/gi,
      '<span class="log-token log-token--call">$1</span>',
    )
    .replace(/(\b(?:exec|read|write)\s*:)/gi, '<span class="log-token log-token--result">$1</span>')
    .replace(/(https?:\/\/[^\s]+)/gi, '<span class="log-token log-token--url">$1</span>')
    .replace(/(\/[^\s)>"']+)/g, '<span class="log-token log-token--path">$1</span>');
}

function buildRealtimeEntries(rawLines) {
  return rawLines.map((line) => {
    const { timestampIso, rest } = extractTimestamp(line);
    const message = (rest ?? "").trimStart();
    const context = parseRealtimeMessageContext(message);
    const tags = deriveRealtimeTags(message, context);
    const kind = deriveRealtimeKind(tags, message, context);
    const icon = iconForTags(tags, state.realtimeLogFilter);
    const time = timestampIso ? formatTime(timestampIso) : (line.match(/^(\d{2}:\d{2}:\d{2})/)?.[1] ?? "—");

    return {
      key: line || `${time}|${message}`,
      line,
      time,
      message,
      tags,
      kind,
      icon,
    };
  });
}

function buildLatestRealtimeActivityByAgent(rawLines) {
  const latestByAgent = new Map();
  if (!Array.isArray(rawLines) || !rawLines.length) {
    return latestByAgent;
  }

  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    const rawLine = rawLines[index];
    const { rest } = extractTimestamp(rawLine);
    const message = (rest ?? "").trimStart();
    const context = parseRealtimeMessageContext(message);
    const agentKey = normalizeText(context.agentId).toLowerCase();
    if (!agentKey || latestByAgent.has(agentKey)) {
      continue;
    }
    const payload = normalizeText(context.payload || context.raw || message || rawLine);
    if (!payload) {
      continue;
    }
    const role = normalizeText(context.roleRaw);
    const activity = normalizeText(role ? `${role}: ${payload}` : payload);
    if (!activity) {
      continue;
    }
    latestByAgent.set(agentKey, buildLogPreview(activity, AGENT_ACTIVITY_PREVIEW_CHARS).preview);
  }

  return latestByAgent;
}

function renderRealtimeLogFilters() {
  if (!elements.realtimeLogFilters) return;
  const filterIds = new Set(realtimeLogFilters.map((item) => item.id));
  if (!filterIds.has(state.realtimeLogFilter)) {
    state.realtimeLogFilter = "全部";
  }
  elements.realtimeLogFilters.innerHTML = realtimeLogFilters
    .map((filter) => {
      const active = filter.id === state.realtimeLogFilter;
      return `
        <button class="log-chip ${active ? "log-chip--active" : ""}" data-filter="${escapeHtml(filter.id)}" type="button">
          <span class="log-chip__icon" aria-hidden="true">${escapeHtml(filter.icon)}</span>
          <span>${escapeHtml(filter.id)}</span>
        </button>
      `;
    })
    .join("");

  elements.realtimeLogFilters.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.realtimeLogFilter = button.dataset.filter ?? "全部";
      renderRealtimeLogFilters();
      renderRealtimeLogs();
    });
  });
}

function isNearBottom(viewport, thresholdPx = 30) {
  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - thresholdPx;
}

function renderRealtimeLogs() {
  if (!elements.realtimeLogLines || !elements.realtimeLogViewport) return;
  const viewport = elements.realtimeLogViewport;
  const shouldStick = state.realtimeLogAutoScroll || isNearBottom(viewport);
  const previousScrollTop = viewport.scrollTop;

  const entries = buildRealtimeEntries(state.realtimeLogRawLines);
  const filtered = state.realtimeLogFilter === "全部"
    ? entries
    : entries.filter((entry) => entry.tags.has(state.realtimeLogFilter));

  elements.realtimeLogLines.innerHTML = filtered
    .map((entry) => {
      const fullText = entry.message || entry.line || "";
      const preview = buildLogPreview(fullText);
      const expanded = state.realtimeLogExpandedKeys.has(entry.key);
      const displayText = expanded ? fullText : preview.preview;
      const toggleMarkup = preview.truncated
        ? `<button class="log-line__toggle" type="button" data-log-expand="${escapeHtml(entry.key)}">${expanded ? "收起" : "展开"}</button>`
        : "";
      return `
        <div class="log-line log-line--${escapeHtml(entry.kind)}">
          <div class="log-line__time">${escapeHtml(entry.time)}</div>
          <div class="log-line__icon" aria-hidden="true">${escapeHtml(entry.icon)}</div>
          <div class="log-line__content">
            <div class="log-line__text">${decorateLogText(displayText)}</div>
            ${toggleMarkup}
          </div>
        </div>
      `;
    })
    .join("");

  elements.realtimeLogLines.querySelectorAll("[data-log-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.logExpand;
      if (!key) return;
      if (state.realtimeLogExpandedKeys.has(key)) {
        state.realtimeLogExpandedKeys.delete(key);
      } else {
        state.realtimeLogExpandedKeys.add(key);
      }
      renderRealtimeLogs();
    });
  });

  if (shouldStick) {
    viewport.scrollTop = viewport.scrollHeight;
  } else {
    viewport.scrollTop = previousScrollTop;
  }

  if (elements.realtimeLogMeta) {
    const updatedAt = state.realtimeLogLastUpdateAt
      ? new Date(state.realtimeLogLastUpdateAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      : "—";
    elements.realtimeLogMeta.textContent = `agent sessions · ${entries.length} lines · ${updatedAt}`;
  }
}

function mergeLogTail(previous, nextTail, limit = 600) {
  if (!Array.isArray(nextTail) || nextTail.length === 0) {
    return previous ?? [];
  }
  if (!Array.isArray(previous) || previous.length === 0) {
    return nextTail.slice(-limit);
  }

  const searchFrom = Math.max(0, previous.length - 80);
  let matchIndexInTail = -1;
  for (let index = previous.length - 1; index >= searchFrom; index -= 1) {
    const candidate = previous[index];
    const idx = nextTail.lastIndexOf(candidate);
    if (idx !== -1) {
      matchIndexInTail = idx;
      break;
    }
  }

  if (matchIndexInTail === -1) {
    return nextTail.slice(-limit);
  }

  const merged = previous.concat(nextTail.slice(matchIndexInTail + 1));
  return merged.slice(-limit);
}

async function refreshRealtimeLogs() {
  const data = await fetchJson("/api/logs?type=session&lines=350");
  state.realtimeLogRawLines = mergeLogTail(state.realtimeLogRawLines, data.lines ?? []);
  state.realtimeLatestByAgent = buildLatestRealtimeActivityByAgent(state.realtimeLogRawLines);
  state.realtimeLogLastUpdateAt = Date.now();
  renderRealtimeLogs();
  renderAgentStatus();
}

function setupTabs() {
  const tabById = new Map();
  elements.tabs.forEach((tab) => {
    if (tab.dataset.tab) {
      tabById.set(tab.dataset.tab, tab);
    }
  });

  const activateTab = (tabId, options = {}) => {
    const targetTab = tabById.get(tabId);
    if (!targetTab) return;

    elements.tabs.forEach((button) => button.classList.remove("tab--active"));
    elements.panels.forEach((panel) => panel.classList.remove("panel--active"));

    targetTab.classList.add("tab--active");
    const panel = document.getElementById(tabId);
    if (panel) {
      panel.classList.add("panel--active");
    }

    if (options.persist !== false) {
      try {
        window.localStorage.setItem(TAB_STORAGE_KEY, tabId);
      } catch (error) {
        // ignore storage failures (private mode / disabled storage)
      }
    }

    if (options.updateHash !== false) {
      if (window.location.hash !== `#${tabId}`) {
        window.history.replaceState(null, "", `#${tabId}`);
      }
    }

    if (tabId === "config") {
      requestAnimationFrame(() => layoutConfigMonacoEditor());
      loadConfigFile({ force: false });
    } else if (tabId === "tokens") {
      if (!state.tokenUsage || !state.tokenUsageLastUpdateAt || Date.now() - state.tokenUsageLastUpdateAt > 30000) {
        refreshTokenUsage();
      }
    }
  };

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
    });
  });

  const hashTabId = window.location.hash.replace(/^#/, "");
  let initialTabId = tabById.has(hashTabId) ? hashTabId : "";
  if (!initialTabId) {
    try {
      const stored = window.localStorage.getItem(TAB_STORAGE_KEY) ?? "";
      if (tabById.has(stored)) {
        initialTabId = stored;
      }
    } catch (error) {
      // ignore storage failures
    }
  }
  if (!initialTabId) {
    const activeFromMarkup = Array.from(elements.tabs).find((tab) => tab.classList.contains("tab--active"));
    initialTabId = activeFromMarkup?.dataset.tab ?? elements.tabs[0]?.dataset.tab ?? "";
  }
  if (initialTabId) {
    activateTab(initialTabId, { persist: false, updateHash: false });
  }
}

async function refreshAll() {
  if (state.refreshInFlight) {
    return;
  }
  state.refreshInFlight = true;
  try {
    await Promise.all([
      refreshSummary(),
      refreshAgents(),
      refreshLogs(),
      refreshRealtimeLogs(),
      refreshSchedules(),
      refreshSkills(),
    ]);
  } finally {
    state.refreshInFlight = false;
  }
}

setupTabs();
renderRealtimeLogFilters();
syncTokenFilterInputs();
renderTokenUsage();
if (elements.realtimeLogViewport) {
  elements.realtimeLogViewport.addEventListener("scroll", () => {
    state.realtimeLogAutoScroll = isNearBottom(elements.realtimeLogViewport);
  });
}
if (elements.tokenFilterApply) {
  elements.tokenFilterApply.addEventListener("click", applyTokenDateFilter);
}
if (elements.tokenFilterToday) {
  elements.tokenFilterToday.addEventListener("click", applyTodayTokenDateFilter);
}
if (elements.tokenFilterReset) {
  elements.tokenFilterReset.addEventListener("click", resetTokenDateFilter);
}
if (elements.tokenRefresh) {
  elements.tokenRefresh.addEventListener("click", refreshTokenUsage);
}
if (elements.tokenGranularityDay) {
  elements.tokenGranularityDay.addEventListener("click", () => setTokenTrendGranularity("day"));
}
if (elements.tokenGranularityHour) {
  elements.tokenGranularityHour.addEventListener("click", () => setTokenTrendGranularity("hour"));
}
if (elements.refreshLogs) {
  elements.refreshLogs.addEventListener("click", refreshLogs);
}
if (elements.logSearch) {
  elements.logSearch.addEventListener("input", (event) => {
    state.logSearchQuery = event.target?.value ?? "";
    renderGatewayLogs();
  });
}
if (elements.logLevelAll) {
  elements.logLevelAll.addEventListener("click", () => {
    state.logLevelFilter = "all";
    renderGatewayLogs();
  });
}
if (elements.logLevelIssues) {
  elements.logLevelIssues.addEventListener("click", () => {
    state.logLevelFilter = "issues";
    renderGatewayLogs();
  });
}
if (elements.logAutoScrollButton) {
  elements.logAutoScrollButton.addEventListener("click", () => {
    state.logAutoScroll = !state.logAutoScroll;
    renderLogAutoScrollButton();
    if (state.logAutoScroll && elements.logViewport) {
      elements.logViewport.scrollTop = elements.logViewport.scrollHeight;
    }
  });
}
if (elements.clearLogs) {
  elements.clearLogs.addEventListener("click", clearGatewayLogsView);
}
if (elements.logViewport) {
  elements.logViewport.addEventListener("scroll", () => {
    if (state.logAutoScroll && !isNearBottom(elements.logViewport)) {
      state.logAutoScroll = false;
      renderLogAutoScrollButton();
    }
  });
}
setupConfigCodeEditor();
window.addEventListener("resize", () => {
  layoutConfigMonacoEditor();
  renderTokenTrend();
});
if (elements.configReload) {
  elements.configReload.addEventListener("click", reloadConfigFile);
}
if (elements.configFormat) {
  elements.configFormat.addEventListener("click", formatConfigFile);
}
if (elements.configValidate) {
  elements.configValidate.addEventListener("click", validateConfigEditor);
}
if (elements.configWrap) {
  elements.configWrap.addEventListener("click", toggleConfigEditorWrap);
}
if (elements.configSave) {
  elements.configSave.addEventListener("click", saveConfigFile);
}
if (elements.gatewayRestart) {
  elements.gatewayRestart.addEventListener("click", restartGateway);
}
renderConfigWrapButton();
refreshConfigCursorStatus();
refreshConfigJsonValidation();
window.addEventListener("beforeunload", (event) => {
  if (!state.configFileDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

refreshAll();
setInterval(refreshAll, 3000);
