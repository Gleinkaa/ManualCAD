# ManualCAD

A 2D drafting program for Austrian mechanical manufacturing drawings (Fertigungszeichnungen). You construct every element by hand the way you would on a drawing board, and the program enforces the drawing standards for you.

**▶ [Live-Demo](https://gleinkaa.github.io/ManualCAD/)** — opens on an A3 sheet with a title block. Type `LINE`, `CIRCLE` or `DIMLINEAR` in the command line. No install, no sign-up.

## What it does

- **Manual drafting, not modelling.** Every line, view and annotation is placed by you. Views are never generated from a 3D model — the point is the exercise of drawing it.
- **Standards are enforced, not suggested.** Line type follows meaning (thick solid = visible edge, thin dash-dot = centre line) and line width comes from the sheet's line group, per ISO 128-2. You cannot pick a line width freely.
- **Sheet and views.** One A4–A0 sheet per file with an ISO 7200 title block and an ISO 7573 parts list. Each view carries its own scale and origin, and a linked view can only move along its projection axis relative to its parent until you deliberately unlink it.
- **AutoCAD command line.** Commands use AutoCAD English names and short aliases (`L`, `REC`, `DLI`, `DAN`, …), with autocomplete over every command and alias, prefix matches first. `F1` (or `?`) lists them all with one-line summaries.
- **Associative dimensions and hatching.** A dimension follows the geometry it measures — never the reverse. Hatching re-finds its region when an edge of its boundary is edited, and breaks around text inside it. HATCH previews the area under the cursor and explains a failed pick: an outline closed only by hidden or centre lines, a gap (its open ends marked in red), or nothing around the point.
- **Notes and item numbers.** Leaders per ISO 128-22 (a note stands on a short horizontal reference line) and item numbers per ISO 6433, lettered at twice the dimension text height.
- **Export.** PDF and SVG, at sheet scale.

## Why it exists

Most CAD tools assume the drawing falls out of a model. For training — and for the Austrian manufacturing drawings this targets — the drawing *is* the work, and the costly mistakes are standards mistakes: a wrong line type, a missing centre line, a hatch not associated to anything, a dimension that no longer matches its part.

ManualCAD treats those as first-class: the norm rules are data in the program (`model/standards.ts`), each one with an ID and its source, so an element's appearance is derived from what it means rather than from a layer or a style someone set once and forgot.

## Quick start

```bash
git clone https://github.com/Gleinkaa/ManualCAD.git
cd ManualCAD
npm ci
npm run dev        # http://localhost:5173
```

| Command | |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm test` | vitest unit tests |
| `npm run typecheck` | `tsc`, strict |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the production build |

## Commands

Dimensions (**Bemaßungen**): `DIMLINEAR` (`DLI`), `DIMALIGNED` (`DAL`), `DIMRADIUS` (`DRA`), `DIMDIAMETER` (`DDI`), `DIMANGULAR` (`DAN`), `DIMEDIT` (`DED`).

Draw: `LINE` `CIRCLE` `ARC` `RECTANG` `HATCH` `SKETCH` `TEXT`
Modify: `OFFSET` `TRIM` `EXTEND` `FILLET` `CHAMFER` `MOVE` `COPY` `ROTATE` `SCALE` `STRETCH` `MIRROR` `ERASE` `HATCHEDIT` `TEXTEDIT`
Annotate: `LEADER` `BALLOON`
Sheet: `VIEW` `LTYPE` `LAYER` `ZOOM` `PAN` `TITLEBLOCK` `PARTSLIST` `HELP`

Start a command and the command line walks you through its prompts. At the command line, autocomplete lists matching names and aliases: arrow keys to move, `Enter` or `Tab` to accept. It stays out of the way once a command has started, so coordinates and options are never intercepted.

Dimension text accepts AutoCAD escapes: `%%c` → ⌀, `%%d` → °, `%%p` → ±, and `<>` stands for the measured value.

## Architecture

TypeScript + Vite + Canvas2D, no runtime framework. Dependencies point one way only:

```
app → plot → dim → model → geom
```

- `geom/` — pure 2D curve maths (line, circle, arc): intersections, snaps, offset, trim, extend, fillet, chamfer, freehand arcs, closed regions, hatch lines. No DOM.
- `model/` — document types (`SheetDoc`), the norm rule data, and doc helpers (view transforms, projection links, anchors, annotation transforms, JSON).
- `dim/` — dimensions rendered to plot primitives per ISO 129-1.
- `plot/` — sheet to device-independent primitives in sheet millimetres (y up), plus the canvas renderer and the PDF/SVG export.
- `app/` — the UI: viewport, command line (autocomplete, option chips), commands, grips, snaps, selection, undo, help.

Coordinates are paper millimetres with the origin bottom-left and y up; entity geometry is stored in view-local real millimetres and converted on the way to the sheet.

Design decisions are recorded in `docs/adr/`, the domain vocabulary in `CONTEXT.md`.

## Status

A work in progress, built as a training tool. Desktop packaging via Tauri is planned (see ADR-0002); Rust is not wired up yet.

The stack, the conventions and the module map for contributors are in `CLAUDE.md`.

## License

No licence yet — all rights reserved.
