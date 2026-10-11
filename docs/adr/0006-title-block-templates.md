# Title block templates: layout data per template, widths from the line group, BBRZ blocks read by their tags

The title block was one hard-coded ISO 7200 layout. The school drawings use the BBRZ title blocks (`samples/bbrz`), so the layout is now data: `model/titleblock.ts` holds a registry of **title block templates** (CONTEXT.md), and the sheet stores which one it uses (`SheetDoc.titleBlockTemplate`; a file without it is ISO 7200, so old files load unchanged). A template gives the block's size, its inner rulings, the captions, and for each field its box, preferred lettering height, alignment and the DXF attribute tag that carries it; it also gives the parts list layout (header and row height, columns). `plot/frame.ts` draws whatever template the sheet names, so screen, PDF, SVG and DXF export follow it.

| Template | Size | From |
|---|---|---|
| ISO 7200 (`iso7200`, default) | 180 × 48, parts list ISO 7573 with 7 columns | the previous layout, unchanged |
| BBRZ (`bbrz`) | 180 × 51 on every format A4–A0, parts list 5 columns, 8 mm header, 6 mm rows | `A4 bis A0_PLR_m_SK_BBRZ`, `Stückliste_BBRZ`, `Stückliste_Erweiterung_BBRZ` |
| BBRZ small (`bbrz-small`) | 180 × 15, A4 portrait only (other sheets are allowed, with a warning) | `A4-PLR_m_kleinem_SK_BBRZ-MB` |

Fields stay keyed by meaning (`TitleBlockField`), not by tag, so switching templates keeps the values; the BBRZ tags map onto them: `ZEICHNUNGNR.` drawing number, `TITEL_BENENNUNG`/`BENENNUNG` title, `MAßSTAB` scale, `NEBENMAßSTAB` secondary scale, `KLASSE` client/class ("Auftraggeber / Klasse", no longer the owner), `TOLERANZ` general tolerance (a bare `m` becomes `ISO 2768-m`), `GEZ-NAME`/`NAME` created by, `PLOT-TAG`/`DATUM` date, `GEPR-NAME` approved by, `GEPR-TAG` approval date, `DOKU_ART` document type, `BLATT-NR` sheet. "Firma / Schule" has no attribute in the template and is the owner field. Fields a template has no place for (material in BBRZ, stock and remark in the BBRZ parts list) are kept in the file but not printed. Parts list columns: `TEIL1`/`TEIL` item, `ZEICHNUNGSNUMMER` part number (`standard`), `TEIL1-STÜCK` quantity, `TEIL1-BENENNUNG` name, `TEIL1-WERKSTOFF/NORMKBZ` material.

## Import

A block insert whose attribute tags contain at least three of one template's tags (more than of any other) selects that template and fills its fields; an insert with `TEIL…` and `TEIL…-BENENNUNG` attributes is a parts list row, ordered by insertion height (row 1 lowest). Neither is exploded, since ManualCAD draws the frame, title block and parts list itself; before, the BBRZ frame lines came in as a second frame. A BBRZ template drawing opened as it is (loose attribute definitions, no insert) selects its template, but the definitions' defaults are prompts, not values, and are not taken. Placeholders (`----`) count as empty. Inserts that match no template still fill fields by tag name, as before. `DK1`/`DK2` (file author, last saved by) are invisible constant attributes and are not read.

## Where the BBRZ template and ISO disagree

The template is the reference for field positions, proportions, captions and tags; line widths and lettering heights follow ManualCAD's rules:

- **Rulings.** The BBRZ blocks draw the main divisions with the wide pen (layer colour) and only some subdivisions narrow; the parts list column lines are wide too. ManualCAD draws the outline wide like the frame (ISO 5457 / ISO 7200) and every inner ruling, and every parts list column line, with the line group's narrow line, as in the ISO 7200 template. Switching to the BBRZ look would mean marking rules as wide in the template data.
- **Lettering heights.** The BBRZ `TOLERANZ` attribute is 2.0 mm high, not an ISO 3098 height; ManualCAD prefers 2.5 mm and shrinks along the ISO 3098 series (1.8 mm) when the value does not fit.
- **Projection symbol.** Drawn from ManualCAD's ISO 5456-2 symbol at h = 2.5 in the BBRZ "Projektion" cell (BBRZ draws it at about that size).
- **Small block content.** The small school block has no scale, projection symbol, owner, approval or document type, all of which ISO 7200 expects. It is reproduced as the school uses it; the sheet warns only when it is used on anything other than A4 portrait.

## Not done

- DXF export still writes the title block as plain geometry, so a ManualCAD DXF re-imported keeps the template only through the sheet file, not through the DXF. Writing it as an attributed block with the template's tags is the next step.
- Parts lists drawn as `ACAD_TABLE` (as in `MASTER_MET_JET_23.dwt`) are not read.
