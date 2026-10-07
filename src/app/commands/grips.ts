// GRIPSTRETCH: drag a hot grip (and every selected grip at the same spot) to a new point. Started by the app
// when a grip is clicked; `ctx.grip` carries the grips. Not a typed command.
import type { Vec2 } from '../../geom/types';
import { toLocal } from '../../model/doc';
import { applyGrip, stretchAnnotation, stretchCurve, type Grip } from '../grips';
import type { CommandContext, CommandGen, Preview } from './types';

export interface GripDrag {
  grips: Grip[];             // all hot grips (coincident grips of the selection)
  base: Vec2;                // sheet mm
}

export function* gripstretch(ctx: CommandContext): CommandGen {
  const drag = ctx.grip;
  ctx.grip = null;
  if (!drag || drag.grips.length === 0) {
    ctx.log('Click a grip of a selected object to stretch it.');
    return;
  }
  const preview = (p: Vec2): Preview => {
    const out: Preview = { curves: [], annotations: [] };
    for (const g of drag.grips) {
      const to = toLocal(ctx.viewOf(g.viewId), p);
      const e = ctx.entity(g.id);
      if (e) out.curves!.push({ curve: stretchCurve(e.geom, g, to), lineType: e.lineType, viewId: e.viewId });
      const a = ctx.doc.annotations.find((x) => x.id === g.id);
      if (a) out.annotations!.push(stretchAnnotation(a, g, to));
    }
    return out;
  };
  const r = yield { kind: 'point', prompt: 'Specify stretch point', base: drag.base, preview };
  if (r.kind !== 'point') return;
  for (const g of drag.grips) applyGrip(ctx.doc, g, toLocal(ctx.viewOf(g.viewId), r.p));
}
