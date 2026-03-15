const state = {
  summary: null,
  agents: [],
  config: null,
  refreshInFlight: false,
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
  logType: document.getElementById("log-type"),
  refreshLogs: document.getElementById("refresh-logs"),
  configBox: document.getElementById("config-box"),
  gatewayDot: document.getElementById("gateway-dot"),
  gatewayText: document.getElementById("gateway-text"),
  realtimeLogMeta: document.getElementById("realtime-log-meta"),
  realtimeLogFilters: document.getElementById("realtime-log-filters"),
  realtimeLogViewport: document.getElementById("realtime-log-viewport"),
  realtimeLogLines: document.getElementById("realtime-log-lines"),
};

const statusLabels = {
  active: "运行中",
  idle: "空闲",
  stale: "待关注",
  offline: "离线",
  unknown: "未知",
};

const REALTIME_LOG_PREVIEW_CHARS = 220;

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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
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
  elements.logBox.textContent = data.lines.join("\n");
}

async function refreshConfig() {
  if (!elements.configBox) {
    return;
  }
  state.config = await fetchJson("/api/config");
  elements.configBox.textContent = JSON.stringify(state.config, null, 2);
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
    });
  });
}

async function refreshAll() {
  if (state.refreshInFlight) {
    return;
  }
  state.refreshInFlight = true;
  try {
    await Promise.all([refreshSummary(), refreshAgents(), refreshLogs(), refreshRealtimeLogs(), refreshConfig()]);
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

refreshAll();
setInterval(refreshAll, 3000);
