// Dimension commands: DIMLINEAR, DIMALIGNED, DIMRADIUS, DIMDIAMETER, DIMANGULAR, DIMEDIT.
// Anchors associate to snapped entity points.
import { cross, dist, endpoints } from '../../geom';
import type { Vec2 } from '../../geom/types';
import { dimensionText } from '../../dim';
import { newId, toSheet } from '../../model/doc';
import type { AngularDimension, AngularLeg, DimAnchor, Dimension, DimText, Entity, LinearDimension, RadialDimension } from '../../model/types';
import type { Option, PointInput } from './types';
import { selectObjects, type CommandContext, type CommandGen, type SubGen } from './types';

type Orientation = LinearDimension['orientation'];

/** Text and Mtext options on every "dimension line location" prompt (both ask for a single line here). */
const TEXT_OPTIONS: Option[] = [{ key: 'M', label: 'Mtext' }, { key: 'T', label: 'Text' }];

const keepMeasured = (): DimText => ({ override: null, prefix: '', suffix: '' });

/**
 * Dimension text as typed (AutoCAD syntax): `<>` stands for the measured value, `%%c` → ⌀, `%%d` → °,
 * `%%p` → ±. With `<>` the text around it becomes prefix/suffix; without it the text replaces the value;
 * empty text keeps the measured value.
 */
export function parseDimText(input: string): DimText {
  const t = input.replace(/%%c/gi, '⌀').replace(/%%d/gi, '°').replace(/%%p/gi, '±');
  if (t.trim() === '') return keepMeasured();
  const i = t.indexOf('<>');
  if (i < 0) return { override: t, prefix: '', suffix: '' };
  return { override: null, prefix: t.slice(0, i), suffix: t.slice(i + 2) };
}

/** Ask for dimension text; Enter keeps `current`. `measured` is shown as the default like AutoCAD. */
function* askDimText(measured: string, current: DimText): SubGen<DimText> {
  const r = yield { kind: 'text', prompt: `Enter dimension text <${measured}>` };
  return r.kind === 'text' ? parseDimText(r.text) : current;
}

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
  let text = keepMeasured();
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
      text: structuredClone(text),
    };
  };
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: 'Specify dimension line location',
      options: aligned ? TEXT_OPTIONS : [...TEXT_OPTIONS, { key: 'H', label: 'Horizontal' }, { key: 'V', label: 'Vertical' }],
      preview: (p) => ({ dims: [make(p)] }),
    };
    if (r.kind === 'option' && (r.key === 'T' || r.key === 'M')) {
      const probe = make(sb);
      probe.text = keepMeasured();
      text = yield* askDimText(dimensionText(ctx.doc, probe), text);
      continue;
    }
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
  let text = keepMeasured();
  const make = (p: Vec2): RadialDimension => ({
    kind,
    id: newId('d'),
    viewId: ent.viewId,
    layer: ctx.settings.layer,
    entityId: ent.id,
    angle: Math.atan2(p.y - c.y, p.x - c.x),
    leader: Math.max(0, dist(p, c) - g.r * view.scale),
    text: structuredClone(text),
  });
  for (;;) {
    const loc = yield { kind: 'point', prompt: 'Specify dimension line location', options: TEXT_OPTIONS, preview: (p) => ({ dims: [make(p)] }) };
    if (loc.kind === 'option') {
      const probe = make(c);
      probe.text = keepMeasured();
      text = yield* askDimText(dimensionText(ctx.doc, probe), text);
      continue;
    }
    if (loc.kind !== 'point') return;
    ctx.doc.dimensions.push(make(loc.p));
    return;
  }
}

export function dimradius(ctx: CommandContext): CommandGen {
  return radialDim(ctx, 'radius');
}

export function dimdiameter(ctx: CommandContext): CommandGen {
  return radialDim(ctx, 'diameter');
}

// --- angular ---

function legOf(e: Entity): AngularLeg | null {
  const ends = endpoints(e.geom);
  if (e.geom.kind !== 'line' || !ends) return null;
  return { a: { ref: { entityId: e.id, point: 'start' }, fallback: ends[0] }, b: { ref: { entityId: e.id, point: 'end' }, fallback: ends[1] } };
}

/**
 * Senses selecting the sector that contains `loc` (all view-local): `loc − vertex = α·d1 + β·d2`,
 * the sector between sign(α)·d1 and sign(β)·d2 contains it (AutoCAD picks the quadrant the same way).
 */
export function angularSenses(vertex: Vec2, d1: Vec2, d2: Vec2, loc: Vec2): { sense1: 1 | -1; sense2: 1 | -1 } {
  const w = { x: loc.x - vertex.x, y: loc.y - vertex.y };
  const den = cross(d1, d2);
  const alpha = cross(w, d2) / den;
  const beta = cross(d1, w) / den;
  return { sense1: alpha < 0 ? -1 : 1, sense2: beta < 0 ? -1 : 1 };
}

/** First prompt of DIMANGULAR: two lines, or Enter for the 3-point form (vertex, then one point on each leg). */
function* angularLegs(ctx: CommandContext): SubGen<{ viewId: string; leg1: AngularLeg; leg2: AngularLeg } | null> {
  const isLine = (e: Entity) => e.geom.kind === 'line';
  const r1 = yield { kind: 'entity', prompt: 'Select first line or <specify vertex>', filter: isLine, allowEnter: true };
  if (r1.kind === 'enter') {
    const v = yield { kind: 'point', prompt: 'Specify angle vertex' };
    if (v.kind !== 'point') return null;
    const viewId = dimView(ctx, v);
    const ray = (p: Vec2) => ({ curves: [{ curve: { kind: 'line' as const, a: ctx.localIn(viewId, v.p), b: ctx.localIn(viewId, p) }, lineType: 'construction' as const, viewId }] });
    const p1 = yield { kind: 'point', prompt: 'Specify first angle endpoint', base: v.p, preview: ray };
    if (p1.kind !== 'point') return null;
    const p2 = yield { kind: 'point', prompt: 'Specify second angle endpoint', base: v.p, preview: ray };
    if (p2.kind !== 'point') return null;
    const vertex = anchorFrom(ctx, viewId, v);
    return {
      viewId,
      leg1: { a: vertex, b: anchorFrom(ctx, viewId, p1) },
      leg2: { a: structuredClone(vertex), b: anchorFrom(ctx, viewId, p2) },
    };
  }
  if (r1.kind !== 'entity') return null;
  const e1 = ctx.entity(r1.id);
  const r2 = yield { kind: 'entity', prompt: 'Select second line', filter: isLine };
  if (r2.kind !== 'entity') return null;
  const e2 = ctx.entity(r2.id);
  if (!e1 || !e2) return null;
  if (e1.viewId !== e2.viewId) {
    ctx.log('Both lines must be in the same view.');
    return null;
  }
  const leg1 = legOf(e1);
  const leg2 = legOf(e2);
  return leg1 && leg2 ? { viewId: e1.viewId, leg1, leg2 } : null;
}

export function* dimangular(ctx: CommandContext): CommandGen {
  const legs = yield* angularLegs(ctx);
  if (!legs) return;
  const { viewId, leg1, leg2 } = legs;
  const d1 = { x: leg1.b.fallback.x - leg1.a.fallback.x, y: leg1.b.fallback.y - leg1.a.fallback.y };
  const d2 = { x: leg2.b.fallback.x - leg2.a.fallback.x, y: leg2.b.fallback.y - leg2.a.fallback.y };
  if (Math.hypot(d1.x, d1.y) < 1e-9 || Math.hypot(d2.x, d2.y) < 1e-9) {
    ctx.log('An angle endpoint coincides with the vertex.');
    return;
  }
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) {
    ctx.log('Lines are parallel.');
    return;
  }
  const p1 = leg1.a.fallback;
  const p2 = leg2.a.fallback;
  const t = cross({ x: p2.x - p1.x, y: p2.y - p1.y }, d2) / den;
  const vertex = { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
  const view = ctx.viewOf(viewId);
  const V = toSheet(view, vertex);
  let text = keepMeasured();
  const make = (p: Vec2): AngularDimension => ({
    kind: 'angular',
    id: newId('d'),
    viewId,
    layer: ctx.settings.layer,
    leg1: structuredClone(leg1),
    leg2: structuredClone(leg2),
    ...angularSenses(vertex, d1, d2, ctx.localIn(viewId, p)),
    radius: dist(p, V),
    text: structuredClone(text),
  });
  for (;;) {
    const r = yield { kind: 'point', prompt: 'Specify dimension arc line location', options: TEXT_OPTIONS, preview: (p) => ({ dims: [make(p)] }) };
    if (r.kind === 'option') {
      const probe = make(toSheet(view, { x: vertex.x + d1.x + d2.x, y: vertex.y + d1.y + d2.y }));
      probe.text = keepMeasured();
      text = yield* askDimText(dimensionText(ctx.doc, probe), text);
      continue;
    }
    if (r.kind !== 'point') return;
    if (dist(r.p, V) < 1e-9) {
      ctx.log('The dimension arc needs a location away from the vertex.');
      continue;
    }
    ctx.doc.dimensions.push(make(r.p));
    return;
  }
}

// --- DIMEDIT ---

/** DIMEDIT New: replace the text of the selected dimensions (`<>` = measured value). */
export function* dimedit(ctx: CommandContext): CommandGen {
  const o = yield { kind: 'text', prompt: 'Enter type of dimension editing', options: [{ key: 'N', label: 'New' }], default: 'N' };
  if (o.kind !== 'option' && !(o.kind === 'text' && /^n/i.test(o.text.trim()))) return;
  const t = yield { kind: 'text', prompt: 'Enter dimension text (<> = measured value)' };
  const text = t.kind === 'text' ? parseDimText(t.text) : keepMeasured();
  const ids = new Set(yield* selectObjects(ctx));
  const dims: Dimension[] = ctx.doc.dimensions.filter((d) => ids.has(d.id));
  for (const d of dims) d.text = structuredClone(text);
  ctx.log(`${dims.length} dimension(s) changed.`);
}
