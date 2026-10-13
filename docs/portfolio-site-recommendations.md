# Portfolio site: audit and recommendations (2026-10-01)

Notes from an agent-assisted review of venkatiyerportfolio.replit.app, written as a brief a Replit agent could execute. Reconstructed from the review summary; the full two-phase brief and draft `DESIGN.md` live with the original site workspace.

## Phase A: content and correctness

1. **Fix the dead canonical host.** Canonical, `og:url`, `twitter:url`, the Plausible domain, and `portfolio-pdf.html` all still point at `venkat-portfolio.replit.app`, which 404s. Point everything at `venkatiyerportfolio.replit.app`.
2. **Dedupe the project grid.** 28 tiles, 27 unique projects (`ai-pilots` appears twice in the `projects` object in `script.js`). Remove the duplicate and never hand-type the count anywhere in copy; derive it.
3. **Replace the stale resume.** `Venkat_Iyer_Resume.pdf` on the site is dated 2025-10-28. Upload the current one-page version and update the download link.
4. **Reconcile the timeline with the resume.** The site predates the most recent year of work (skills library, CRM program, AI governance). Timeline titles and dates disagree with the current resume. Use years only, and the same role titles as the resume.
5. **Add the missing recent work as tiles.** Three bodies of work are absent: the governed revenue skills library (graph-connected, scored, blind-tested agent skills), the Salesforce-to-CRM migration program, and the AI governance and enablement work (care package, best-practices guide, setup video). Write each as problem, what was built, outcome.
6. **Copy gate before publishing.** Every number on the site needs a source you can point to. Unverified or internal-only figures stay off. No internal codenames; describe the thing, don't name it. No hype words ("revolutionary", "game-changing"), no overclaims ("hundreds of users" when the measured range is smaller).

## Phase B: styling and accessibility

Baseline from `npx impeccable@3.6.1 detect <local-copy>`: **128 findings**. Target: 20 or fewer.

| Finding | Count | Fix |
|---|---|---|
| side-tab | 58 | Remove the decorative side tabs; they are the bulk of the noise |
| glow | 27 | Drop box-shadow glows; use one subtle elevation token |
| gradient-text | 15 | Solid ink for headings; gradient at most once on the hero |
| undersized | 8 | Minimum 14px body, 12px for captions |
| low-contrast | 4 | Meet 4.5:1 on body text |
| overused font | 4 | See fonts below |

Run the detector on local files; against the live URL it hung for over five minutes.

**Fonts.** Flagged as overused by the detector: Geist, Space Grotesk, Instrument Sans, Fraunces. Not flagged: Bricolage Grotesque, Hanken Grotesk, Newsreader, Onest, Manrope, IBM Plex Sans. Pick one display and one text face from the second list.

**Accessibility gaps found (all fixable in CSS/HTML, no framework change):**
- Zero `aria-*` attributes; add labels to icon buttons and the modal.
- No `<main>` landmark; wrap the content.
- No `:focus-visible` styles; keyboard users can't see where they are.
- No `prefers-reduced-motion` handling; wrap animations in the media query.
- Category headers are click-only `<div>`s; make them `<button>`s or add `role`, `tabindex`, and key handlers.
- Esc-to-close on the modal already works; keep it.

**Brand.** This is a personal site. Do not reuse any employer's brand colors, lockup, or design tokens. Extract your own `DESIGN.md` (palette, type scale, spacing, elevation) and have the agent build from it instead of improvising per component.

## Process notes that generalize

- Audit first, with a mechanical detector, so "better styling" has a number attached and a target.
- Give the agent two phases: content correctness, then styling. Mixing them is how the duplicate tile and the dead canonical survived earlier passes.
- Keep a gate list of claims that need a human yes before they ship. The agent drafts; you confirm.
