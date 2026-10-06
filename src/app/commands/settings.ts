// Sheet organisation commands: VIEW, LTYPE, LAYER, ZOOM, TITLEBLOCK.
import type { Vec2 } from '../../geom/types';
import { moveView, newId } from '../../model/doc';
import { formatScale, LINE_TYPES } from '../../model/standards';
import type { LineTypeId, PartsListRow, ProjectionLink, SheetDoc, View } from '../../model/types';
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
    // free placements land on a 0.5 mm sheet grid so view origins stay readable
    const p = r.snap ? r.p : { x: Math.round(r.p.x * 2) / 2, y: Math.round(r.p.y * 2) / 2 };
    const placed = linked ? linkFor(parent, p) : { origin: p, link: null };
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
    { key: 'LA', label: 'LAbel' },
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
    case 'LA': {
      const v = ctx.view();
      v.label = v.label === false ? undefined : false;
      ctx.log(`Label of "${v.name}" ${v.label === false ? 'off' : 'on (printed when ISO 128-3 asks for one)'}.`);
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
  { key: 'F', label: 'Freehand' },
  { key: 'CO', label: 'COnstruction' },
];

const LTYPE_BY_KEY: Record<string, LineTypeId> = { V: 'visible', T: 'thin', H: 'hidden', C: 'center', P: 'phantom', F: 'freehand', CO: 'construction' };

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

// --- PARTSLIST: ISO 7573 parts list above the title block ---

const PARTS_FIELDS: { field: keyof PartsListRow; prompt: string }[] = [
  { field: 'item', prompt: 'Item number (Pos.)' },
  { field: 'quantity', prompt: 'Quantity (Menge)' },
  { field: 'name', prompt: 'Name (Benennung)' },
  { field: 'standard', prompt: 'Part number / standard (Sachnummer/Norm)' },
  { field: 'material', prompt: 'Material (Werkstoff)' },
  { field: 'stock', prompt: 'Raw dimensions / pattern (Rohmaße)' },
  { field: 'remark', prompt: 'Remark (Bemerkung)' },
];

function emptyRow(): PartsListRow {
  return { item: '', quantity: '', name: '', standard: '', material: '', stock: '', remark: '' };
}

function rowSummary(r: PartsListRow): string {
  return [r.item, r.quantity && `${r.quantity}×`, r.name, r.standard, r.material, r.stock, r.remark].filter(Boolean).join('  ');
}

/** Ask every field of `row`; Enter keeps the shown value, "." clears it. False if cancelled. */
function* askRow(row: PartsListRow): SubGen<boolean> {
  for (const f of PARTS_FIELDS) {
    const r = yield { kind: 'text', prompt: f.prompt, default: row[f.field] };
    if (r.kind !== 'text') return false;
    const t = r.text.trim();
    row[f.field] = t === '.' ? '' : t;
  }
  return true;
}

function findRow(doc: SheetDoc, item: string): number {
  return doc.partsList.findIndex((r) => r.item.trim().toLowerCase() === item.trim().toLowerCase());
}

/** PARTSLIST opens the dialog where there is one; -PARTSLIST (and tests) use the command line. */
export function* partslist(ctx: CommandContext): CommandGen {
  if (ctx.host.partsList) {
    ctx.host.partsList();
    return;
  }
  yield* partslistCommandLine(ctx);
}

export function* partslistCommandLine(ctx: CommandContext): CommandGen {
  const doc = ctx.doc;
  for (;;) {
    const r = yield {
      kind: 'text',
      prompt: `Parts list (${doc.partsList.length} row${doc.partsList.length === 1 ? '' : 's'}). Enter an option`,
      options: [{ key: 'A', label: 'Add' }, { key: 'E', label: 'Edit' }, { key: 'D', label: 'Delete' }, { key: 'L', label: 'List' }],
      allowEnter: true,
    };
    if (r.kind !== 'option') return;
    if (r.key === 'L') {
      ctx.log(doc.partsList.length ? doc.partsList.map(rowSummary).join('   |   ') : 'Parts list is empty.');
      continue;
    }
    if (r.key === 'A') {
      const row = emptyRow();
      row.item = String(doc.partsList.length + 1);
      row.quantity = '1';
      if (!(yield* askRow(row))) return;
      if (row.item && findRow(doc, row.item) >= 0) ctx.log(`Note: item ${row.item} already exists.`);
      doc.partsList.push(row);
      continue;
    }
    if (doc.partsList.length === 0) {
      ctx.log('Parts list is empty.');
      continue;
    }
    const n = yield { kind: 'text', prompt: 'Enter item number' };
    if (n.kind !== 'text') return;
    const i = findRow(doc, n.text);
    if (i < 0) {
      ctx.log(`No item "${n.text.trim()}".`);
      continue;
    }
    if (r.key === 'D') {
      doc.partsList.splice(i, 1);
      continue;
    }
    ctx.log('Enter keeps a value, "." clears it.');
    const row = { ...doc.partsList[i] };
    if (!(yield* askRow(row))) return;
    doc.partsList[i] = row;
  }
}
