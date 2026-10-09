# DXF in and out natively, DWG in through LibreDWG, DWG out through an external converter

ManualCAD reads and writes DXF with its own small reader and writer (`src/io`), reads DWG in the browser with LibreDWG compiled to WebAssembly, and does not write DWG itself. Exchange with the school's AutoCAD templates (BBRZ, `samples/bbrz`) is the use case: the templates arrive as DWG, students hand in DWG, and everything in between can be DXF.

## Import maps meaning, not appearance

A DXF entity has a layer, a colour and a line type, and the plotted width comes from a plot style (`samples/bbrz/BBRZ_Plotstil_MB.ctb`: red 0.8, yellow 0.53, green 0.4, cyan 0.3, magenta 0.2 mm). ManualCAD has only `LineTypeId` and the sheet's line group (ADR-0001). The importer therefore decides each entity's line type from the names of its layer and line type (Achsen, Verdeckt, Strich-2xPunkt, CENTER, HIDDEN, ISO…), from the dash pattern when the name says nothing, and for continuous lines from the lineweight, the pen colour (red/yellow wide, green/cyan/magenta narrow, after the BBRZ plot style) and the layer name (`0.50`, `0.25`, …). The line group is 0.7 when red pens or 0.70 layers dominate, else 0.5. DXF layers become ManualCAD layers (show/hide only); `Defpoints` and frozen layers are left out.

Model space becomes a view. A paper-space layout with viewports gives the sheet format (nearest ISO A size) and one view per viewport, with `paper = model × scale`, so every view keeps its scale and position. Without a layout, the sheet and a standard scale are chosen to fit the model extents. Paper-space geometry outside ManualCAD's own title block goes into a 1:1 "Sheet" view; what lies inside the title block is dropped, because ManualCAD draws the title block itself, and block attributes (ZEICHNUNGNR., TITEL_BENENNUNG, KLASSE, TOLERANZ, …) fill its fields.

Dimensions are imported as associative ManualCAD dimensions (linear, rotated, radial, angular), anchored to entity endpoints where they coincide; texts snap to the ISO 3098 series; MTEXT loses its formatting; hatches keep boundary, angle and spacing; leaders take the text they point at. Splines and ellipses become line segments, filled areas outlines, and the report says so. Blocks are exploded (ManualCAD has no blocks), including the title block templates.

## Export writes what AutoCAD users expect

`DXFOUT` writes DXF R2000 (AC1015): model space holds every view's geometry in real millimetres, placed so that `paper = model × scale`; a layout "Sheet" at the paper size carries the frame, title block, parts list and view labels as plain geometry and one viewport per view. Layers follow the BBRZ convention (`0.50`/`0.70`, `0.25`/`0.35`, `Achsen`, `Verdeckt`, `Strich-2xPunkt`, `Bemaßung`, `Schraffur`, `Text`, `Schriftkopf`) with the matching pen colours, so the school's plot style prints the right widths; entities on a user layer keep that layer and get the colour explicitly. Dimensions and leaders are exploded into the same primitives ManualCAD plots (lines, arcs, solids, text) rather than written as DIMENSION entities, so they look exactly like the PDF in every viewer; the price is that they are not editable as dimensions in AutoCAD. Construction lines are not exported. The file is checked with ezdxf's audit and round-trips through the ODA File Converter.

## DWG

No open-source DWG writer exists for the browser (LibreDWG writes at most R2004 and every WASM build drops the writer; the Rust readers/writers are too young, 2026-10). Reading is covered by `@mlightcad/libredwg-web`, LibreDWG as WebAssembly, loaded lazily on the first `.dwg` (9.5 MB, about 2 MB compressed) and kept out of the main bundle. **It is GPL-3.** ManualCAD has no licence yet; as long as the reader stays a separately loaded chunk behind the `src/io/dwg` adapter it can be swapped or removed, and the decision whether ManualCAD becomes GPL or drops in-browser DWG stays open for the owner. Writing DWG means converting the exported DXF with the ODA File Converter (`scripts/dwg2dxf.sh` wraps it headless, both directions) or, once the Tauri shell exists, a Rust crate such as `acadrust`/`opencadcodec` after it has been validated.

## Considered options

- `dxf-parser`, `dxf`, `dxf-render/parser` (MIT) for reading, `@tarikjabiri/dxf` (MIT) for writing: all fine, but the mapping into `SheetDoc` is the work and a 300-line tagged-text reader avoids a dependency whose output would be mapped anyway. `dxf-json` has the best coverage but is GPL-3.
- Native DIMENSION/HATCH export with anonymous `*D` blocks: more faithful to AutoCAD, deferred; hatches are already native HATCH entities.
- Importing paper-space title blocks as geometry: rejected, two title blocks on one sheet.
