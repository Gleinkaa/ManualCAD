import type { ArcCurve, Curve, Vec2 } from './types';
import { EPS } from './types';
import { angleOf, makeArc } from './curve';
import { add, cross, dist, dot, len, norm, scale, sub } from './vec';

export function arcFrom3Points(p1: Vec2, p2: Vec2, p3: Vec2): ArcCurve | null {
  const b = sub(p2, p1);
  const c = sub(p3, p1);
  const d = 2 * cross(b, c);
  if (Math.abs(d) <= 2 * EPS * len(b) * len(c) || len(b) === 0 || len(c) === 0) return null;
  const bb = dot(b, b);
  const cc = dot(c, c);
  const center = add(p1, { x: (c.y * bb - b.y * cc) / d, y: (b.x * cc - c.x * bb) / d });
  const r = dist(center, p1);
  const a1 = angleOf(center, p1);
  const a3 = angleOf(center, p3);
  return d > 0 ? makeArc(center, r, a1, a3) : makeArc(center, r, a3, a1);
}

/** Arc around `c` from the direction of `start` counter-clockwise to the direction of `end`. */
export function arcFromCenter(c: Vec2, start: Vec2, end: Vec2): ArcCurve {
  return makeArc(c, dist(c, start), angleOf(c, start), angleOf(c, end));
}

function mapPoints(c: Curve, f: (p: Vec2) => Vec2): Curve {
  switch (c.kind) {
    case 'line': return { kind: 'line', a: f(c.a), b: f(c.b) };
    case 'circle': return { ...c, c: f(c.c) };
    case 'arc': return { ...c, c: f(c.c) };
  }
}

export function translate(c: Curve, d: Vec2): Curve {
  return mapPoints(c, (p) => add(p, d));
}

export function rotate(c: Curve, about: Vec2, angle: number): Curve {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const r = mapPoints(c, (p) => {
    const q = sub(p, about);
    return { x: about.x + q.x * cs - q.y * sn, y: about.y + q.x * sn + q.y * cs };
  });
  return r.kind === 'arc' ? makeArc(r.c, r.r, r.start + angle, r.end + angle) : r;
}

/** Mirror across the infinite line through a and b. Arcs keep counter-clockwise orientation. */
export function mirror(c: Curve, a: Vec2, b: Vec2): Curve {
  if (dist(a, b) === 0) return c;
  const u = norm(sub(b, a));
  const m = mapPoints(c, (p) => {
    const q = sub(p, a);
    return sub(add(a, scale(u, 2 * dot(q, u))), q);
  });
  if (m.kind !== 'arc' || c.kind !== 'arc') return m;
  const phi = Math.atan2(u.y, u.x);
  return makeArc(m.c, m.r, 2 * phi - c.end, 2 * phi - c.start);
}

export function scaleCurve(c: Curve, about: Vec2, factor: number): Curve {
  const s = mapPoints(c, (p) => add(about, scale(sub(p, about), factor)));
  switch (s.kind) {
    case 'line': return s;
    case 'circle': return { ...s, r: s.r * Math.abs(factor) };
    case 'arc': {
      const flip = factor < 0 ? Math.PI : 0;
      return makeArc(s.c, s.r * Math.abs(factor), s.start + flip, s.end + flip);
    }
  }
}
