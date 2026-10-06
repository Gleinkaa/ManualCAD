import { describe, expect, it } from 'vitest';
import { curveLength } from './curve';
import { findRegion } from './region';
import { A, C, L, P } from './testutil';
import type { Curve } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Curve[] => [L(x0, y0, x1, y0), L(x1, y0, x1, y1), L(x1, y1, x0, y1), L(x0, y1, x0, y0)];
const perimeter = (loop: Curve[]) => loop.reduce((s, c) => s + curveLength(c), 0);

describe('findRegion', () => {
  it('finds a rectangle', () => {
    const r = findRegion(rect(0, 0, 40, 20), P(10, 10));
    expect(r).toHaveLength(1);
    expect(r![0]).toHaveLength(4);
    expect(perimeter(r![0])).toBeCloseTo(120, 9);
  });

  it('returns null for a point outside or an open outline', () => {
    expect(findRegion(rect(0, 0, 40, 20), P(50, 10))).toBeNull();
    expect(findRegion(rect(0, 0, 40, 20).slice(0, 3), P(10, 10))).toBeNull();
    expect(findRegion([], P(0, 0))).toBeNull();
  });

  it('keeps a circular hole as an island', () => {
    const r = findRegion([...rect(0, 0, 40, 20), C(20, 10, 5)], P(5, 5));
    expect(r).toHaveLength(2);
    expect(perimeter(r![0])).toBeCloseTo(120, 9);
    expect(r![1]).toHaveLength(1);
    expect(r![1][0].kind).toBe('circle');
  });

  it('picks the inside of the hole as its own region', () => {
    const r = findRegion([...rect(0, 0, 40, 20), C(20, 10, 5)], P(20, 10));
    expect(r).toHaveLength(1);
    expect(perimeter(r![0])).toBeCloseTo(2 * Math.PI * 5, 9);
  });

  it('finds the ring between concentric circles', () => {
    const r = findRegion([C(0, 0, 10), C(0, 0, 4)], P(7, 0));
    expect(r).toHaveLength(2);
    expect(perimeter(r![0])).toBeCloseTo(20 * Math.PI, 9);
    expect(perimeter(r![1])).toBeCloseTo(8 * Math.PI, 9);
  });

  it('splits a rectangle by a wavy chain of tangent arcs (break-out boundary)', () => {
    // Freehand line from (20,0) up to (20,20): two tangent half-circles r=5 bulging left then right.
    const wave = [A(20, 5, 5, 270, 90), A(20, 15, 5, 90, 270)];
    // A(20,5,5,270,90) runs CCW from (20,0) through (25,5) to (20,10); A(20,15,5,90,270) from (20,20) via (15,15) to (20,10).
    const curves = [...rect(0, 0, 40, 20), ...wave];
    const left = findRegion(curves, P(5, 10));
    const right = findRegion(curves, P(35, 10));
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    // left: 20 + 20 + 20 (bottom/left/top pieces) + the wave; right: same lengths mirrored
    const waveLen = 2 * Math.PI * 5;
    expect(perimeter(left![0])).toBeCloseTo(60 + waveLen, 9);
    expect(perimeter(right![0])).toBeCloseTo(60 + waveLen, 9);
    // points inside a bulge belong to the side the bulge opens to
    const inBulge = findRegion(curves, P(23, 5));
    expect(perimeter(inBulge![0])).toBeCloseTo(perimeter(left![0]), 9);
  });

  it('finds the stepped region of a shaft section bounded by a bore', () => {
    // Shaft: Ø28 x 40 then Ø20 x 30, cut along the axis (upper half); bore Ø13 x 28 from the left.
    const outline = [
      L(0, 0, 0, 14), L(0, 14, 40, 14), L(40, 14, 40, 10), L(40, 10, 70, 10), L(70, 10, 70, 0), L(70, 0, 0, 0),
    ];
    const bore = [L(0, 6.5, 28, 6.5), L(28, 6.5, 28, 0)];
    const r = findRegion([...outline, ...bore], P(10, 10));
    expect(r).toHaveLength(1);
    // L-shaped wall: 0,6.5 → 0,14 → 40,14 → 40,10 → 70,10 → 70,0 → 28,0 → 28,6.5 → back
    expect(perimeter(r![0])).toBeCloseTo(7.5 + 40 + 4 + 30 + 10 + 42 + 6.5 + 28, 9);
    // inside the bore: the bore rectangle only
    const b = findRegion([...outline, ...bore], P(10, 3));
    expect(perimeter(b![0])).toBeCloseTo(2 * 28 + 2 * 6.5, 9);
  });

  it('ignores dangling lines and duplicate overlapping lines', () => {
    const curves = [...rect(0, 0, 40, 20), L(10, 0, 10, 8), L(0, 0, 40, 0), L(50, 50, 60, 60)];
    const r = findRegion(curves, P(5, 15));
    expect(perimeter(r![0])).toBeCloseTo(120, 9);
  });

  it('splits at T-junctions where an endpoint lies on another line', () => {
    const curves = [...rect(0, 0, 40, 20), L(20, 0, 20, 20)];
    expect(perimeter(findRegion(curves, P(5, 5))![0])).toBeCloseTo(80, 9);
    expect(perimeter(findRegion(curves, P(35, 5))![0])).toBeCloseTo(80, 9);
  });

  it('keeps only the outermost island', () => {
    const curves = [...rect(0, 0, 100, 100), ...rect(20, 20, 80, 80), C(50, 50, 10)];
    const r = findRegion(curves, P(10, 10));
    expect(r).toHaveLength(2);
    expect(perimeter(r![1])).toBeCloseTo(240, 9);
  });

  it('handles a circle touching a line at one point', () => {
    const curves = [...rect(0, 0, 40, 20), C(20, 10, 10)];
    const r = findRegion(curves, P(2, 2));
    expect(r).toHaveLength(1);
    const inner = findRegion(curves, P(20, 10));
    expect(perimeter(inner![0])).toBeCloseTo(20 * Math.PI, 9);
  });
});
