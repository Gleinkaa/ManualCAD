# Symbols are annotations built from values, sized from the sheet, exported as attributed blocks

A symbol (CONTEXT.md) is an annotation like a text or a leader: it lives in a view, its anchor is view-local, and MOVE, COPY, MIRROR, ROTATE, SCALE and grips treat it like the others. It stores only what the user decided (where it is, which variant, the values), never its geometry. Plotting builds the geometry from the Norm rule data in `model/standards.ts`, with the sheet's lettering height h (the line group's dimension text height) and the narrow line of the line group. The same layout code (`plot/symbol.ts`) feeds the screen, PDF, SVG and DXF, so a symbol cannot look different in one of them, and changing the line group resizes every symbol consistently.

Implemented now:

- **Surface texture symbol** (`SurfaceSymbol`, command SURFACE): ISO 21920-1, with the ISO 1302 positions a–e. Legs at 60°, short leg 1.4 h, long leg 3 h, the bar on the long leg as long as the longest text. Variants: any process, material removal required (bar across the V), removal prohibited (circle in the V), and the parenthesised "(✓)" of a collective indication, which takes no texts. Rotation is free; anything outside 0°–90° is logged as not readable from the bottom or right.
- **Taper / slope symbol** (`TaperSymbol`, command TAPER): ISO 3040. A leader with an arrowhead on the outline, the triangle (h high, 2 h long; symmetric on the reference line for a taper, standing on it for a slope) and the ratio. It stores a view-local direction vector pointing to the end the part narrows or falls; MIRROR reflects it and ROTATE turns it like any other vector, so the triangle follows the part (a slope mirrored across a horizontal line falls the other way), and SCALE leaves it unchanged.

## Where the BBRZ template and ISO disagree

The BBRZ blocks in `samples/bbrz` are the reference for content and attribute names, not for sizes. They agree with ISO on the proportions (60° legs, positions a–e, the 1:2 taper triangle). They disagree on absolute size: the BBRZ surface symbol has legs of h and about 2.3 h (3.5 and 8 mm at h = 3.5), ISO 21920-1 Annex A asks for 1.4 h and 3 h; the BBRZ taper triangle is 4 × 8 mm where ManualCAD draws h × 2 h. ManualCAD follows ISO. The line width is the line group's narrow line (0.25 mm in group 0.5), not ISO 21920-1's h/10 (0.35 mm), because line widths never come from anywhere else (ADR-0001); in line group 0.7 the two agree (0.35 mm at h = 5).

## DXF and DWG

Export writes each symbol as its own block (`MC_SURFACE_n`, `MC_TAPER_n`: bar length, variant and leader differ per symbol), drawn in paper mm and inserted scaled by 1/view scale, the leader as a `LEADER` entity so the importer reads it back even when it is horizontal, with attribute definitions and filled attributes under the BBRZ tags: `RAUHEIT` (a), `OBERFLÄCHENANGABE_ZUSATZ` (b), `Oberflächenbehandlung optional` (c), `FERTIGUNGSRIEFEN` (d), `BEARBEIT.-ZUGABE` (e), `KKV` (ratio). An AutoCAD user can edit the values with ATTEDIT.

Import recognises a block insert by its attributes, whatever the block is called: `RAUHEIT` makes a surface texture symbol, `KKV` a taper or slope symbol. The variant is read from the block geometry: a line across the V is the removal bar, a circle the no-removal circle, a three-vertex polyline the taper (equal sides at the narrow end) or slope triangle, the (multi)leader the leader. The unedited BBRZ surface block contains both bar and circle; it imports as the basic symbol and the report says so. Everything else in such a block is dropped, since ManualCAD draws the symbol itself.

## Not implemented yet, but the model has room for them

- **Tolerance frame** (ISO 1101) and **datum** (ISO 5459): they become two more members of `SymbolAnnotation` — `{ kind: 'tolerance', points (leader, tip on the feature or a dimension line), cells: { characteristic, zone, modifiers, datums[] }[] }` and `{ kind: 'datum', letter, points (triangle on the feature, frame at the end) }` — with layouts in `plot/symbol.ts`, the same block export (attributes per cell) and grips on their points. Nothing in the existing code has to change shape for them.
- A surface texture symbol on its own leader line (today: put it on an extension line, or a LEADER without text).
- The "all around" circle of ISO 21920-1 and the lay direction symbols drawn as graphics (today the lay is lettered: `=`, `⊥`, `X`, `M`, `C`, `R`, `P`).

## Considered options

- Symbols as blocks inside ManualCAD (geometry stored with the symbol): rejected, it would let a symbol drift from the Norm rule and make the line group change unable to resize it.
- One shared block definition per symbol type in the DXF: AutoCAD blocks cannot stretch the bar to the text, so the block would carry wrong geometry for most values.
