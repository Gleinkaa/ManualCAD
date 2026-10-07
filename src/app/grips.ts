// Grips: the characteristic points of selected objects that can be dragged (AutoCAD grip editing). Pure, no DOM.
import { angleOf, arcEnd, arcStart, makeArc } from '../geom/curve';
import { translate } from '../geom';
import type { Curve, Vec2 } from '../geom/types';
import { getView, toSheet } from '../model/doc';
import type { Annotation, Entity, SheetDoc } from '../model/types';
import { dist, polar, sub } from '../geom/vec';

export type GripKind = 'end' | 'mid' | 'center' | 'quad' | 'point';

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

/** Grips of one object, in sheet mm. Hatches and dimensions have none (they follow their geometry). */
export function objectGrips(doc: SheetDoc, id: string): Grip[] {
  const e = doc.entities.find((x) => x.id === id);
  if (e) {
    const view = getView(doc, e.viewId);
    return curveGrips(e.geom).map((g) => ({ id, kind: g.kind, index: g.index, p: toSheet(view, g.p), viewId: e.viewId }));
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

/** Apply a stretch in place; false when the object no longer exists. */
export function applyGrip(doc: SheetDoc, grip: Grip, to: Vec2): boolean {
  const e: Entity | undefined = doc.entities.find((x) => x.id === grip.id);
  if (e) {
    e.geom = stretchCurve(e.geom, grip, to);
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
