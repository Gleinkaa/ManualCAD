import { describe, expect, it } from 'vitest';
import { hatchSegments } from './hatch';
import { findRegion } from './region';
import { A, C, L, P } from './testutil';
import type { Curve, Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Curve[] => [L(x0, y0, x1, y0), L(x1, y0, x1, y1), L(x1, y1, x0, y1), L(x0, y1, x0, y0)];
const total = (segs: [Vec2, Vec2][]) => segs.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0);
const within = (segs: [Vec2, Vec2][], ok: (p: Vec2) => boolean) =>
  segs.every(([a, b]) => [a, b, P((a.x + b.x) / 2, (a.y + b.y) / 2)].every(ok));

describe('hatchSegments', () => {
  it('fills a rectangle: total length ≈ area / spacing, all inside', () => {
    const segs = hatchSegments([rect(0, 0, 40, 20)], 45, 2);
    expect(total(segs) / (800 / 2)).toBeCloseTo(1, 1);
    expect(within(segs, (p) => p.x > -1e-9 && p.x < 40 + 1e-9 && p.y > -1e-9 && p.y < 20 + 1e-9)).toBe(true);
  });

  it('fills a circle: total length ≈ area / spacing', () => {
    const segs = hatchSegments([[C(10, 10, 15)]], 45, 1);
    expect(total(segs) / ((Math.PI * 225) / 1)).toBeCloseTo(1, 1);
    expect(within(segs, (p) => Math.hypot(p.x - 10, p.y - 10) <= 15 + 1e-9)).toBe(true);
  });

  it('leaves holes free (even-odd)', () => {
    const segs = hatchSegments([rect(0, 0, 40, 20), [C(20, 10, 5)]], 45, 1);
    expect(within(segs, (p) => Math.hypot(p.x - 20, p.y - 10) >= 5 - 1e-9)).toBe(true);
    expect(total(segs) / ((800 - Math.PI * 25) / 1)).toBeCloseTo(1, 1);
  });

  it('does not leak through vertices lying exactly on hatch lines', () => {
    // a diamond whose corners sit on 0° lines (y = 0, ±10): corners touch, not cross
    const d = [L(0, -10, 10, 0), L(10, 0, 0, 10), L(0, 10, -10, 0), L(-10, 0, 0, -10)];
    const segs = hatchSegments([d], 0, 1);
    expect(within(segs, (p) => Math.abs(p.x) + Math.abs(p.y) <= 10 + 1e-6)).toBe(true);
    expect(total(segs) / 200).toBeCloseTo(1, 1);
    // a rectangle whose horizontal edges lie on 0° lines
    const r = hatchSegments([rect(0, 0, 10, 10)], 0, 1);
    expect(within(r, (p) => p.x >= -1e-9 && p.x <= 10 + 1e-9)).toBe(true);
    // a concave corner (L shape) at 45°: line through the reflex vertex
    const l = [L(0, 0, 20, 0), L(20, 0, 20, 10), L(20, 10, 10, 10), L(10, 10, 10, 20), L(10, 20, 0, 20), L(0, 20, 0, 0)];
    const ls = hatchSegments([l], 45, 1);
    expect(within(ls, (p) => p.x >= -1e-6 && p.y >= -1e-6 && p.x <= 20 + 1e-6 && p.y <= 20 + 1e-6 && !(p.x > 10 + 1e-6 && p.y > 10 + 1e-6))).toBe(true);
    expect(total(ls) / 300).toBeCloseTo(1, 1);
  });

  it('does not leak at an arc tangent to a hatch line', () => {
    const segs = hatchSegments([[C(0, 0, 10)]], 0, 10);
    // the lines y = ±10 only touch the circle: the diameter plus at most a sub-micron-offset sliver
    expect(within(segs, (p) => Math.hypot(p.x, p.y) <= 10 + 1e-9)).toBe(true);
    expect(total(segs)).toBeCloseTo(20, 1);
    // a tangent arc piece alone (half circle bulging up to y = 10, closed by its diameter)
    const half = hatchSegments([[A(0, 0, 10, 0, 180), L(-10, 0, 10, 0)]], 0, 10);
    // y = 10 only touches the top: no line there; the y = 0 line runs along the diameter, inside by the offset
    expect(half.every(([a]) => Math.abs(a.y) < 1e-5)).toBe(true);
    expect(within(half, (p) => p.y >= -1e-9 && Math.hypot(p.x, p.y) <= 10 + 1e-9)).toBe(true);
  });

  it('hatches a region found from a break-out wave', () => {
    const wave = [A(20, 5, 5, 270, 90), A(20, 15, 5, 90, 270)];
    const loops = findRegion([...rect(0, 0, 40, 20), ...wave], P(5, 10))!;
    const segs = hatchSegments(loops, 45, 0.5);
    // the left region has the rectangle half's area (the bulges cancel out)
    expect(total(segs) / (400 / 0.5)).toBeCloseTo(1, 1);
    expect(within(segs, (p) => p.x <= 25 + 1e-9 && p.x >= -1e-9)).toBe(true);
  });

  it('keeps one line through the origin and is empty for bad input', () => {
    const segs = hatchSegments([rect(-5, -5, 5, 5)], 0, 3, P(0, 1));
    expect(segs.some(([a]) => Math.abs(a.y - 1) < 1e-5)).toBe(true);
    expect(hatchSegments([], 45, 2)).toEqual([]);
    expect(hatchSegments([rect(0, 0, 1, 1)], 45, 0)).toEqual([]);
  });
});
