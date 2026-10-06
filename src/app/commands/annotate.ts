// Annotation commands: TEXT (single-line text, ISO 3098) and SKETCH (freehand break lines, ISO 128-2 01.1).
import { freehandCurve } from '../../geom';
import type { Vec2 } from '../../geom/types';
import { newId } from '../../model/doc';
import { TEXT_HEIGHTS } from '../../model/standards';
import type { TextNote } from '../../model/types';
import type { CommandContext, CommandGen, Input } from './types';

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
