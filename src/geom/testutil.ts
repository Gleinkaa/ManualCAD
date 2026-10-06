import { expect } from 'vitest';
import type { ArcCurve, CircleCurve, Curve, LineCurve, Vec2 } from './types';

export const P = (x: number, y: number): Vec2 => ({ x, y });
export const L = (ax: number, ay: number, bx: number, by: number): LineCurve => ({ kind: 'line', a: P(ax, ay), b: P(bx, by) });
export const C = (x: number, y: number, r: number): CircleCurve => ({ kind: 'circle', c: P(x, y), r });
export const deg = (d: number): number => (d * Math.PI) / 180;
export const A = (x: number, y: number, r: number, s: number, e: number): ArcCurve =>
  ({ kind: 'arc', c: P(x, y), r, start: deg(s), end: deg(e) });

export function expectPt(p: Vec2 | null | undefined, x: number, y: number, digits = 7): void {
  expect(p).toBeTruthy();
  expect(p!.x).toBeCloseTo(x, digits);
  expect(p!.y).toBeCloseTo(y, digits);
}

/** Order-independent comparison of point sets. */
export function expectPts(pts: Vec2[], expected: [number, number][], digits = 7): void {
  expect(pts).toHaveLength(expected.length);
  const key = (p: { x: number; y: number }) => [Math.round(p.x * 1e6), Math.round(p.y * 1e6)];
  const sorted = [...pts].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
  const exp = expected.map(([x, y]) => P(x, y)).sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
  sorted.forEach((p, i) => expectPt(p, exp[i].x, exp[i].y, digits));
}

export function normDeg(a: number): number {
  const d = ((a * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
}

export function expectArc(c: Curve, x: number, y: number, r: number, sDeg: number, eDeg: number): void {
  expect(c.kind).toBe('arc');
  const a = c as ArcCurve;
  expectPt(a.c, x, y);
  expect(a.r).toBeCloseTo(r, 7);
  expect(normDeg(a.start) % 360).toBeCloseTo(sDeg % 360, 5);
  expect(normDeg(a.end) % 360).toBeCloseTo(eDeg % 360, 5);
}

export function expectLine(c: Curve, ax: number, ay: number, bx: number, by: number): void {
  expect(c.kind).toBe('line');
  const l = c as LineCurve;
  expectPt(l.a, ax, ay);
  expectPt(l.b, bx, by);
}
