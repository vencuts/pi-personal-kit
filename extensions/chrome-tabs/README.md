---
summary: Manage your real Chrome browser tabs — list, find, close, switch, open, deduplicate.
commands: [/chrome-tabs]
tools: [chrome_tabs]
category: browser
keywords: [chrome, tabs, browser, tab management, close tabs, duplicate tabs, macos]
status: stable
---

# Chrome Tabs

Manage your **real** Chrome browser tabs from Pi via macOS AppleScript. Unlike the `chrome-devtools` extension (which controls an isolated headless browser), this talks to your actual Chrome instance with all your logged-in sessions and open tabs.

## Requirements

- **macOS** (AppleScript is a macOS-only technology)
- **Google Chrome** installed and running
- First time: macOS may prompt to allow automation access in System Settings → Privacy & Security → Automation

## Tool: `chrome_tabs`

A single tool with an `action` parameter:

| Action | Description | Required params |
|--------|-------------|-----------------|
| `list` | List all tabs across all windows | — |
| `windows` | Window summary with tab counts | — |
| `count` | Total number of open tabs | — |
| `find` | Find tabs matching title or URL | `pattern` |
| `switch` | Focus a specific tab | `tab`, optional `window` |
| `open` | Open a URL in a new tab | `url`, optional `window` |
| `close` | Close tab by index or by pattern | `tab`+`window` or `pattern` |
| `close_duplicates` | Remove duplicate tabs (keeps first of each URL) | — |
| `reload` | Reload a tab | optional `window`, `tab` |

### Parameters

- `action` — Required. One of the actions above.
- `pattern` — Search string for `find`/`close` (case-insensitive, matches title or URL).
- `window` — Window number (1-based, defaults to 1).
- `tab` — Tab number within the window (1-based).
- `url` — URL to open.

## Command: `/chrome-tabs`

Quick tab overview from the command line:

```
/chrome-tabs              # Show windows summary (default)
/chrome-tabs list         # List all tabs
/chrome-tabs count        # Tab count
/chrome-tabs find slack   # Find tabs matching "slack"
```

## Examples

Ask Pi naturally:

- "How many tabs do I have open?"
- "Find all my Slack tabs"
- "Close duplicate tabs"
- "Close all tabs with observe in the URL"
- "Switch to the Google Sheets tab"
- "Open https://github.com in Chrome"
