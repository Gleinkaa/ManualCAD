// CONTRACT: signatures are fixed. Implementations live in the sibling files; doc comments are next to them.
export * from './types';

// --- vector basics ---
export { v, add, sub, scale, dot, cross, len, dist, norm, perp, polar } from './vec';

// --- curve queries ---
export { endpoints, midpoint, bbox, closestPoint, distanceTo, curveLength } from './curve';
export { intersectsBox, insideBox, intersect } from './intersect';

// --- snapping ---
export { snapCandidates, perpendicularFoot, tangentPoints } from './snap';

// --- construction & transforms ---
export { arcFrom3Points, arcFromCenter, translate, rotate, mirror, scaleCurve } from './transform';

// --- regions & hatching ---
export { findRegion } from './region';
export { hatchSegments } from './hatch';

// --- edit operations (AutoCAD semantics) ---
export { offset, trim, extend, fillet, chamfer } from './edit';
