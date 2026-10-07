# Handoff: leaders, item numbers, associative hatching, UX pass (2026-10-06)

This session continued from the ZA 38 session (PR #1, `feat/za38-partial-sections`: partial sections, SKETCH, TEXT, HATCH, DIMANGULAR, parts list, SVG export; its feature list is in the PR description and `git log`).
- **Branch:** `feat/ux-pass`, stacked on `feat/za38-partial-sections`.
- **ZA 38 source and transcription:** `docs/testcases/` (photo and `ZA38.md`).

## Current state

- **CI:** `.github/workflows/ci.yml` runs `npm ci`, typecheck, test and build on every PR and on pushes to `master`, and uploads the ZA 38 SVG render as the `za38-svg` artifact.
- **Checks:** `npm test` gives 240 passing and 1 skipped (the SVG render script). `npm run typecheck` and `npm run build` are clean.
- **End-to-end test** (`src/app/za38.test.ts`, fixture in `src/app/testcases/za38.ts`): draws the whole exercise through typed commands only and checks every dimension value from the book, the five hatched cut regions, the parts list and the title block.
- **Visual checks:**
  - Write the SVG with `ZA38_SVG=/tmp/za38.svg npx vitest run scripts/render-za38.test.ts`.
  - In the running app, `await (await import('/src/app/testcases/za38.ts')).drawZA38()` from the dev console gives the document. Load it with `window.manualcad.replaceDoc(doc, true)`.
- **Browser runs (Playwright, Vite):**
  - A full UX audit drove every toolbar button, every command name and alias, and a complete small part through to PDF at 1024, 1280 and 1600 px width. There were no console errors.
  - LEADER, BALLOON, DIMANGULAR 3-point, FILLET on a hatched boundary and the parts list dialog were checked on screen, including hatching breaking around a rotated dimension value.

## New in this session

| Feature | Where |
|---|---|
| CI workflow | `.github/workflows/ci.yml` |
| LEADER (LE, QLEADER, MLEADER, MLD): note on a horizontal reference line (ISO 128-22). The terminator comes from where the tip lands: arrowhead on an outline (snapped to an object, except a centre), dot inside. The Terminator option forces Arrow/Dot/None | `model/types.ts` (`Leader`), `plot/annot.ts`, `app/commands/annotate.ts` |
| BALLOON (BAL, ITEM): item number (ISO 6433) on a straight leader, at twice the dimension text height. The default is the first parts list item not yet placed; it warns when the number is missing from a non-empty parts list | `app/commands/annotate.ts` |
| DIMANGULAR 3-point form: Enter at the first prompt, then the vertex and two endpoints. The 30° on ZA 38 no longer needs a helper line | `app/commands/dims.ts` |
| Hatching is interrupted around notes, leader texts and dimension values (Norm rule HATCH-TEXT) | `geom/hatch.ts` (`clipOutsideConvex`), `plot/annot.ts` (`textBox`) |
| Associative hatching: a hatch keeps its picked point and the ids of its boundary entities. When one of them changes, the region is found again at the end of the command. If the point is no longer enclosed, the hatch keeps its loops, stops following and says so | `app/commands/hatch.ts`, `app/runner.ts` |
| Parts list dialog: PARTSLIST opens it, `-PARTSLIST` keeps the command line. Double-click the title block or the parts list on the sheet to edit them | `app/ui.ts`, `app/app.ts`, `app/commands/settings.ts` |
| Fixes from the audit: rejected input stays in the command line for correction; "Requires a point or a distance" at distance prompts; "Object is not valid for this command." when the pick hits the wrong kind of object; clearer tooltips | `app/runner.ts`, `app/app.ts`, `app/ui.ts` |

| Object snaps: closest wins, with a handicap per kind (a fraction of the aperture: endpoint 0, intersection 0.1, centre/midpoint 0.25, quadrant 0.3, perpendicular/tangent 0.35); nearest only as a fallback. A short line's midpoint is reachable, and the chamfer corner still beats the chamfer's midpoint | `app/snap.ts` (`SNAP_HANDICAP`) |
| Perpendicular onto the extension of a line, when there is a base point | `app/snap.ts` |
| Typed one-shot snap overrides at point prompts: END, MID, CEN, QUA, INT, PER, TAN, NEA. They work with SNAP off; a click that finds no such point is refused and the prompt stays | `app/runner.ts`, `app/app.ts` |
| A hatch moved, copied or mirrored without its whole boundary stops following it (a copy made with its boundary follows the copied boundary) | `model/annot.ts` (`remapHatchBoundary`), `app/commands/modify.ts` |

Files saved before this session load unchanged: hatches without `assoc` keep their fixed loops.

### Decisions taken (formerly open judgement calls)

- **A, PER onto a line's extension:** done, with a base point.
- **B, tiered priority vs closest-wins:** hybrid. Closest wins, and the kind handicap settles near-ties.
- **C, deferred PER/TAN as the first point:** not built. Typed overrides cover the common need; PER/TAN at a first point is refused with a message.
- **D, CEN by hovering the centre:** kept, as a training convenience.
- **Hatch copied without its boundary:** loses its association at once.

## Known limitations and next steps

1. **Associativity follows the picked point, not the boundary objects.** If the boundary geometry is moved without the hatch, the point can end up outside, and the hatch then stops following. Moving both together works.
2. **Deferred PER/TAN** (a first point perpendicular or tangent to an object) is not supported; see the decisions above.
3. **Leader texts are single-line.** For a tip on a dimension line, the terminator is not chosen automatically; use Terminator → None.
4. **The sheet stays German** (title block, parts list headers) while the UI is English. This is deliberate for Austrian drawings and was raised by the audit. A sheet-language setting is the fix if English sheets are ever needed.
5. **The toolbar wraps to three rows at 1600 px.** It works, but one menu per group (Draw, Modify, Annotate, Dimension) would be tidier.
6. **NEW asks no confirmation.** UNDO restores the previous drawing, and the message says so.
7. **`chrome-devtools-axi` failed earlier** with a pageId validation error. Use Playwright with `/usr/bin/chromium`.

## How to resume

```
cd ~/Work/ManualCAD
npm ci
npm test
npm run dev            # window.manualcad is the App in dev builds
```

Driving the app with Playwright: view-local mm → CSS px via `app.vp.toScreen`, then `page.mouse`. Type into `.mc-input` with `press('Enter')`; Space only submits while the input is empty, so text with spaces works.
