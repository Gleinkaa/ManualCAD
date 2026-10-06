// Modify commands: OFFSET, TRIM, EXTEND, FILLET, CHAMFER, MOVE, COPY, MIRROR, ERASE.
import { chamfer as geomChamfer, distanceTo, intersect, extend as geomExtend, fillet as geomFillet, mirror as geomMirror, offset as geomOffset, translate, trim as geomTrim } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import { mirrorAnnotation, translateAnnotation } from '../../model/annot';
import { newId, resolveAnchor, toSheet } from '../../model/doc';
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
      ? { kind: 'point', prompt: 'Specify first fence point' }
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

function splitIds(ctx: CommandContext, ids: string[]): { ents: Entity[]; dims: Dimension[]; annots: Annotation[] } {
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
  const d = { x: r.to.x - r.base.x, y: r.to.y - r.base.y };
  const moved = new Set(ents.map((e) => e.id));
  for (const e of ents) e.geom = translate(e.geom, localDelta(ctx, e.viewId, d));
  for (const a of annots) Object.assign(a, translateAnnotation(a, localDelta(ctx, a.viewId, d)));
  for (const dim of dims) {
    if (dim.kind === 'linear') {
      shiftAnchor(ctx, dim.a, dim.viewId, d, moved);
      shiftAnchor(ctx, dim.b, dim.viewId, d, moved);
    }
  }
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
      preview: (p) => ghost(ctx, ents, { x: p.x - b.p.x, y: p.y - b.p.y }),
    };
    if (t.kind !== 'point') return;
    const d = { x: t.p.x - b.p.x, y: t.p.y - b.p.y };
    const map = new Map<string, string>();
    for (const e of ents) {
      const c = ctx.addEntity(translate(e.geom, localDelta(ctx, e.viewId, d)), { viewId: e.viewId, layer: e.layer, lineType: e.lineType });
      map.set(e.id, c.id);
    }
    for (const a of annots) ctx.doc.annotations.push({ ...translateAnnotation(structuredClone(a), localDelta(ctx, a.viewId, d)), id: newId('a') });
    for (const dim of dims) {
      if (dim.kind === 'linear') {
        ctx.doc.dimensions.push({
          ...structuredClone(dim),
          id: newId('d'),
          a: copyAnchor(ctx, dim.a, dim.viewId, d, map),
          b: copyAnchor(ctx, dim.b, dim.viewId, d, map),
        });
      } else {
        const target = map.get(dim.entityId);
        if (target) ctx.doc.dimensions.push({ ...structuredClone(dim), id: newId('d'), entityId: target });
      }
    }
  }
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
  if (dim.kind !== 'linear') {
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
    const follows = d.kind === 'linear' ? !!d.a.ref && !!d.b.ref && ids.has(d.a.ref.entityId) && ids.has(d.b.ref.entityId) : ids.has(d.entityId);
    if (follows) out.push(d);
  }
  return out;
}

export function* mirror(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  const { ents, dims: selectedDims, annots } = splitIds(ctx, ids);
  if (ents.length === 0 && selectedDims.length === 0 && annots.length === 0) return;
  const dims = dimsToMirror(ctx, selectedDims, ents);
  const a = yield { kind: 'point', prompt: 'Specify first point of mirror line' };
  if (a.kind !== 'point') return;
  const make = (p: Vec2) =>
    ents.map((e) => ({ e, curve: geomMirror(e.geom, ctx.localIn(e.viewId, a.p), ctx.localIn(e.viewId, p)) }));
  const previewDims = (p: Vec2): Dimension[] =>
    dims
      .filter((d): d is LinearDimension => d.kind === 'linear')
      .map((d) => mirrorDim(ctx, d, a.p, p, new Map()))
      .filter((d): d is Dimension => !!d);
  const b = yield {
    kind: 'point',
    prompt: 'Specify second point of mirror line',
    base: a.p,
    preview: (p) =>
      p.x === a.p.x && p.y === a.p.y
        ? {}
        : {
            curves: make(p).map(({ e, curve }) => ({ curve, lineType: e.lineType, viewId: e.viewId })),
            dims: previewDims(p),
            annotations: annots.map((x) => mirrorAnnotation(x, ctx.localIn(x.viewId, a.p), ctx.localIn(x.viewId, p))),
          },
  };
  if (b.kind !== 'point') return;
  if (b.p.x === a.p.x && b.p.y === a.p.y) {
    ctx.log('The mirror line needs two different points.');
    return;
  }
  const yn = yield { kind: 'text', prompt: 'Erase source objects? [Yes/No]', default: 'N' };
  const erase = yn.kind === 'text' && /^y/i.test(yn.text.trim());
  const idMap = new Map<string, string>();
  const curves = make(b.p);
  if (erase) for (const e of ents) idMap.set(e.id, e.id);
  else for (const { e, curve } of curves) idMap.set(e.id, ctx.addEntity(curve, { viewId: e.viewId, layer: e.layer, lineType: e.lineType }).id);
  // dimension images are computed from the source geometry, before it is replaced in place
  const mirrored = dims.map((d) => ({ d, m: mirrorDim(ctx, d, a.p, b.p, idMap) }));
  if (erase) for (const { e, curve } of curves) e.geom = curve;
  for (const { d, m } of mirrored) {
    if (!m) continue;
    if (erase) Object.assign(d, m);
    else ctx.doc.dimensions.push({ ...m, id: newId('d') });
  }
  for (const x of annots) {
    const m = mirrorAnnotation(structuredClone(x), ctx.localIn(x.viewId, a.p), ctx.localIn(x.viewId, b.p));
    if (erase) Object.assign(x, m);
    else ctx.doc.annotations.push({ ...m, id: newId('a') });
  }
}

/** Remove entities/dimensions; radial dims of removed entities go too, linear anchors freeze at their position. */
export function eraseIds(ctx: CommandContext, ids: string[]): void {
  const set = new Set(ids);
  const doc = ctx.doc;
  for (const dim of doc.dimensions) {
    if (dim.kind !== 'linear') continue;
    for (const a of [dim.a, dim.b]) {
      if (a.ref && set.has(a.ref.entityId)) {
        resolveAnchor(doc, a);
        a.ref = null;
      }
    }
  }
  doc.entities = doc.entities.filter((e) => !set.has(e.id));
  doc.dimensions = doc.dimensions.filter((d) => !set.has(d.id) && !(d.kind !== 'linear' && set.has(d.entityId)));
  doc.annotations = doc.annotations.filter((a) => !set.has(a.id));
}

export function* erase(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  eraseIds(ctx, ids);
}
