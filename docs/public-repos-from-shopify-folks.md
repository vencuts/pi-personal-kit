# Public repos from Shopify folks worth knowing

A reading list of public GitHub repos by people who work (or worked) at Shopify, collected 2026-10-13. Everything here is public on the author's own account. Star counts are from that day.

How it was built: public members of the Shopify GitHub org, each member's public non-fork repos pushed in 2026, filtered for agent / Pi / skills relevance or traction, plus a few authors found by hand. Coverage is partial: only people who made their org membership public are visible this way. The complete unfiltered scan is in [shopify-public-repos-full-scan-2026-10-13.md](shopify-public-repos-full-scan-2026-10-13.md).

## Pi itself and autoresearch

| Repo | What it is |
|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi) | Pi, the coding agent everything below plugs into. ★114k |
| [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | Autonomous experiment loop for Pi: try, measure, keep, discard. ★8.2k. [Docs](https://davebcn87.github.io/pi-autoresearch/) |
| [pascal-de-ladurantaye/pi-agent](https://github.com/pascal-de-ladurantaye/pi-agent) | A personal Pi package: extensions, skills, prompts, themes, plus the `APPEND_SYSTEM.md` pattern. `pi install git:https://github.com/pascal-de-ladurantaye/pi-agent` |
| [pascal-de-ladurantaye/bb-autoresearch](https://github.com/pascal-de-ladurantaye/bb-autoresearch) | Measured code-optimization studies as a plugin for [BB](https://github.com/get-bb/bb). Companion: [bb-bench-provider-gcp](https://github.com/pascal-de-ladurantaye/bb-bench-provider-gcp) |
| [martelogan/autoclanker](https://github.com/martelogan/autoclanker) | Bayesian harness for agent auto-eval loops. Pi extension: [pi-autoclanker](https://github.com/martelogan/pi-autoclanker) |

## Daily Pi workflow

| Repo | What it is |
|---|---|
| [tobi/qmd](https://github.com/tobi/qmd) | Mini CLI search engine for docs, notes, knowledge bases. ★30k |
| [Soleone/logdig](https://github.com/Soleone/logdig) | Turns saved Pi sessions into daily Markdown notes grouped by project |
| [Soleone/pi-tasks](https://github.com/Soleone/pi-tasks) | Task management for Pi via beads or other backends. CLI: [pi-tasks-cli](https://github.com/Soleone/pi-tasks-cli) |
| [Soleone/pi-prompts](https://github.com/Soleone/pi-prompts) | Hotkey palette of recently used prompts across all Pi sessions |
| [Soleone/pi-favs](https://github.com/Soleone/pi-favs) | Short list of files and directories kept handy |
| [Soleone/pi-git](https://github.com/Soleone/pi-git) | Git workflow from inside Pi |
| [Soleone/pi-topic](https://github.com/Soleone/pi-topic) | Session topic shown above the input editor |
| [Soleone/pi-staffed](https://github.com/Soleone/pi-staffed) / [staffed](https://github.com/Soleone/staffed) | Visualize subagents and staffed roles; staff a project with coordinated subagent roles |
| [Soleone/pi-statusline](https://github.com/Soleone/pi-statusline), [pi-sketchpad](https://github.com/Soleone/pi-sketchpad), [pi-zellij-attention](https://github.com/Soleone/pi-zellij-attention), [podcaster](https://github.com/Soleone/podcaster), [pi-ext](https://github.com/Soleone/pi-ext) | More from the same author |
| [herdrdev/herdr](https://github.com/herdrdev/herdr) | Herdr, the runtime your coding agents live on. ★43k. Clients: [herdr-gpui](https://github.com/penso/herdr-gpui), [herdrm](https://github.com/missuo/herdrm), [herdr-web-ui](https://github.com/devswha/herdr-web-ui); review plugin [herdr-reviewr](https://github.com/persiyanov/herdr-reviewr) |
| [tobi/pi-herdr-workers](https://github.com/tobi/pi-herdr-workers) | Pi + Herdr: `/team` worker panes, `/loop` re-wakes, monitors |
| [kalindudc/pi-minions](https://github.com/kalindudc/pi-minions) | Minions for your Pi |
| [kalindudc/pi-quests](https://github.com/kalindudc/pi-quests) | Keep your agent on track, one quest at a time |
| [benjaminsehl/agent-kernel](https://github.com/benjaminsehl/agent-kernel) | Markdown workspace for agent memory, durable context, reusable outputs |
| [st0012/cctop](https://github.com/st0012/cctop) | Keyboard-first menubar app to monitor and jump between AI coding sessions. ★155 |
| [surma/pi-config](https://github.com/surma/pi-config), [adeci/pi-agent-config](https://github.com/adeci/pi-agent-config) | Other people's global Pi configs, for ideas |
| [ryanwilsonperkin/pi-notifications](https://github.com/ryanwilsonperkin/pi-notifications) | Notifications for Pi |
| [jfinnson/pi-party](https://github.com/jfinnson/pi-party) | Share one Pi session with several humans (relay code is internal, pattern is readable) |
| [burke/claude-tasks-viewer](https://github.com/burke/claude-tasks-viewer) | ratatui TUI viewer for Claude Code task lists |

## Secrets, sandboxing, hygiene

| Repo | What it is |
|---|---|
| [tobi/s](https://github.com/tobi/s) | Encrypted env store: secrets injected at runtime and scrubbed from output, so the agent never sees them |
| [tobi/wrap](https://github.com/tobi/wrap) | Run coding agents and project commands inside isolated Arch Linux microVMs |
| [tobi/reve](https://github.com/tobi/reve) | Durable Ruby coding agents in mandatory microsandbox microVMs |
| [kvendrik/backoffice](https://github.com/kvendrik/backoffice) | Give your AI assistant its own Linux machine that keeps working when you close the laptop |
| [tobi/try](https://github.com/tobi/try) | Fresh directories for every vibe. ★4k |

## Skills authoring and evaluation

| Repo | What it is |
|---|---|
| [brysonreece/better-skill-creator](https://github.com/brysonreece/better-skill-creator) | Refined skill-creator for Claude, based on Anthropic research recommendations |
| [st0012/ruby-skills](https://github.com/st0012/ruby-skills) | Claude Code plugins for Ruby development. ★125 |
| [benjaminsehl/liquid-skills](https://github.com/benjaminsehl/liquid-skills) | Claude Agent Skills for Shopify Liquid theme development. ★120 |
| [camsimony/claude-skills](https://github.com/camsimony/claude-skills) | A collection of Claude Code skills |
| [grodowski/undercover](https://github.com/grodowski/undercover) | Warns about methods, classes and blocks changed without tests. ★844. Claude plugin: [undercover-claude](https://github.com/grodowski/undercover-claude) |
| [gmcgibbon/agentic-development-in-ruby](https://github.com/gmcgibbon/agentic-development-in-ruby) | Agentic development in Ruby |

## Agent coordination patterns

| Repo | What it is |
|---|---|
| [DerekStride/agent-mail](https://github.com/DerekStride/agent-mail) | Local Maildir message bus for coding-agent sessions |
| [DerekStride/agent-id-cli](https://github.com/DerekStride/agent-id-cli) | Portable identity registry for coding-agent sessions |
| [DerekStride/agent-orchestrator](https://github.com/DerekStride/agent-orchestrator) | Orchestrator that drives one dependency-scoped task graph |
| [DerekStride/sift-v1](https://github.com/DerekStride/sift-v1) | Queue-driven review system: humans decide, agents do the work |
| [DerekStride/agent-workspace](https://github.com/DerekStride/agent-workspace) | Agent workspace |
| [tobi/bb-bots-sidebar](https://github.com/tobi/bb-bots-sidebar) | Specialist bots, their memory, and conversations together across projects (for BB) |
| [NickLewanowicz/claude-agent](https://github.com/NickLewanowicz/claude-agent) | Self-hosted Docker web UI for Claude Code |
| [NickLewanowicz/slate](https://github.com/NickLewanowicz/slate) | Android home-screen widget for AI agents: push status, ask questions |
| [Soleone/agent-memory](https://github.com/Soleone/agent-memory) | Global and project-scoped memory |

## Design skills (not Shopify authors, but the ones installed and used daily)

| Repo | What it is |
|---|---|
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | The design language that makes an AI harness better at design: `/impeccable` critique, polish, distill, harden, animate. ★80k |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Source of `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`, `redesign-existing-projects`, plus brandkit, image-to-code, stitch. ★95k |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md) | DESIGN.md: a format for describing a visual identity to coding agents. What `designmd` extracts into. ★28k |
| [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) | Dark-themed system architecture diagrams as standalone HTML/SVG. Source of `architecture-diagram`. ★7.4k |
| [h3nryprod01/design-taste](https://github.com/h3nryprod01/design-taste) | Merged synthesis of emilkowalski/skill, impeccable and others into one taste skill. ★73 |
| [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) | Large skills catalog and local control plane; carries copies of the UI skills above. ★47k |

## Fun and tangents

| Repo | What it is |
|---|---|
| [tobi/neohack](https://github.com/tobi/neohack) | NetHack as a library; semantic world exploration engine |
| [tobi/walgit](https://github.com/tobi/walgit) | A git server that is one binary in front of an object store. ★2.6k |
| [tobi/disktree](https://github.com/tobi/disktree) | Treemap for finding and removing what fills your disk |
| [kvendrik/voicecall](https://github.com/kvendrik/voicecall), [zenchef](https://github.com/kvendrik/zenchef) | Have an agent make your calls and restaurant bookings |
| [ryanwilsonperkin/gen](https://github.com/ryanwilsonperkin/gen) | LLM-powered tab completion for the command line |
| [gil--/ucp-agent-imessage](https://github.com/gil--/ucp-agent-imessage) | Agentic commerce chat on UCP + iMessage |

## Well-starred general tools from the same scan

| Repo | What it is |
|---|---|
| [burke/zeus](https://github.com/burke/zeus) | Boot any Rails app in under a second. ★3.3k |
| [jhawthorn/vernier](https://github.com/jhawthorn/vernier) | Next generation CRuby profiler. ★1.1k. Also [sheap](https://github.com/jhawthorn/sheap), [discard](https://github.com/jhawthorn/discard) |
| [k0kubun/pp](https://github.com/k0kubun/pp) | Colored pretty printer for Go. ★2k. Also [md2key](https://github.com/k0kubun/md2key), [gitstar-ranking](https://github.com/k0kubun/gitstar-ranking) |
| [clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) | The modern toolkit for drag and drop interfaces. ★17.7k |
| [Edouard-chin/ci_runner](https://github.com/Edouard-chin/ci_runner) | Rerun CI failures locally without copy/paste |
| [DerekStride/tree-sitter-sql](https://github.com/DerekStride/tree-sitter-sql) | SQL grammar for tree-sitter. ★247 |
| [st0012/rubylens](https://github.com/st0012/rubylens) | Turn your Ruby codebase into a galaxy |
| [paracycle/slackthemes](https://github.com/paracycle/slackthemes) | Slack sidebar theme browser. ★873 |
| [willnguyen1312/zoom-image](https://github.com/willnguyen1312/zoom-image) | Headless image zoom library. ★357 |
