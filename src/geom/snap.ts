import type { Curve, SnapPoint, Vec2 } from './types';
import { angleOf, arcEnd, arcStart, lineAt, lineParam, midpoint, onArcAngle, tolAt } from './curve';
import { dist, polar } from './vec';

/** Endpoint, midpoint, center and quadrant snaps of one curve. */
export function snapCandidates(c: Curve): SnapPoint[] {
  const quadrants = (): SnapPoint[] => {
    const out: SnapPoint[] = [];
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2;
      if (c.kind === 'circle' || (c.kind === 'arc' && onArcAngle(c, th))) {
        out.push({ point: polar(c.c, c.r, th), kind: 'quadrant' });
      }
    }
    return out;
  };
  switch (c.kind) {
    case 'line':
      return [
        { point: c.a, kind: 'endpoint' },
        { point: c.b, kind: 'endpoint' },
        { point: lineAt(c, 0.5), kind: 'midpoint' },
      ];
    case 'circle':
      return [{ point: c.c, kind: 'center' }, ...quadrants()];
    case 'arc':
      return [
        { point: arcStart(c), kind: 'endpoint' },
        { point: arcEnd(c), kind: 'endpoint' },
        { point: midpoint(c)!, kind: 'midpoint' },
        { point: c.c, kind: 'center' },
        ...quadrants(),
      ];
  }
}

/** Foot of the perpendicular from `from` onto the curve (extended for lines), or null. */
export function perpendicularFoot(c: Curve, from: Vec2): Vec2 | null {
  if (c.kind === 'line') {
    if (dist(c.a, c.b) === 0) return null;
    return lineAt(c, lineParam(c, from));
  }
  if (dist(from, c.c) <= tolAt(c.r)) return null;
  const th = angleOf(c.c, from);
  if (c.kind === 'circle' || onArcAngle(c, th)) return polar(c.c, c.r, th);
  if (onArcAngle(c, th + Math.PI)) return polar(c.c, c.r, th + Math.PI);
  return null;
}

/**
 * All perpendicular feet from `from` onto the curve: the line foot (extended), or for circles both the
 * near and the far foot on the diameter through `from` (arcs: those within the extent).
 */
export function perpendicularFeet(c: Curve, from: Vec2): Vec2[] {
  if (c.kind === 'line') {
    const f = perpendicularFoot(c, from);
    return f ? [f] : [];
  }
  if (dist(from, c.c) <= tolAt(c.r)) return [];
  const th = angleOf(c.c, from);
  return [th, th + Math.PI].filter((a) => c.kind === 'circle' || onArcAngle(c, a)).map((a) => polar(c.c, c.r, a));
}

/** Tangent points on a circle/arc as seen from `from` (0..2 points; arcs filtered to their extent). */
export function tangentPoints(c: Curve, from: Vec2): Vec2[] {
  if (c.kind === 'line') return [];
  const d = dist(from, c.c);
  const tol = tolAt(c.r);
  if (d < c.r - tol) return [];
  const base = angleOf(c.c, from);
  const angles = Math.abs(d - c.r) <= tol ? [base] : [base + Math.acos(c.r / d), base - Math.acos(c.r / d)];
  return angles
    .filter((th) => c.kind === 'circle' || onArcAngle(c, th))
    .map((th) => polar(c.c, c.r, th));
}
