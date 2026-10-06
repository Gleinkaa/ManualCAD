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

export type Dimension = LinearDimension | RadialDimension;

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
}
