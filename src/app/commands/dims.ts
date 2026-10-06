// Dimension commands: DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER. Anchors associate to snapped entity points.
import { dist, endpoints } from '../../geom';
import type { Vec2 } from '../../geom/types';
import { newId, toSheet } from '../../model/doc';
import type { DimAnchor, Entity, LinearDimension, RadialDimension } from '../../model/types';
import type { PointInput } from './types';
import type { CommandContext, CommandGen, SubGen } from './types';

type Orientation = LinearDimension['orientation'];

/**
 * Signed offset (sheet mm) of the dimension line through `loc`, measured from the midpoint of a and b
 * perpendicular to the measured direction (+y for horizontal, +x for vertical, left normal of a→b for aligned).
 */
export function dimOffset(orientation: Orientation, a: Vec2, b: Vec2, loc: Vec2): number {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  switch (orientation) {
    case 'horizontal':
      return loc.y - m.y;
    case 'vertical':
      return loc.x - m.x;
    case 'aligned': {
      const l = dist(a, b) || 1;
      const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
      return (loc.x - m.x) * n.x + (loc.y - m.y) * n.y;
    }
  }
}

/** AutoCAD rule: cursor beyond the points vertically → horizontal dimension, beyond them sideways → vertical. */
export function autoOrientation(a: Vec2, b: Vec2, loc: Vec2): 'horizontal' | 'vertical' {
  const outX = Math.max(0, Math.min(a.x, b.x) - loc.x, loc.x - Math.max(a.x, b.x));
  const outY = Math.max(0, Math.min(a.y, b.y) - loc.y, loc.y - Math.max(a.y, b.y));
  if (outX === 0 && outY === 0) return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
  return outY >= outX ? 'horizontal' : 'vertical';
}

function anchorFrom(ctx: CommandContext, viewId: string, inp: PointInput): DimAnchor {
  const snap = inp.snap;
  const ent = snap?.entityId ? ctx.entity(snap.entityId) : undefined;
  const ref = snap?.anchor && ent && ent.viewId === viewId ? { entityId: ent.id, point: snap.anchor } : null;
  return { ref, fallback: ctx.localIn(viewId, inp.p) };
}

/** View a dimension belongs to: the view of the first snapped entity, else the current view. */
function dimView(ctx: CommandContext, inp: PointInput): string {
  const ent = inp.snap?.entityId ? ctx.entity(inp.snap.entityId) : undefined;
  return ent?.viewId ?? ctx.settings.currentViewId;
}

function* twoAnchors(ctx: CommandContext): SubGen<{ viewId: string; a: DimAnchor; b: DimAnchor } | null> {
  const r1 = yield { kind: 'point', prompt: 'Specify first extension line origin or <select object>', allowEnter: true };
  if (r1.kind === 'enter') {
    const r = yield { kind: 'entity', prompt: 'Select object to dimension', filter: (e) => e.geom.kind === 'line' };
    if (r.kind !== 'entity') return null;
    const e = ctx.entity(r.id);
    if (!e || !endpoints(e.geom)) return null;
    const [p, q] = endpoints(e.geom)!;
    return {
      viewId: e.viewId,
      a: { ref: { entityId: e.id, point: 'start' }, fallback: p },
      b: { ref: { entityId: e.id, point: 'end' }, fallback: q },
    };
  }
  if (r1.kind !== 'point') return null;
  const viewId = dimView(ctx, r1);
  const r2 = yield {
    kind: 'point',
    prompt: 'Specify second extension line origin',
    base: r1.p,
    preview: (p) => ({ curves: [{ curve: { kind: 'line', a: ctx.local(r1.p), b: ctx.local(p) }, lineType: 'construction' }] }),
  };
  if (r2.kind !== 'point') return null;
  return { viewId, a: anchorFrom(ctx, viewId, r1), b: anchorFrom(ctx, viewId, r2) };
}

function* linearDim(ctx: CommandContext, aligned: boolean): CommandGen {
  const anchors = yield* twoAnchors(ctx);
  if (!anchors) return;
  const { viewId, a, b } = anchors;
  const view = ctx.viewOf(viewId);
  const sa = toSheet(view, a.fallback);
  const sb = toSheet(view, b.fallback);
  if (dist(sa, sb) < 1e-9) {
    ctx.log('Extension line origins coincide.');
    return;
  }
  let fixed: Orientation | null = aligned ? 'aligned' : null;
  const make = (loc: Vec2): LinearDimension => {
    const orientation = fixed ?? autoOrientation(sa, sb, loc);
    return {
      kind: 'linear',
      id: newId('d'),
      viewId,
      layer: ctx.settings.layer,
      a: structuredClone(a),
      b: structuredClone(b),
      orientation,
      offset: dimOffset(orientation, sa, sb, loc),
      text: { override: null, prefix: '', suffix: '' },
    };
  };
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: 'Specify dimension line location',
      options: aligned ? [] : [{ key: 'H', label: 'Horizontal' }, { key: 'V', label: 'Vertical' }],
      preview: (p) => ({ dims: [make(p)] }),
    };
    if (r.kind === 'option') {
      fixed = r.key === 'H' ? 'horizontal' : 'vertical';
      continue;
    }
    if (r.kind !== 'point') return;
    const dim = make(r.p);
    ctx.doc.dimensions.push(dim);
    return;
  }
}

export function dimlinear(ctx: CommandContext): CommandGen {
  return linearDim(ctx, false);
}

export function dimaligned(ctx: CommandContext): CommandGen {
  return linearDim(ctx, true);
}

function* radialDim(ctx: CommandContext, kind: 'radius' | 'diameter'): CommandGen {
  const r = yield { kind: 'entity', prompt: 'Select arc or circle', filter: (e) => e.geom.kind !== 'line' };
  if (r.kind !== 'entity') return;
  const ent: Entity | undefined = ctx.entity(r.id);
  if (!ent || ent.geom.kind === 'line') return;
  const g = ent.geom;
  const view = ctx.viewOf(ent.viewId);
  const c = toSheet(view, g.c);
  const make = (p: Vec2): RadialDimension => ({
    kind,
    id: newId('d'),
    viewId: ent.viewId,
    layer: ctx.settings.layer,
    entityId: ent.id,
    angle: Math.atan2(p.y - c.y, p.x - c.x),
    leader: Math.max(0, dist(p, c) - g.r * view.scale),
    text: { override: null, prefix: '', suffix: '' },
  });
  const loc = yield { kind: 'point', prompt: 'Specify dimension line location', preview: (p) => ({ dims: [make(p)] }) };
  if (loc.kind !== 'point') return;
  ctx.doc.dimensions.push(make(loc.p));
}

export function dimradius(ctx: CommandContext): CommandGen {
  return radialDim(ctx, 'radius');
}

export function dimdiameter(ctx: CommandContext): CommandGen {
  return radialDim(ctx, 'diameter');
}
