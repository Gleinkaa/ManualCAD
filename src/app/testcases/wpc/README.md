# WPC drawing set as ManualCAD sheets

The four sheets of the water pump case drawing set (`WaterPumpCase_Zeichnung`, delivered 2026-10-04
as `WPC_Fertigungszeichnungen.pdf`) rebuilt as ManualCAD documents:

| Sheet | Builder | Format | Content |
|---|---|---|---|
| WPC-001 Wasserpumpengehäuse | `wpc001.ts` | A3 | assembly: front + top view, isometric 1:2, balloons, BBRZ parts list |
| WPC-002 Gehäuseunterteil | `wpc002.ts` | A2 | front/top/left/rear views, sections A-A and C-C, detail Y 5:1, coordinate table of 36 bosses |
| WPC-003 Deckel | `wpc003.ts` | A3 | plan view, section A-A, detail Z 5:1 |
| WPC-004 Snap-Einsatz | `wpc004.ts` | A4 portrait | view from below and section A-A at 5:1 |

Everything is built from the ordinary document model: entities with ISO 128-2 line types, ISO 129-1
dimensions (linear/radial, decimal comma), ISO 128-50 hatching, ISO 128-22 leaders, ISO 6433 item
numbers, ISO 21920 surface symbols, the BBRZ title block template (`samples/bbrz`) and the BBRZ
parts list layout.

`geometry.gen.ts` is generated: it was fitted from the HLR projections (`views.pkl`) of
`waterpumpcase_v7.step` that the delivered sheets were plotted from, so the linework, circle radii
and cut regions match the shipped drawings exactly. Arcs run CCW; `P` entries are sampled
polylines (isometric ellipses). The file is data, not code - regenerate it with the extraction
scripts (see the repository history) if the model changes.

Render a sheet to SVG (visual checks, no title block editing):

```
WPC_SHEET=002 WPC_SVG=/tmp/wpc002.svg npx vitest run scripts/render-wpc.test.ts
```

`src/app/wpc.test.ts` checks the sheets end to end (dimension values, hatching, parts list,
plotting, serialisation).

## Deviations from the delivered matplotlib sheets

- The **BBRZ title block** from `samples/bbrz` replaces the sheets' custom 66 mm block; fields the
  BBRZ template has no cell for (Werkstoff, Halbzeug, Masse, Index, Blatt) stay in the document but
  are not printed. The projection symbol, Maßstab/Nebenmaßstab, dokument type, title, drawing
  number, author and date are printed.
- **Tolerances** are single-line (`SW 21,4 0/−0,1`): the dimension model has no stacked limits.
- The **coordinate runs** of the delivered sheets (values measured from the 0/0 corner on one
  line) are drawn as chain dimensions (up to 5 features) or stacked baselines from the same datum,
  per the app's ISO 129-1 rendering.
- **Item numbers** are plain numbers on their leader (ISO 6433), not circled; leader text is 3.5 mm
  (ISO 3098 series) rather than 3 mm.
