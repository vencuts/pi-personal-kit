/**
 * AppleScript templates for Chrome tab management.
 *
 * Each constant or function returns a complete AppleScript string
 * ready to pass to `osascript -e`.
 */

// ── Read-only queries ─────────────────────────────────────────────────────

/** List every tab across all windows as TSV: window\ttab\ttitle\turl */
export const LIST_TABS = `
tell application "Google Chrome"
  set output to ""
  repeat with w from 1 to (count windows)
    repeat with t from 1 to (count tabs of window w)
      set tabTitle to title of tab t of window w
      set tabUrl to URL of tab t of window w
      set output to output & w & "\\t" & t & "\\t" & tabTitle & "\\t" & tabUrl & linefeed
    end repeat
  end repeat
  return output
end tell`;

/** List windows with tab counts: "Window N: X tabs — active: Title" per line */
export const LIST_WINDOWS = `
tell application "Google Chrome"
  set output to ""
  repeat with w from 1 to (count windows)
    set tabCount to count tabs of window w
    set activeTitle to title of active tab of window w
    set output to output & "Window " & w & ": " & tabCount & " tabs — active: " & activeTitle & linefeed
  end repeat
  return output
end tell`;

/** Return total tab count as a number */
export const COUNT_TABS = `
tell application "Google Chrome"
  set n to 0
  repeat with w from 1 to (count windows)
    set n to n + (count tabs of window w)
  end repeat
  return n
end tell`;

/** Get a single tab's title */
export function getTabTitle(w: number, t: number): string {
  return `tell application "Google Chrome" to return title of tab ${t} of window ${w}`;
}

// ── Mutations ─────────────────────────────────────────────────────────────

/** Activate a tab and bring its window to front */
export function switchTab(w: number, t: number): string {
  return `
tell application "Google Chrome"
  set active tab index of window ${w} to ${t}
  set index of window ${w} to 1
  activate
end tell`;
}

/** Open a URL in a new tab within the given window */
export function openTab(url: string, w: number): string {
  return `
tell application "Google Chrome"
  tell window ${w}
    set newTab to make new tab with properties {URL:"${url.replace(/"/g, '\\"')}"}
  end tell
  activate
end tell`;
}

/** Close a specific tab */
export function closeTab(w: number, t: number): string {
  return `tell application "Google Chrome" to close tab ${t} of window ${w}`;
}

/** Close duplicate tabs (keeps first occurrence of each URL). Returns count. */
export const CLOSE_DUPLICATES = `
tell application "Google Chrome"
  set seenUrls to {}
  set closed to 0
  repeat with w from (count windows) to 1 by -1
    repeat with t from (count tabs of window w) to 1 by -1
      set tabUrl to URL of tab t of window w
      if seenUrls contains tabUrl then
        close tab t of window w
        set closed to closed + 1
      else
        set end of seenUrls to tabUrl
      end if
    end repeat
  end repeat
  return closed
end tell`;

/** Reload a tab. Without a tab number, reloads the active tab. */
export function reloadTab(w: number, t?: number): string {
  if (t !== undefined) {
    return `
tell application "Google Chrome"
  set tabUrl to URL of tab ${t} of window ${w}
  set URL of tab ${t} of window ${w} to tabUrl
end tell`;
  }
  return `tell application "Google Chrome" to reload active tab of window ${w}`;
}
