// Closed regions formed by curves: what HATCH's "pick internal point" finds.
import type { Curve, Vec2 } from './types';

/**
 * The boundary of the smallest closed region around `p` formed by `curves` (one coordinate space).
 * Curves are split at their mutual intersections; dangling pieces are ignored. Returns the outer loop
 * first, then the islands inside it (loops of other curves that lie inside the outer loop but do not
 * contain `p`), each as a closed chain of curves. Null when `p` is not enclosed.
 */
export function findRegion(curves: Curve[], p: Vec2): Curve[][] | null {
  void curves;
  void p;
  return null; // TODO(hatch): implement
}
