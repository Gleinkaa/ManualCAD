// Sheet organisation commands: VIEW, LTYPE, LAYER, ZOOM, TITLEBLOCK.
import type { Vec2 } from '../../geom/types';
import { moveView, newId } from '../../model/doc';
import { formatScale, LINE_TYPES } from '../../model/standards';
import type { LineTypeId, ProjectionLink, SheetDoc, View } from '../../model/types';
import { parseScale } from '../input';
import type { CommandContext, CommandGen, Input, Option, SubGen } from './types';

/** Projection link for a view placed at `p` relative to `parent`: beside → slides along x, above/below → along y. */
export function linkFor(parent: View, p: Vec2): { origin: Vec2; link: ProjectionLink } {
  const dx = p.x - parent.origin.x;
  const dy = p.y - parent.origin.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { origin: { x: p.x, y: parent.origin.y }, link: { parentId: parent.id, freeAxis: 'x' } }
    : { origin: { x: parent.origin.x, y: p.y }, link: { parentId: parent.id, freeAxis: 'y' } };
}

export function findView(doc: SheetDoc, text: string): View | undefined {
  const t = text.trim().toLowerCase();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= doc.views.length) return doc.views[n - 1];
  return doc.views.find((v) => v.name.toLowerCase() === t) ?? doc.views.find((v) => v.name.toLowerCase().startsWith(t));
}

function* askScale(ctx: CommandContext, def: number): SubGen<number | null> {
  for (;;) {
    const r = yield { kind: 'text', prompt: 'Specify view scale (e.g. 1:2, 2:1)', default: formatScale(def) };
    if (r.kind !== 'text') return null;
    const s = parseScale(r.text);
    if (s) return s;
    ctx.log('Invalid scale.');
  }
}

function* viewNew(ctx: CommandContext): SubGen<void> {
  const doc = ctx.doc;
  const nameR = yield { kind: 'text', prompt: 'Enter view name', default: `View ${doc.views.length + 1}` };
  if (nameR.kind !== 'text') return;
  const name = nameR.text.trim() || `View ${doc.views.length + 1}`;
  if (doc.views.some((v) => v.name === name)) {
    ctx.log(`View "${name}" already exists.`);
    return;
  }
  const scale = yield* askScale(ctx, ctx.view().scale);
  if (!scale) return;
  const parent = ctx.view();
  let linked = true;
  for (;;) {
    const r: Input = yield {
      kind: 'point',
      prompt: linked ? `Specify view origin (projection-linked to "${parent.name}")` : 'Specify view origin',
      options: linked ? [{ key: 'U', label: 'Unlinked' }] : [{ key: 'L', label: 'Linked' }],
      preview: (p) => ({ markers: [linked ? linkFor(parent, p).origin : p] }),
    };
    if (r.kind === 'option') {
      linked = r.key !== 'U';
      continue;
    }
    if (r.kind !== 'point') return;
    const placed = linked ? linkFor(parent, r.p) : { origin: r.p, link: null };
    const view: View = { id: newId('v'), name, scale, origin: placed.origin, link: placed.link };
    doc.views.push(view);
    ctx.settings.currentViewId = view.id;
    ctx.log(`View "${name}" ${formatScale(scale)} created${view.link ? `, linked along ${view.link.freeAxis}` : ''}; now current.`);
    return;
  }
}

function* viewMove(ctx: CommandContext): SubGen<void> {
  const v = ctx.view();
  const b = yield { kind: 'point', prompt: `Specify base point (moving "${v.name}")` };
  if (b.kind !== 'point') return;
  const constrain = (p: Vec2): Vec2 => {
    const d = { x: p.x - b.p.x, y: p.y - b.p.y };
    if (!v.link) return d;
    return v.link.freeAxis === 'x' ? { x: d.x, y: 0 } : { x: 0, y: d.y };
  };
  const t = yield {
    kind: 'point',
    prompt: 'Specify second point',
    base: b.p,
    preview: (p) => {
      const d = constrain(p);
      return { markers: [{ x: v.origin.x + d.x, y: v.origin.y + d.y }] };
    },
  };
  if (t.kind !== 'point') return;
  moveView(ctx.doc, v.id, { x: t.p.x - b.p.x, y: t.p.y - b.p.y });
}

export function* view(ctx: CommandContext): CommandGen {
  const opts: Option[] = [
    { key: 'N', label: 'New' },
    { key: 'M', label: 'Move' },
    { key: 'S', label: 'Set' },
    { key: 'SC', label: 'SCale' },
    { key: 'U', label: 'Unlink' },
  ];
  const r = yield { kind: 'text', prompt: `Current view: "${ctx.view().name}". Enter an option`, options: opts };
  if (r.kind !== 'option') return;
  switch (r.key) {
    case 'N':
      yield* viewNew(ctx);
      return;
    case 'M':
      yield* viewMove(ctx);
      return;
    case 'S': {
      ctx.log(ctx.doc.views.map((v, i) => `${i + 1}: ${v.name} (${formatScale(v.scale)})`).join('   '));
      const n = yield { kind: 'text', prompt: 'Enter view name or number' };
      if (n.kind !== 'text') return;
      const v = findView(ctx.doc, n.text);
      if (!v) ctx.log('No such view.');
      else ctx.settings.currentViewId = v.id;
      return;
    }
    case 'SC': {
      const s = yield* askScale(ctx, ctx.view().scale);
      if (s) ctx.view().scale = s;
      return;
    }
    case 'U': {
      const v = ctx.view();
      if (!v.link) ctx.log(`"${v.name}" is not linked.`);
      v.link = null;
      return;
    }
  }
}

export const LTYPE_OPTIONS: Option[] = [
  { key: 'V', label: 'Visible' },
  { key: 'T', label: 'Thin' },
  { key: 'H', label: 'Hidden' },
  { key: 'C', label: 'Center' },
  { key: 'P', label: 'Phantom' },
  { key: 'CO', label: 'COnstruction' },
];

const LTYPE_BY_KEY: Record<string, LineTypeId> = { V: 'visible', T: 'thin', H: 'hidden', C: 'center', P: 'phantom', CO: 'construction' };

/** Set the line type of the pre-selection, or the current line type. */
export function* ltype(ctx: CommandContext): CommandGen {
  const sel = ctx.preselection;
  ctx.preselection = [];
  const cur = LINE_TYPES[ctx.settings.lineType];
  const r = yield { kind: 'text', prompt: `Enter line type (current: ${cur.label} ${cur.isoNo ?? ''})`.replace(' )', ')'), options: LTYPE_OPTIONS };
  if (r.kind !== 'option') return;
  const lt = LTYPE_BY_KEY[r.key];
  const ids = new Set(sel);
  const ents = ctx.doc.entities.filter((e) => ids.has(e.id));
  if (ents.length > 0) {
    for (const e of ents) e.lineType = lt;
    ctx.log(`${ents.length} object(s) changed to ${LINE_TYPES[lt].label}.`);
  } else {
    ctx.settings.lineType = lt;
  }
}

export function* layer(ctx: CommandContext): CommandGen {
  const doc = ctx.doc;
  for (;;) {
    ctx.log(`Layers: ${doc.layers.map((l) => `${l.name}${l.visible ? '' : ' (off)'}${l.name === ctx.settings.layer ? ' *' : ''}`).join(', ')}`);
    const r = yield {
      kind: 'text',
      prompt: 'Enter an option',
      options: [{ key: 'N', label: 'New' }, { key: 'ON', label: 'ON' }, { key: 'OFF', label: 'OFF' }, { key: 'S', label: 'Set' }],
      allowEnter: true,
    };
    if (r.kind !== 'option') return;
    const n = yield { kind: 'text', prompt: 'Enter layer name' };
    if (n.kind !== 'text' || !n.text.trim()) continue;
    const name = n.text.trim();
    const l = doc.layers.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (r.key === 'N') {
      if (l) ctx.log(`Layer "${name}" already exists.`);
      else doc.layers.push({ name, visible: true });
      continue;
    }
    if (!l) {
      ctx.log(`No layer "${name}".`);
      continue;
    }
    if (r.key === 'S') {
      ctx.settings.layer = l.name;
      l.visible = true;
    } else if (r.key === 'ON') {
      l.visible = true;
    } else if (l.name === ctx.settings.layer) {
      ctx.log('Cannot turn off the current layer.');
    } else {
      l.visible = false;
    }
  }
}

export function* zoom(ctx: CommandContext): CommandGen {
  const r = yield { kind: 'text', prompt: 'Enter an option', options: [{ key: 'E', label: 'Extents' }, { key: 'A', label: 'All' }], default: 'E' };
  if (r.kind === 'option' || r.kind === 'text') ctx.host.zoomExtents?.();
}

export function* titleblock(ctx: CommandContext): CommandGen {
  ctx.host.titleBlock?.();
}

