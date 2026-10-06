import { describe, expect, it } from 'vitest';
import { chamfer, curveLength, endpoints, extend, fillet, offset, trim } from './index';
import type { ArcCurve, LineCurve } from './types';
import { A, C, L, P, deg, expectArc, expectLine, expectPt } from './testutil';

describe('offset', () => {
  it('line to either side', () => {
    expectLine(offset(L(0, 0, 10, 0), 2, P(5, 5))!, 0, 2, 10, 2);
    expectLine(offset(L(0, 0, 10, 0), 2, P(5, -1))!, 0, -2, 10, -2);
    expect(offset(L(0, 0, 10, 0), 2, P(20, 0))).toBeNull(); // on the line
  });

  it('circle and arc concentric', () => {
    expect(offset(C(0, 0, 5), 2, P(10, 0))).toEqual(C(0, 0, 7));
    expect(offset(C(0, 0, 5), 2, P(1, 0))).toEqual(C(0, 0, 3));
    expect(offset(C(0, 0, 5), 5, P(1, 0))).toBeNull();
    expectArc(offset(A(0, 0, 5, 0, 90), 1, P(0, 0))!, 0, 0, 4, 0, 90);
  });

  it('rejects non-positive distance', () => {
    expect(offset(L(0, 0, 10, 0), 0, P(5, 5))).toBeNull();
  });
});

describe('trim', () => {
  it('line between two cutters', () => {
    const res = trim(L(0, 0, 10, 0), P(5, 0), [L(3, -1, 3, 1), L(7, -1, 7, 1)])!;
    expect(res).toHaveLength(2);
    expectLine(res[0], 0, 0, 3, 0);
    expectLine(res[1], 7, 0, 10, 0);
  });

  it('line end beyond the last cutter', () => {
    const res = trim(L(0, 0, 10, 0), P(9, 0), [L(3, -1, 3, 1), L(7, -1, 7, 1)])!;
    expect(res).toHaveLength(1);
    expectLine(res[0], 0, 0, 7, 0);
  });

  it('nothing to trim', () => {
    expect(trim(L(0, 0, 10, 0), P(5, 0), [L(20, -1, 20, 1)])).toBeNull();
    // only touching at the target's own endpoint
    expect(trim(L(0, 0, 10, 0), P(5, 0), [L(10, 0, 10, 10)])).toBeNull();
  });

  it('ignores the target itself among cutters', () => {
    const t = L(0, 0, 10, 0);
    const res = trim(t, P(9, 0), [t, L(5, -1, 5, 1)])!;
    expect(res).toHaveLength(1);
    expectLine(res[0], 0, 0, 5, 0);
  });

  it('circle trimmed by two lines becomes an arc', () => {
    const circle = C(0, 0, 5);
    const cutters = [L(3, -10, 3, 10), L(-3, -10, -3, 10)];
    // pick right cap: removed, keep the big arc from 180-53.13 ... through left
    const res = trim(circle, P(5, 0), cutters)!;
    expect(res).toHaveLength(1);
    const a = res[0] as ArcCurve;
    expect(a.kind).toBe('arc');
    const [s, e] = endpoints(a)!;
    expectPt(s, 3, 4);
    expectPt(e, 3, -4);
    expect(curveLength(a)).toBeCloseTo(5 * (2 * Math.PI - 2 * Math.atan2(4, 3)));
    // pick top: removed between (3,4) and (-3,4)
    const top = trim(circle, P(0, 5), cutters)![0];
    const [s2, e2] = endpoints(top)!;
    expectPt(s2, -3, 4);
    expectPt(e2, 3, 4);
  });

  it('circle with a single intersection is not trimmed', () => {
    expect(trim(C(0, 0, 5), P(0, 5), [L(0, 0, 10, 0)])).toBeNull();
  });

  it('arc crossing 0° trimmed in the middle', () => {
    const arc = A(0, 0, 5, 300, 60);
    const res = trim(arc, P(5, 0), [L(-10, 1, 10, 1), L(-10, -1, 10, -1)])!;
    expect(res).toHaveLength(2);
    expectPt(endpoints(res[0])![0], 2.5, -5 * Math.sin(deg(60)));
    expectPt(endpoints(res[0])![1], Math.sqrt(24), -1);
    expectPt(endpoints(res[1])![0], Math.sqrt(24), 1);
    expectPt(endpoints(res[1])![1], 2.5, 5 * Math.sin(deg(60)));
  });

  it('arc end piece', () => {
    const res = trim(A(0, 0, 5, 0, 180), P(-5, 0.1), [L(0, -10, 0, 10)])!;
    expect(res).toHaveLength(1);
    expectArc(res[0], 0, 0, 5, 0, 90);
  });
});

describe('extend', () => {
  it('line end to nearest boundary', () => {
    const bounds = [L(20, -5, 20, 5), L(15, -5, 15, 5)];
    expectLine(extend(L(0, 0, 10, 0), P(9, 0), bounds)!, 0, 0, 15, 0);
  });

  it('line start', () => {
    expectLine(extend(L(0, 0, 10, 0), P(1, 0), [L(-4, -5, -4, 5)])!, -4, 0, 10, 0);
  });

  it('null when the boundary is missed (bounded boundary)', () => {
    expect(extend(L(0, 0, 10, 0), P(9, 0), [L(20, 1, 20, 5)])).toBeNull();
    expect(extend(L(0, 0, 10, 0), P(9, 0), [L(-4, -5, -4, 5)])).toBeNull(); // behind the other end
  });

  it('line to circle', () => {
    expectLine(extend(L(0, 0, 10, 0), P(9, 0), [C(30, 0, 5)])!, 0, 0, 25, 0);
  });

  it('arc along its circle, across 0°', () => {
    const r = extend(A(0, 0, 5, 90, 300), P(2.5, -4.3), [L(0, 0, 10, 0)])!;
    expectArc(r, 0, 0, 5, 90, 0);
    const s = extend(A(0, 0, 5, 90, 300), P(0, 5), [L(0, 0, -10, -10), L(-10, 2, 10, 2)])!;
    expectArc(s, 0, 0, 5, 90 - (90 - (180 / Math.PI) * Math.asin(2 / 5)), 300);
  });

  it('circle cannot be extended', () => {
    expect(extend(C(0, 0, 5), P(5, 0), [L(-10, 0, 10, 0)])).toBeNull();
  });
});

describe('fillet line/line', () => {
  // rectangle 100 x 50, bottom and right edges
  const bottom = L(0, 0, 100, 0);
  const right = L(100, 0, 100, 50);

  it('rectangle corner with r=5', () => {
    const f = fillet(bottom, P(50, 0), right, P(100, 25), 5)!;
    expectLine(f.a, 0, 0, 95, 0);
    expectLine(f.b, 100, 5, 100, 50);
    expectArc(f.arc!, 95, 5, 5, 270, 0);
  });

  it('pick order does not matter for the arc', () => {
    const f = fillet(right, P(100, 25), bottom, P(50, 0), 5)!;
    expectLine(f.a, 100, 5, 100, 50);
    expectLine(f.b, 0, 0, 95, 0);
    expectArc(f.arc!, 95, 5, 5, 270, 0);
  });

  it('crossing lines: picks choose the kept quadrant', () => {
    const h = L(-10, 0, 10, 0);
    const vv = L(0, -10, 0, 10);
    const f = fillet(h, P(-5, 0), vv, P(0, -5), 2)!;
    expectLine(f.a, -10, 0, -2, 0);
    expectLine(f.b, -2 + 2, -10, 0, -2);
    expectArc(f.arc!, -2, -2, 2, 0, 90);
  });

  it('r = 0 joins non-intersecting lines at their extended corner', () => {
    const f = fillet(L(0, 0, 8, 0), P(4, 0), L(10, 2, 10, 20), P(10, 10), 0)!;
    expectLine(f.a, 0, 0, 10, 0);
    expectLine(f.b, 10, 0, 10, 20);
    expect(f.arc).toBeNull();
  });

  it('r > 0 for non-intersecting lines extends to the tangent points', () => {
    const f = fillet(L(0, 0, 8, 0), P(4, 0), L(10, 2, 10, 20), P(10, 10), 1)!;
    expectLine(f.a, 0, 0, 9, 0);
    expectLine(f.b, 10, 1, 10, 20);
    expectArc(f.arc!, 9, 1, 1, 270, 0);
  });

  it('non-right angle: tangent distance r/tan(θ/2)', () => {
    const a = L(0, 0, 20, 0);
    const b = L(0, 0, 20, 20); // 45°
    const f = fillet(a, P(10, 0), b, P(10, 10), 3)!;
    const t = 3 / Math.tan(deg(22.5));
    expectLine(f.a, t, 0, 20, 0);
    const fb = f.b as LineCurve;
    expectPt(fb.a, t * Math.SQRT1_2, t * Math.SQRT1_2);
    expect(f.arc!.r).toBe(3);
    expectPt(f.arc!.c, t, 3);
  });

  it('null for parallel lines or radius too large', () => {
    expect(fillet(L(0, 0, 10, 0), P(5, 0), L(0, 5, 10, 5), P(5, 5), 1)).toBeNull();
    expect(fillet(bottom, P(50, 0), right, P(100, 25), 60)).toBeNull();
  });
});

describe('fillet with arcs', () => {
  it('line/circle: fillet tangent to both', () => {
    const line = L(-20, 0, 20, 0);
    const circle = C(0, 10, 5);
    const f = fillet(line, P(-10, 0), circle, P(-4, 7), 3)!;
    const arc = f.arc!;
    expect(arc.r).toBe(3);
    expect(arc.c.y).toBeCloseTo(3);
    expect(Math.hypot(arc.c.x, arc.c.y - 10)).toBeCloseTo(8);
    expect(arc.c.x).toBeLessThan(0);
    expect(f.b).toEqual(circle);
    expect((f.a as LineCurve).b.x).toBeCloseTo(arc.c.x);
    expectPt((f.a as LineCurve).a, -20, 0);
  });

  it('line/arc trims the arc at the tangent point', () => {
    const line = L(-20, 0, 20, 0);
    const arc = A(0, 10, 5, 90, 300);
    const f = fillet(line, P(-10, 0), arc, P(-5, 10), 3)!;
    const kept = f.b as ArcCurve;
    const [, e] = endpoints(kept)!;
    const t = f.arc!;
    // fillet arc endpoints coincide with trimmed curve ends
    const fe = endpoints(t)!;
    const has = (p: { x: number; y: number }) => fe.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-7);
    expect(has(e)).toBe(true);
    expect(has((f.a as LineCurve).b)).toBe(true);
    expect(curveLength(t) / t.r).toBeLessThan(Math.PI);
  });

  it('arc/arc', () => {
    const a = A(0, 0, 5, 0, 180);
    const b = A(12, 0, 5, 0, 180);
    const f = fillet(a, P(0, 5), b, P(12, 5), 2)!;
    expect(f).not.toBeNull();
    const fe = endpoints(f.arc!)!;
    const ea = endpoints(f.a)!;
    const eb = endpoints(f.b)!;
    const near = (p: { x: number; y: number }, qs: { x: number; y: number }[]) => qs.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-7);
    expect(near(fe[0], [...ea, ...eb]) && near(fe[1], [...ea, ...eb])).toBe(true);
    expect(f.arc!.c.x).toBeCloseTo(6);
  });
});

describe('chamfer', () => {
  it('2 x 45° on a rectangle corner', () => {
    const c = chamfer(L(0, 0, 100, 0), P(50, 0), L(100, 0, 100, 50), P(100, 25), 2, 2)!;
    expectLine(c.a, 0, 0, 98, 0);
    expectLine(c.b, 100, 2, 100, 50);
    expectLine(c.line, 98, 0, 100, 2);
    expect(curveLength(c.line)).toBeCloseTo(2 * Math.SQRT2);
  });

  it('unequal distances and too long', () => {
    const c = chamfer(L(0, 0, 100, 0), P(50, 0), L(100, 0, 100, 50), P(100, 25), 3, 1)!;
    expectLine(c.line, 97, 0, 100, 1);
    expect(chamfer(L(0, 0, 100, 0), P(50, 0), L(100, 0, 100, 50), P(100, 25), 3, 60)).toBeNull();
  });

  it('non-lines and parallel lines are rejected', () => {
    expect(chamfer(C(0, 0, 1), P(1, 0), L(0, 0, 1, 1), P(1, 1), 1, 1)).toBeNull();
    expect(chamfer(L(0, 0, 10, 0), P(5, 0), L(0, 1, 10, 1), P(5, 1), 1, 1)).toBeNull();
  });
});

