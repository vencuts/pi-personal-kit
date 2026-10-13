# Matrix renderer

A dependency-free Pi extension that gives built-in tool calls and results a Matrix-style display:

- New results decode from moving half-width katakana into phosphor-green text on a near-black background.
- Streaming output keeps a digital-rain tail while data arrives.
- Failed tool results use a red palette.
- Tool execution, arguments, results, and model context are unchanged.
- Existing tools owned by another extension are skipped instead of overridden.

## Use

The renderer starts on.

```text
/matrix          toggle
/matrix on       enable
/matrix off      restore Pi's stock renderers
/matrix status   show current state
```

Run `/reload` once after installation. Pi also loads it automatically in every new session.

## Provenance

This is a local reimplementation of the behavior Ju Liu demonstrated in a Pi community channel on 2026-09-02. The demonstrated original was a local `~/.pi/agent/extensions/matrix/index.ts` file and had no published package or source link at install time.

The safe pattern for re-registering only still-built-in tools is adapted from [`pi-quiet-tools`](https://github.com/leblancfg/pi-quiet-tools) at commit `a0fbdffabbbcdaa610d77b80ade305f0b6f9ab6a` (MIT).

## Expected behavior

- Pi warns that `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` are being overridden. This is expected: Matrix replaces their renderers while preserving their built-in execution definitions.
- `/matrix off` lasts for the current extension instance. A reload or new Pi session starts Matrix on again.
- If another extension already owns one of those tools, Matrix skips it and names the skipped tool in a startup warning.

## Safety and performance

- The Matrix rendering layer makes no network calls, spawns no child processes, adds no package dependencies or telemetry, and writes no content.
- The re-registered tools still perform their normal built-in actions. Their `execute` functions pass through unchanged by identity.
- Reads only Pi's documented global/project settings to preserve `shellPath`, `shellCommandPrefix`, and `images.autoResize` when rebuilding tool definitions. Non-settings-based overrides are outside this local renderer's compatibility contract.
- Uses one unreferenced 84 ms animation timer for all active rows and stops it when animations settle or the session shuts down.
- Matrix content fills its renderer width with a near-black background; Pi's one-cell outer padding may retain the active theme color.
- Only the first 48 lines / 8,000 single-cell glyphs animate; the remainder stays readable.
- Historical rows are styled but do not replay animation after reload.
