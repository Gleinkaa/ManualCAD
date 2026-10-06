import type { ArcCurve, BBox, Curve, LineCurve, Vec2 } from './types';
import { add, dist, dot, polar, scale, sub } from './vec';

export const TAU = Math.PI * 2;
/** Tolerance on normalised parameters (line t, arc angle in rad). */
export const PARAM_TOL = 1e-9;
/** Relative tolerance for geometric coincidence (tangency, duplicate points). */
export const GEOM_TOL = 1e-7;

/** Absolute coincidence tolerance at the magnitude of the given values. */
export function tolAt(...vals: number[]): number {
  let m = 1;
  for (const x of vals) m = Math.max(m, Math.abs(x));
  return GEOM_TOL * m;
}

/** Angle normalised to [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TAU;
  const n = r < 0 ? r + TAU : r;
  return n >= TAU ? 0 : n;
}

export const angleOf = (c: Vec2, p: Vec2): number => Math.atan2(p.y - c.y, p.x - c.x);

/** CCW sweep of an arc in (0, 2π]. */
export function sweep(a: ArcCurve): number {
  const s = normAngle(a.end - a.start);
  return s === 0 ? TAU : s;
}

/** CCW distance from the arc start to `theta`, in [0, 2π). */
export function arcParam(a: ArcCurve, theta: number): number {
  return normAngle(theta - a.start);
}

export function onArcAngle(a: ArcCurve, theta: number, tol = PARAM_TOL): boolean {
  const p = arcParam(a, theta);
  return p <= sweep(a) + tol || p >= TAU - tol;
}

export function makeLine(a: Vec2, b: Vec2): LineCurve {
  return { kind: 'line', a, b };
}

export function makeArc(c: Vec2, r: number, start: number, end: number): ArcCurve {
  return { kind: 'arc', c, r, start: normAngle(start), end: normAngle(end) };
}

export const arcStart = (a: ArcCurve): Vec2 => polar(a.c, a.r, a.start);
export const arcEnd = (a: ArcCurve): Vec2 => polar(a.c, a.r, a.end);

/** Parameter of the projection of `p` onto the infinite line (0 at a, 1 at b). */
export function lineParam(l: LineCurve, p: Vec2): number {
  const d = sub(l.b, l.a);
  const dd = dot(d, d);
  return dd === 0 ? 0 : dot(sub(p, l.a), d) / dd;
}

export function lineAt(l: LineCurve, t: number): Vec2 {
  return add(l.a, scale(sub(l.b, l.a), t));
}

/** Point lying on the curve's carrier: is it within the curve's extent? */
export function withinExtent(c: Curve, p: Vec2): boolean {
  switch (c.kind) {
    case 'line': {
      const t = lineParam(c, p);
      return t >= -PARAM_TOL && t <= 1 + PARAM_TOL;
    }
    case 'circle':
      return true;
    case 'arc':
      return onArcAngle(c, angleOf(c.c, p));
  }
}

/** Start/end points of a line or arc; null for a full circle. */
export function endpoints(c: Curve): [Vec2, Vec2] | null {
  switch (c.kind) {
    case 'line': return [c.a, c.b];
    case 'arc': return [arcStart(c), arcEnd(c)];
    case 'circle': return null;
  }
}

export function midpoint(c: Curve): Vec2 | null {
  switch (c.kind) {
    case 'line': return lineAt(c, 0.5);
    case 'arc': return polar(c.c, c.r, c.start + sweep(c) / 2);
    case 'circle': return null;
  }
}

export function boxOf(pts: Vec2[]): BBox {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
}

export function bbox(c: Curve): BBox {
  switch (c.kind) {
    case 'line': return boxOf([c.a, c.b]);
    case 'circle': return { min: { x: c.c.x - c.r, y: c.c.y - c.r }, max: { x: c.c.x + c.r, y: c.c.y + c.r } };
    case 'arc': {
      const pts = [arcStart(c), arcEnd(c)];
      for (let k = 0; k < 4; k++) {
        const th = (k * Math.PI) / 2;
        if (onArcAngle(c, th)) pts.push(polar(c.c, c.r, th));
      }
      return boxOf(pts);
    }
  }
}

export function closestPoint(c: Curve, p: Vec2): Vec2 {
  switch (c.kind) {
    case 'line':
      return lineAt(c, Math.min(1, Math.max(0, lineParam(c, p))));
    case 'circle':
      return polar(c.c, c.r, dist(p, c.c) === 0 ? 0 : angleOf(c.c, p));
    case 'arc': {
      const th = angleOf(c.c, p);
      if (dist(p, c.c) > 0 && onArcAngle(c, th, 0)) return polar(c.c, c.r, th);
      const s = arcStart(c);
      const e = arcEnd(c);
      return dist(p, s) <= dist(p, e) ? s : e;
    }
  }
}

export function distanceTo(c: Curve, p: Vec2): number {
  return dist(closestPoint(c, p), p);
}

/** Length of a line, circumference of a circle, arc length of an arc. */
export function curveLength(c: Curve): number {
  switch (c.kind) {
    case 'line': return dist(c.a, c.b);
    case 'circle': return TAU * c.r;
    case 'arc': return sweep(c) * c.r;
  }
}
