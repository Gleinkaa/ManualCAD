import type { Curve, Vec2 } from '../geom/types';

/** Coordinates: sheet = paper mm, origin bottom-left, y up. View-local = real part mm, y up. */

export type SheetFormat = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export type Orientation = 'portrait' | 'landscape';
export type LineGroupId = '0.5' | '0.7';

/** ISO 128-2 line types used in v0.1. `construction` is never plotted. */
export type LineTypeId =
  | 'visible'      // 01.2 continuous wide: visible edges and outlines
  | 'thin'         // 01.1 continuous narrow: dimension/extension lines, hatching, thread roots
  | 'hidden'       // 02.1 dashed narrow: hidden edges
  | 'center'       // 04.1 long-dashed dotted narrow: centre lines, symmetry axes
  | 'phantom'      // 05.1 long-dashed double-dotted narrow: adjacent parts, extreme positions
  | 'freehand'     // 01.1 freehand narrow: limits of partial or interrupted views and sections (break-outs)
  | 'construction';

export interface Layer {
  name: string;
  visible: boolean;
}

/** A projection link: the view may only move along `freeAxis` relative to its parent. */
export interface ProjectionLink {
  parentId: string;
  freeAxis: 'x' | 'y';
}

export interface View {
  id: string;
  name: string;              // e.g. "Front view", "A-A", "Z"
  scale: number;             // 2 = 2:1, 0.5 = 1:2
  origin: Vec2;              // sheet position of the view-local (0,0)
  link: ProjectionLink | null;
  /** false = never print the view label (e.g. a second part on the same sheet, identified by its item number). */
  label?: boolean;
}

export interface Entity {
  id: string;
  viewId: string;
  layer: string;
  lineType: LineTypeId;
  geom: Curve;               // view-local coordinates
}

export type AnchorPoint = 'start' | 'end' | 'center' | 'mid';

/** A dimension point: associated with an entity's characteristic point, else the stored fallback. */
export interface DimAnchor {
  ref: { entityId: string; point: AnchorPoint } | null;
  fallback: Vec2;            // view-local; updated to the last resolved position
}

export interface DimText {
  override: string | null;   // replaces the measured value entirely
  prefix: string;            // e.g. "⌀", "M"
  suffix: string;            // e.g. " h6"
}

export interface LinearDimension {
  kind: 'linear';
  id: string;
  viewId: string;
  layer: string;
  a: DimAnchor;
  b: DimAnchor;
  orientation: 'horizontal' | 'vertical' | 'aligned';
  /** Signed distance of the dimension line from the midpoint of the two measured sheet points, in SHEET mm, perpendicular to the measured direction (+y horizontal, +x vertical, left normal of a→b aligned). */
  offset: number;
  text: DimText;
}

export interface RadialDimension {
  kind: 'radius' | 'diameter';
  id: string;
  viewId: string;
  layer: string;
  entityId: string;          // circle or arc
  /** Direction of the dimension line through the centre, radians (view-local). */
  angle: number;
  /** Distance of the text outside the curve along the leader, SHEET mm; 0 = text inside. */
  leader: number;
  text: DimText;
}

/** One leg of an angular dimension: a line given by two anchors (normally the start and end of a line entity). */
export interface AngularLeg {
  a: DimAnchor;
  b: DimAnchor;
}

/**
 * Angle between two lines (ISO 129-1). The vertex is the intersection of the two infinite legs.
 * The dimensioned sector runs between the rays `sense1·(leg1.b − leg1.a)` and `sense2·(leg2.b − leg2.a)`
 * from the vertex, always the one below 180°; the four possible sectors are chosen with the senses.
 */
export interface AngularDimension {
  kind: 'angular';
  id: string;
  viewId: string;
  layer: string;
  leg1: AngularLeg;
  leg2: AngularLeg;
  sense1: 1 | -1;
  sense2: 1 | -1;
  /** Radius of the dimension arc around the vertex, SHEET mm. */
  radius: number;
  text: DimText;
}

export type Dimension = LinearDimension | RadialDimension | AngularDimension;

/** Single-line text, ISO 3098 type B. Position is view-local; height is paper mm (cap height). */
export interface TextNote {
  kind: 'text';
  id: string;
  viewId: string;
  layer: string;
  pos: Vec2;                 // view-local insertion point
  text: string;
  height: number;            // paper mm, from the ISO 3098 series
  angle: number;             // radians, CCW
  align: 'left' | 'center' | 'right';
}

/**
 * Section hatching per ISO 128-50: parallel narrow continuous lines inside closed boundary loops.
 * Loops are view-local and filled even-odd, so inner loops (islands, holes) stay free.
 * The boundary is captured when the hatch is created; it does not follow later geometry edits.
 */
export interface Hatch {
  kind: 'hatch';
  id: string;
  viewId: string;
  layer: string;
  loops: Curve[][];          // each loop a closed chain of curves, view-local
  angle: number;             // degrees, normally 45 or 135
  spacing: number;           // paper mm between hatch lines
}

/**
 * Leader line (ISO 128-22): a narrow continuous line from the tip to a note or item number.
 * The terminator says where the tip ends: arrowhead on an outline, dot inside an outline, none on a dimension line.
 * `note`: the text stands on a horizontal reference line at the last point.
 * `item`: an item number (ISO 6433) at the end of the leader, without reference line.
 */
export interface Leader {
  kind: 'leader';
  id: string;
  viewId: string;
  layer: string;
  points: Vec2[];            // view-local; points[0] is the tip; at least two points
  terminator: 'arrow' | 'dot' | 'none';
  style: 'note' | 'item';
  text: string;              // empty = leader without text
  height: number;            // paper mm, ISO 3098 series
}

/** Sheet objects that are neither part geometry nor dimensions. */
export type Annotation = TextNote | Hatch | Leader;

export type TitleBlockField =
  | 'owner'          // legal owner / company / school
  | 'title'          // part name
  | 'drawingNumber'
  | 'createdBy'
  | 'approvedBy'
  | 'date'
  | 'revision'
  | 'sheet'          // e.g. "1/1"
  | 'material'
  | 'scale'          // auto-filled from the main view if empty
  | 'generalTolerance' // e.g. "ISO 2768-m"
  | 'documentType';  // e.g. "Fertigungszeichnung"

/** One parts-list row (ISO 7573). All fields are free text; `item` is the item (position) number. */
export interface PartsListRow {
  item: string;
  quantity: string;
  name: string;
  standard: string;          // part number / standard designation
  material: string;
  stock: string;             // raw dimensions or pattern number
  remark: string;
}

export interface SheetDoc {
  version: 1;
  format: SheetFormat;
  orientation: Orientation;
  lineGroup: LineGroupId;
  titleBlock: Partial<Record<TitleBlockField, string>>;
  layers: Layer[];
  views: View[];
  entities: Entity[];
  dimensions: Dimension[];
  annotations: Annotation[];
  /** Parts list above the title block, row 0 lowest (next to the header). Empty = no parts list. */
  partsList: PartsListRow[];
}
