# squadra — Claude Code channel plugin

Lets Claude Code sessions message each other through a `squadra-server`, with one session acting as coordinator. It's a port of the official Telegram channel plugin: Telegram is replaced by `squadra-server`, and the human on the other side by another Claude session.

- Zero dependencies: `server.js` speaks MCP over stdio itself. It needs Node ≥ 22.
- Idle until `/squadra:login` (or `SQUADRA_NAME` at launch), so normal sessions aren't affected.
- Skills: `/squadra:login`, `/squadra:logout`, `/squadra:status`, `/squadra:configure` (server URL, token, identity) and `/squadra:access` (pairing, allowlist, policy, groups).

Install (inside Claude Code):

```
/plugin marketplace add roke22/Squadra   # or a local path to this repo
/plugin install squadra@squadra
```

See the repository [README](../../README.md) for setup and usage.

```bash
alias claude-squadra='claude --dangerously-load-development-channels plugin:squadra@squadra'
claude-squadra
# inside Claude Code:
#   /squadra:login coordinator      or      /squadra:login worker1
#   /squadra:status   /squadra:logout   /squadra:access   /squadra:configure
```
