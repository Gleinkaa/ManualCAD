# Sample drawings

Test fixtures for the DXF/DWG import (`src/io`, ADR-0004). Read by `scripts/io-samples.test.ts` and `scripts/io-dwg.test.ts`.

## `bbrz/` — BBRZ training templates (AutoCAD 2013 DWG, `AC1027`)

The AutoCAD templates used in the Austrian training drawings (BBRZ, class "JET MZ"), received 2026-10-08:

| File | Content |
|---|---|
| `MASTER_MET_JET_23.dwt` | Master template: layout "A4" with the title block inserted, two viewports, a parts-list table; the layer convention (`0.25`…`0.70`, `Achsen`, `Verdeckt`, `Schraffur`, `Bemaßung`, `Text Höhe 2.5`…`7.0`, `Schnitt`, `Strich-2xPunkt`) with the BBRZ line types |
| `A4 bis A0_PLR_m_SK_BBRZ.dwg` | Sheet frames A4 to A0 with the title block (`Zeichnungsnummer`, `Titel`, `Maßstab`, `Allgemeintoleranzen ISO 2768-`, projection symbol) as attribute definitions |
| `A4-PLR_m_kleinem_SK_BBRZ-MB.dwg` | A4 portrait frame with the small school title block (Name, Blatt Nr., Datum, Klasse, Benennung) |
| `Stückliste_BBRZ.dwg`, `Stückliste_Erweiterung_BBRZ.dwg` | Parts list header and extension rows |
| `Oberflächenzeichen_BBRZ.dwg` | Surface texture symbol with its attributes and the list of process words |
| `Kegel-Keil-Verhältnis_BBRZ.dwg` | Taper / slope symbol with a multileader |
| `BBRZ_Plotstil_MB.ctb` | Plot style: colour 1 red 0.8 mm, 2 yellow 0.53, 3 green 0.4, 4 cyan 0.3, 6 magenta 0.2, all others 0 (hairline) |

## `bbrz-dxf/` — the same files as DXF R2018

Converted with the ODA File Converter (`scripts/dwg2dxf.sh`), then the embedded OLE objects were removed with ezdxf to keep the files small; the importer ignores them anyway.

## `synthetic/` — a part drawing written by ezdxf

`part-r2000.dxf` and `part-r2018.dxf` (same content, two DXF versions) exercise every entity type the importer handles: lines, circle, arc, polylines with a bulge, hatch with an island, TEXT, MTEXT with formatting codes, linear/rotated/radial/diameter/angular dimensions, a block with an attribute, a leader, a spline, an ellipse, an old-style polyline, and a 420 × 297 layout with a 2:1 viewport. `part-r2018.dwg` is the ODA conversion of the R2018 file. The generator script is in the commit that added them (`git log -- samples/synthetic`).
