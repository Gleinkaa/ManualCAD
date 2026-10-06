// Picking and window/crossing selection of entities and dimensions, in sheet mm.
import { distanceTo, insideBox, intersectsBox } from '../geom';
import type { BBox, Vec2 } from '../geom/types';
import { plotDimension } from '../dim';
import type { Dimension, SheetDoc } from '../model/types';
import type { Primitive } from '../plot/types';
import { entitySheetCurve, layerVisible, visibleEntities } from './xform';

export function dimPrimitives(doc: SheetDoc, dim: Dimension): Primitive[] {
  try {
    return plotDimension(doc, dim);
  } catch {
    return [];
  }
}

function visibleDims(doc: SheetDoc): Dimension[] {
  return doc.dimensions.filter((d) => layerVisible(doc, d.layer));
}

/** Closest entity or dimension within `tol` sheet mm of `p`. */
export function pick(doc: SheetDoc, p: Vec2, tol: number): string | null {
  let best: string | null = null;
  let bestD = tol;
  for (const e of visibleEntities(doc)) {
    const d = distanceTo(entitySheetCurve(doc, e), p);
    if (d <= bestD) {
      bestD = d;
      best = e.id;
    }
  }
  if (best) return best;
  for (const dim of visibleDims(doc)) {
    const d = primsDistance(dimPrimitives(doc, dim), p);
    if (d <= bestD) {
      bestD = d;
      best = dim.id;
    }
  }
  return best;
}

/** Entities only (for TRIM, FILLET, ...). */
export function pickEntity(doc: SheetDoc, p: Vec2, tol: number, filter?: (id: string) => boolean): string | null {
  let best: string | null = null;
  let bestD = tol;
  for (const e of visibleEntities(doc)) {
    if (filter && !filter(e.id)) continue;
    const d = distanceTo(entitySheetCurve(doc, e), p);
    if (d <= bestD) {
      bestD = d;
      best = e.id;
    }
  }
  return best;
}

export function boxFrom(a: Vec2, b: Vec2): BBox {
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) } };
}

/** Left→right drag = window (entirely inside), right→left = crossing (touching). */
export function boxSelect(doc: SheetDoc, from: Vec2, to: Vec2): string[] {
  const box = boxFrom(from, to);
  const crossing = to.x < from.x;
  const ids: string[] = [];
  for (const e of visibleEntities(doc)) {
    const c = entitySheetCurve(doc, e);
    if (crossing ? intersectsBox(c, box) : insideBox(c, box)) ids.push(e.id);
  }
  for (const dim of visibleDims(doc)) {
    const pts = primPoints(dimPrimitives(doc, dim));
    if (pts.length === 0) continue;
    const inside = (q: Vec2) => q.x >= box.min.x && q.x <= box.max.x && q.y >= box.min.y && q.y <= box.max.y;
    if (crossing ? pts.some(inside) : pts.every(inside)) ids.push(dim.id);
  }
  return ids;
}

function primPoints(prims: Primitive[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of prims) {
    if (p.kind === 'polyline' || p.kind === 'fill') pts.push(...p.points);
    else if (p.kind === 'text') pts.push(p.pos);
    else pts.push({ x: p.c.x + p.r * Math.cos(p.start), y: p.c.y + p.r * Math.sin(p.start) }, { x: p.c.x + p.r * Math.cos(p.end), y: p.c.y + p.r * Math.sin(p.end) });
  }
  return pts;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function primsDistance(prims: Primitive[], p: Vec2): number {
  let best = Infinity;
  for (const pr of prims) {
    if (pr.kind === 'polyline' || pr.kind === 'fill') {
      const pts = pr.points;
      for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i], pts[i + 1]));
    } else if (pr.kind === 'text') {
      best = Math.min(best, Math.hypot(p.x - pr.pos.x, p.y - pr.pos.y) - pr.height);
    } else {
      best = Math.min(best, Math.abs(Math.hypot(p.x - pr.c.x, p.y - pr.c.y) - pr.r));
    }
  }
  return best;
}

export function isDimensionId(doc: SheetDoc, id: string): boolean {
  return doc.dimensions.some((d) => d.id === id);
}
