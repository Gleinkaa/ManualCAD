// Reader-independent picture of a CAD drawing: what the DXF reader and the DWG reader both produce, and what
// `import.ts` turns into a SheetDoc. Coordinates are drawing units (usually mm), angles radians, arcs counter-clockwise.
import type { Vec2 } from '../geom/types';

/** Entity properties that decide the line type: layer, colour (ACI; 256 = by layer, 0 = by block), line type name, lineweight (1/100 mm, < 0 = by layer/block/default). */
export interface RawStyle {
  layer: string;
  color: number;
  linetype: string;
  lineweight: number;
  /** Group 67: 1 = paper space of the active layout. */
  paperSpace: boolean;
  handle: string;
}

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'baseline' | 'bottom' | 'middle' | 'top';

export interface RawVertex {
  p: Vec2;
  /** tan(θ/4) of the arc to the next vertex; 0 = straight. */
  bulge: number;
}

export type RawLoopEdge =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; start: number; end: number; ccw: boolean }
  | { kind: 'ellipse'; c: Vec2; major: Vec2; ratio: number; start: number; end: number; ccw: boolean }
  | { kind: 'spline'; degree: number; knots: number[]; control: Vec2[]; weights: number[]; fit: Vec2[] }
  | { kind: 'polyline'; vertices: RawVertex[]; closed: boolean };

export interface RawHatchLine {
  angle: number;             // degrees
  base: Vec2;
  offset: Vec2;              // perpendicular step between lines (drawing units, pattern scale applied)
}

export type RawEntity = RawStyle &
  (
    | { kind: 'line'; a: Vec2; b: Vec2 }
    | { kind: 'circle'; c: Vec2; r: number }
    | { kind: 'arc'; c: Vec2; r: number; start: number; end: number }
    | { kind: 'polyline'; vertices: RawVertex[]; closed: boolean }
    | { kind: 'text'; pos: Vec2; text: string; height: number; angle: number; halign: HAlign; valign: VAlign; tag: string | null }
    | { kind: 'mtext'; pos: Vec2; text: string; height: number; angle: number; attachment: number; width: number }
    | { kind: 'insert'; name: string; pos: Vec2; scale: Vec2; rotation: number; attribs: RawEntity[] }
    | { kind: 'hatch'; loops: RawLoopEdge[][]; solid: boolean; pattern: string; angle: number; scale: number; lines: RawHatchLine[] }
    | {
        kind: 'dimension';
        dimType: 'linear' | 'aligned' | 'angular' | 'diameter' | 'radius' | 'angular3' | 'ordinate';
        defPoint: Vec2;      // 10: on the dimension line (linear), first circle point (diameter), centre (radius), arc point (angular 3P)
        textMid: Vec2 | null;
        p13: Vec2;
        p14: Vec2;
        p15: Vec2;
        p16: Vec2;
        rotation: number;    // radians, linear dimensions
        text: string;        // '' or '<>' = measured value
        userText: boolean;   // 70 & 128: text at textMid
      }
    | { kind: 'leader'; points: Vec2[]; arrow: boolean; annotation: string | null }
    | { kind: 'mleader'; lines: Vec2[][]; text: string; textPos: Vec2 | null; textHeight: number; arrow: boolean; landing: Vec2 | null }
    | { kind: 'spline'; degree: number; knots: number[]; control: Vec2[]; weights: number[]; fit: Vec2[] }
    | { kind: 'ellipse'; c: Vec2; major: Vec2; ratio: number; start: number; end: number }
    | { kind: 'viewport'; center: Vec2; width: number; height: number; viewCenter: Vec2; viewHeight: number; id: number; on: boolean }
    | { kind: 'solid'; points: Vec2[] }
    | { kind: 'xline'; p: Vec2; dir: Vec2; ray: boolean }
    | { kind: 'unsupported'; type: string }
  );

export interface RawLayer {
  name: string;
  color: number;
  linetype: string;
  lineweight: number;
  frozen: boolean;
  off: boolean;
}

export interface RawBlock {
  name: string;
  base: Vec2;
  entities: RawEntity[];
}

export interface RawLayout {
  name: string;
  blockName: string;
  paperWidth: number;        // mm
  paperHeight: number;       // mm
  /** Printable-area margins, mm: paper-space (0,0) sits this far from the paper's bottom-left corner. */
  marginLeft: number;
  marginBottom: number;
  rotation: number;          // quarter turns
}

export interface RawDrawing {
  version: string;
  /** Multiplier from drawing units to mm ($INSUNITS). */
  unitFactor: number;
  layers: Map<string, RawLayer>;
  /** Line type name → dash pattern (drawing units; positive dash, negative gap, 0 dot). */
  linetypes: Map<string, number[]>;
  blocks: Map<string, RawBlock>;
  layouts: RawLayout[];
  /** Model space entities plus the active paper space (paperSpace = true). */
  entities: RawEntity[];
}

/** $INSUNITS → mm per unit. Unitless drawings are taken as mm. */
export function unitsToMm(insunits: number): number {
  switch (insunits) {
    case 1:
      return 25.4;
    case 2:
      return 304.8;
    case 3:
      return 1609344;
    case 5:
      return 10;
    case 6:
      return 1000;
    case 7:
      return 1e6;
    case 8:
      return 25.4e-6;
    case 9:
      return 25.4e-3;
    case 10:
      return 914.4;
    default:
      return 1;
  }
}
