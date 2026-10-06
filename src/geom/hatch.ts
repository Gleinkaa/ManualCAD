// Hatch line generation: parallel lines clipped to closed loops.
import type { Curve, Vec2 } from './types';

/**
 * Segments of the parallel lines at `angleDeg` (CCW from +x), `spacing` apart, one of them through
 * `origin`, clipped to the even-odd interior of `loops` (each a closed chain of curves).
 * Lines through a vertex or tangent to an arc must not leak outside the loops.
 */
export function hatchSegments(loops: Curve[][], angleDeg: number, spacing: number, origin: Vec2 = { x: 0, y: 0 }): [Vec2, Vec2][] {
  void loops;
  void angleDeg;
  void spacing;
  void origin;
  return []; // TODO(hatch): implement
}
