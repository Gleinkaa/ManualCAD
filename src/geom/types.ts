export interface Vec2 {
  x: number;
  y: number;
}

export interface LineCurve {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export interface CircleCurve {
  kind: 'circle';
  c: Vec2;
  r: number;
}

/** Counter-clockwise from `start` to `end`, angles in radians. */
export interface ArcCurve {
  kind: 'arc';
  c: Vec2;
  r: number;
  start: number;
  end: number;
}

export type Curve = LineCurve | CircleCurve | ArcCurve;

export interface BBox {
  min: Vec2;
  max: Vec2;
}

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'intersection'
  | 'perpendicular'
  | 'tangent'
  | 'nearest';

export interface SnapPoint {
  point: Vec2;
  kind: SnapKind;
}

export const EPS = 1e-9;
