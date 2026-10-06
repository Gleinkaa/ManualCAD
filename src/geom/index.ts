// CONTRACT: signatures are fixed. Bodies are implemented by the geom module owner.
import type { ArcCurve, BBox, Curve, SnapPoint, Vec2 } from './types';

export * from './types';

const todo = (): never => {
  throw new Error('not implemented');
};

// --- vector basics ---
export const v = (x: number, y: number): Vec2 => ({ x, y });
export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; }
export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function cross(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
export function len(a: Vec2): number { return Math.hypot(a.x, a.y); }
export function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function norm(a: Vec2): Vec2 { const l = len(a); return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; }
export function perp(a: Vec2): Vec2 { return { x: -a.y, y: a.x }; }
export function polar(origin: Vec2, length: number, angle: number): Vec2 {
  return { x: origin.x + length * Math.cos(angle), y: origin.y + length * Math.sin(angle) };
}

// --- curve queries ---
/** Start/end points of a line or arc; null for a full circle. */
export function endpoints(c: Curve): [Vec2, Vec2] | null { void c; return todo(); }
export function midpoint(c: Curve): Vec2 | null { void c; return todo(); }
export function bbox(c: Curve): BBox { void c; return todo(); }
export function closestPoint(c: Curve, p: Vec2): Vec2 { void c; void p; return todo(); }
export function distanceTo(c: Curve, p: Vec2): number { void c; void p; return todo(); }
/** Length of a line, circumference of a circle, arc length of an arc. */
export function curveLength(c: Curve): number { void c; return todo(); }
/** True when the curve intersects or lies inside the box (used for crossing selection). */
export function intersectsBox(c: Curve, box: BBox): boolean { void c; void box; return todo(); }
/** True when the curve lies completely inside the box (used for window selection). */
export function insideBox(c: Curve, box: BBox): boolean { void c; void box; return todo(); }

/**
 * Intersection points of two curves, restricted to the actual extents of segments/arcs.
 * With `extended: true`, lines are treated as infinite and arcs as full circles.
 */
export function intersect(a: Curve, b: Curve, opts?: { extended?: boolean }): Vec2[] {
  void a; void b; void opts; return todo();
}

// --- snapping ---
/** Endpoint, midpoint, center and quadrant snaps of one curve. */
export function snapCandidates(c: Curve): SnapPoint[] { void c; return todo(); }
/** Foot of the perpendicular from `from` onto the curve (extended for lines), or null. */
export function perpendicularFoot(c: Curve, from: Vec2): Vec2 | null { void c; void from; return todo(); }
/** Tangent points on a circle/arc as seen from `from` (0..2 points; arcs filtered to their extent). */
export function tangentPoints(c: Curve, from: Vec2): Vec2[] { void c; void from; return todo(); }

// --- construction ---
export function arcFrom3Points(p1: Vec2, p2: Vec2, p3: Vec2): ArcCurve | null { void p1; void p2; void p3; return todo(); }
/** Arc around `c` from the direction of `start` counter-clockwise to the direction of `end`. */
export function arcFromCenter(c: Vec2, start: Vec2, end: Vec2): ArcCurve { void c; void start; void end; return todo(); }

// --- transforms ---
export function translate(c: Curve, d: Vec2): Curve { void c; void d; return todo(); }
export function rotate(c: Curve, about: Vec2, angle: number): Curve { void c; void about; void angle; return todo(); }
/** Mirror across the infinite line through a and b. Arcs keep counter-clockwise orientation. */
export function mirror(c: Curve, a: Vec2, b: Vec2): Curve { void c; void a; void b; return todo(); }
export function scaleCurve(c: Curve, about: Vec2, factor: number): Curve { void c; void about; void factor; return todo(); }

// --- edit operations (AutoCAD semantics) ---
/** Parallel copy at `distance`, on the side of `sidePoint`. Null if impossible (e.g. inward offset >= radius). */
export function offset(c: Curve, distance: number, sidePoint: Vec2): Curve | null { void c; void distance; void sidePoint; return todo(); }
/**
 * Remove the portion of `target` around `pick` that is bounded by intersections with `cutters`.
 * Returns the remaining pieces (0..2 curves; a trimmed circle becomes an arc).
 * Returns null if no cutter intersects `target` (nothing to trim).
 */
export function trim(target: Curve, pick: Vec2, cutters: Curve[]): Curve[] | null { void target; void pick; void cutters; return todo(); }
/** Extend the end of a line/arc nearest `pick` to the nearest boundary it hits. Null if it hits none. */
export function extend(target: Curve, pick: Vec2, boundaries: Curve[]): Curve | null { void target; void pick; void boundaries; return todo(); }
/**
 * Fillet two curves (v0.1: line/line required, line/arc and arc/arc optional) with radius r.
 * `pickA`/`pickB` choose which side of each curve is kept. r = 0 joins the curves at their corner.
 * Returns the trimmed curves and the fillet arc (null when r = 0), or null if impossible.
 */
export function fillet(a: Curve, pickA: Vec2, b: Curve, pickB: Vec2, r: number):
  { a: Curve; b: Curve; arc: ArcCurve | null } | null {
  void a; void pickA; void b; void pickB; void r; return todo();
}
/** Chamfer two lines: distance dA along `a` and dB along `b` from their corner. */
export function chamfer(a: Curve, pickA: Vec2, b: Curve, pickB: Vec2, dA: number, dB: number):
  { a: Curve; b: Curve; line: Curve } | null {
  void a; void pickA; void b; void pickB; void dA; void dB; return todo();
}
