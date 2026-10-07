// Grips: the characteristic points of selected objects that can be dragged (AutoCAD grip editing). Pure, no DOM.
import { angleOf, arcEnd, arcStart, makeArc } from '../geom/curve';
import { translate } from '../geom';
import type { Curve, Vec2 } from '../geom/types';
import { angularGeometry } from '../dim';
import { getView, resolveAnchor, toLocal, toSheet } from '../model/doc';
import type { Annotation, Dimension, Entity, SheetDoc } from '../model/types';
import { add, dist, norm, polar, scale, sub } from '../geom/vec';
import { angularSenses, dimOffset } from './commands/dims';

/** `anchor`: a measured point of a dimension (dragging it detaches the point); `dimline`: its dimension line (offset, leader, arc radius). */
export type GripKind = 'end' | 'mid' | 'center' | 'quad' | 'point' | 'anchor' | 'dimline';

export interface Grip {
  id: string;                // entity or annotation id
  kind: GripKind;
  index: number;             // which end / quadrant / leader point
  p: Vec2;                   // sheet mm
  viewId: string;
}

function curveGrips(c: Curve): { kind: GripKind; index: number; p: Vec2 }[] {
  switch (c.kind) {
    case 'line':
      return [
        { kind: 'end', index: 0, p: c.a },
        { kind: 'end', index: 1, p: c.b },
        { kind: 'mid', index: 0, p: { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 } },
      ];
    case 'circle':
      return [{ kind: 'center', index: 0, p: c.c }, ...[0, 1, 2, 3].map((k) => ({ kind: 'quad' as const, index: k, p: polar(c.c, c.r, (k * Math.PI) / 2) }))];
    case 'arc': {
      const s = c.start;
      let e = c.end;
      if (e <= s) e += 2 * Math.PI;
      return [
        { kind: 'end', index: 0, p: arcStart(c) },
        { kind: 'end', index: 1, p: arcEnd(c) },
        { kind: 'mid', index: 0, p: polar(c.c, c.r, (s + e) / 2) },
        { kind: 'center', index: 0, p: c.c },
      ];
    }
  }
}

/** Unit normal of a linear dimension's offset (see dim/plotLinear), sheet space. */
function linearNormal(orientation: 'horizontal' | 'vertical' | 'aligned', A: Vec2, B: Vec2): Vec2 {
  if (orientation === 'horizontal') return { x: 0, y: 1 };
  if (orientation === 'vertical') return { x: 1, y: 0 };
  const u = dist(A, B) < 1e-12 ? { x: 1, y: 0 } : norm(sub(B, A));
  return { x: -u.y, y: u.x };
}

/** Grips of a dimension (sheet mm): its measured points and one point on its dimension line, text or arc. */
export function dimensionGrips(doc: SheetDoc, dim: Dimension): { kind: GripKind; index: number; p: Vec2 }[] {
  const view = getView(doc, dim.viewId);
  if (dim.kind === 'linear') {
    const A = toSheet(view, resolveAnchor(doc, dim.a));
    const B = toSheet(view, resolveAnchor(doc, dim.b));
    const M = scale(add(A, B), 0.5);
    return [
      { kind: 'anchor', index: 0, p: A },
      { kind: 'anchor', index: 1, p: B },
      { kind: 'dimline', index: 0, p: add(M, scale(linearNormal(dim.orientation, A, B), dim.offset)) },
    ];
  }
  if (dim.kind === 'angular') {
    const g = angularGeometry(doc, dim);
    if (!g) return [];
    const bis = norm(add(g.u1, g.u2));
    const V = toSheet(view, g.vertex);
    return [{ kind: 'dimline', index: 0, p: add(V, scale(bis.x === 0 && bis.y === 0 ? { x: 1, y: 0 } : bis, dim.radius)) }];
  }
  const e = doc.entities.find((x) => x.id === dim.entityId);
  if (!e || e.geom.kind === 'line') return [];
  const C = toSheet(view, e.geom.c);
  const d = { x: Math.cos(dim.angle), y: Math.sin(dim.angle) };
  return [{ kind: 'dimline', index: 0, p: add(C, scale(d, e.geom.r * view.scale + dim.leader)) }];
}

/** The dimension after dragging a grip to `to` (sheet mm): a clone, the original untouched. */
export function stretchDimension(doc: SheetDoc, dim: Dimension, grip: Pick<Grip, 'kind' | 'index'>, to: Vec2): Dimension {
  const view = getView(doc, dim.viewId);
  if (dim.kind === 'linear') {
    const out = structuredClone(dim);
    if (grip.kind === 'anchor') {
      const an = grip.index === 0 ? out.a : out.b;
      an.ref = null;
      an.fallback = toLocal(view, to);
      return out;
    }
    const A = toSheet(view, resolveAnchor(doc, dim.a));
    const B = toSheet(view, resolveAnchor(doc, dim.b));
    out.offset = dimOffset(dim.orientation, A, B, to);
    return out;
  }
  if (dim.kind === 'angular') {
    const out = structuredClone(dim);
    const g = angularGeometry(doc, dim);
    if (!g) return out;
    const V = toSheet(view, g.vertex);
    const d1 = sub(resolveAnchor(doc, dim.leg1.b), resolveAnchor(doc, dim.leg1.a));
    const d2 = sub(resolveAnchor(doc, dim.leg2.b), resolveAnchor(doc, dim.leg2.a));
    out.radius = Math.max(1e-6, dist(to, V));
    Object.assign(out, angularSenses(g.vertex, d1, d2, toLocal(view, to)));
    return out;
  }
  const out = structuredClone(dim);
  const e = doc.entities.find((x) => x.id === dim.entityId);
  if (!e || e.geom.kind === 'line') return out;
  const C = toSheet(view, e.geom.c);
  out.angle = Math.atan2(to.y - C.y, to.x - C.x);
  out.leader = Math.max(0, dist(to, C) - e.geom.r * view.scale);
  return out;
}

/** Grips of one object, in sheet mm. Hatches have none: they follow their boundary. */
export function objectGrips(doc: SheetDoc, id: string): Grip[] {
  const e = doc.entities.find((x) => x.id === id);
  if (e) {
    const view = getView(doc, e.viewId);
    return curveGrips(e.geom).map((g) => ({ id, kind: g.kind, index: g.index, p: toSheet(view, g.p), viewId: e.viewId }));
  }
  const dim = doc.dimensions.find((d) => d.id === id);
  if (dim) {
    try {
      return dimensionGrips(doc, dim).map((g) => ({ id, kind: g.kind, index: g.index, p: g.p, viewId: dim.viewId }));
    } catch {
      return [];
    }
  }
  const a = doc.annotations.find((x) => x.id === id);
  if (!a) return [];
  const view = getView(doc, a.viewId);
  if (a.kind === 'text') return [{ id, kind: 'point', index: 0, p: toSheet(view, a.pos), viewId: a.viewId }];
  if (a.kind === 'leader') return a.points.map((p, i) => ({ id, kind: 'point', index: i, p: toSheet(view, p), viewId: a.viewId }));
  return [];
}

/**
 * The curve after dragging `grip` to `to` (view-local): an endpoint moves alone, a midpoint or centre moves the
 * whole curve, a quadrant or arc midpoint changes the radius, an arc endpoint changes that end angle.
 */
export function stretchCurve(c: Curve, grip: Pick<Grip, 'kind' | 'index'>, to: Vec2): Curve {
  switch (c.kind) {
    case 'line':
      if (grip.kind === 'end') return grip.index === 0 ? { kind: 'line', a: to, b: c.b } : { kind: 'line', a: c.a, b: to };
      return translate(c, sub(to, { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }));
    case 'circle':
      if (grip.kind === 'center') return { ...c, c: to };
      return { ...c, r: Math.max(1e-9, dist(c.c, to)) };
    case 'arc':
      if (grip.kind === 'center') return translate(c, sub(to, c.c));
      if (grip.kind === 'mid') return { ...c, r: Math.max(1e-9, dist(c.c, to)) };
      if (grip.kind === 'end') {
        const th = angleOf(c.c, to);
        return grip.index === 0 ? makeArc(c.c, c.r, th, c.end) : makeArc(c.c, c.r, c.start, th);
      }
      return c;
  }
}

/** The annotation after dragging one of its points to `to` (view-local). */
export function stretchAnnotation(a: Annotation, grip: Pick<Grip, 'kind' | 'index'>, to: Vec2): Annotation {
  if (a.kind === 'text') return { ...a, pos: to };
  if (a.kind === 'leader') return { ...a, points: a.points.map((p, i) => (i === grip.index ? to : p)) };
  return a;
}

/** Apply a stretch in place (`to` view-local of the object's view); false when the object no longer exists. */
export function applyGrip(doc: SheetDoc, grip: Grip, to: Vec2): boolean {
  const e: Entity | undefined = doc.entities.find((x) => x.id === grip.id);
  if (e) {
    e.geom = stretchCurve(e.geom, grip, to);
    return true;
  }
  const di = doc.dimensions.findIndex((d) => d.id === grip.id);
  if (di >= 0) {
    doc.dimensions[di] = stretchDimension(doc, doc.dimensions[di], grip, toSheet(getView(doc, grip.viewId), to));
    return true;
  }
  const i = doc.annotations.findIndex((x) => x.id === grip.id);
  if (i < 0) return false;
  doc.annotations[i] = stretchAnnotation(doc.annotations[i], grip, to);
  return true;
}

/** The grip nearest to `p` within `tol` (sheet mm), or null. */
export function nearestGrip(grips: Grip[], p: Vec2, tol: number): Grip | null {
  let best: Grip | null = null;
  let bestD = tol;
  for (const g of grips) {
    const d = dist(g.p, p);
    if (d <= bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}
