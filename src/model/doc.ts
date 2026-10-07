import { endpoints, midpoint } from '../geom';
import type { Vec2 } from '../geom/types';
import type { AnchorPoint, DimAnchor, Dimension, Entity, SheetDoc, View } from './types';

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newSheet(): SheetDoc {
  return {
    version: 1,
    format: 'A3',
    orientation: 'landscape',
    lineGroup: '0.5',
    titleBlock: { documentType: 'Fertigungszeichnung', generalTolerance: 'ISO 2768-m', sheet: '1/1' },
    layers: [{ name: '0', visible: true }],
    views: [{ id: 'v-front', name: 'Front view', scale: 1, origin: { x: 120, y: 160 }, link: null }],
    entities: [],
    dimensions: [],
    annotations: [],
    partsList: [],
  };
}

export function getView(doc: SheetDoc, id: string): View {
  const view = doc.views.find((w) => w.id === id);
  if (!view) throw new Error(`unknown view ${id}`);
  return view;
}

export function toSheet(view: View, p: Vec2): Vec2 {
  return { x: view.origin.x + p.x * view.scale, y: view.origin.y + p.y * view.scale };
}

export function toLocal(view: View, p: Vec2): Vec2 {
  return { x: (p.x - view.origin.x) / view.scale, y: (p.y - view.origin.y) / view.scale };
}

/**
 * Move a view by `delta` (sheet mm). A linked view only moves along its free axis.
 * Children follow their parent along the locked axis only, recursively.
 */
export function moveView(doc: SheetDoc, viewId: string, delta: Vec2): void {
  const view = getView(doc, viewId);
  const d = view.link ? constrain(delta, view.link.freeAxis) : delta;
  shift(doc, view, d);
}

function constrain(d: Vec2, freeAxis: 'x' | 'y'): Vec2 {
  return freeAxis === 'x' ? { x: d.x, y: 0 } : { x: 0, y: d.y };
}

function shift(doc: SheetDoc, view: View, d: Vec2): void {
  view.origin = { x: view.origin.x + d.x, y: view.origin.y + d.y };
  for (const child of doc.views) {
    if (child.link?.parentId !== view.id) continue;
    const locked = child.link.freeAxis === 'x' ? { x: 0, y: d.y } : { x: d.x, y: 0 };
    if (locked.x !== 0 || locked.y !== 0) shift(doc, child, locked);
  }
}

/** Resolve a dimension anchor to its current view-local position and refresh its fallback. */
export function resolveAnchor(doc: SheetDoc, anchor: DimAnchor): Vec2 {
  if (anchor.ref) {
    const ent = doc.entities.find((e) => e.id === anchor.ref!.entityId);
    const p = ent ? anchorPoint(ent, anchor.ref.point) : null;
    if (p) {
      anchor.fallback = p;
      return p;
    }
    anchor.ref = null;
  }
  return anchor.fallback;
}

/** The anchors of a dimension that can be tied to entity points (none for radial dimensions). */
export function dimensionAnchors(dim: Dimension): DimAnchor[] {
  if (dim.kind === 'linear') return [dim.a, dim.b];
  if (dim.kind === 'angular') return [dim.leg1.a, dim.leg1.b, dim.leg2.a, dim.leg2.b];
  return [];
}

function anchorPoint(ent: Entity, point: AnchorPoint): Vec2 | null {
  const g = ent.geom;
  switch (point) {
    case 'center':
      return g.kind === 'line' ? null : g.c;
    case 'mid':
      return midpoint(g);
    case 'start':
    case 'end': {
      const ends = endpoints(g);
      return ends ? ends[point === 'start' ? 0 : 1] : null;
    }
  }
}

export function serialize(doc: SheetDoc): string {
  return JSON.stringify(doc, null, 1);
}

export function parse(json: string): SheetDoc {
  const doc = JSON.parse(json) as SheetDoc;
  if (doc.version !== 1) throw new Error(`unsupported file version ${String(doc.version)}`);
  doc.annotations ??= []; // files written before annotations existed
  doc.partsList ??= [];
  return doc;
}
