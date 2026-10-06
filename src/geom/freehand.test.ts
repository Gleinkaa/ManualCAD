import { describe, expect, it } from 'vitest';
import { endpoints, freehandCurve } from './index';
import type { Curve, Vec2 } from './types';

const close = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

/** Direction of travel at the start/end of a curve that is traversed from `from`. */
function tangentAt(c: Curve, from: Vec2, atEnd: boolean): Vec2 {
  if (c.kind === 'line') {
    const d = { x: c.b.x - c.a.x, y: c.b.y - c.a.y };
    const s = close(c.a, from) ? 1 : -1;
    const l = Math.hypot(d.x, d.y);
    return { x: (s * d.x) / l, y: (s * d.y) / l };
  }
  if (c.kind !== 'arc') throw new Error('unexpected');
  const [ps, pe] = endpoints(c)!;
  const ccw = close(ps, from); // traversed start→end = counter-clockwise
  const p = atEnd ? (ccw ? pe : ps) : ccw ? ps : pe;
  const r = { x: p.x - c.c.x, y: p.y - c.c.y };
  const t = ccw ? { x: -r.y, y: r.x } : { x: r.y, y: -r.x };
  const l = Math.hypot(t.x, t.y);
  return { x: t.x / l, y: t.y / l };
}

/** Walk the chain and return its points in travel order, checking continuity and tangency. */
function walk(chain: Curve[], start: Vec2): Vec2[] {
  const pts = [start];
  let at = start;
  let prevT: Vec2 | null = null;
  for (const c of chain) {
    const [a, b] = endpoints(c)!;
    expect(close(a, at) || close(b, at)).toBe(true);
    const t0 = tangentAt(c, at, false);
    if (prevT) expect(t0.x * prevT.x + t0.y * prevT.y).toBeCloseTo(1, 6);
    prevT = tangentAt(c, at, true);
    at = close(a, at) ? b : a;
    pts.push(at);
  }
  return pts;
}

describe('freehandCurve', () => {
  it('two points give a smooth S wave of two arcs between them', () => {
    const chain = freehandCurve([{ x: 0, y: 0 }, { x: 40, y: 0 }]);
    expect(chain).toHaveLength(2);
    expect(chain.every((c) => c.kind === 'arc')).toBe(true);
    const pts = walk(chain, { x: 0, y: 0 });
    expect(close(pts.at(-1)!, { x: 40, y: 0 })).toBe(true);
    expect(close(pts[1], { x: 20, y: 0 })).toBe(true); // S wave: the join sits on the chord
  });

  it('passes through every point with tangent continuity', () => {
    const input = [{ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 22, y: -3 }, { x: 30, y: 4 }];
    const chain = freehandCurve(input);
    const pts = walk(chain, input[0]);
    for (const p of input) expect(pts.some((q) => close(p, q))).toBe(true);
    expect(close(pts.at(-1)!, input.at(-1)!)).toBe(true);
  });

  it('drops duplicate points and needs two distinct ones', () => {
    expect(freehandCurve([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([]);
    expect(freehandCurve([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 30 }])).toHaveLength(2);
  });

  it('collinear points stay a straight chain', () => {
    const chain = freehandCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(chain.every((c) => c.kind === 'line')).toBe(true);
  });
});
