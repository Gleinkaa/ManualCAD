// Modify commands: OFFSET, TRIM, EXTEND, FILLET, CHAMFER, MOVE, COPY, MIRROR, ERASE.
import { chamfer as geomChamfer, distanceTo, extend as geomExtend, fillet as geomFillet, mirror as geomMirror, offset as geomOffset, translate, trim as geomTrim } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import { newId, resolveAnchor } from '../../model/doc';
import type { DimAnchor, Dimension, Entity } from '../../model/types';
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

/** Shared by TRIM and EXTEND: edge selection (Enter = all), then repeated picks. */
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
  for (;;) {
    const pick = yield {
      kind: 'entity',
      prompt: mode === 'trim' ? 'Select object to trim' : 'Select object to extend',
      allowEnter: true,
    };
    if (pick.kind !== 'entity') return;
    const target = ctx.entity(pick.id);
    if (!target) continue;
    const edgeIds = all ? visibleEntities(ctx.doc).map((e) => e.id) : edges;
    const cutters = edgeIds
      .filter((id) => id !== target.id)
      .map((id) => ctx.entity(id))
      .filter((e): e is Entity => !!e)
      .map((e) => ctx.curveIn(e, target.viewId));
    const lp = ctx.localIn(target.viewId, pick.p);
    if (mode === 'trim') {
      const pieces = geomTrim(target.geom, lp, cutters);
      if (!pieces) {
        ctx.log('Object does not intersect a cutting edge.');
        continue;
      }
      if (pieces.length === 0) {
        eraseIds(ctx, [target.id]);
        continue;
      }
      target.geom = pieces[0];
      for (const p of pieces.slice(1)) ctx.addEntity(p, { viewId: target.viewId, layer: target.layer, lineType: target.lineType });
    } else {
      const c = geomExtend(target.geom, lp, cutters);
      if (!c) {
        ctx.log('Object does not intersect a boundary edge.');
        continue;
      }
      target.geom = c;
    }
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

function splitIds(ctx: CommandContext, ids: string[]): { ents: Entity[]; dims: Dimension[] } {
  const set = new Set(ids);
  return {
    ents: ctx.doc.entities.filter((e) => set.has(e.id)),
    dims: ctx.doc.dimensions.filter((d) => set.has(d.id)),
  };
}

/** Sheet displacement → view-local displacement of `viewId`. */
function localDelta(ctx: CommandContext, viewId: string, d: Vec2): Vec2 {
  const s = ctx.viewOf(viewId).scale;
  return { x: d.x / s, y: d.y / s };
}

function ghost(ctx: CommandContext, ents: Entity[], d: Vec2): Preview {
  return { curves: ents.map((e) => ({ curve: translate(e.geom, localDelta(ctx, e.viewId, d)), lineType: e.lineType, viewId: e.viewId })) };
}

function* baseAndSecond(ctx: CommandContext, ents: Entity[]): SubGen<{ base: Vec2; to: Vec2 } | null> {
  const b = yield { kind: 'point', prompt: 'Specify base point' };
  if (b.kind !== 'point') return null;
  const t = yield {
    kind: 'point',
    prompt: 'Specify second point or <use first point as displacement>',
    allowEnter: true,
    base: b.p,
    preview: (p) => ghost(ctx, ents, { x: p.x - b.p.x, y: p.y - b.p.y }),
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
  const { ents, dims } = splitIds(ctx, ids);
  const r = yield* baseAndSecond(ctx, ents);
  if (!r) return;
  const d = { x: r.to.x - r.base.x, y: r.to.y - r.base.y };
  const moved = new Set(ents.map((e) => e.id));
  for (const e of ents) e.geom = translate(e.geom, localDelta(ctx, e.viewId, d));
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
  const { ents, dims } = splitIds(ctx, ids);
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

export function* mirror(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  const { ents, dims } = splitIds(ctx, ids);
  if (ents.length === 0) return;
  if (dims.length > 0) ctx.log(`${dims.length} dimension(s) are not mirrored.`);
  const a = yield { kind: 'point', prompt: 'Specify first point of mirror line' };
  if (a.kind !== 'point') return;
  const make = (p: Vec2) =>
    ents.map((e) => ({ e, curve: geomMirror(e.geom, ctx.localIn(e.viewId, a.p), ctx.localIn(e.viewId, p)) }));
  const b = yield {
    kind: 'point',
    prompt: 'Specify second point of mirror line',
    base: a.p,
    preview: (p) => (p.x === a.p.x && p.y === a.p.y ? {} : { curves: make(p).map(({ e, curve }) => ({ curve, lineType: e.lineType, viewId: e.viewId })) }),
  };
  if (b.kind !== 'point') return;
  const yn = yield { kind: 'text', prompt: 'Erase source objects? [Yes/No]', default: 'N' };
  const erase = yn.kind === 'text' && /^y/i.test(yn.text.trim());
  for (const { e, curve } of make(b.p)) {
    if (erase) e.geom = curve;
    else ctx.addEntity(curve, { viewId: e.viewId, layer: e.layer, lineType: e.lineType });
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
}

export function* erase(ctx: CommandContext): CommandGen {
  const ids = yield* selectObjects(ctx);
  eraseIds(ctx, ids);
}
