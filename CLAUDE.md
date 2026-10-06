# ManualCAD

2D manual drafting for Austrian manufacturing drawings (ÖNORM EN ISO). Read `CONTEXT.md` (glossary) and `docs/adr/` before changing behaviour.

## Stack
TypeScript + Vite + Canvas2D, tests with vitest. Desktop app later via Tauri (ADR-0002; Rust is not installed yet).
`npm run dev` · `npm test` · `npm run typecheck`

## Modules (`src/`)
- `geom/`: pure 2D curve math (line/circle/arc): intersections, snaps, offset/trim/extend/fillet/chamfer. No DOM.
- `model/`: document types (`SheetDoc`), Norm rule data (`standards.ts`), doc helpers (view transforms, projection links, anchors, JSON).
- `dim/`: dimensions → plot primitives per ISO 129-1. No DOM.
- `plot/`: sheet → device-independent primitives (sheet mm, y up), canvas renderer, PDF export, fonts.
- `app/`: UI: viewport, command line, commands, snaps, selection, undo.

Dependency direction: `app → plot → dim → model → geom`. Never import upward.

## Conventions
- Sheet coordinates: paper mm, origin bottom-left, y up. Entity geometry: view-local real mm (`toSheet`/`toLocal` in `model/doc.ts`).
- Line type and width are never chosen freely: they come from `LineTypeId` + the sheet's line group (ADR-0001).
- Commands: AutoCAD English names and short aliases. UI language English.
- Exported signatures in `geom/index.ts`, `dim/index.ts`, `plot/index.ts` are contracts; change them only deliberately and update all callers.
