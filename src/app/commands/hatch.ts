// HATCH: section hatching per ISO 128-50, by picking points inside closed boundaries.
// Hatches are associative: when an entity of their boundary changes, the region around the picked point is found again.
import { distanceTo, findRegion, midpoint } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import { layerVisible, newId } from '../../model/doc';
import { hatchSheetSegments } from '../../plot';
import type { Entity, Hatch, HatchAssoc, LineTypeId, SheetDoc } from '../../model/types';
import { fmt } from '../input';
import type { CommandContext, CommandGen } from './types';

/** Line types that bound a cut surface: visible edges, thin lines and break-out freehand lines. */
const BOUNDARY_TYPES: ReadonlySet<LineTypeId> = new Set(['visible', 'thin', 'freehand']);

/** Entities that can bound a cut surface in `viewId`, whether or not their layer is visible. */
function boundaryEntities(doc: SheetDoc, viewId: string): Entity[] {
  return doc.entities.filter((e) => e.viewId === viewId && BOUNDARY_TYPES.has(e.lineType));
}

function pointOn(c: Curve): Vec2 {
  return midpoint(c) ?? { x: c.kind === 'circle' ? c.c.x + c.r : 0, y: c.kind === 'circle' ? c.c.y : 0 };
}

/** Fingerprint of the boundary entities; changes when one is edited, retyped or erased, not when its layer is hidden. */
function boundaryKey(doc: SheetDoc, viewId: string, ids: string[]): string {
  const ents = new Map(boundaryEntities(doc, viewId).map((e) => [e.id, e]));
  return JSON.stringify(ids.map((id) => ents.get(id)?.geom ?? null));
}

/**
 * Loops around `seed` (view-local) and the association that lets them follow later edits; null when the
 * point is not enclosed.
 */
export function hatchRegion(doc: SheetDoc, viewId: string, seed: Vec2, includeHidden = false): { loops: Curve[][]; assoc: HatchAssoc } | null {
  const candidates = boundaryEntities(doc, viewId);
  const ents = includeHidden ? candidates : candidates.filter((e) => layerVisible(doc, e.layer));
  const loops = findRegion(ents.map((e) => e.geom), seed);
  if (!loops) return null;
  const tol = 1e-6 * Math.max(1, ...loops.flat().map((c) => Math.hypot(pointOn(c).x, pointOn(c).y)));
  const boundary = ents.filter((e) => loops.some((l) => l.some((c) => distanceTo(e.geom, pointOn(c)) <= tol))).map((e) => e.id);
  return { loops, assoc: { seed, boundary, key: boundaryKey(doc, viewId, boundary) } };
}

/**
 * Re-find the region of every associative hatch whose boundary changed since its loops were found.
 * A hatch whose point is no longer enclosed keeps its last loops and loses its association.
 * Returns the number of hatches that lost it.
 */
export function updateAssociativeHatches(doc: SheetDoc): number {
  let lost = 0;
  for (const h of doc.annotations) {
    if (h.kind !== 'hatch' || !h.assoc) continue;
    if (boundaryKey(doc, h.viewId, h.assoc.boundary) === h.assoc.key) continue;
    const r = hatchRegion(doc, h.viewId, h.assoc.seed, true);
    if (r) {
      h.loops = r.loops;
      h.assoc = r.assoc;
    } else {
      delete h.assoc;
      lost++;
    }
  }
  return lost;
}

export function* hatch(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  let count = 0;
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: `Pick internal point (angle ${fmt(s.hatchAngle, 2)}°, spacing ${fmt(s.hatchSpacing, 2)})`,
      options: [{ key: 'A', label: 'Angle' }, { key: 'S', label: 'Spacing' }],
      allowEnter: true,
    };
    if (r.kind === 'option' && r.key === 'A') {
      const a = yield { kind: 'number', prompt: 'Specify hatch angle', default: s.hatchAngle };
      if (a.kind === 'number') s.hatchAngle = a.value;
      continue;
    }
    if (r.kind === 'option' && r.key === 'S') {
      const d = yield { kind: 'number', prompt: 'Specify hatch line spacing (paper mm)', default: s.hatchSpacing };
      if (d.kind === 'number') {
        if (d.value > 0) s.hatchSpacing = d.value;
        else ctx.log('Spacing must be positive.');
      }
      continue;
    }
    if (r.kind !== 'point') {
      if (count > 0) ctx.log(`${count} hatch(es) created.`);
      return;
    }
    const viewId = s.currentViewId;
    const region = hatchRegion(ctx.doc, viewId, ctx.local(r.p));
    if (!region) {
      ctx.log('No closed boundary found around the point.');
      continue;
    }
    const h: Hatch = { kind: 'hatch', id: newId('a'), viewId, layer: s.layer, loops: region.loops, angle: s.hatchAngle, spacing: s.hatchSpacing, assoc: region.assoc };
    if (hatchSheetSegments(ctx.doc, h).length === 0) {
      ctx.log('Hatch spacing yields no lines in this region; adjust the spacing.');
      continue;
    }
    ctx.doc.annotations.push(h);
    count++;
  }
}
