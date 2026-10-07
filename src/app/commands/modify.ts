// Modify commands: OFFSET, TRIM, EXTEND, FILLET, CHAMFER, MOVE, COPY, MIRROR, ROTATE, SCALE, ERASE.
import { chamfer as geomChamfer, distanceTo, intersect, extend as geomExtend, fillet as geomFillet, mirror as geomMirror, offset as geomOffset, rotate as geomRotate, scaleCurve, translate, trim as geomTrim } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import { mirrorAnnotation, remapHatchBoundary, rotateAnnotation, rotatePoint, scaleAnnotation, scalePoint, translateAnnotation } from '../../model/annot';
import { dimensionAnchors, newId, resolveAnchor, toSheet } from '../../model/doc';
import type { Annotation, AnchorPoint, DimAnchor, Dimension, Entity, LinearDimension } from '../../model/types';
import { fmt } from '../input';
import { visibleEntities } from '../xform';
import { selectObjects, type CommandContext, type CommandGen, type Preview, type SubGen } from './types';

const EXIT = { key: 'E', label: 'Exit' };

export function* offset(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  const r0 = yield {
    kind: 'number',
    prompt: 'Specify offset distance',
    options: [{ key: 'T', label: 'Through' }],
    default: s.offsetDistance ?? undefined,
  };
  if (r0.kind === 'option') s.offsetDistance = null;
  else if (r0.kind === 'number') {
    if (r0.value <= 0) {
      ctx.log('Distance must be positive.');
      return;
    }
    s.offsetDistance = r0.value;
  } else if (r0.kind !== 'enter') return;

  for (;;) {
    const pick = yield { kind: 'entity', prompt: 'Select object to offset', options: [EXIT], allowEnter: true };
    if (pick.kind !== 'entity') return;
    const src = ctx.entity(pick.id);
    if (!src) continue;
    const view = src.viewId;
    const make = (p: Vec2): Curve | null => {
      const lp = ctx.localIn(view, p);
      const d = s.offsetDistance ?? distanceTo(src.geom, lp);
      return d > 0 ? geomOffset(src.geom, d, lp) : null;
    };
    const side = yield {
      kind: 'point',
      prompt: s.offsetDistance === null ? 'Specify through point' : 'Specify point on side to offset',
      preview: (p): Preview => {
        const c = make(p);
        return c ? { curves: [{ curve: c, lineType: src.lineType, viewId: view }] } : {};
      },
    };
    if (side.kind !== 'point') return;
    const c = make(side.p);
    if (c) ctx.addEntity(c, { viewId: view, layer: src.layer, lineType: src.lineType });
    else ctx.log('Cannot offset that object.');
  }
}

/** Fence points (sheet mm), AutoCAD style: first point, next points with Undo, Enter to finish. */
function* fencePoints(ctx: CommandContext): SubGen<Vec2[] | null> {
  const pts: Vec2[] = [];
  const segs = (extra: Vec2 | null): Preview => {
    const all = extra ? [...pts, extra] : pts;
    const curves = [];
    for (let i = 0; i + 1 < all.length; i++) curves.push({ curve: { kind: 'line' as const, a: ctx.local(all[i]), b: ctx.local(all[i + 1]) }, lineType: 'thin' as const });
    return { curves };
  };
  for (;;) {
    const r = yield pts.length === 0
      ? { kind: 'point', prompt: 'Specify first fence point', allowEnter: true }
      : {
          kind: 'point',
          prompt: 'Specify next fence point',
          options: pts.length > 1 ? [{ key: 'U', label: 'Undo' }] : [],
          allowEnter: true,
          base: pts[pts.length - 1],
          preview: (p: Vec2) => segs(p),
        };
    if (r.kind === 'point') pts.push(r.p);
    else if (r.kind === 'option') pts.pop();
    else if (r.kind === 'enter') return pts.length > 1 ? pts : null;
    else return null;
  }
}

/** Points (sheet mm) where the fence crosses visible entities, in fence order. */
function fenceCrossings(ctx: CommandContext, fence: Vec2[]): { id: string; p: Vec2 }[] {
  const out: { id: string; p: Vec2; t: number }[] = [];
  for (let i = 0; i + 1 < fence.length; i++) {
    const seg: Curve = { kind: 'line', a: fence[i], b: fence[i + 1] };
    const dx = fence[i + 1].x - fence[i].x;
    const dy = fence[i + 1].y - fence[i].y;
    for (const e of visibleEntities(ctx.doc)) {
      for (const p of intersect(seg, ctx.sheetCurve(e))) {
        out.push({ id: e.id, p, t: i + ((p.x - fence[i].x) * dx + (p.y - fence[i].y) * dy) / (dx * dx + dy * dy || 1) });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Shared by TRIM and EXTEND: edge selection (Enter = all), then repeated picks or a Fence. */
function* edgeEdit(ctx: CommandContext, mode: 'trim' | 'extend'): CommandGen {
  ctx.log(mode === 'trim' ? 'Select cutting edges ...' : 'Select boundary edges ...');
  let edges: string[];
  if (ctx.preselection.length > 0) {
    edges = ctx.preselection;
    ctx.preselection = [];
  } else {
    const r = yield { kind: 'selection', prompt: 'Select objects or <select all>' };
    if (r.kind !== 'selection') return;
    edges = r.ids;
  }
  const all = edges.length === 0;

  /** Trim/extend `target` at the sheet point `p`; returns ids of new pieces, or null if nothing happened. */
  const apply = (target: Entity, p: Vec2, quiet: boolean): string[] | null => {
    const edgeIds = all ? visibleEntities(ctx.doc).map((e) => e.id) : edges;
    const cutters = edgeIds
      .filter((id) => id !== target.id)
      .map((id) => ctx.entity(id))
      .filter((e): e is Entity => !!e)
      .map((e) => ctx.curveIn(e, target.viewId));
    const lp = ctx.localIn(target.viewId, p);
    if (mode === 'trim') {
      const pieces = geomTrim(target.geom, lp, cutters);
      if (!pieces) {
        if (!quiet) ctx.log('Object does not intersect a cutting edge.');
        return null;
      }
      if (pieces.length === 0) {
        eraseIds(ctx, [target.id]);
        return [];
      }
      target.geom = pieces[0];
      return pieces.slice(1).map((c) => ctx.addEntity(c, { viewId: target.viewId, layer: target.layer, lineType: target.lineType }).id);
    }
    const c = geomExtend(target.geom, lp, cutters);
    if (!c) {
      if (!quiet) ctx.log('Object does not intersect a boundary edge.');
      return null;
    }
    target.geom = c;
    return [];
  };

  for (;;) {
    const pick = yield {
      kind: 'entity',
      prompt: mode === 'trim' ? 'Select object to trim' : 'Select object to extend',
      options: [{ key: 'F', label: 'Fence' }],
      allowEnter: true,
    };
    if (pick.kind === 'option') {
      const fence = yield* fencePoints(ctx);
      if (!fence) continue;
      // pieces split off a trimmed entity stay candidates for later crossings of the same entity
      const family = new Map<string, string[]>();
      const done = new Set<string>();
      let n = 0;
      for (const { id, p } of fenceCrossings(ctx, fence)) {
        if (mode === 'extend' && done.has(id)) continue;
        const ids = family.get(id) ?? [id];
        const target = ids
          .map((x) => ctx.entity(x))
          .find((e): e is Entity => !!e && distanceTo(ctx.sheetCurve(e), p) <= 1e-6);
        if (!target) continue;
        const added = apply(target, p, true);
        if (!added) continue;
        n++;
        done.add(id);
        family.set(id, [...ids, ...added]);
      }
      ctx.log(n ? `${n} object(s) ${mode === 'trim' ? 'trimmed' : 'extended'}.` : 'Fence does not cross anything to ' + mode + '.');
      continue;
    }
    if (pick.kind !== 'entity') return;
    const target = ctx.entity(pick.id);
    if (target) apply(target, pick.p, false);
  }
}

export function trim(ctx: CommandContext): CommandGen {
  return edgeEdit(ctx, 'trim');
}

export function extend(ctx: CommandContext): CommandGen {
  return edgeEdit(ctx, 'extend');
}

/** Pick two entities of the same view, with option handling delegated to `onOption`. */
function* pickPair(
  ctx: CommandContext,
  firstPrompt: string,
  options: { key: string; label: string }[],
  onOption: (key: string) => SubGen<void>,
): SubGen<{ a: Entity; pa: Vec2; b: Entity; pb: Vec2 } | null> {
  let first: { e: Entity; p: Vec2 } | null = null;
  while (!first) {
    const r = yield { kind: 'entity', prompt: firstPrompt, options };
    if (r.kind === 'option') {
      yield* onOption(r.key);
      continue;
    }
    if (r.kind !== 'entity') return null;
    const e = ctx.entity(r.id);
    if (e) first = { e, p: r.p };
  }
  for (;;) {
    const r = yield { kind: 'entity', prompt: 'Select second object', filter: (e) => e.id !== first.e.id };
    if (r.kind !== 'entity') return null;
    const b = ctx.entity(r.id);
    if (!b) continue;
    if (b.viewId !== first.e.viewId) {
      ctx.log('Both objects must be in the same view.');
      continue;
    }
    return { a: first.e, pa: ctx.localIn(b.viewId, first.p), b, pb: ctx.localIn(b.viewId, r.p) };
  }
}

export function* fillet(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  ctx.log(`Current settings: Mode = TRIM, Radius = ${fmt(s.filletRadius, 4)}`);
  const pair = yield* pickPair(ctx, 'Select first object', [{ key: 'R', label: 'Radius' }], function* () {
    const r = yield { kind: 'number', prompt: 'Specify fillet radius', default: s.filletRadius };
    if (r.kind === 'number') {
      if (r.value < 0) ctx.log('Radius must not be negative.');
      else s.filletRadius = r.value;
    }
  });
  if (!pair) return;
  const res = geomFillet(pair.a.geom, pair.pa, pair.b.geom, pair.pb, s.filletRadius);
  if (!res) {
    ctx.log('Cannot fillet these objects with that radius.');
    return;
  }
  pair.a.geom = res.a;
  pair.b.geom = res.b;
  if (res.arc) ctx.addEntity(res.arc, { viewId: pair.a.viewId, layer: pair.a.layer, lineType: pair.a.lineType });
}

export function* chamfer(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  ctx.log(`(TRIM mode) Current chamfer Dist1 = ${fmt(s.chamferA, 4)}, Dist2 = ${fmt(s.chamferB, 4)}`);
  const pair = yield* pickPair(ctx, 'Select first line', [{ key: 'D', label: 'Distance' }], function* () {
    const a = yield { kind: 'number', prompt: 'Specify first chamfer distance', default: s.chamferA };
    if (a.kind !== 'number' || a.value < 0) return;
    const b = yield { kind: 'number', prompt: 'Specify second chamfer distance', default: a.value };
    if (b.kind !== 'number' || b.value < 0) return;
    s.chamferA = a.value;
    s.chamferB = b.value;
  });
  if (!pair) return;
  const res = geomChamfer(pair.a.geom, pair.pa, pair.b.geom, pair.pb, s.chamferA, s.chamferB);
  if (!res) {
    ctx.log('Cannot chamfer these objects with those distances.');
    return;
  }
  pair.a.geom = res.a;
  pair.b.geom = res.b;
  if (s.chamferA > 0 || s.chamferB > 0) ctx.addEntity(res.line, { viewId: pair.a.viewId, layer: pair.a.layer, lineType: pair.a.lineType });
}

// --- move / copy / mirror / erase ---

export function splitIds(ctx: CommandContext, ids: string[]): { ents: Entity[]; dims: Dimension[]; annots: Annotation[] } {
  const set = new Set(ids);
  return {
    ents: ctx.doc.entities.filter((e) => set.has(e.id)),
    dims: ctx.doc.dimensions.filter((d) => set.has(d.id)),
    annots: ctx.doc.annotations.filter((a) => set.has(a.id)),
  };
}

/** Sheet displacement → view-local displacement of `viewId`. */
function localDelta(ctx: CommandContext, viewId: string, d: Vec2): Vec2 {
  const s = ctx.viewOf(viewId).scale;
  return { x: d.x / s, y: d.y / s };
}

function ghost(ctx: CommandContext, ents: Entity[], d: Vec2, annots: Annotation[] = []): Preview {
  return {
    curves: ents.map((e) => ({ curve: translate(e.geom, localDelta(ctx, e.viewId, d)), lineType: e.lineType, viewId: e.viewId })),
    annotations: annots.map((a) => translateAnnotation(a, localDelta(ctx, a.viewId, d))),
  };
}

function* baseAndSecond(ctx: CommandContext, ents: Entity[], annots: Annotation[]): SubGen<{ base: Vec2; to: Vec2 } | null> {
  const b = yield { kind: 'point', prompt: 'Specify base point' };
  if (b.kind !== 'point') return null;
  const t = yield {
    kind: 'point',
    prompt: 'Specify second point or <use first point as displacement>',
    allowEnter: true,
    base: b.p,
    preview: (p) => ghost(ctx, ents, { x: p.x - b.p.x, y: p.y - b.p.y }, annots),
  };
  if (t.kind === 'enter') {
    // AutoCAD: the base point read as a displacement (in current-view mm) from the origin.
    const v = ctx.view();
    return { base: v.origin, to: { x: v.origin.x + ctx.local(b.p).x * v.scale, y: v.origin.y + ctx.local(b.p).y * v.scale } };
  }
  if (t.kind !== 'point') return null;
  return { base: b.p, to: t.p };
}

function shiftAnchor(ctx: CommandContext, a: DimAnchor, viewId: string, d: Vec2, moved: Set<string>): void {
  if (a.ref && moved.has(a.ref.entityId)) return;
  const p = resolveAnchor(ctx.doc, a);
  const ld = localDelta(ctx, viewId, d);
  a.ref = null;
  a.fallback = { x: p.x + ld.x, y: p.y + ld.y };
}

export function* move(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  if (ids.length === 0) return;
  const { ents, dims, annots } = splitIds(ctx, ids);
  const r = yield* baseAndSecond(ctx, ents, annots);
  if (!r) return;
  translateSelection(ctx, { ents, dims, annots }, { x: r.to.x - r.base.x, y: r.to.y - r.base.y });
}

/** Move a selection in place by the sheet displacement `d` (MOVE and the grip Move mode). */
export function translateSelection(ctx: CommandContext, { ents, dims, annots }: Selection, d: Vec2): void {
  const moved = new Set(ents.map((e) => e.id));
  const inPlace = new Map(ents.map((e) => [e.id, e.id]));
  for (const e of ents) e.geom = translate(e.geom, localDelta(ctx, e.viewId, d));
  for (const a of annots) {
    const m = remapHatchBoundary(translateAnnotation(a, localDelta(ctx, a.viewId, d)), inPlace);
    if (a.kind === 'hatch' && m.kind === 'hatch' && !m.assoc) delete a.assoc;
    Object.assign(a, m);
  }
  for (const dim of dims) for (const an of dimensionAnchors(dim)) shiftAnchor(ctx, an, dim.viewId, d, moved);
}

/** Ghost of a selection moved by `d` (sheet mm). */
export function translateGhost(ctx: CommandContext, { ents, annots }: Selection, d: Vec2): Preview {
  return ghost(ctx, ents, d, annots);
}

function copyAnchor(ctx: CommandContext, a: DimAnchor, viewId: string, d: Vec2, map: Map<string, string>): DimAnchor {
  const p = resolveAnchor(ctx.doc, a);
  const mapped = a.ref ? map.get(a.ref.entityId) : undefined;
  const ld = localDelta(ctx, viewId, d);
  return { ref: mapped && a.ref ? { entityId: mapped, point: a.ref.point } : null, fallback: { x: p.x + ld.x, y: p.y + ld.y } };
}

export function* copy(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  if (ids.length === 0) return;
  const { ents, dims, annots } = splitIds(ctx, ids);
  const b = yield { kind: 'point', prompt: 'Specify base point' };
  if (b.kind !== 'point') return;
  for (;;) {
    const t = yield {
      kind: 'point',
      prompt: 'Specify second point',
      options: [EXIT],
      allowEnter: true,
      base: b.p,
      preview: (p) => ghost(ctx, ents, { x: p.x - b.p.x, y: p.y - b.p.y }, annots),
    };
    if (t.kind !== 'point') return;
    copySelection(ctx, { ents, dims, annots }, { x: t.p.x - b.p.x, y: t.p.y - b.p.y });
  }
}

/** Copies of a selection displaced by `d` (sheet mm), ids remapped so copied dimensions follow copied entities. */
export function copySelection(ctx: CommandContext, { ents, dims, annots }: Selection, d: Vec2): Selection {
  const out: Selection = { ents: [], dims: [], annots: [] };
  const map = new Map<string, string>();
  for (const e of ents) {
    const c = ctx.addEntity(translate(e.geom, localDelta(ctx, e.viewId, d)), { viewId: e.viewId, layer: e.layer, lineType: e.lineType });
    map.set(e.id, c.id);
    out.ents.push(c);
  }
  for (const a of annots) {
    const copy = { ...remapHatchBoundary(translateAnnotation(structuredClone(a), localDelta(ctx, a.viewId, d)), map), id: newId('a') };
    ctx.doc.annotations.push(copy);
    out.annots.push(copy);
  }
  for (const dim of dims) {
    const cp = (an: DimAnchor) => copyAnchor(ctx, an, dim.viewId, d, map);
    let c: Dimension | null = null;
    if (dim.kind === 'linear') c = { ...structuredClone(dim), id: newId('d'), a: cp(dim.a), b: cp(dim.b) };
    else if (dim.kind === 'angular') {
      c = { ...structuredClone(dim), id: newId('d'), leg1: { a: cp(dim.leg1.a), b: cp(dim.leg1.b) }, leg2: { a: cp(dim.leg2.a), b: cp(dim.leg2.b) } };
    } else {
      const target = map.get(dim.entityId);
      if (target) c = { ...structuredClone(dim), id: newId('d'), entityId: target };
    }
    if (c) {
      ctx.doc.dimensions.push(c);
      out.dims.push(c);
    }
  }
  return out;
}

function mirrorPt(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return p;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const f = { x: a.x + t * dx, y: a.y + t * dy };
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
}

/** Unit normal along which a linear dimension's offset is measured (see dim/plotLinear). */
function dimNormal(orientation: LinearDimension['orientation'], A: Vec2, B: Vec2): Vec2 {
  if (orientation === 'horizontal') return { x: 0, y: 1 };
  if (orientation === 'vertical') return { x: 1, y: 0 };
  const l = Math.hypot(B.x - A.x, B.y - A.y);
  return l < 1e-12 ? { x: 0, y: 1 } : { x: -(B.y - A.y) / l, y: (B.x - A.x) / l };
}

/**
 * Mirror of `dim` across the sheet line a-b. `idMap` maps mirrored entity ids to the ids of their mirror images
 * (the same id when mirrored in place); anchors on other entities are frozen at their mirrored position.
 */
function mirrorDim(ctx: CommandContext, dim: Dimension, a: Vec2, b: Vec2, idMap: Map<string, string>): Dimension | null {
  const view = ctx.viewOf(dim.viewId);
  const isArc = (id: string) => ctx.entity(id)?.geom.kind === 'arc';
  if (dim.kind !== 'linear' && dim.kind !== 'angular') {
    const target = idMap.get(dim.entityId);
    if (!target) return null;
    const phi = Math.atan2(b.y - a.y, b.x - a.x);
    return { ...structuredClone(dim), entityId: target, angle: 2 * phi - dim.angle };
  }
  const la = ctx.localIn(dim.viewId, a);
  const lb = ctx.localIn(dim.viewId, b);
  const anchor = (an: DimAnchor): DimAnchor => {
    const p = mirrorPt(resolveAnchor(ctx.doc, an), la, lb);
    const target = an.ref ? idMap.get(an.ref.entityId) : undefined;
    if (!an.ref || !target) return { ref: null, fallback: p };
    // a mirrored arc runs the other way round: its start is the image of the old end
    const swap: Record<string, AnchorPoint> = { start: 'end', end: 'start' };
    const point = isArc(an.ref.entityId) ? (swap[an.ref.point] ?? an.ref.point) : an.ref.point;
    return { ref: { entityId: target, point }, fallback: p };
  };
  // The senses stay valid: each leg direction is mirrored together with its anchors.
  if (dim.kind === 'angular') {
    return { ...structuredClone(dim), leg1: { a: anchor(dim.leg1.a), b: anchor(dim.leg1.b) }, leg2: { a: anchor(dim.leg2.a), b: anchor(dim.leg2.b) } };
  }
  const A = toSheet(view, resolveAnchor(ctx.doc, dim.a));
  const B = toSheet(view, resolveAnchor(ctx.doc, dim.b));
  const n = dimNormal(dim.orientation, A, B);
  const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const D = mirrorPt({ x: M.x + n.x * dim.offset, y: M.y + n.y * dim.offset }, a, b);
  let orientation = dim.orientation;
  if (orientation !== 'aligned') {
    const deg = (((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180 + 180) % 180;
    if (Math.abs(deg - 45) < 1e-6 || Math.abs(deg - 135) < 1e-6) orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  }
  const A2 = mirrorPt(A, a, b);
  const B2 = mirrorPt(B, a, b);
  const n2 = dimNormal(orientation, A2, B2);
  const M2 = { x: (A2.x + B2.x) / 2, y: (A2.y + B2.y) / 2 };
  return {
    ...structuredClone(dim),
    orientation,
    a: anchor(dim.a),
    b: anchor(dim.b),
    offset: (D.x - M2.x) * n2.x + (D.y - M2.y) * n2.y,
  };
}

/**
 * Dimensions that go along with mirrored entities: the selected ones plus those whose every anchor is on a
 * mirrored entity (they would otherwise be left behind on the source).
 */
function dimsToMirror(ctx: CommandContext, selected: Dimension[], ents: Entity[]): Dimension[] {
  const ids = new Set(ents.map((e) => e.id));
  const out = [...selected];
  for (const d of ctx.doc.dimensions) {
    if (out.includes(d)) continue;
    const follows =
      d.kind === 'radius' || d.kind === 'diameter' ? ids.has(d.entityId) : dimensionAnchors(d).every((an) => !!an.ref && ids.has(an.ref.entityId));
    if (follows) out.push(d);
  }
  return out;
}

export function* mirror(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  const { ents, dims: selectedDims, annots } = splitIds(ctx, ids);
  if (ents.length === 0 && selectedDims.length === 0 && annots.length === 0) return;
  const sel = { ents, dims: selectedDims, annots };
  const a = yield { kind: 'point', prompt: 'Specify first point of mirror line' };
  if (a.kind !== 'point') return;
  const b = yield {
    kind: 'point',
    prompt: 'Specify second point of mirror line',
    base: a.p,
    preview: (p) => mirrorGhost(ctx, sel, a.p, p),
  };
  if (b.kind !== 'point') return;
  if (b.p.x === a.p.x && b.p.y === a.p.y) {
    ctx.log('The mirror line needs two different points.');
    return;
  }
  const yn = yield { kind: 'text', prompt: 'Erase source objects? [Yes/No]', default: 'N' };
  applyMirror(ctx, sel, a.p, b.p, yn.kind === 'text' && /^y/i.test(yn.text.trim()));
}

/** Ghost of a selection mirrored across the sheet line a-b; empty while the two points coincide. */
export function mirrorGhost(ctx: CommandContext, { ents, dims: selectedDims, annots }: Selection, a: Vec2, p: Vec2): Preview {
  if (p.x === a.x && p.y === a.y) return {};
  const dims = dimsToMirror(ctx, selectedDims, ents);
  return {
    curves: ents.map((e) => ({ curve: geomMirror(e.geom, ctx.localIn(e.viewId, a), ctx.localIn(e.viewId, p)), lineType: e.lineType, viewId: e.viewId })),
    dims: dims
      .filter((d) => d.kind === 'linear' || d.kind === 'angular')
      .map((d) => mirrorDim(ctx, d, a, p, new Map()))
      .filter((d): d is Dimension => !!d),
    annotations: annots.map((x) => mirrorAnnotation(x, ctx.localIn(x.viewId, a), ctx.localIn(x.viewId, p))),
  };
}

/** Mirror a selection across the sheet line a-b, in place (`erase`) or as copies. */
export function applyMirror(ctx: CommandContext, { ents, dims: selectedDims, annots }: Selection, a: { x: number; y: number }, bp: Vec2, erase: boolean): void {
  const dims = dimsToMirror(ctx, selectedDims, ents);
  const make = (p: Vec2) => ents.map((e) => ({ e, curve: geomMirror(e.geom, ctx.localIn(e.viewId, a), ctx.localIn(e.viewId, p)) }));
  const b = { p: bp };
  const idMap = new Map<string, string>();
  const curves = make(b.p);
  if (erase) for (const e of ents) idMap.set(e.id, e.id);
  else for (const { e, curve } of curves) idMap.set(e.id, ctx.addEntity(curve, { viewId: e.viewId, layer: e.layer, lineType: e.lineType }).id);
  // dimension images are computed from the source geometry, before it is replaced in place
  const mirrored = dims.map((d) => ({ d, m: mirrorDim(ctx, d, a, b.p, idMap) }));
  if (erase) for (const { e, curve } of curves) e.geom = curve;
  for (const { d, m } of mirrored) {
    if (!m) continue;
    if (erase) Object.assign(d, m);
    else ctx.doc.dimensions.push({ ...m, id: newId('d') });
  }
  for (const x of annots) {
    const m = remapHatchBoundary(mirrorAnnotation(structuredClone(x), ctx.localIn(x.viewId, a), ctx.localIn(x.viewId, b.p)), idMap);
    if (erase) {
      if (x.kind === 'hatch' && m.kind === 'hatch' && !m.assoc) delete x.assoc;
      Object.assign(x, m);
    }
    else ctx.doc.annotations.push({ ...m, id: newId('a') });
  }
}

// --- rotate / scale ---

/** A rotation or a scaling about a view-local point, as applied to curves, annotations and points. */
interface Similarity {
  curve(c: Curve, about: Vec2): Curve;
  annot(a: Annotation, about: Vec2): Annotation;
  point(p: Vec2, about: Vec2): Vec2;
  /** Change of a radial dimension's line direction (radians). */
  dAngle: number;
}

export const rotation = (angle: number): Similarity => ({
  curve: (c, about) => geomRotate(c, about, angle),
  annot: (a, about) => rotateAnnotation(a, about, angle),
  point: (p, about) => rotatePoint(p, about, angle),
  dAngle: angle,
});

export const scaling = (factor: number): Similarity => ({
  curve: (c, about) => scaleCurve(c, about, factor),
  annot: (a, about) => scaleAnnotation(a, about, factor),
  point: (p, about) => scalePoint(p, about, factor),
  dAngle: 0,
});

export type Selection = ReturnType<typeof splitIds>;

/**
 * Image of `dim` under the transform. `map` maps transformed entity ids to their images (themselves when
 * transformed in place); anchors on other entities are frozen at their transformed position. In place, a radial
 * dimension stays on its entity even when that was not selected; as a copy it needs a copied entity.
 */
function xformDim(ctx: CommandContext, dim: Dimension, map: Map<string, string>, pt: (p: Vec2) => Vec2, dAngle: number, inPlace: boolean): Dimension | null {
  const anchor = (an: DimAnchor): DimAnchor => {
    const p = resolveAnchor(ctx.doc, an);
    const target = an.ref ? map.get(an.ref.entityId) : undefined;
    return { ref: target && an.ref ? { entityId: target, point: an.ref.point } : null, fallback: pt(p) };
  };
  if (dim.kind === 'linear') return { ...structuredClone(dim), a: anchor(dim.a), b: anchor(dim.b) };
  if (dim.kind === 'angular') {
    return { ...structuredClone(dim), leg1: { a: anchor(dim.leg1.a), b: anchor(dim.leg1.b) }, leg2: { a: anchor(dim.leg2.a), b: anchor(dim.leg2.b) } };
  }
  const target = map.get(dim.entityId) ?? (inPlace ? dim.entityId : undefined);
  if (!target) return null;
  return { ...structuredClone(dim), entityId: target, angle: dim.angle + dAngle };
}

export function similarityGhost(ctx: CommandContext, sel: Selection, base: Vec2, x: Similarity): Preview {
  const about = (viewId: string) => ctx.localIn(viewId, base);
  return {
    curves: sel.ents.map((e) => ({ curve: x.curve(e.geom, about(e.viewId)), lineType: e.lineType, viewId: e.viewId })),
    annotations: sel.annots.map((a) => x.annot(a, about(a.viewId))),
    // radial dims are drawn from their entity, which the ghost does not replace
    dims: sel.dims
      .filter((d) => d.kind === 'linear' || d.kind === 'angular')
      .map((d) => xformDim(ctx, d, new Map(), (p) => x.point(p, about(d.viewId)), x.dAngle, true))
      .filter((d): d is Dimension => !!d),
  };
}

/** Apply the transform about the sheet point `base`, in place or as copies (ids remapped like COPY). */
export function applySimilarity(ctx: CommandContext, sel: Selection, base: Vec2, x: Similarity, copyMode: boolean): void {
  const about = (viewId: string) => ctx.localIn(viewId, base);
  const map = new Map<string, string>();
  const images = sel.ents.map((e) => ({ e, curve: x.curve(e.geom, about(e.viewId)) }));
  if (copyMode) for (const { e, curve } of images) map.set(e.id, ctx.addEntity(curve, { viewId: e.viewId, layer: e.layer, lineType: e.lineType }).id);
  else for (const e of sel.ents) map.set(e.id, e.id);
  // dimension images are computed from the source geometry, before it is replaced in place
  const dims = sel.dims.map((d) => ({ d, m: xformDim(ctx, d, map, (p) => x.point(p, about(d.viewId)), x.dAngle, !copyMode) }));
  if (!copyMode) for (const { e, curve } of images) e.geom = curve;
  for (const { d, m } of dims) {
    if (!m) continue;
    if (copyMode) ctx.doc.dimensions.push({ ...m, id: newId('d') });
    else Object.assign(d, m);
  }
  for (const a of sel.annots) {
    const m = remapHatchBoundary(x.annot(copyMode ? structuredClone(a) : a, about(a.viewId)), map);
    if (copyMode) ctx.doc.annotations.push({ ...m, id: newId('a') });
    else {
      if (a.kind === 'hatch' && m.kind === 'hatch' && !m.assoc) delete a.assoc;
      Object.assign(a, m);
    }
  }
}

const COPY_OPT = { key: 'C', label: 'Copy' };
const REFERENCE_OPT = { key: 'R', label: 'Reference' };
const DEG = Math.PI / 180;

/** Angle of base → p (radians, view-local of the current view), or null when p is the base point. */
export function angleTo(ctx: CommandContext, base: Vec2, p: Vec2): number | null {
  const a = ctx.local(base);
  const b = ctx.local(p);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy) < 1e-12 ? null : Math.atan2(dy, dx);
}

/** Distance base → p in the current view's mm (drawing units). */
export function distTo(ctx: CommandContext, base: Vec2, p: Vec2): number {
  const a = ctx.local(base);
  const b = ctx.local(p);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function* rotate(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  const sel = splitIds(ctx, ids);
  if (sel.ents.length === 0 && sel.dims.length === 0 && sel.annots.length === 0) return;
  const b = yield { kind: 'point', prompt: 'Specify base point' };
  if (b.kind !== 'point') return;
  const base = b.p;
  const ghostAt = (angle: number) => similarityGhost(ctx, sel, base, rotation(angle));
  let copyMode = false;
  let angle: number | null = null;
  while (angle === null) {
    const r = yield {
      kind: 'point',
      prompt: 'Specify rotation angle or',
      options: [COPY_OPT, REFERENCE_OPT],
      base,
      acceptNumber: true,
      preview: (p) => {
        const a = angleTo(ctx, base, p);
        return a === null ? {} : ghostAt(a);
      },
    };
    if (r.kind === 'number') angle = r.value * DEG;
    else if (r.kind === 'point') {
      angle = angleTo(ctx, base, r.p);
      if (angle === null) ctx.log('The angle needs a point other than the base point.');
    } else if (r.kind === 'option' && r.key === 'C') {
      copyMode = !copyMode;
      ctx.log(copyMode ? 'Rotating a copy of the selected objects.' : 'Rotating the selected objects.');
    } else if (r.kind === 'option' && r.key === 'R') {
      const ref = yield { kind: 'number', prompt: 'Specify the reference angle', default: 0 };
      if (ref.kind !== 'number') return;
      const refAngle = ref.value * DEG;
      const n = yield {
        kind: 'point',
        prompt: 'Specify the new angle',
        base,
        acceptNumber: true,
        preview: (p) => {
          const a = angleTo(ctx, base, p);
          return a === null ? {} : ghostAt(a - refAngle);
        },
      };
      if (n.kind === 'number') angle = n.value * DEG - refAngle;
      else if (n.kind === 'point') {
        const a = angleTo(ctx, base, n.p);
        if (a === null) ctx.log('The angle needs a point other than the base point.');
        else angle = a - refAngle;
      } else return;
    } else return;
  }
  applySimilarity(ctx, sel, base, rotation(angle), copyMode);
}

export function* scaleCmd(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  const sel = splitIds(ctx, ids);
  if (sel.ents.length === 0 && sel.dims.length === 0 && sel.annots.length === 0) return;
  const b = yield { kind: 'point', prompt: 'Specify base point' };
  if (b.kind !== 'point') return;
  const base = b.p;
  const ghostAt = (factor: number) => (factor > 0 ? similarityGhost(ctx, sel, base, scaling(factor)) : {});
  let copyMode = false;
  let factor: number | null = null;
  while (factor === null) {
    const r = yield {
      kind: 'point',
      prompt: 'Specify scale factor or',
      options: [COPY_OPT, REFERENCE_OPT],
      base,
      acceptNumber: true,
      preview: (p) => ghostAt(distTo(ctx, base, p)),
    };
    if (r.kind === 'number' || r.kind === 'point') {
      const f = r.kind === 'number' ? r.value : distTo(ctx, base, r.p);
      if (f > 0) factor = f;
      else ctx.log('Value must be positive and nonzero.');
    } else if (r.kind === 'option' && r.key === 'C') {
      copyMode = !copyMode;
      ctx.log(copyMode ? 'Scaling a copy of the selected objects.' : 'Scaling the selected objects.');
    } else if (r.kind === 'option' && r.key === 'R') {
      const ref = yield { kind: 'number', prompt: 'Specify reference length', default: 1 };
      if (ref.kind !== 'number') return;
      if (ref.value <= 0) {
        ctx.log('Value must be positive and nonzero.');
        continue;
      }
      const n = yield {
        kind: 'point',
        prompt: 'Specify new length',
        base,
        acceptNumber: true,
        preview: (p) => ghostAt(distTo(ctx, base, p) / ref.value),
      };
      if (n.kind !== 'number' && n.kind !== 'point') return;
      const len = n.kind === 'number' ? n.value : distTo(ctx, base, n.p);
      if (len > 0) factor = len / ref.value;
      else ctx.log('Value must be positive and nonzero.');
    } else return;
  }
  applySimilarity(ctx, sel, base, scaling(factor), copyMode);
}

/** Remove entities/dimensions; radial dims of removed entities go too, linear/angular anchors freeze at their position. */
export function eraseIds(ctx: CommandContext, ids: string[]): void {
  const set = new Set(ids);
  const doc = ctx.doc;
  for (const dim of doc.dimensions) {
    for (const a of dimensionAnchors(dim)) {
      if (a.ref && set.has(a.ref.entityId)) {
        resolveAnchor(doc, a);
        a.ref = null;
      }
    }
  }
  doc.entities = doc.entities.filter((e) => !set.has(e.id));
  doc.dimensions = doc.dimensions.filter((d) => !set.has(d.id) && !((d.kind === 'radius' || d.kind === 'diameter') && set.has(d.entityId)));
  doc.annotations = doc.annotations.filter((a) => !set.has(a.id));
}

export function* erase(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  eraseIds(ctx, ids);
}
