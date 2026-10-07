# Handoff: hatch UX, icon toolbar, help, autocomplete, ROTATE/SCALE (2026-10-07)

This session followed the 2026-10-06 UX pass (PR #2, `feat/ux-pass`). Its notes are kept below, under "Previous handoff".
- **Branch:** `feat/ux-hatch-help`, on `master` after PR #2.
- **Checks:** `npm test` gives 300 passing and 1 skipped; `npm run typecheck` and `npm run build` are clean.
- **Browser runs (Playwright, `/usr/bin/chromium`, the copy under `~/.hermes/hermes-agent/node_modules/playwright`):** every screen below was driven and screenshotted at 1400 and 1100 px width with no console errors; the rollover pick costs 0.5 ms per mouse move on ZA 38 (101 entities, 26 dimensions), the hatch preview under 0.1 ms.

## Why: "how do I hatch an area?"

HATCH worked before, but only told the user *that* nothing was found. Now:

| Change | Where |
|---|---|
| **Hatch preview under the cursor.** While HATCH asks for a point, the area that would be hatched is drawn in the preview colour, so the user sees whether the outline is closed before clicking | `app/commands/hatch.ts` (`preview` in the point request, cached per cursor position) |
| **Diagnosis instead of "No closed boundary".** `diagnoseHatch` says one of three things: the area is closed only by hidden/centre/phantom/construction lines (names them, says a cut surface needs visible, thin or freehand lines); the boundary has gaps (the open ends are marked in red on the sheet until the next pick, with EXTEND/TRIM/FILLET R0 as the repair); or there is nothing around the point | `app/commands/hatch.ts`, `geom/region.ts` (`openEnds`: vertices of degree 1 after splitting at intersections) |
| HATCH options Flip (45° ↔ 135°, for the adjacent part) and Undo (the last hatch of this command) | `app/commands/hatch.ts` (`flipAngle`) |
| HATCHEDIT (HE): Angle / Spacing / Flip on selected hatches; the current settings follow. Double-click a hatch to open it | `app/commands/hatch.ts`, `app/app.ts` (`onDoubleClick`) |

## Other new things

| Feature | Where |
|---|---|
| Icon toolbar: 30 px icon buttons in captioned groups (File, Draw, Modify, Annotate, Dimension, View); the running command's button is highlighted; hovering a button shows its description in the status bar | `app/icons.ts` (41 inline SVGs, 20×20, `iconElement`), `app/ui.ts` (`GROUPS`), `app/style.css` |
| HELP (F1, `?`, the ? button): modal reference with the basics (command line, prompts, points, snaps, selecting, mouse, line types, hatching) and every command with aliases and a one-line summary | `app/commands/index.ts` (`COMMAND_INFO`, `aliasesOf`), `app/ui.ts` (`openHelpDialog`) |
| Command line autocomplete: typing shows matching commands (alias, name, summary); ↑/↓ choose, Tab completes, Enter on a partial name runs the highlighted one; click a row | `app/commands/index.ts` (`suggestCommands`), `app/app.ts` |
| Option chips: the current prompt's [options] are buttons right of the input | `app/app.ts` (`refreshPrompt`) |
| Rollover highlight: the object a click would pick is drawn in light blue (entity prompts honour their filter) | `app/app.ts` (`rollover`, `HOVER`) |
| Status bar: selection count ("3 selected") and a mouse hint for the current prompt | `app/ui.ts`, `app/app.ts` (`defaultHint`) |
| ROTATE (RO) and SCALE (SC): base point, typed angle/factor or picked direction/distance, Copy and Reference options, live ghost; annotations and dimensions go along (`rotateAnnotation`, `scaleAnnotation`); hatch angle, text height and hatch spacing stay (paper values) | `app/commands/modify.ts`, `model/annot.ts`, `app/rotate-scale.test.ts` |
| TEXTEDIT (ED, DDEDIT): new text for notes and leaders, Enter keeps; double-click a text or leader. Double-click a dimension opens DIMEDIT on it | `app/commands/annotate.ts`, `app/app.ts` |
| ZOOM Window (Z W) with a rubber-band box; PAN (P): left-drag pans until Esc/Enter/right-click, for mice without a middle button; Ctrl+A selects everything visible | `app/commands/settings.ts`, `app/viewport.ts` (`fitBox`), `app/app.ts` |
| Point requests may set `acceptNumber: true`: a typed bare number then arrives as `{ kind: 'number' }` (angle, factor) instead of being read as a direct distance | `app/commands/types.ts`, `app/runner.ts` |

Messages changed: "N hatch(es) created." → "1 hatch created." / "2 hatches created."; "No closed boundary found around the point." → the three diagnosis texts in `diagnosisMessage`.

## Second pass (same day): grips, gap tolerance, icons

| Feature | Where |
|---|---|
| **Grips.** Selected objects show blue squares: line ends and midpoint, circle centre and quadrants, arc ends, midpoint and centre, text insertion point, leader points. Hovering turns one red; clicking it starts the hidden GRIPSTRETCH command (point prompt with base, snaps/ortho/polar work, live ghost). All selected grips at the same spot move together, so a corner stretches both lines. Associative dimensions and hatches follow through the existing anchor and `updateAssociativeHatches` paths | `app/grips.ts` (`objectGrips`, `stretchCurve`, `applyGrip`), `app/commands/grips.ts`, `app/app.ts` (`startGripDrag`, `hotGrip`), `app/overlay.ts` (`drawGrip`) |
| HATCH Gap option (AutoCAD HPGAPTOL, default 0): open ends closer than the tolerance are joined by bridge lines before the region is found; the hatch remembers the tolerance in `assoc.gap` so re-finding after edits uses it. The failure message now names the smallest gap and the option | `app/commands/hatch.ts` (`bridgeGaps`, `hatchRegion(..., gap)`), `commands/types.ts` (`hatchGap`), `session.ts`, `model/types.ts` |
| Redrawn DIMALIGNED, DIMEDIT and HATCHEDIT icons (larger arrowheads, bigger pencil) | `app/icons.ts` |
| Hidden commands (`GRIPSTRETCH`) stay out of HELP, autocomplete and Enter-repeat | `app/commands/index.ts` (`isHiddenCommand`), `app/runner.ts` |

## Third pass (same day): dimension grips, Shift-collected grips, STRETCH

| Feature | Where |
|---|---|
| Dimension grips: a linear dimension shows its two measured points (dragging one detaches it from the geometry and moves it) and a grip on the dimension line (drag = new offset); a radius/diameter dimension one grip at the text end (drag = new direction and leader); an angular dimension one on its arc (drag = new radius and sector) | `app/grips.ts` (`dimensionGrips`, `stretchDimension`) |
| Shift+click collects grips (red); clicking one of them drags the whole set by the displacement, so the spacing is kept. Esc drops the set | `app/app.ts` (`hotSet`, `toggleHotGrip`), `app/commands/grips.ts` (`moved`) |
| STRETCH (S): crossing window by two corners, then base and second point. Line ends, arc ends, text and leader points and detached dimension points inside the window move; a circle or arc moves whole when its centre is inside; objects fully inside move whole. Live ghost, toolbar button, icon | `app/commands/grips.ts` (`stretch`, shared `ghost`), `app/icons.ts` |

Hatches still have no grips: they follow their boundary, and that is the ISO-correct behaviour.

## Known limitations and next steps

1. **Grip modes.** AutoCAD's Enter-cycling of a hot grip through move/rotate/scale/mirror is not built; ROTATE/SCALE/MIRROR commands cover it.
2. **A dragged dimension point detaches.** Dragging a measured point of a dimension onto a new snapped point does not re-associate it (AutoCAD does); the fallback is stored and the dimension stops following that end.
3. **Autocomplete ranks substring matches too** (typing `di` also lists HATCHEDIT and TEXTEDIT after the DIM* commands). Drop rank 3 in `suggestCommands` if that annoys.
4. **The toolbar wraps to two rows below ~1250 px.** Still usable; icon-only buttons could lose their captions at narrow widths.
5. The items 1–7 of the previous handoff still apply where not superseded (toolbar item 5 is done; `chrome-devtools-axi` item 7 still true).

## How to resume

```
cd ~/Work/ManualCAD
npm ci
npm test
npm run dev            # window.manualcad is the App in dev builds
```

Driving the app with Playwright: view-local mm → CSS px via `app.vp.toScreen`, then `page.mouse`. Type into `.mc-input` with `press('Enter')`; Space only submits while the input is empty, so text with spaces works. `drawZA38()` from `/src/app/testcases/za38.ts` returns `{ doc }`; load it with `window.manualcad.replaceDoc(doc, true)`.

---

# Previous handoff: leaders, item numbers, associative hatching, UX pass (2026-10-06)

This session continued from the ZA 38 session (PR #1, `feat/za38-partial-sections`: partial sections, SKETCH, TEXT, HATCH, DIMANGULAR, parts list, SVG export; its feature list is in the PR description and `git log`).
- **Branch:** `feat/ux-pass`, stacked on `feat/za38-partial-sections`.
- **ZA 38 source and transcription:** `docs/testcases/` (photo and `ZA38.md`).

## Current state

- **CI:** `.github/workflows/ci.yml` runs `npm ci`, typecheck, test and build on every PR and on pushes to `master`, and uploads the ZA 38 SVG render as the `za38-svg` artifact.
- **Checks:** `npm test` gives 264 passing and 1 skipped (the SVG render script). `npm run typecheck` and `npm run build` are clean.
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
