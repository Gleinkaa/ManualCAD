// Annotation helpers: transforms used by MOVE, COPY and MIRROR. View-local coordinates throughout.
import { mirror as mirrorCurve, translate } from '../geom';
import type { Vec2 } from '../geom/types';
import type { Annotation } from './types';

export function translateAnnotation(a: Annotation, d: Vec2): Annotation {
  if (a.kind === 'text') return { ...a, pos: { x: a.pos.x + d.x, y: a.pos.y + d.y } };
  if (a.kind === 'leader') return { ...a, points: a.points.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) };
  return { ...a, loops: a.loops.map((l) => l.map((c) => translate(c, d))) };
}

/**
 * Mirror across the line p-q. Text keeps its reading direction (AutoCAD MIRRTEXT = 0): only the
 * insertion point moves, and left/right alignment swaps so the text stays on the mirrored side.
 * Hatch loops are mirrored; the hatch angle is mirrored too (45° ↔ 135° across an axis-parallel line).
 * Leader points are mirrored; the reference line and text follow the new direction of the last segment.
 */
export function mirrorAnnotation(a: Annotation, p: Vec2, q: Vec2): Annotation {
  const m = (v: Vec2): Vec2 => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return v;
    const t = ((v.x - p.x) * dx + (v.y - p.y) * dy) / l2;
    return { x: 2 * (p.x + t * dx) - v.x, y: 2 * (p.y + t * dy) - v.y };
  };
  if (a.kind === 'text') {
    const swap = { left: 'right', right: 'left', center: 'center' } as const;
    const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
    return { ...a, pos: m(a.pos), align: vertical ? swap[a.align] : a.align };
  }
  if (a.kind === 'leader') return { ...a, points: a.points.map(m) };
  const phi = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  const angle = (((2 * phi - a.angle) % 180) + 180) % 180;
  return { ...a, loops: a.loops.map((l) => l.map((c) => mirrorCurve(c, p, q))), angle };
}
