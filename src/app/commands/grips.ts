// GRIPSTRETCH: drag a hot grip (and every selected grip at the same spot) to a new point. Started by the app
// when a grip is clicked; `ctx.grip` carries the grips. Enter cycles the grip modes (Stretch, Move, Rotate,
// Scale, Mirror) like AutoCAD; the modes act on the whole selection about the grip. Not a typed command.
import type { Vec2 } from '../../geom/types';
import { newId, toLocal } from '../../model/doc';
import { applyGrip, objectGrips, stretchAnnotation, stretchCurve, stretchDimension, type AnchorRef, type Grip } from '../grips';
import { visibleEntities } from '../xform';
import { angleTo, applyMirror, applySimilarity, copySelection, distTo, mirrorGhost, rotation, scaling, similarityGhost, splitIds, translateGhost, translateSelection, type Selection } from './modify';
import type { CommandContext, CommandGen, Input, Option, Preview, SubGen } from './types';

export interface GripDrag {
  grips: Grip[];             // all hot grips (coincident grips of the selection, plus Shift-collected ones)
  base: Vec2;                // sheet mm: the clicked grip
  selection: string[];       // the whole selection, for the Move/Rotate/Scale/Mirror modes
}

type Mode = 'STRETCH' | 'MOVE' | 'ROTATE' | 'SCALE' | 'MIRROR';
const CYCLE: Mode[] = ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR'];
const MODE_OPTIONS: Option[] = [{ key: 'ST', label: 'STretch' }, { key: 'MO', label: 'MOve' }, { key: 'RO', label: 'ROtate' }, { key: 'SC', label: 'SCale' }, { key: 'MI', label: 'MIrror' }];
const COPY_OPT: Option = { key: 'C', label: 'Copy' };
const EXIT_OPT: Option = { key: 'X', label: 'eXit' };
const BY_KEY: Record<string, Mode> = { ST: 'STRETCH', MO: 'MOVE', RO: 'ROTATE', SC: 'SCALE', MI: 'MIRROR' };
const DEG = Math.PI / 180;

const PROMPTS: Record<Mode, string> = {
  STRETCH: 'Specify stretch point or',
  MOVE: 'Specify move point or',
  ROTATE: 'Specify rotation angle or',
  SCALE: 'Specify scale factor or',
  MIRROR: 'Specify second point of mirror line or',
};

/** Copies of the objects that carry `grips`, with the grips re-pointed at the copies (grip Stretch with Copy). */
function copyGripObjects(ctx: CommandContext, grips: Grip[]): Grip[] {
  const map = new Map<string, string>();
  for (const g of grips) {
    if (map.has(g.id)) continue;
    const e = ctx.entity(g.id);
    if (e) {
      map.set(g.id, ctx.addEntity(structuredClone(e.geom), { viewId: e.viewId, layer: e.layer, lineType: e.lineType }).id);
      continue;
    }
    const d = ctx.doc.dimensions.find((x) => x.id === g.id);
    if (d) {
      const c = { ...structuredClone(d), id: newId('d') };
      ctx.doc.dimensions.push(c);
      map.set(g.id, c.id);
      continue;
    }
    const a = ctx.doc.annotations.find((x) => x.id === g.id);
    if (a) {
      const c = { ...structuredClone(a), id: newId('a') };
      if (c.kind === 'hatch') delete c.assoc;
      ctx.doc.annotations.push(c);
      map.set(g.id, c.id);
    }
  }
  return grips.map((g) => ({ ...g, id: map.get(g.id) ?? g.id }));
}

export function* gripstretch(ctx: CommandContext): CommandGen {
  const drag = ctx.grip;
  ctx.grip = null;
  if (!drag || drag.grips.length === 0) {
    ctx.log('Click a grip of a selected object to stretch it.');
    return;
  }
  const base = drag.base;
  const sel = (): Selection => splitIds(ctx, drag.selection);
  // every hot grip moves by the same displacement: coincident grips land on the point, collected ones keep their spacing
  const moved = (grips: Grip[], p: Vec2) => grips.map((g) => ({ grip: g, to: { x: g.p.x + p.x - base.x, y: g.p.y + p.y - base.y } }));
  let mode: Mode = 'STRETCH';
  let copy = false;
  for (;;) {
    ctx.log(`** ${mode}${copy ? ' (multiple)' : ''} **`);
    const r: Input = yield* modePrompt(ctx, mode, base, () => sel(), (p) => ghost(ctx, moved(drag.grips, p)));
    if (r.kind === 'enter') {
      mode = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
      continue;
    }
    if (r.kind === 'option') {
      if (r.key === 'X') return;
      if (r.key === 'C') {
        copy = !copy;
        continue;
      }
      mode = BY_KEY[r.key] ?? mode;
      continue;
    }
    if (r.kind === 'number' && mode === 'ROTATE') {
      applySimilarity(ctx, sel(), base, rotation(r.value * DEG), copy);
    } else if (r.kind === 'number' && mode === 'SCALE') {
      if (r.value <= 0) {
        ctx.log('Value must be positive and nonzero.');
        continue;
      }
      applySimilarity(ctx, sel(), base, scaling(r.value), copy);
    } else if (r.kind !== 'point') {
      continue;
    } else if (mode === 'STRETCH') {
      const grips = copy ? copyGripObjects(ctx, drag.grips) : drag.grips;
      const ref: AnchorRef | null = r.snap?.entityId && r.snap.anchor ? { entityId: r.snap.entityId, point: r.snap.anchor } : null;
      for (const m of moved(grips, r.p)) applyGrip(ctx.doc, m.grip, toLocal(ctx.viewOf(m.grip.viewId), m.to), m.grip.kind === 'anchor' ? ref : null);
      if (ref && grips.some((g) => g.kind === 'anchor')) ctx.log('Dimension point attached to the snapped object.');
    } else if (mode === 'MOVE') {
      const d = { x: r.p.x - base.x, y: r.p.y - base.y };
      if (copy) copySelection(ctx, sel(), d);
      else translateSelection(ctx, sel(), d);
    } else if (mode === 'ROTATE') {
      const a = angleTo(ctx, base, r.p);
      if (a === null) {
        ctx.log('The angle needs a point other than the base point.');
        continue;
      }
      applySimilarity(ctx, sel(), base, rotation(a), copy);
    } else if (mode === 'SCALE') {
      const f = distTo(ctx, base, r.p);
      if (f <= 0) {
        ctx.log('Value must be positive and nonzero.');
        continue;
      }
      applySimilarity(ctx, sel(), base, scaling(f), copy);
    } else {
      if (r.p.x === base.x && r.p.y === base.y) {
        ctx.log('The mirror line needs two different points.');
        continue;
      }
      applyMirror(ctx, sel(), base, r.p, !copy);
    }
    if (!copy) return;
    ctx.log(`${mode} applied to a copy; next point, or eXit.`);
  }
}

/** One prompt of a grip mode; the ghost shows the transform the cursor would apply. */
function* modePrompt(ctx: CommandContext, mode: Mode, base: Vec2, sel: () => Selection, stretchGhost: (p: Vec2) => Preview): SubGen<Input> {
  const options = [...MODE_OPTIONS.filter((o) => BY_KEY[o.key] !== mode), COPY_OPT, EXIT_OPT];
  const preview = (p: Vec2): Preview => {
    switch (mode) {
      case 'STRETCH':
        return stretchGhost(p);
      case 'MOVE':
        return translateGhost(ctx, sel(), { x: p.x - base.x, y: p.y - base.y });
      case 'ROTATE': {
        const a = angleTo(ctx, base, p);
        return a === null ? {} : similarityGhost(ctx, sel(), base, rotation(a));
      }
      case 'SCALE': {
        const f = distTo(ctx, base, p);
        return f > 0 ? similarityGhost(ctx, sel(), base, scaling(f)) : {};
      }
      case 'MIRROR':
        return mirrorGhost(ctx, sel(), base, p);
    }
  };
  return yield { kind: 'point', prompt: PROMPTS[mode], options, allowEnter: true, base, acceptNumber: mode === 'ROTATE' || mode === 'SCALE', preview };
}

/** Ghost of every object with its grips moved to their targets (sheet mm); several grips of one object stack up. */
function ghost(ctx: CommandContext, moves: { grip: Grip; to: Vec2 }[]): Preview {
  const out: Preview = { curves: [], annotations: [], dims: [] };
  const byId = new Map<string, { grip: Grip; to: Vec2 }[]>();
  for (const m of moves) byId.set(m.grip.id, [...(byId.get(m.grip.id) ?? []), m]);
  for (const [id, ms] of byId) {
    const e = ctx.entity(id);
    if (e) {
      let c = e.geom;
      for (const m of ms) c = stretchCurve(c, m.grip, toLocal(ctx.viewOf(e.viewId), m.to));
      out.curves!.push({ curve: c, lineType: e.lineType, viewId: e.viewId });
      continue;
    }
    const d = ctx.doc.dimensions.find((x) => x.id === id);
    if (d) {
      let dim = d;
      for (const m of ms) dim = stretchDimension(ctx.doc, dim, m.grip, m.to);
      out.dims!.push(dim);
      continue;
    }
    const a = ctx.doc.annotations.find((x) => x.id === id);
    if (a) {
      let an = a;
      for (const m of ms) an = stretchAnnotation(an, m.grip, toLocal(ctx.viewOf(a.viewId), m.to));
      out.annotations!.push(an);
    }
  }
  return out;
}

/**
 * STRETCH (S): a crossing window picks the ends to move. Line ends, arc ends, text and leader points and
 * detached dimension points inside the window move with the displacement; a circle or an arc moves whole
 * when its centre is inside. Objects fully inside move entirely, as in AutoCAD.
 */
export function* stretch(ctx: CommandContext): CommandGen {
  ctx.preselection = [];
  const a = yield { kind: 'point', prompt: 'Specify first corner of the crossing window' };
  if (a.kind !== 'point') return;
  const box = (p: Vec2): Vec2[] => [a.p, { x: p.x, y: a.p.y }, p, { x: a.p.x, y: p.y }];
  const b = yield {
    kind: 'point',
    prompt: 'Specify opposite corner',
    base: a.p,
    preview: (p) => {
      const c = box(p).map((q) => ctx.local(q));
      return { curves: c.map((q, i) => ({ curve: { kind: 'line' as const, a: q, b: c[(i + 1) % 4] }, lineType: 'construction' as const })) };
    },
  };
  if (b.kind !== 'point') return;
  const min = { x: Math.min(a.p.x, b.p.x), y: Math.min(a.p.y, b.p.y) };
  const max = { x: Math.max(a.p.x, b.p.x), y: Math.max(a.p.y, b.p.y) };
  const inside = (p: Vec2) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
  const grips: Grip[] = [];
  for (const e of visibleEntities(ctx.doc)) {
    const gs = objectGrips(ctx.doc, e.id);
    if (e.geom.kind === 'line') grips.push(...gs.filter((g) => g.kind === 'end' && inside(g.p)));
    else if (e.geom.kind === 'circle') grips.push(...gs.filter((g) => g.kind === 'center' && inside(g.p)));
    else {
      const ends = gs.filter((g) => g.kind === 'end' && inside(g.p));
      const centre = gs.find((g) => g.kind === 'center')!;
      if (ends.length === 2 || inside(centre.p)) grips.push(centre);
      else grips.push(...ends);
    }
  }
  const hidden = new Set(ctx.doc.layers.filter((l) => !l.visible).map((l) => l.name));
  for (const an of ctx.doc.annotations) if (!hidden.has(an.layer)) grips.push(...objectGrips(ctx.doc, an.id).filter((g) => inside(g.p)));
  for (const d of ctx.doc.dimensions) {
    if (hidden.has(d.layer) || d.kind !== 'linear') continue;
    for (const g of objectGrips(ctx.doc, d.id)) {
      if (g.kind !== 'anchor' || !inside(g.p)) continue;
      if ((g.index === 0 ? d.a : d.b).ref === null) grips.push(g);
    }
  }
  if (grips.length === 0) {
    ctx.log('Nothing to stretch inside the window.');
    return;
  }
  ctx.log(`${grips.length} point${grips.length === 1 ? '' : 's'} to stretch.`);
  const base = yield { kind: 'point', prompt: 'Specify base point' };
  if (base.kind !== 'point') return;
  const moved = (p: Vec2) => grips.map((g) => ({ grip: g, to: { x: g.p.x + p.x - base.p.x, y: g.p.y + p.y - base.p.y } }));
  const t = yield { kind: 'point', prompt: 'Specify second point', base: base.p, preview: (p) => ghost(ctx, moved(p)) };
  if (t.kind !== 'point') return;
  for (const m of moved(t.p)) applyGrip(ctx.doc, m.grip, toLocal(ctx.viewOf(m.grip.viewId), m.to));
}
