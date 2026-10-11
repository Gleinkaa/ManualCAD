// Symbol commands (CONTEXT.md "Symbol"): SURFACE places a surface texture symbol (ISO 21920-1, layout of
// ISO 1302), TAPER a taper or slope symbol with its ratio on a leader (ISO 3040). The program builds the symbol
// from the entered values; its size comes from the sheet's lettering height, its lines are narrow lines.
import type { Vec2 } from '../../geom/types';
import { taperDirection } from '../../model/annot';
import { newId } from '../../model/doc';
import { SURFACE_LAY_SYMBOLS, SURFACE_PROCESS_WORDS } from '../../model/standards';
import type { SurfaceFields, SurfaceRemoval, SurfaceSymbol, TaperSymbol } from '../../model/types';
import { expandControlCodes } from './text-codes';
import type { AppSettings, CommandContext, CommandGen, Option, SubGen } from './types';

/** What the symbol commands remember between runs (per app session, like AutoCAD's last-used values). */
interface SymbolMemory {
  removal: SurfaceRemoval;
  roughness: string;
  form: TaperSymbol['form'];
  ratio: string;
}

const memories = new WeakMap<AppSettings, SymbolMemory>();

function memory(ctx: CommandContext): SymbolMemory {
  let m = memories.get(ctx.settings);
  if (!m) {
    m = { removal: 'required', roughness: '', form: 'taper', ratio: '' };
    memories.set(ctx.settings, m);
  }
  return m;
}

export const EMPTY_FIELDS: SurfaceFields = { roughness: '', second: '', process: '', lay: '', allowance: '' };

const REMOVAL_OPTIONS: Option[] = [
  { key: 'A', label: 'Any process' },
  { key: 'R', label: 'Removal required' },
  { key: 'P', label: 'removal Prohibited' },
  { key: 'C', label: 'Collective' },
];
const REMOVAL_BY_KEY: Record<string, SurfaceRemoval> = { A: 'any', R: 'required', P: 'prohibited' };
const REMOVAL_TEXT: Record<SurfaceRemoval, string> = {
  any: 'any process',
  required: 'material removal required',
  prohibited: 'material removal prohibited',
};

/** Process words of the BBRZ list as option chips: type the number, the word, or any other text. */
export const PROCESS_OPTIONS: Option[] = SURFACE_PROCESS_WORDS.map((w, i) => ({ key: String(i + 1), label: w }));

const LAY_NAMES: Record<string, string> = { '=': 'parallel', '⊥': 'perpendicular', X: 'crossed', M: 'multi-directional', C: 'circular', R: 'radial', P: 'particulate' };
/** Lay symbols as chips; `⊥` is typed as T. */
export const LAY_OPTIONS: Option[] = SURFACE_LAY_SYMBOLS.map((s) => ({ key: s === '⊥' ? 'T' : s, label: `${s} ${LAY_NAMES[s]}` }));

/** ISO 21920-1: the symbol and its texts must be readable from the bottom or the right, i.e. turned 0° to 90°. */
export function readable(angle: number): boolean {
  const deg = (((angle * 180) / Math.PI) % 360 + 360) % 360;
  return deg <= 90 + 1e-6 || deg >= 360 - 1e-6;
}

/** One field prompt: Enter keeps `current` (or leaves the field empty), a chip or typed text sets it. */
function* fieldPrompt(prompt: string, current: string, options?: Option[], fromOption?: (key: string) => string): SubGen<string | null> {
  const r = yield { kind: 'text', prompt, default: current || undefined, options, allowEnter: true };
  if (r.kind === 'option') return fromOption ? fromOption(r.key) : r.key;
  if (r.kind === 'text') return expandControlCodes(r.text.trim());
  if (r.kind === 'enter') return current;
  return null;
}

/** Ask the five fields in ISO 1302 position order a–e; null when the command was cancelled. */
export function* surfaceFields(current: SurfaceFields): SubGen<SurfaceFields | null> {
  const a = yield* fieldPrompt('Enter surface texture requirement (a), e.g. Ra 3,2', current.roughness);
  if (a === null) return null;
  const b = yield* fieldPrompt('Enter second requirement (b)', current.second);
  if (b === null) return null;
  const c = yield* fieldPrompt('Enter manufacturing method (c)', current.process, PROCESS_OPTIONS, (k) => SURFACE_PROCESS_WORDS[Number(k) - 1]);
  if (c === null) return null;
  const d = yield* fieldPrompt('Enter surface lay (d)', current.lay, LAY_OPTIONS, (k) => (k === 'T' ? '⊥' : k));
  if (d === null) return null;
  const e = yield* fieldPrompt('Enter machining allowance (e)', current.allowance);
  if (e === null) return null;
  return { roughness: a, second: b, process: c, lay: d, allowance: e };
}

/**
 * SURFACE: vertex on the surface (snap to the outline or an extension line), rotation (typed, or picked as the
 * direction the symbol stands up towards), then the texts a–e. Type options switch the process requirement;
 * Collective places the "(✓)" of a collective indication without texts.
 */
export function* surface(ctx: CommandContext): CommandGen {
  const mem = memory(ctx);
  const view = ctx.view();
  let collective = false;
  const make = (pos: Vec2, angle: number, fields: SurfaceFields): SurfaceSymbol => ({
    kind: 'surface',
    id: newId('a'),
    viewId: view.id,
    layer: ctx.settings.layer,
    pos: ctx.local(pos),
    angle,
    removal: mem.removal,
    fields: collective ? EMPTY_FIELDS : fields,
    collective,
  });
  const preview = (p: Vec2) => ({ annotations: [make(p, 0, { ...EMPTY_FIELDS, roughness: mem.roughness })] });
  let at: Vec2;
  for (;;) {
    const what = `${collective ? 'collective indication, ' : ''}${REMOVAL_TEXT[mem.removal]}`;
    const r = yield { kind: 'point', prompt: `Specify point on the surface (${what})`, options: REMOVAL_OPTIONS, preview };
    if (r.kind === 'option') {
      if (r.key === 'C') collective = !collective;
      else mem.removal = REMOVAL_BY_KEY[r.key];
      continue;
    }
    if (r.kind !== 'point') return;
    at = r.p;
    break;
  }
  const rot = yield {
    kind: 'point',
    prompt: 'Specify rotation angle or direction the symbol stands towards <0>',
    base: at,
    acceptNumber: true,
    allowEnter: true,
    preview: (p) => ({ annotations: [make(at, upAngle(at, p), { ...EMPTY_FIELDS, roughness: mem.roughness })] }),
  };
  let angle = 0;
  if (rot.kind === 'number') angle = (rot.value * Math.PI) / 180;
  else if (rot.kind === 'point') angle = upAngle(at, rot.p);
  else if (rot.kind !== 'enter') return;
  if (!readable(angle)) ctx.log('Not readable from the bottom or right (ISO 21920-1): put the symbol on an extension or leader line instead.');
  let fields: SurfaceFields = EMPTY_FIELDS;
  if (!collective) {
    const f = yield* surfaceFields({ ...EMPTY_FIELDS, roughness: mem.roughness });
    if (!f) return;
    fields = f;
    if (f.roughness) mem.roughness = f.roughness;
  }
  ctx.doc.annotations.push(make(at, angle, fields));
}

/** Rotation that makes the symbol stand up towards `p`: its upright axis points from the vertex to `p`. */
function upAngle(vertex: Vec2, p: Vec2): number {
  if (Math.hypot(p.x - vertex.x, p.y - vertex.y) < 1e-9) return 0;
  const a = Math.atan2(p.y - vertex.y, p.x - vertex.x) - Math.PI / 2;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const FORM_OPTIONS: Option[] = [{ key: 'F', label: 'Form' }];

/**
 * TAPER: arrowhead on the tapered or inclined outline, further leader points, Enter, then the ratio and the way the
 * part narrows. The Form option switches between taper (cone, ISO 3040) and slope.
 */
export function* taper(ctx: CommandContext): CommandGen {
  const mem = memory(ctx);
  const view = ctx.view();
  const make = (sheetPts: Vec2[], ratio: string, direction: Vec2): TaperSymbol => ({
    kind: 'taper',
    id: newId('a'),
    viewId: view.id,
    layer: ctx.settings.layer,
    form: mem.form,
    points: sheetPts.map((p) => ctx.local(p)),
    ratio,
    direction,
  });
  let first: Vec2;
  for (;;) {
    const r = yield { kind: 'point', prompt: `Specify leader arrowhead location on the ${mem.form === 'taper' ? 'cone' : 'inclined surface'}`, options: FORM_OPTIONS };
    if (r.kind === 'option') {
      const f = yield { kind: 'text', prompt: 'Symbol form', options: [{ key: 'T', label: 'Taper' }, { key: 'S', label: 'Slope' }], default: mem.form === 'taper' ? 'T' : 'S' };
      if (f.kind === 'option') mem.form = f.key === 'S' ? 'slope' : 'taper';
      ctx.log(`Form: ${mem.form}.`);
      continue;
    }
    if (r.kind !== 'point') return;
    first = r.p;
    break;
  }
  const pts: Vec2[] = [first];
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: pts.length < 2 ? 'Specify next point' : 'Specify next point or <enter ratio>',
      options: pts.length > 1 ? [{ key: 'U', label: 'Undo' }] : [],
      allowEnter: pts.length > 1,
      base: pts[pts.length - 1],
      preview: (p) => ({ annotations: [make([...pts, p], mem.ratio || '1:', taperDirection(mem.form, 1))] }),
    };
    if (r.kind === 'option') {
      if (pts.length > 1) pts.pop();
      continue;
    }
    if (r.kind === 'point') {
      pts.push(r.p);
      continue;
    }
    if (r.kind !== 'enter') return;
    break;
  }
  let ratio = '';
  while (!ratio) {
    const t = yield { kind: 'text', prompt: mem.form === 'taper' ? 'Enter rate of taper, e.g. 1:5' : 'Enter slope, e.g. 1:10 or 5%', default: mem.ratio || undefined };
    if (t.kind !== 'text' && t.kind !== 'enter') return;
    ratio = t.kind === 'text' ? t.text.trim() : '';
    if (!ratio) ctx.log('The symbol needs its ratio.');
  }
  mem.ratio = ratio;
  const d = yield {
    kind: 'text',
    prompt: mem.form === 'taper' ? 'Cone narrows towards' : 'Surface falls towards',
    options: [{ key: 'R', label: 'Right' }, { key: 'L', label: 'Left' }],
    default: 'R',
  };
  if (d.kind !== 'option') return;
  ctx.doc.annotations.push(make(pts, ratio, taperDirection(mem.form, d.key === 'L' ? -1 : 1)));
}

/** TEXTEDIT on a symbol: the surface texts a–e one after the other, or the taper ratio. False when cancelled. */
export function* editSymbol(s: SurfaceSymbol | TaperSymbol): SubGen<boolean> {
  if (s.kind === 'surface') {
    const f = yield* surfaceFields(s.fields);
    if (!f) return false;
    s.fields = f;
    return true;
  }
  const t = yield { kind: 'text', prompt: 'Enter ratio', default: s.ratio || undefined, allowEnter: true };
  if (t.kind !== 'text' && t.kind !== 'enter') return false;
  if (t.kind === 'text' && t.text.trim()) s.ratio = t.text.trim();
  return true;
}
