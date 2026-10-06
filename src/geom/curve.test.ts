import { describe, expect, it } from 'vitest';
import {
  bbox, closestPoint, curveLength, distanceTo, endpoints, insideBox, intersectsBox, midpoint,
  perpendicularFoot, snapCandidates, tangentPoints,
} from './index';
import { A, C, L, P, expectPt, expectPts } from './testutil';

const box = { min: P(0, 0), max: P(10, 10) };

describe('curve queries', () => {
  it('endpoints and midpoint', () => {
    expect(endpoints(L(0, 0, 4, 2))).toEqual([P(0, 0), P(4, 2)]);
    expect(endpoints(C(0, 0, 1))).toBeNull();
    const e = endpoints(A(0, 0, 2, 0, 90))!;
    expectPt(e[0], 2, 0);
    expectPt(e[1], 0, 2);
    expectPt(midpoint(L(0, 0, 4, 2)), 2, 1);
    expect(midpoint(C(0, 0, 1))).toBeNull();
    expectPt(midpoint(A(0, 0, 2, 350, 10)), 2, 0);
  });

  it('bbox of arcs includes quadrants on the arc only', () => {
    const b = bbox(A(0, 0, 1, 45, 135));
    expect(b.max.y).toBeCloseTo(1);
    expect(b.min.y).toBeCloseTo(Math.SQRT1_2);
    expect(b.min.x).toBeCloseTo(-Math.SQRT1_2);
    const w = bbox(A(0, 0, 1, 315, 45)); // crosses 0
    expect(w.max.x).toBeCloseTo(1);
    expect(w.min.x).toBeCloseTo(Math.SQRT1_2);
    expect(bbox(C(1, 2, 3))).toEqual({ min: P(-2, -1), max: P(4, 5) });
  });

  it('closest point and distance', () => {
    expectPt(closestPoint(L(0, 0, 10, 0), P(5, 3)), 5, 0);
    expectPt(closestPoint(L(0, 0, 10, 0), P(-5, 3)), 0, 0);
    expectPt(closestPoint(C(0, 0, 2), P(0, 5)), 0, 2);
    expectPt(closestPoint(A(0, 0, 2, 0, 90), P(1, 1)), Math.SQRT2, Math.SQRT2);
    expectPt(closestPoint(A(0, 0, 2, 0, 90), P(-1, -5)), 2, 0);
    expect(distanceTo(C(0, 0, 2), P(0, 5))).toBeCloseTo(3);
  });

  it('lengths', () => {
    expect(curveLength(L(0, 0, 3, 4))).toBeCloseTo(5);
    expect(curveLength(C(0, 0, 1))).toBeCloseTo(2 * Math.PI);
    expect(curveLength(A(0, 0, 2, 270, 0))).toBeCloseTo(Math.PI);
  });

  it('window and crossing selection', () => {
    expect(insideBox(L(1, 1, 9, 9), box)).toBe(true);
    expect(insideBox(L(1, 1, 11, 9), box)).toBe(false);
    expect(intersectsBox(L(-5, 5, 15, 5), box)).toBe(true);
    expect(intersectsBox(L(-5, -1, 15, -1), box)).toBe(false);
    expect(intersectsBox(L(11, -5, 15, 20), box)).toBe(false);
    expect(intersectsBox(C(5, 5, 20), box)).toBe(false); // box inside circle, no crossing
    expect(intersectsBox(C(5, 5, 2), box)).toBe(true);
    expect(intersectsBox(C(12, 5, 3), box)).toBe(true);
    expect(intersectsBox(A(12, 5, 3, 90, 270), box)).toBe(true);
    expect(intersectsBox(A(12, 5, 3, 270, 90), box)).toBe(false);
    expect(insideBox(A(5, 5, 4, 0, 90), box)).toBe(true);
  });
});

describe('snapping', () => {
  it('line snaps', () => {
    const s = snapCandidates(L(0, 0, 4, 0));
    expect(s.map((x) => x.kind)).toEqual(['endpoint', 'endpoint', 'midpoint']);
    expectPt(s[2].point, 2, 0);
  });

  it('circle snaps: center + 4 quadrants', () => {
    const s = snapCandidates(C(1, 1, 2));
    expect(s.filter((x) => x.kind === 'center')).toHaveLength(1);
    expectPts(s.filter((x) => x.kind === 'quadrant').map((x) => x.point), [[3, 1], [1, 3], [-1, 1], [1, -1]]);
  });

  it('arc snaps only quadrants on the arc', () => {
    const s = snapCandidates(A(0, 0, 1, 315, 100));
    expectPts(s.filter((x) => x.kind === 'quadrant').map((x) => x.point), [[1, 0], [0, 1]]);
    expect(s.filter((x) => x.kind === 'endpoint')).toHaveLength(2);
    expect(s.filter((x) => x.kind === 'midpoint')).toHaveLength(1);
    expect(s.filter((x) => x.kind === 'center')).toHaveLength(1);
  });

  it('perpendicular foot', () => {
    expectPt(perpendicularFoot(L(0, 0, 10, 0), P(20, 5)), 20, 0); // extended
    expectPt(perpendicularFoot(C(0, 0, 2), P(5, 0)), 2, 0);
    expect(perpendicularFoot(C(0, 0, 2), P(0, 0))).toBeNull();
    expectPt(perpendicularFoot(A(0, 0, 2, 90, 270), P(5, 0)), -2, 0); // far side
    expect(perpendicularFoot(A(0, 0, 2, 10, 80), P(0, -5))).toBeNull();
  });

  it('tangent points', () => {
    const s = Math.sqrt(3) / 2;
    expectPts(tangentPoints(C(0, 0, 1), P(2, 0)), [[0.5, s], [0.5, -s]]);
    expect(tangentPoints(C(0, 0, 1), P(0.5, 0))).toHaveLength(0);
    expectPts(tangentPoints(C(0, 0, 1), P(1, 0)), [[1, 0]]);
    expectPts(tangentPoints(A(0, 0, 1, 0, 180), P(2, 0)), [[0.5, s]]);
    expect(tangentPoints(L(0, 0, 1, 0), P(0, 1))).toHaveLength(0);
  });
});
