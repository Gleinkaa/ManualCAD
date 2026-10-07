// HATCH: section hatching per ISO 128-50, by picking points inside closed boundaries.
import { findRegion } from '../../geom';
import { newId } from '../../model/doc';
import { hatchSheetSegments } from '../../plot';
import type { Hatch, LineTypeId } from '../../model/types';
import { fmt } from '../input';
import { visibleEntities } from '../xform';
import type { CommandContext, CommandGen } from './types';

/** Line types that bound a cut surface: visible edges, thin lines and break-out freehand lines. */
const BOUNDARY_TYPES: ReadonlySet<LineTypeId> = new Set(['visible', 'thin', 'freehand']);

export function* hatch(ctx: CommandContext): CommandGen {
  const s = ctx.settings;
  let count = 0;
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: `Pick internal point (angle ${fmt(s.hatchAngle, 2)}°, spacing ${fmt(s.hatchSpacing, 2)})`,
      options: [{ key: 'A', label: 'Angle' }, { key: 'S', label: 'Spacing' }],
      allowEnter: true,
    };
    if (r.kind === 'option' && r.key === 'A') {
      const a = yield { kind: 'number', prompt: 'Specify hatch angle', default: s.hatchAngle };
      if (a.kind === 'number') s.hatchAngle = a.value;
      continue;
    }
    if (r.kind === 'option' && r.key === 'S') {
      const d = yield { kind: 'number', prompt: 'Specify hatch line spacing (paper mm)', default: s.hatchSpacing };
      if (d.kind === 'number') {
        if (d.value > 0) s.hatchSpacing = d.value;
        else ctx.log('Spacing must be positive.');
      }
      continue;
    }
    if (r.kind !== 'point') {
      if (count > 0) ctx.log(`${count} hatch(es) created.`);
      return;
    }
    const viewId = s.currentViewId;
    const curves = visibleEntities(ctx.doc)
      .filter((e) => e.viewId === viewId && BOUNDARY_TYPES.has(e.lineType))
      .map((e) => e.geom);
    const loops = findRegion(curves, ctx.local(r.p));
    if (!loops) {
      ctx.log('No closed boundary found around the point.');
      continue;
    }
    const h: Hatch = { kind: 'hatch', id: newId('a'), viewId, layer: s.layer, loops, angle: s.hatchAngle, spacing: s.hatchSpacing };
    if (hatchSheetSegments(ctx.doc, h).length === 0) {
      ctx.log('Hatch spacing yields no lines in this region; adjust the spacing.');
      continue;
    }
    ctx.doc.annotations.push(h);
    count++;
  }
}
