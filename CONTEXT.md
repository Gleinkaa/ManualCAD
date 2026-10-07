# ManualCAD

A 2D drafting program for Austrian mechanical manufacturing drawings, built for training. You construct every element by hand, the way you would on a drawing board, and the program enforces the drawing standards.

## Language

**Manufacturing drawing**:
A 2D technical drawing of a part that is detailed enough to manufacture it, drawn to ÖNORM EN ISO standards (German: Fertigungszeichnung).
_Avoid_: blueprint, plan, sketch

**Manual drafting**:
The user places every line, view and annotation themselves. Views are never generated from a 3D model.
_Avoid_: modelling, parametric design

## Sheet and views

**Sheet**:
The single drawing page (A4–A0) with its frame and title block. One file holds exactly one sheet.
_Avoid_: layout, paper space, Blatt

**View**:
A region on the sheet with its own scale and origin, in which part geometry is drawn in real millimetres (e.g. front view, section A-A, detail Z 5:1).
_Avoid_: viewport, model space

**Projection link**:
The first-angle alignment between views: a linked view can only move along its projection axis relative to its parent view. The link can be removed on purpose (e.g. a section view moved aside and marked with a view arrow).
_Avoid_: view alignment, constraint

**Title block**:
The standardised information field in the sheet's bottom-right corner, per ISO 7200 (German: Schriftfeld). Its layout comes from a title block template; ISO 7200 is the default.
_Avoid_: header, stamp

**Parts list**:
The table of the parts shown on the sheet, directly above the title block, per ISO 7573 (German: Stückliste). Row 1 sits lowest, just above the column headings.
_Avoid_: BOM table, item list

**Item number**:
The number that identifies a part in the parts list and on the drawing (German: Positionsnummer, "Teil"). Placed with BALLOON (AutoCAD Mechanical's command name) on a leader line (see Leader line), lettered at twice the dimension text height (ISO 6433).
_Avoid_: balloon, part ID

**Leader line**:
A narrow line from a point on the part to a note or item number, per ISO 128-22 (German: Hinweislinie). It ends with a dot inside an outline, an arrowhead on an outline, and nothing on a dimension line; a note stands on a short horizontal reference line.
_Avoid_: callout, pointer

**Construction line**:
A thin helper line that is never plotted, the equivalent of light pencil lines on a drawing board.
_Avoid_: xline, guide

## Standards

**Norm rule**:
One rule from a drawing standard, with an ID and its source (e.g. ISO 128-2), that fixes how an element must look.
_Avoid_: constraint, style

**Line type**:
The type of line an element gets from its meaning (e.g. thick solid = visible edge, thin dash-dot = centre line), per ISO 128-2 (German: Linienart).
_Avoid_: layer, style

**Line group**:
The set of line widths (0.5 or 0.7) chosen once per sheet, from which every line type takes its actual width (German: Liniengruppe).
_Avoid_: lineweight, pen width

**Symbol**:
A standards annotation (surface texture, tolerance frame, datum, edge, weld) that the program builds from entered values and the user places. Never assembled by hand.
_Avoid_: block, stamp

**Surface texture indication**:
The symbol for surface finish and its values (process, Ra/Rz, lay direction), per ISO 21920 / ISO 1302 (German: Oberflächenangabe).
_Avoid_: surface definition, roughness mark

**Partial section**:
A section of only one region of a view, bounded by a freehand line, used to show a hidden detail such as a bore without sectioning the whole part (German: Teilschnitt, Ausbruch, "aufbrechen").
_Avoid_: cutaway, local cut

**Freehand line**:
The narrow freehand line (ISO 128-2 type 01.1) that bounds a partial section or a broken-off view. In ManualCAD it is drawn with SKETCH as a smooth chain of arcs.
_Avoid_: break line, spline, wavy line

**Hatching**:
Narrow parallel lines, normally at 45°, that mark cut material in a section, per ISO 128-50 (German: Schraffur). Hatching is associative: when an edge of its boundary is edited, the region around the originally picked point is found again; if that point is no longer enclosed, the hatching keeps its last boundary and stops following edits. Hatching is interrupted around text and dimension values inside it.
_Avoid_: fill, pattern

**Open end**:
An endpoint of a boundary-type line that meets no other line. HATCH marks the open ends in red when the picked area is not closed, so the user sees where the gap is.
_Avoid_: dangling edge, leak

**Associative dimension**:
A dimension tied to geometry that updates its value and position when the geometry changes. The geometry never follows the dimension.
_Avoid_: driving dimension, parametric dimension

**Layer**:
A named show/hide group only. It never decides line type, width or colour.
_Avoid_: level
