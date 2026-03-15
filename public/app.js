const state = {
  summary: null,
  agents: [],
  config: null,
};

const elements = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".panel"),
  summaryCards: document.getElementById("summary-cards"),
  agentStatus: document.getElementById("agent-status"),
  agentMeta: document.getElementById("agent-meta"),
  agentList: document.getElementById("agent-list"),
  logBox: document.getElementById("log-box"),
  logType: document.getElementById("log-type"),
  refreshLogs: document.getElementById("refresh-logs"),
  configBox: document.getElementById("config-box"),
  gatewayDot: document.getElementById("gateway-dot"),
  gatewayText: document.getElementById("gateway-text"),
};

const statusLabels = {
  active: "Active",
  idle: "Idle",
  stale: "Stale",
  offline: "Offline",
  unknown: "Unknown",
};

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function statusDotClass(state) {
  return `status-dot status-dot--${state || "unknown"}`;
}

function buildSummaryCards(summary, agents) {
  if (!summary) return [];
  const activeCount = agents.filter((agent) => agent.state === "active").length;
  const idleCount = agents.filter((agent) => agent.state === "idle").length;
  const staleCount = agents.filter((agent) => agent.state === "stale").length;
  const offlineCount = agents.filter((agent) => agent.state === "offline").length;

  return [
    {
      label: "Agents Online",
      value: `${activeCount + idleCount}/${summary.agents.count}`,
      meta: `${activeCount} active · ${idleCount} idle`,
    },
    {
      label: "Agents Stale",
      value: staleCount,
      meta: `${offlineCount} offline`,
    },
    {
      label: "Gateway Port",
      value: summary.gateway.port ?? "—",
      meta: summary.gateway.mode ? `${summary.gateway.mode} · ${summary.gateway.bind}` : "—",
    },
    {
      label: "Last Run",
      value: summary.lastRunCommand ?? "—",
      meta: formatDate(summary.lastRunAt),
    },
  ];
}

function renderSummary() {
  const cards = buildSummaryCards(state.summary, state.agents);
  elements.summaryCards.innerHTML = cards
    .map(
      (card) => `
      <article class="card">
        <div class="card__label">${card.label}</div>
        <div class="card__value">${card.value}</div>
        <div class="card__meta">${card.meta}</div>
      </article>
    `,
    )
    .join("");

  if (state.summary?.logs?.lastEventAt) {
    elements.gatewayDot.className = statusDotClass(
      deriveGatewayStatus(state.summary.logs.lastEventAt),
    );
    elements.gatewayText.textContent = `Gateway · ${formatDate(state.summary.logs.lastEventAt)}`;
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
  if (!state.agents.length) {
    elements.agentStatus.innerHTML = `<div class="card">No agents found.</div>`;
    elements.agentMeta.textContent = "";
    return;
  }
  elements.agentMeta.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
  elements.agentStatus.innerHTML = state.agents
    .map((agent) => {
      const bindings = agent.bindings
        .map(
          (binding) => `
          <div class="binding">
            <span>${binding.channel}</span>
            <strong>${binding.accountId}</strong>
            <span>${statusLabels[binding.status?.state ?? "unknown"]}</span>
          </div>
        `,
        )
        .join("");

      return `
        <article class="card agent-card">
          <div class="agent-card__title">
            <span>${agent.id}</span>
            <span class="tag">
              <span class="${statusDotClass(agent.state)}"></span>
              ${statusLabels[agent.state]}
            </span>
          </div>
          <div class="agent-card__meta">Model: ${agent.model}</div>
          <div class="agent-card__meta">Workspace: ${agent.workspace}</div>
          <div class="agent-card__meta">Last event: ${formatDate(agent.lastEventAt)}</div>
          <div class="binding-list">${bindings || "<span>No bindings</span>"}</div>
        </article>
      `;
    })
    .join("");
}

function renderAgentList() {
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
              ${statusLabels[agent.state]}
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
  const type = elements.logType.value;
  const data = await fetchJson(`/api/logs?type=${type}&lines=200`);
  elements.logBox.textContent = data.lines.join("\n");
}

async function refreshConfig() {
  state.config = await fetchJson("/api/config");
  elements.configBox.textContent = JSON.stringify(state.config, null, 2);
}

function setupTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      elements.tabs.forEach((btn) => btn.classList.remove("tab--active"));
      elements.panels.forEach((panel) => panel.classList.remove("panel--active"));
      tab.classList.add("tab--active");
      document.getElementById(tab.dataset.tab).classList.add("panel--active");
    });
  });
}

async function refreshAll() {
  await Promise.all([refreshSummary(), refreshAgents(), refreshLogs(), refreshConfig()]);
}

setupTabs();
elements.refreshLogs.addEventListener("click", refreshLogs);

refreshAll();
setInterval(refreshAll, 10000);
