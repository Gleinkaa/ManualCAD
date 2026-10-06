import { describe, expect, it } from 'vitest';
import { clipOutsideConvex } from './hatch';
import { P } from './testutil';
import type { Vec2 } from './types';

type Seg = [Vec2, Vec2];

const CCW = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
const CW = [P(0, 0), P(0, 10), P(10, 10), P(10, 0)];
const DIAMOND = [P(0, 5), P(5, 0), P(10, 5), P(5, 10)];

const seg = (ax: number, ay: number, bx: number, by: number): Seg => [P(ax, ay), P(bx, by)];

function expectSegs(got: Seg[], want: [number, number, number, number][]): void {
  expect(got).toHaveLength(want.length);
  got.forEach(([a, b], i) => {
    const [ax, ay, bx, by] = want[i];
    expect(a.x).toBeCloseTo(ax, 9);
    expect(a.y).toBeCloseTo(ay, 9);
    expect(b.x).toBeCloseTo(bx, 9);
    expect(b.y).toBeCloseTo(by, 9);
  });
}

describe('clipOutsideConvex', () => {
  it('leaves a segment that misses the polygon unchanged', () => {
    expectSegs(clipOutsideConvex([seg(20, 5, 30, 5)], [CCW]), [[20, 5, 30, 5]]);
    // the same segment with no polygons at all
    expectSegs(clipOutsideConvex([seg(-5, -5, -1, -1)], []), [[-5, -5, -1, -1]]);
  });

  it('removes a segment that lies fully inside the polygon', () => {
    expect(clipOutsideConvex([seg(2, 5, 8, 5)], [CCW])).toEqual([]);
    expect(clipOutsideConvex([seg(2, 2, 8, 8)], [CCW])).toEqual([]);
  });

  it('cuts a segment crossing one box, keeping the exact outside endpoints', () => {
    expectSegs(clipOutsideConvex([seg(-5, 5, 15, 5)], [CCW]), [
      [-5, 5, 0, 5],
      [10, 5, 15, 5],
    ]);
  });

  it('merges two overlapping boxes into one interruption', () => {
    const boxes = [CCW, [P(5, 0), P(15, 0), P(15, 10), P(5, 10)]];
    // x covered by box1 [0,10] and box2 [5,15] → the whole [0,15] is hidden
    expectSegs(clipOutsideConvex([seg(-5, 5, 20, 5)], boxes), [
      [-5, 5, 0, 5],
      [15, 5, 20, 5],
    ]);
  });

  it('cuts a rotated (diamond) box', () => {
    // at y = 3 the diamond spans x ∈ [2, 8]
    expectSegs(clipOutsideConvex([seg(-5, 3, 15, 3)], [DIAMOND]), [
      [-5, 3, 2, 3],
      [8, 3, 15, 3],
    ]);
  });

  it('gives the same result for clockwise and counter-clockwise vertex order', () => {
    const ccw = clipOutsideConvex([seg(-5, 5, 15, 5)], [CCW]);
    const cw = clipOutsideConvex([seg(-5, 5, 15, 5)], [CW]);
    expectSegs(ccw, [
      [-5, 5, 0, 5],
      [10, 5, 15, 5],
    ]);
    expectSegs(cw, [
      [-5, 5, 0, 5],
      [10, 5, 15, 5],
    ]);
  });

  it('drops pieces shorter than minLength and whole short segments', () => {
    // the sliver left of the box is 0.05 mm long; at minLength 1 only the right piece survives
    expectSegs(clipOutsideConvex([seg(-0.05, 5, 15, 5)], [CCW], 1), [[10, 5, 15, 5]]);
    // a whole input segment shorter than minLength is dropped before any clipping
    expect(clipOutsideConvex([seg(0, 0, 0.5, 0)], [], 1)).toEqual([]);
    // with the default minLength the tiny piece is kept
    expect(clipOutsideConvex([seg(-0.05, 5, 15, 5)], [CCW])).toHaveLength(2);
  });
});
