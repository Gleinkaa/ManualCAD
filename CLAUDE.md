# ManualCAD

2D manual drafting for Austrian manufacturing drawings (ÖNORM EN ISO). Read `CONTEXT.md` (glossary) and `docs/adr/` before changing behaviour.

## Stack
TypeScript + Vite + Canvas2D, tests with vitest. Desktop app later via Tauri (ADR-0002; Rust is not installed yet).
`npm run dev` · `npm test` · `npm run typecheck`

## Modules (`src/`)
- `geom/`: pure 2D curve math (line/circle/arc): intersections, snaps, offset/trim/extend/fillet/chamfer, freehand arcs, closed regions and hatch lines. No DOM.
- `model/`: document types (`SheetDoc`), Norm rule data (`standards.ts`), doc helpers (view transforms, projection links, anchors, annotation transforms, JSON).
- `dim/`: dimensions → plot primitives per ISO 129-1. No DOM.
- `plot/`: sheet → device-independent primitives (sheet mm, y up), canvas renderer, PDF and SVG export, fonts.
- `io/`: drawing interchange (ADR-0004). `dxf/` reads and writes DXF (own tagged-text reader and R2000 writer), `dwg/adapter.ts` reads DWG through LibreDWG as WebAssembly (GPL-3, lazily loaded), `import.ts` maps a `RawDrawing` into a `SheetDoc` (line types from layer/colour/line type, views from layout viewports, title block from block attributes). Sample files in `samples/`; import tests against them in `scripts/io-samples.test.ts` and `scripts/io-dwg.test.ts`.
- `app/`: UI: viewport, command line (autocomplete, option chips), commands, snaps, selection, undo, help. `icons.ts` holds the toolbar SVGs; `grips.ts` the grip points and stretch rules; `commands/index.ts` is the registry and the command catalogue (`COMMAND_INFO`) behind HELP and autocomplete.

Dependency direction: `app → io → plot → dim → model → geom`. Never import upward.

## Conventions
- Sheet coordinates: paper mm, origin bottom-left, y up. Entity geometry: view-local real mm (`toSheet`/`toLocal` in `model/doc.ts`).
- Line type and width are never chosen freely: they come from `LineTypeId` + the sheet's line group (ADR-0001).
- Commands: AutoCAD English names and short aliases. UI language English.
- Exported signatures in `geom/index.ts`, `dim/index.ts`, `plot/index.ts` are contracts; change them only deliberately and update all callers.
