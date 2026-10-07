// HATCH: section hatching per ISO 128-50, by picking points inside closed boundaries.
// Hatches are associative: when an entity of their boundary changes, the region around the picked point is found again.
// HATCHEDIT changes angle and spacing of existing hatches.
import { dist, distanceTo, findRegion, midpoint, openEnds } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import { layerVisible, newId, toSheet } from '../../model/doc';
import { LINE_TYPES } from '../../model/standards';
import { hatchSheetSegments } from '../../plot';
import type { Entity, Hatch, HatchAssoc, LineTypeId, SheetDoc } from '../../model/types';
import { fmt } from '../input';
import { selectObjects, type CommandContext, type CommandGen, type Option, type Preview, type SubGen } from './types';

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
export function hatchRegion(doc: SheetDoc, viewId: string, seed: Vec2, includeHidden = false, gap = 0): { loops: Curve[][]; assoc: HatchAssoc; bridged: number } | null {
  const candidates = boundaryEntities(doc, viewId);
  const ents = includeHidden ? candidates : candidates.filter((e) => layerVisible(doc, e.layer));
  const curves = ents.map((e) => e.geom);
  let loops = findRegion(curves, seed);
  let bridged = 0;
  if (!loops && gap > 0) {
    const bridges = bridgeGaps(openEnds(curves), gap);
    if (bridges.length > 0) {
      loops = findRegion([...curves, ...bridges], seed);
      bridged = bridges.length;
    }
  }
  if (!loops) return null;
  const tol = 1e-6 * Math.max(1, ...loops.flat().map((c) => Math.hypot(pointOn(c).x, pointOn(c).y)));
  const boundary = ents.filter((e) => loops.some((l) => l.some((c) => distanceTo(e.geom, pointOn(c)) <= tol))).map((e) => e.id);
  const assoc: HatchAssoc = { seed, boundary, key: boundaryKey(doc, viewId, boundary) };
  if (gap > 0) assoc.gap = gap;
  return { loops, assoc, bridged };
}

/** Lines closing pairs of open ends that are at most `gap` apart (nearest pairs first, each end used once). */
export function bridgeGaps(ends: Vec2[], gap: number): Curve[] {
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const d = dist(ends[i], ends[j]);
      if (d > 0 && d <= gap) pairs.push({ i, j, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const used = new Set<number>();
  const out: Curve[] = [];
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    out.push({ kind: 'line', a: ends[i], b: ends[j] });
  }
  return out;
}

/** Why no region was found around `seed`, so the user can fix the drawing instead of guessing. */
export type HatchDiagnosis =
  /** The area closes only with line types that never bound a cut surface (hidden, centre, phantom, construction). */
  | { reason: 'linetype'; types: LineTypeId[] }
  /** The boundary has gaps: the open ends nearest the point (view-local), nearest first, and the smallest gap between two ends (view mm, null when there is only one end). */
  | { reason: 'open'; ends: Vec2[]; smallest: number | null }
  /** Nothing around the point at all. */
  | { reason: 'none' };

export function diagnoseHatch(doc: SheetDoc, viewId: string, seed: Vec2): HatchDiagnosis {
  const visible = doc.entities.filter((e) => e.viewId === viewId && layerVisible(doc, e.layer));
  const all = findRegion(visible.map((e) => e.geom), seed);
  if (all) {
    const tol = 1e-6 * Math.max(1, ...all.flat().map((c) => Math.hypot(pointOn(c).x, pointOn(c).y)));
    const onLoop = visible.filter((e) => all.some((l) => l.some((c) => distanceTo(e.geom, pointOn(c)) <= tol)));
    const types = [...new Set(onLoop.map((e) => e.lineType).filter((t) => !BOUNDARY_TYPES.has(t)))];
    if (types.length > 0) return { reason: 'linetype', types };
  }
  const ends = openEnds(visible.filter((e) => BOUNDARY_TYPES.has(e.lineType)).map((e) => e.geom));
  if (ends.length === 0) return { reason: 'none' };
  return { reason: 'open', ends: ends.sort((a, b) => dist(a, seed) - dist(b, seed)), smallest: smallestGap(ends) };
}

function smallestGap(ends: Vec2[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const d = dist(ends[i], ends[j]);
    if (d > 0 && (best === null || d < best)) best = d;
  }
  return best;
}

/** Message for a diagnosis, naming the repair. */
export function diagnosisMessage(d: HatchDiagnosis): string {
  switch (d.reason) {
    case 'linetype': {
      const names = d.types.map((t) => LINE_TYPES[t].label.toLowerCase()).join(' and ');
      return `The area is closed only by ${names} lines. A cut surface is bounded by visible edges (01.2), thin or freehand lines: change the line type of the outline (select it, then choose the line type) or draw the edge again.`;
    }
    case 'open': {
      const size = d.smallest !== null && d.smallest < 5 ? ` (smallest ${fmt(d.smallest, 2)} mm)` : '';
      return `The boundary is not closed: ${d.ends.length} open end${d.ends.length === 1 ? '' : 's'} marked in red${size}. Close the gap (EXTEND, TRIM, FILLET with radius 0, or redraw with object snap) and pick again, or set a Gap tolerance.`;
    }
    case 'none':
      return 'No boundary around that point. Pick a point inside a closed outline of visible edges.';
  }
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
    const r = hatchRegion(doc, h.viewId, h.assoc.seed, true, h.assoc.gap ?? 0);
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

/** 45° ↔ 135°: the second direction for an adjacent part (ISO 128-50). Other angles are mirrored the same way. */
export function flipAngle(angle: number): number {
  return (((180 - angle) % 180) + 180) % 180;
}

/** Options shared by HATCH and HATCHEDIT, plus a prompt tail showing the current values. */
const STYLE_OPTIONS: Option[] = [{ key: 'A', label: 'Angle' }, { key: 'S', label: 'Spacing' }, { key: 'F', label: 'Flip' }];
const GAP_OPTION: Option = { key: 'G', label: 'Gap' };

/** Handle Angle / Spacing / Flip; returns true when `key` was one of them. */
function* styleOption(ctx: CommandContext, key: string, cur: { angle: number; spacing: number }): SubGen<boolean> {
  if (key === 'A') {
    const a = yield { kind: 'number', prompt: 'Specify hatch angle (45 or 135 for a section, ISO 128-50)', default: cur.angle };
    if (a.kind === 'number') cur.angle = ((a.value % 180) + 180) % 180;
    return true;
  }
  if (key === 'S') {
    const d = yield { kind: 'number', prompt: 'Specify hatch line spacing (paper mm)', default: cur.spacing };
    if (d.kind === 'number') {
      if (d.value > 0) cur.spacing = d.value;
      else ctx.log('Spacing must be positive.');
    }
    return true;
  }
  if (key === 'F') {
    cur.angle = flipAngle(cur.angle);
    ctx.log(`Hatch angle ${fmt(cur.angle, 0)}°.`);
    return true;
  }
  return false;
}

export function* hatch(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  const created: string[] = [];
  /** Open ends shown in red after a failed pick (sheet mm), until the next pick. */
  let ends: Vec2[] = [];
  let last: { seed: Vec2; viewId: string; hatch: Hatch | null } | null = null;
  const regionAt = (p: Vec2): Hatch | null => {
    const viewId = s.currentViewId;
    const seed = ctx.local(p);
    if (last && last.viewId === viewId && dist(last.seed, seed) < 1e-9) return last.hatch;
    const region = hatchRegion(ctx.doc, viewId, seed, false, s.hatchGap);
    const h: Hatch | null = region && { kind: 'hatch', id: 'preview', viewId, layer: s.layer, loops: region.loops, angle: s.hatchAngle, spacing: s.hatchSpacing, assoc: region.assoc };
    last = { seed, viewId, hatch: h };
    return h;
  };
  for (;;) {
    const options = [...STYLE_OPTIONS, GAP_OPTION];
    if (created.length > 0) options.push({ key: 'U', label: 'Undo' });
    const r = yield {
      kind: 'point',
      prompt: `Pick a point inside the area to hatch (angle ${fmt(s.hatchAngle, 0)}°, spacing ${fmt(s.hatchSpacing, 2)}${s.hatchGap > 0 ? `, gap ${fmt(s.hatchGap, 2)}` : ''})`,
      options,
      allowEnter: true,
      preview: (p): Preview => {
        const h = regionAt(p);
        return { annotations: h ? [h] : [], markers: ends };
      },
    };
    if (r.kind === 'option') {
      if (r.key === 'U') {
        const id = created.pop();
        ctx.doc.annotations = ctx.doc.annotations.filter((a) => a.id !== id);
        continue;
      }
      if (r.key === 'G') {
        const g = yield { kind: 'number', prompt: 'Specify gap tolerance (view mm, 0 = boundaries must close exactly)', default: s.hatchGap };
        if (g.kind === 'number') {
          if (g.value >= 0) s.hatchGap = g.value;
          else ctx.log('The gap tolerance must not be negative.');
        }
        last = null;
        continue;
      }
      const cur = { angle: s.hatchAngle, spacing: s.hatchSpacing };
      yield* styleOption(ctx, r.key, cur);
      s.hatchAngle = cur.angle;
      s.hatchSpacing = cur.spacing;
      last = null;
      continue;
    }
    if (r.kind !== 'point') {
      if (created.length > 0) ctx.log(`${created.length} hatch${created.length === 1 ? '' : 'es'} created.`);
      return;
    }
    const viewId = s.currentViewId;
    const seed = ctx.local(r.p);
    const region = hatchRegion(ctx.doc, viewId, seed, false, s.hatchGap);
    if (!region) {
      const d = diagnoseHatch(ctx.doc, viewId, seed);
      const view = ctx.viewOf(viewId);
      ends = d.reason === 'open' ? d.ends.map((p) => toSheet(view, p)) : [];
      ctx.log(diagnosisMessage(d));
      continue;
    }
    ends = [];
    const h: Hatch = { kind: 'hatch', id: newId('a'), viewId, layer: s.layer, loops: region.loops, angle: s.hatchAngle, spacing: s.hatchSpacing, assoc: region.assoc };
    if (hatchSheetSegments(ctx.doc, h).length === 0) {
      ctx.log('Hatch spacing yields no lines in this region; adjust the spacing.');
      continue;
    }
    ctx.doc.annotations.push(h);
    created.push(h.id);
    if (region.bridged > 0) ctx.log(`${region.bridged} gap${region.bridged === 1 ? '' : 's'} bridged (tolerance ${fmt(s.hatchGap, 2)} mm); the outline itself is still open.`);
  }
}

/** HATCHEDIT: change angle and spacing of selected hatches (the current settings follow the last edit). */
export function* hatchedit(ctx: CommandContext): CommandGen {
  const ids = new Set(yield* selectObjects(ctx, 'Select hatches'));
  const hatches = ctx.doc.annotations.filter((a): a is Hatch => a.kind === 'hatch' && ids.has(a.id));
  if (hatches.length === 0) {
    ctx.log(ids.size > 0 ? 'No hatch in the selection.' : 'Nothing selected.');
    return;
  }
  const cur = { angle: hatches[0].angle, spacing: hatches[0].spacing };
  for (;;) {
    const r = yield {
      kind: 'text',
      prompt: `${hatches.length} hatch${hatches.length === 1 ? '' : 'es'}: angle ${fmt(cur.angle, 0)}°, spacing ${fmt(cur.spacing, 2)}. Enter an option or <done>`,
      options: STYLE_OPTIONS,
      allowEnter: true,
    };
    if (r.kind !== 'option') break;
    yield* styleOption(ctx, r.key, cur);
    for (const h of hatches) {
      h.angle = cur.angle;
      h.spacing = cur.spacing;
    }
  }
  ctx.settings.hatchAngle = cur.angle;
  ctx.settings.hatchSpacing = cur.spacing;
}
