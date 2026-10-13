# pi-personal-kit

A personal [Pi](https://pi.dev) package: the generic extensions, theme, and prompt I built while using Pi daily. Nothing here depends on any employer's systems.

```sh
pi install git:github.com/<you>/pi-personal-kit   # or: pi install ./pi-personal-kit
```

Then `/reload` in Pi.

| Resource | What it does |
|---|---|
| `extensions/chrome-tabs` | `chrome_tabs` tool + `/chrome-tabs`: list, find, switch, open, close, dedupe tabs in your real Chrome via AppleScript (macOS). |
| `extensions/matrix` | `/matrix` screensaver in the TUI. Reimplementation of a demo by Ju Liu. |
| `extensions/pi-pettes` | Small animated pets in the footer. |
| `extensions/review-loop-budget.ts` | Hard limit on autonomous review loops: max 2 review rounds per session, and no `team_spawn`/`subagent` after 90 min without human input. `/review-budget [status\|allow\|reset]`. |
| `extensions/smart-compaction` | Compaction fails closed: writes a durable handoff (raw JSON + markdown) to `~/Documents/pi-compact-handoffs/` before any summary, and tells the summarizer to keep decision IDs, table names, URLs, SHAs, paths, and corrections verbatim. Set `SMART_COMPACTION_USER=YourName` to extract "YourName caught/flagged/said ..." sentences. |
| `extensions/pre-compact-safety` | Second, independent pre-compact checkpoint (session file, cwd, open decisions, Slack/PR/commit/file refs). Cancels compaction if the checkpoint cannot be written. |
| `extensions/think-deeply.ts` | Typing "think deeply" in a prompt bumps the thinking level for that turn. |
| `extensions/zmux` | Tools for a zmux terminal multiplexer socket (`ZMUX_SOCKET_PATH`). Only useful if you run zmux. |
| `themes/zmux.json` | Dark indigo/cyan theme. |
| `docs/` | [Public repos from Shopify folks](docs/public-repos-from-shopify-folks.md): a curated reading list, plus the [full 395-repo scan](docs/shopify-public-repos-full-scan-2026-10-13.md). |
| `prompts/no-agree.md` | `/no-agree`: forces the strongest counterargument, fragile assumption, and alternative before any recommendation. |

## Not included on purpose
Anything that talks to an internal data warehouse, Slack workspace, SSO proxy, or company tooling. Those were left behind.

## License
MIT.
