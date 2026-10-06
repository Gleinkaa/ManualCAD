import { describe, expect, it } from 'vitest';
import { arcFrom3Points, arcFromCenter, endpoints, mirror, rotate, scaleCurve, translate } from './index';
import type { ArcCurve } from './types';
import { A, C, L, P, expectArc, expectLine, expectPt } from './testutil';

describe('construction', () => {
  it('arc from 3 points, CCW and CW input', () => {
    expectArc(arcFrom3Points(P(1, 0), P(0, 1), P(-1, 0))!, 0, 0, 1, 0, 180);
    expectArc(arcFrom3Points(P(-1, 0), P(0, 1), P(1, 0))!, 0, 0, 1, 0, 180);
    expectArc(arcFrom3Points(P(1, 0), P(0, -1), P(-1, 0))!, 0, 0, 1, 180, 0);
    expect(arcFrom3Points(P(0, 0), P(1, 1), P(2, 2))).toBeNull();
    expect(arcFrom3Points(P(0, 0), P(0, 0), P(2, 2))).toBeNull();
  });

  it('arc from center', () => {
    expectArc(arcFromCenter(P(0, 0), P(0, -3), P(3, 0)), 0, 0, 3, 270, 0);
    expectArc(arcFromCenter(P(0, 0), P(3, 0), P(0, 10)), 0, 0, 3, 0, 90);
  });
});

describe('transforms', () => {
  it('translate', () => {
    expectLine(translate(L(0, 0, 1, 1), P(2, 3)), 2, 3, 3, 4);
    expectPt((translate(C(0, 0, 1), P(2, 3)) as { c: { x: number; y: number } }).c, 2, 3);
  });

  it('rotate line and arc', () => {
    expectLine(rotate(L(1, 0, 2, 0), P(0, 0), Math.PI / 2), 0, 1, 0, 2);
    expectArc(rotate(A(1, 0, 1, 0, 90), P(0, 0), Math.PI), -1, 0, 1, 180, 270);
  });

  it('mirror line and circle', () => {
    expectLine(mirror(L(1, 1, 2, 3), P(0, 0), P(0, 1)), -1, 1, -2, 3);
  });

  it('mirror keeps arcs CCW with the same endpoints mirrored', () => {
    const arc = A(2, 0, 1, 0, 90);
    const m = mirror(arc, P(0, 0), P(0, 1)) as ArcCurve;
    expectArc(m, -2, 0, 1, 90, 180);
    const [s, e] = endpoints(m)!;
    expectPt(s, -2, 1);
    expectPt(e, -3, 0);
  });

  it('mirror arc crossing 0° across a diagonal', () => {
    const m = mirror(A(0, 0, 1, 330, 30), P(0, 0), P(1, 1));
    expectArc(m, 0, 0, 1, 60, 120);
  });

  it('scale', () => {
    expectLine(scaleCurve(L(1, 1, 2, 2), P(1, 1), 2), 1, 1, 3, 3);
    expectArc(scaleCurve(A(1, 0, 1, 0, 90), P(0, 0), 2), 2, 0, 2, 0, 90);
    expectArc(scaleCurve(A(1, 0, 1, 0, 90), P(0, 0), -1), -1, 0, 1, 180, 270);
  });
});
