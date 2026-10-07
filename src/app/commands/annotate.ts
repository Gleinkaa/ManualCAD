// Annotation commands: TEXT (single-line text, ISO 3098), SKETCH (freehand break lines, ISO 128-2 01.1),
// LEADER (notes on leader lines, ISO 128-22) and BALLOON (item numbers, ISO 6433).
import { freehandCurve } from '../../geom';
import type { Vec2 } from '../../geom/types';
import { newId } from '../../model/doc';
import { ITEM_NUMBER_HEIGHT_FACTOR, LINE_GROUPS, TEXT_HEIGHTS } from '../../model/standards';
import type { Leader, TextNote } from '../../model/types';
import type { SnapHit } from '../snap';
import { selectObjects, type CommandContext, type CommandGen, type Input, type Option, type PointInput, type SubGen } from './types';

/** AutoCAD control codes: %%c → ⌀, %%d → °, %%p → ±. */
export function expandControlCodes(s: string): string {
  return s.replace(/%%c/gi, '⌀').replace(/%%d/gi, '°').replace(/%%p/gi, '±');
}

/** The ISO 3098 height nearest to `h` (paper mm). */
export function isoTextHeight(h: number): number {
  return TEXT_HEIGHTS.reduce((best, x) => (Math.abs(x - h) < Math.abs(best - h) ? x : best));
}

/** Line pitch of multi-line text: ISO 3098 minimum baseline spacing is 1.43 h; 1.6 h reads better. */
const LINE_PITCH = 1.6;

const JUSTIFY: Record<string, TextNote['align']> = { L: 'left', C: 'center', R: 'right' };

export function* text(ctx: CommandContext): CommandGen {
  let align: TextNote['align'] = 'left';
  let start: Input;
  for (;;) {
    start = yield { kind: 'point', prompt: align === 'left' ? 'Specify start point of text' : `Specify ${align} point of text`, options: [{ key: 'J', label: 'Justify' }] };
    if (start.kind !== 'option') break;
    const j = yield { kind: 'text', prompt: 'Enter an option', options: [{ key: 'L', label: 'Left' }, { key: 'C', label: 'Center' }, { key: 'R', label: 'Right' }] };
    if (j.kind === 'option') align = JUSTIFY[j.key];
  }
  if (start.kind !== 'point') return;
  const view = ctx.view();
  const pos = ctx.local(start.p);
  const hr = yield { kind: 'number', prompt: 'Specify height', default: ctx.settings.textHeight };
  if (hr.kind !== 'number') return;
  const height = isoTextHeight(hr.value);
  if (Math.abs(height - hr.value) > 1e-9) ctx.log(`Height ${hr.value} is not in the ISO 3098 series; using ${height}.`);
  ctx.settings.textHeight = height;
  const ar = yield { kind: 'number', prompt: 'Specify rotation angle of text', default: 0 };
  if (ar.kind !== 'number') return;
  const angle = (ar.value * Math.PI) / 180;
  // next line: one pitch "down" in the text's own frame, converted to view-local mm
  const step: Vec2 = { x: (Math.sin(angle) * LINE_PITCH * height) / view.scale, y: (-Math.cos(angle) * LINE_PITCH * height) / view.scale };
  let at = pos;
  for (;;) {
    const r = yield { kind: 'text', prompt: 'Enter text', allowEnter: true };
    if (r.kind !== 'text' || r.text === '') return;
    const note: TextNote = { kind: 'text', id: newId('a'), viewId: view.id, layer: ctx.settings.layer, pos: at, text: expandControlCodes(r.text), height, angle, align };
    ctx.doc.annotations.push(note);
    at = { x: at.x + step.x, y: at.y + step.y };
  }
}

/** TEXTEDIT (ED, DDEDIT): replace the text of selected notes and leaders, one after the other. */
export function* textedit(ctx: CommandContext): CommandGen {
  const ids = new Set(yield* selectObjects(ctx, 'Select text or leader'));
  const targets = ctx.doc.annotations.filter((a): a is TextNote | Leader => (a.kind === 'text' || a.kind === 'leader') && ids.has(a.id));
  if (targets.length === 0) {
    ctx.log(ids.size > 0 ? 'No text in the selection.' : 'Nothing selected.');
    return;
  }
  let changed = 0;
  for (const t of targets) {
    const r = yield { kind: 'text', prompt: t.kind === 'leader' ? 'Enter note text' : 'Enter text', default: t.text || undefined, allowEnter: true };
    if (r.kind !== 'text' && r.kind !== 'enter') return;
    const text = r.kind === 'text' ? expandControlCodes(r.text.trim()) : t.text;
    if (text === t.text) continue;
    if (!text && t.kind === 'text') {
      ctx.log('Empty text: use ERASE to remove a note.');
      continue;
    }
    t.text = text;
    changed++;
  }
  if (targets.length > 1) ctx.log(`${changed} text${changed === 1 ? '' : 's'} changed.`);
}

/** Freehand line through clicked points, always line type `freehand` (limits of break-outs and partial views). */
export function* sketch(ctx: CommandContext): CommandGen {
  const first = yield { kind: 'point', prompt: 'Specify first point of freehand line' };
  if (first.kind !== 'point') return;
  const pts: Vec2[] = [first.p];
  const curvesThrough = (sheetPts: Vec2[]) => freehandCurve(sheetPts.map((p) => ctx.local(p)));
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: pts.length < 2 ? 'Specify next point' : 'Specify next point or <finish>',
      options: pts.length > 1 ? [{ key: 'U', label: 'Undo' }] : [],
      allowEnter: true,
      base: pts[pts.length - 1],
      preview: (p) => ({ curves: curvesThrough([...pts, p]).map((curve) => ({ curve, lineType: 'freehand' as const })) }),
    };
    if (r.kind === 'option') {
      pts.pop();
      continue;
    }
    if (r.kind === 'point') {
      pts.push(r.p);
      continue;
    }
    break;
  }
  const curves = curvesThrough(pts);
  if (curves.length === 0) {
    ctx.log('A freehand line needs two different points.');
    return;
  }
  for (const c of curves) ctx.addEntity(c, { lineType: 'freehand' });
}

type Terminator = Leader['terminator'];

/**
 * ISO 128-22 terminator from where the tip landed: on an object's outline (any snap except a centre) → arrowhead,
 * anywhere else (inside the outline) → dot. The Terminator option overrides it, e.g. None for a tip on a dimension line.
 */
export function autoTerminator(snap: SnapHit | null): Terminator {
  return snap && snap.kind !== 'center' ? 'arrow' : 'dot';
}

const TERMINATORS: Record<string, Terminator | null> = { A: 'arrow', D: 'dot', N: 'none', U: null };

/** Tip prompt with the Terminator option; `forced` null = choose automatically from the snap. */
function* leaderTip(ctx: CommandContext, prompt: string): SubGen<{ tip: PointInput; terminator: Terminator } | null> {
  let forced: Terminator | null = null;
  const termOption: Option[] = [{ key: 'T', label: 'Terminator' }];
  for (;;) {
    const r = yield { kind: 'point', prompt, options: termOption };
    if (r.kind === 'option') {
      const t = yield {
        kind: 'text',
        prompt: 'Terminator',
        options: [{ key: 'A', label: 'Arrow' }, { key: 'D', label: 'Dot' }, { key: 'N', label: 'None' }, { key: 'U', label: 'aUto' }],
        default: 'U',
      };
      if (t.kind === 'option') forced = TERMINATORS[t.key];
      ctx.log(forced ? `Terminator: ${forced}.` : 'Terminator: automatic (arrow on an outline, dot inside).');
      continue;
    }
    if (r.kind !== 'point') return null;
    return { tip: r, terminator: forced ?? autoTerminator(r.snap) };
  }
}

/** LEADER: tip, any number of further points, then the note on a horizontal reference line. */
export function* leader(ctx: CommandContext): CommandGen {
  const start = yield* leaderTip(ctx, 'Specify leader arrowhead location');
  if (!start) return;
  const view = ctx.view();
  const pts: Vec2[] = [start.tip.p];
  const make = (sheetPts: Vec2[], text: string): Leader => ({
    kind: 'leader',
    id: newId('a'),
    viewId: view.id,
    layer: ctx.settings.layer,
    points: sheetPts.map((p) => ctx.local(p)),
    terminator: start.terminator,
    style: 'note',
    text,
    height: ctx.settings.textHeight,
  });
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: pts.length < 2 ? 'Specify next point' : 'Specify next point or <enter text>',
      options: pts.length > 1 ? [{ key: 'U', label: 'Undo' }] : [],
      allowEnter: pts.length > 1,
      base: pts[pts.length - 1],
      preview: (p) => ({ annotations: [make([...pts, p], '')] }),
    };
    if (r.kind === 'option') {
      pts.pop();
      continue;
    }
    if (r.kind === 'point') {
      pts.push(r.p);
      continue;
    }
    if (r.kind !== 'enter') return;
    break;
  }
  const t = yield { kind: 'text', prompt: 'Enter note text <none>', allowEnter: true };
  if (t.kind !== 'text' && t.kind !== 'enter') return;
  ctx.doc.annotations.push(make(pts, t.kind === 'text' ? expandControlCodes(t.text.trim()) : ''));
}

/** Next free item number: one above the highest on the sheet, or the first parts list row not yet placed. */
export function nextItemNumber(ctx: CommandContext): string {
  const used = new Set(ctx.doc.annotations.filter((a) => a.kind === 'leader' && a.style === 'item').map((a) => (a as Leader).text));
  for (const row of ctx.doc.partsList) if (row.item && !used.has(row.item)) return row.item;
  let n = 1;
  for (const u of used) if (/^\d+$/.test(u)) n = Math.max(n, Number(u) + 1);
  return String(n);
}

/** BALLOON: item number (ISO 6433) on a straight leader, tip normally inside the part (dot). */
export function* balloon(ctx: CommandContext): CommandGen {
  const start = yield* leaderTip(ctx, 'Specify point on the part');
  if (!start) return;
  const view = ctx.view();
  const height = ITEM_NUMBER_HEIGHT_FACTOR * LINE_GROUPS[ctx.doc.lineGroup].dimText;
  const make = (end: Vec2, text: string): Leader => ({
    kind: 'leader',
    id: newId('a'),
    viewId: view.id,
    layer: ctx.settings.layer,
    points: [ctx.local(start.tip.p), ctx.local(end)],
    terminator: start.terminator,
    style: 'item',
    text,
    height,
  });
  const preset = nextItemNumber(ctx);
  const e = yield { kind: 'point', prompt: 'Specify item number location', base: start.tip.p, preview: (p) => ({ annotations: [make(p, preset)] }) };
  if (e.kind !== 'point') return;
  const n = yield { kind: 'text', prompt: 'Enter item number', default: preset };
  if (n.kind !== 'text') return;
  const text = n.text.trim() || preset;
  ctx.doc.annotations.push(make(e.p, text));
  if (ctx.doc.partsList.length > 0 && !ctx.doc.partsList.some((r) => r.item === text)) ctx.log(`Item ${text} is not in the parts list yet (PARTSLIST Add).`);
}
