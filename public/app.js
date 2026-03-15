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
  configCodeMirror: null,
  configEditorSilent: false,
  configEditorWrap: false,
  configValidationTimer: null,
  schedules: [],
  scheduleSummary: null,
  scheduleExpandedKeys: new Set(),
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
  logBox: document.getElementById("log-box"),
  logViewport: document.getElementById("log-viewport"),
  logType: document.getElementById("log-type"),
  logSearch: document.getElementById("log-search"),
  logLevelAll: document.getElementById("log-level-all"),
  logLevelIssues: document.getElementById("log-level-issues"),
  logStats: document.getElementById("log-stats"),
  clearLogs: document.getElementById("clear-logs"),
  logAutoScrollButton: document.getElementById("log-autoscroll"),
  refreshLogs: document.getElementById("refresh-logs"),
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
const LOG_STREAM_PREVIEW_CHARS = 320;
const SCHEDULE_PREVIEW_CHARS = 260;

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
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

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
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

function resolveAgentRole(isRoot) {
  return isRoot ? "主控" : "子代理";
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
  const rootBinding = rootAgent.bindings[0];
  const rootCurrent = rootBinding
    ? `${rootBinding.channel}:${rootBinding.accountId}`
    : "No binding";
  const rootEmoji = resolveAgentEmoji();
  const rootStateEmoji = resolveStateEmoji(rootAgent.state);
  const rootRole = resolveAgentRole(true);

  const childMarkup = childAgents
    .map((agent) => {
      const bindingText = agent.bindings.length
        ? `${agent.bindings[0].channel}:${agent.bindings[0].accountId}`
        : "No binding";
      const agentEmoji = resolveAgentEmoji();
      const stateEmoji = resolveStateEmoji(agent.state);
      const role = resolveAgentRole(false);

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
          <div class="agent-node__line agent-node__line--current">当前: ${bindingText}</div>
          <div class="agent-node__line">模型: ${agent.model}</div>
          <div class="agent-node__line">最近: ${formatDate(agent.lastEventAt)}</div>
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
        <div class="agent-node__line agent-node__line--current">当前: ${rootCurrent}</div>
        <div class="agent-node__line">工作区: ${rootAgent.workspace}</div>
        <div class="agent-node__line">模型: ${rootAgent.model}</div>
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
  if (state.configCodeMirror) {
    const cursor = state.configCodeMirror.getCursor();
    elements.configCursorStatus.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
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

function setConfigEditorWrap(enabled) {
  state.configEditorWrap = Boolean(enabled);
  if (state.configCodeMirror) {
    state.configCodeMirror.setOption("lineWrapping", state.configEditorWrap);
  } else if (elements.configEditor) {
    elements.configEditor.style.whiteSpace = state.configEditorWrap ? "pre-wrap" : "pre";
    elements.configEditor.style.overflowX = state.configEditorWrap ? "hidden" : "auto";
  }
  renderConfigWrapButton();
}

function setupConfigCodeEditor() {
  if (!elements.configEditor) {
    return;
  }
  const CodeMirror = window.CodeMirror;
  if (!CodeMirror || typeof CodeMirror.fromTextArea !== "function") {
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
    return;
  }

  const supportsLint = Boolean(CodeMirror.lint && window.jsonlint && typeof window.jsonlint.parse === "function");
  const cm = CodeMirror.fromTextArea(elements.configEditor, {
    mode: { name: "javascript", json: true },
    theme: "material-darker",
    lineNumbers: true,
    styleActiveLine: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    tabSize: 2,
    indentUnit: 2,
    indentWithTabs: false,
    lineWrapping: state.configEditorWrap,
    viewportMargin: 12,
    lint: supportsLint ? { lintOnChange: true } : false,
    foldGutter: true,
    gutters: ["CodeMirror-lint-markers", "CodeMirror-linenumbers", "CodeMirror-foldgutter"],
    extraKeys: {
      "Cmd-S": () => saveConfigFile(),
      "Ctrl-S": () => saveConfigFile(),
      "Cmd-F": "findPersistent",
      "Ctrl-F": "findPersistent",
      "Cmd-G": "findNext",
      "Ctrl-G": "findNext",
      "Shift-Cmd-G": "findPrev",
      "Shift-Ctrl-G": "findPrev",
      "Cmd-Alt-F": () => formatConfigFile(),
      "Ctrl-Alt-F": () => formatConfigFile(),
      "Ctrl-Q": (editor) => editor.foldCode(editor.getCursor()),
      "Tab": (editor) => editor.execCommand("indentMore"),
      "Shift-Tab": (editor) => editor.execCommand("indentLess"),
    },
  });

  cm.on("change", () => {
    updateConfigDirtyState();
    scheduleConfigJsonValidation();
    refreshConfigCursorStatus();
  });
  cm.on("cursorActivity", refreshConfigCursorStatus);
  renderConfigWrapButton();
  refreshConfigCursorStatus();
  refreshConfigJsonValidation();
  state.configCodeMirror = cm;
}

function getConfigEditorText() {
  if (state.configCodeMirror) {
    return state.configCodeMirror.getValue();
  }
  return elements.configEditor?.value ?? "";
}

function setConfigEditorText(text) {
  const next = text ?? "";
  if (state.configCodeMirror) {
    state.configCodeMirror.setValue(next);
    refreshConfigCursorStatus();
    scheduleConfigJsonValidation(0);
    return;
  }
  if (elements.configEditor) {
    elements.configEditor.value = next;
    refreshConfigCursorStatus();
    scheduleConfigJsonValidation(0);
  }
}

function setConfigEditorReadOnly(readOnly) {
  if (state.configCodeMirror) {
    state.configCodeMirror.setOption("readOnly", readOnly ? "nocursor" : false);
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
  if (!elements.logType || !elements.logBox) {
    return;
  }
  const type = elements.logType.value;
  const data = await fetchJson(`/api/logs?type=${type}&lines=200`);
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

const realtimeLogFilters = [
  { id: "全部", icon: "●" },
  { id: "管理者", icon: "👑" },
  { id: "全栈", icon: "🧩" },
  { id: "分析", icon: "🧠" },
  { id: "工具调用", icon: "🛠" },
  { id: "文字输出", icon: "📝" },
  { id: "执行结果", icon: "✅" },
];

const realtimeLogIconByTag = {
  管理者: "👑",
  全栈: "🧩",
  分析: "🧠",
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
  const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
  if (timeMatch) {
    return { timestampIso: null, rest: timeMatch[2] ?? "" };
  }
  return { timestampIso: null, rest: line };
}

function deriveRealtimeTags(text) {
  const tags = new Set();
  const lower = (text ?? "").toLowerCase();

  if (/(system message|\[system\]|\bsystem\b)/i.test(text)) {
    tags.add("管理者");
  }
  if (/(manager|\[manager\]|管理者)/i.test(text)) {
    tags.add("管理者");
  }
  if (/(full\s*stack|\[fullstack\]|全栈)/i.test(text)) {
    tags.add("全栈");
  }
  if (/(analysis|\[analysis\]|分析)/i.test(text)) {
    tags.add("分析");
  }

  const isToolCall = /\btoolcall\b/i.test(text) || /\b(exec|read|write|spawn|curl|find|grep)\([^)]*\)/i.test(text);
  const isToolResult = /\btoolresult\b/i.test(text) || /\b(exec|read|write)\s*:/i.test(text) || /\(no output\)/i.test(lower);
  if (isToolCall) tags.add("工具调用");
  if (isToolResult) tags.add("执行结果");

  if (!isToolCall && !isToolResult) {
    tags.add("文字输出");
  }

  return tags;
}

function deriveRealtimeKind(tags, text) {
  const lower = (text ?? "").toLowerCase();
  if (/\b(error|fatal|exception|traceback)\b/i.test(text) || lower.includes("enoent")) {
    return "error";
  }
  if (/\b(warn|warning|deprecated|missing)\b/i.test(text)) {
    return "warn";
  }
  if (tags.has("工具调用")) return "tool-call";
  if (tags.has("执行结果")) return "tool-result";
  if (tags.has("分析")) return "analysis";
  if (tags.has("管理者")) return "system";
  return "output";
}

function iconForTags(tags) {
  const priority = ["工具调用", "执行结果", "分析", "全栈", "管理者", "文字输出"];
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
    const tags = deriveRealtimeTags(message);
    const kind = deriveRealtimeKind(tags, message);
    const icon = iconForTags(tags);
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

function renderRealtimeLogFilters() {
  if (!elements.realtimeLogFilters) return;
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
      const next = button.dataset.filter ?? "全部";
      state.realtimeLogFilter = next;
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
  state.realtimeLogLastUpdateAt = Date.now();
  renderRealtimeLogs();
}

function setupTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      elements.tabs.forEach((button) => button.classList.remove("tab--active"));
      elements.panels.forEach((panel) => panel.classList.remove("panel--active"));
      tab.classList.add("tab--active");
      const panel = document.getElementById(tab.dataset.tab);
      if (panel) {
        panel.classList.add("panel--active");
      }
      if (tab.dataset.tab === "config") {
        loadConfigFile({ force: false });
      }
    });
  });
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
if (elements.realtimeLogViewport) {
  elements.realtimeLogViewport.addEventListener("scroll", () => {
    state.realtimeLogAutoScroll = isNearBottom(elements.realtimeLogViewport);
  });
}
if (elements.refreshLogs) {
  elements.refreshLogs.addEventListener("click", refreshLogs);
}
if (elements.logType) {
  elements.logType.addEventListener("change", () => {
    state.logExpandedKeys.clear();
    refreshLogs();
  });
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
