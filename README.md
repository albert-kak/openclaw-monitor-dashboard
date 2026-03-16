# OpenClaw Monitor Dashboard

Local monitoring dashboard for OpenClaw agents. The server reads data from `~/.openclaw` and serves a UI on port `17788`.

## Run

```bash
node server.js
```

Open `http://localhost:17788` in your browser.

`server.js` now runs with hot reload by default. Changes in `server.js` and `public/` will auto-restart the server.

To disable hot reload:

```bash
OPENCLAW_HOT_RELOAD=0 node server.js
```

## CLI

Use the local CLI `ocd` from repository root:

```bash
./ocd start
```

Start in background (daemon mode):

```bash
./ocd start --daemon
```

Check service status:

```bash
./ocd status
```

Daemon runtime files:

- PID: `~/.openclaw/monitor-dashboard/ocd.pid`
- stdout log: `~/.openclaw/monitor-dashboard/ocd.log`
- stderr log: `~/.openclaw/monitor-dashboard/ocd.err.log`

## Data Sources

- `~/.openclaw/openclaw.json`
- `~/.openclaw/logs/gateway.log`
- `~/.openclaw/logs/gateway.err.log`
- `~/.openclaw/agents/*/sessions/sessions.json`
- `~/.openclaw/agents/*/sessions/*.jsonl`

## Notes

- The dashboard exposes a sanitized view of the config. Tokens and secrets are not returned.
- Agent status is inferred from the latest matching log entry per binding.
