import { describe, expect, it } from 'vitest';
import { newSheet, toSheet } from '../model/doc';
import type { SheetDoc } from '../model/types';
import type { Curve } from '../geom/types';
import { findSnap } from './snap';

function docWith(...curves: Curve[]): SheetDoc {
  const doc = newSheet();
  curves.forEach((geom, i) => doc.entities.push({ id: `e${i}`, viewId: 'v-front', layer: '0', lineType: 'visible', geom }));
  return doc;
}

const at = (doc: SheetDoc, x: number, y: number) => toSheet(doc.views[0], { x, y });

describe('findSnap priority', () => {
  it('prefers the corner endpoint over the closer midpoint of a small chamfer', () => {
    const doc = docWith(
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 89, y: 0 } },
      { kind: 'line', a: { x: 89, y: 0 }, b: { x: 90, y: 1 } },
      { kind: 'line', a: { x: 90, y: 1 }, b: { x: 90, y: 50 } },
    );
    const hit = findSnap(doc, at(doc, 89.7, 0.7), 2, null);
    expect(hit?.kind).toBe('endpoint');
    expect(hit?.point).toEqual(at(doc, 90, 1));
    expect(hit?.anchor).not.toBeNull();
  });

  it('prefers an intersection over a closer midpoint', () => {
    const doc = docWith(
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { kind: 'line', a: { x: 1.8, y: -5 }, b: { x: 1.8, y: 5 } },
    );
    const hit = findSnap(doc, at(doc, 1.1, 0), 1.5, null);
    expect(hit?.kind).toBe('endpoint');
    const hit2 = findSnap(doc, at(doc, 1.2, 0.1), 0.75, null);
    expect(hit2?.kind).toBe('intersection');
    expect(hit2?.point.x).toBeCloseTo(at(doc, 1.8, 0).x);
  });

  it('still snaps a lone midpoint and breaks ties by distance', () => {
    const doc = docWith({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(findSnap(doc, at(doc, 50.5, 0.3), 2, null)?.kind).toBe('midpoint');
    expect(findSnap(doc, at(doc, 99, 0), 2, null)?.point).toEqual(at(doc, 100, 0));
  });

  it('nearest only when nothing better is in the aperture', () => {
    const doc = docWith({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(findSnap(doc, at(doc, 20, 0.5), 2, null)?.kind).toBe('nearest');
  });

  it('offers the far perpendicular foot on a circle too', () => {
    const doc = docWith({ kind: 'circle', c: { x: 150, y: 30 }, r: 20 });
    const from = at(doc, 100, 40);
    // far foot: centre + r * unit(centre - from)
    const u = { x: 50 / Math.hypot(50, 10), y: -10 / Math.hypot(50, 10) };
    const far = { x: 150 + 20 * u.x, y: 30 + 20 * u.y };
    const hit = findSnap(doc, at(doc, far.x + 0.3, far.y + 0.2), 2, from);
    expect(hit?.kind).toBe('perpendicular');
    expect(hit?.point.x).toBeCloseTo(at(doc, far.x, far.y).x, 6);
    expect(hit?.point.y).toBeCloseTo(at(doc, far.x, far.y).y, 6);
  });
});
