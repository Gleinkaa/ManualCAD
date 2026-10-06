// Curve conversion between view-local real mm and sheet mm (uniform scale + translation keeps angles).
import type { Curve, Vec2 } from '../geom/types';
import { getView, toLocal, toSheet } from '../model/doc';
import type { Entity, SheetDoc, View } from '../model/types';

function mapCurve(c: Curve, f: (p: Vec2) => Vec2, s: number): Curve {
  switch (c.kind) {
    case 'line':
      return { kind: 'line', a: f(c.a), b: f(c.b) };
    case 'circle':
      return { kind: 'circle', c: f(c.c), r: c.r * s };
    case 'arc':
      return { kind: 'arc', c: f(c.c), r: c.r * s, start: c.start, end: c.end };
  }
}

export function curveToSheet(view: View, c: Curve): Curve {
  return mapCurve(c, (p) => toSheet(view, p), view.scale);
}

export function curveToLocal(view: View, c: Curve): Curve {
  return mapCurve(c, (p) => toLocal(view, p), 1 / view.scale);
}

export function entitySheetCurve(doc: SheetDoc, e: Entity): Curve {
  return curveToSheet(getView(doc, e.viewId), e.geom);
}

export function visibleEntities(doc: SheetDoc): Entity[] {
  const hidden = new Set(doc.layers.filter((l) => !l.visible).map((l) => l.name));
  return doc.entities.filter((e) => !hidden.has(e.layer));
}

export function layerVisible(doc: SheetDoc, name: string): boolean {
  return doc.layers.find((l) => l.name === name)?.visible ?? true;
}
