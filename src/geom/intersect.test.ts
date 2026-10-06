import { describe, expect, it } from 'vitest';
import { intersect } from './index';
import { A, C, L, expectPts } from './testutil';

describe('intersect', () => {
  it('line/line crossing, outside extent, extended, parallel', () => {
    expectPts(intersect(L(0, 0, 10, 10), L(0, 10, 10, 0)), [[5, 5]]);
    expect(intersect(L(0, 0, 1, 1), L(0, 10, 10, 0))).toHaveLength(0);
    expectPts(intersect(L(0, 0, 1, 1), L(0, 10, 10, 0), { extended: true }), [[5, 5]]);
    expect(intersect(L(0, 0, 10, 0), L(0, 1, 10, 1), { extended: true })).toHaveLength(0);
    expect(intersect(L(0, 0, 10, 0), L(5, 0, 15, 0))).toHaveLength(0); // collinear overlap
  });

  it('line/line touching at endpoints', () => {
    expectPts(intersect(L(0, 0, 10, 0), L(10, 0, 10, 10)), [[10, 0]]);
  });

  it('line/circle: secant, tangent, miss', () => {
    expectPts(intersect(L(-10, 0, 10, 0), C(0, 0, 5)), [[-5, 0], [5, 0]]);
    expectPts(intersect(L(-10, 5, 10, 5), C(0, 0, 5)), [[0, 5]]);
    expect(intersect(L(-10, 6, 10, 6), C(0, 0, 5))).toHaveLength(0);
    expectPts(intersect(L(0, 0, 10, 0), C(0, 0, 5)), [[5, 0]]); // segment starts inside
    expectPts(intersect(L(0, 0, 1, 0), C(0, 0, 5), { extended: true }), [[-5, 0], [5, 0]]);
  });

  it('line/arc restricted to extent, incl. arc crossing 0°', () => {
    expectPts(intersect(L(-10, 0, 10, 0), A(0, 0, 5, 0, 180)), [[-5, 0], [5, 0]]);
    expectPts(intersect(L(-10, 1, 10, 1), A(0, 0, 5, 300, 60)), [[Math.sqrt(24), 1]]);
    expectPts(intersect(L(-10, 1, 10, 1), A(0, 0, 5, 300, 60), { extended: true }), [[Math.sqrt(24), 1], [-Math.sqrt(24), 1]]);
    expect(intersect(L(-10, -1, 10, -1), A(0, 0, 5, 10, 170))).toHaveLength(0);
    expectPts(intersect(L(-10, -5, 10, -5), A(0, 0, 5, 200, 340)), [[0, -5]]); // tangent
  });

  it('circle/circle: two, tangent outside, tangent inside, none, concentric', () => {
    expectPts(intersect(C(0, 0, 5), C(8, 0, 5)), [[4, 3], [4, -3]]);
    expectPts(intersect(C(0, 0, 5), C(10, 0, 5)), [[5, 0]]);
    expectPts(intersect(C(0, 0, 5), C(2, 0, 3)), [[5, 0]]);
    expect(intersect(C(0, 0, 5), C(20, 0, 5))).toHaveLength(0);
    expect(intersect(C(0, 0, 5), C(1, 0, 1))).toHaveLength(0);
    expect(intersect(C(0, 0, 5), C(0, 0, 3))).toHaveLength(0);
  });

  it('circle/arc and arc/arc', () => {
    expectPts(intersect(C(0, 0, 5), A(8, 0, 5, 90, 270)), [[4, 3], [4, -3]]);
    expectPts(intersect(C(0, 0, 5), A(8, 0, 5, 150, 270)), [[4, -3]]);
    expectPts(intersect(A(0, 0, 5, 330, 40), A(8, 0, 5, 90, 180)), [[4, 3]]);
    expect(intersect(A(0, 0, 5, 90, 270), A(8, 0, 5, 90, 270))).toHaveLength(0);
    expectPts(intersect(A(0, 0, 5, 90, 270), A(8, 0, 5, 90, 270), { extended: true }), [[4, 3], [4, -3]]);
  });

  it('tangent arcs at 0°', () => {
    expectPts(intersect(A(0, 0, 5, 350, 10), A(10, 0, 5, 170, 190)), [[5, 0]]);
  });

  it('is symmetric in argument order', () => {
    expectPts(intersect(A(0, 0, 5, 0, 180), L(-10, 0, 10, 0)), [[-5, 0], [5, 0]]);
  });
});
