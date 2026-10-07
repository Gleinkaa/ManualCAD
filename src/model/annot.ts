// Annotation helpers: transforms used by MOVE, COPY, MIRROR, ROTATE and SCALE. View-local coordinates throughout.
import { mirror as mirrorCurve, rotate as rotateCurve, scaleCurve, translate } from '../geom';
import type { Vec2 } from '../geom/types';
import type { Annotation } from './types';

/**
 * Point a hatch's boundary ids at the images of its entities after MOVE/COPY/MIRROR (`map`: old id → new id,
 * or to itself when moved in place). A hatch transformed without its whole boundary no longer sits in that
 * boundary, so it loses its association instead of jumping back on the next edit.
 */
export function remapHatchBoundary(a: Annotation, map: Map<string, string>): Annotation {
  if (a.kind !== 'hatch' || !a.assoc) return a;
  if (!a.assoc.boundary.every((id) => map.has(id))) {
    const { assoc: _, ...rest } = a;
    return rest;
  }
  return { ...a, assoc: { ...a.assoc, boundary: a.assoc.boundary.map((id) => map.get(id)!) } };
}

export function translateAnnotation(a: Annotation, d: Vec2): Annotation {
  if (a.kind === 'text') return { ...a, pos: { x: a.pos.x + d.x, y: a.pos.y + d.y } };
  if (a.kind === 'leader') return { ...a, points: a.points.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) };
  const assoc = a.assoc && { ...a.assoc, seed: { x: a.assoc.seed.x + d.x, y: a.assoc.seed.y + d.y } };
  return { ...a, loops: a.loops.map((l) => l.map((c) => translate(c, d))), ...(assoc && { assoc }) };
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
  const assoc = a.assoc && { ...a.assoc, seed: m(a.assoc.seed) };
  return { ...a, loops: a.loops.map((l) => l.map((c) => mirrorCurve(c, p, q))), angle, ...(assoc && { assoc }) };
}

/** `p` rotated about `about` by `angle` radians counter-clockwise. */
export function rotatePoint(p: Vec2, about: Vec2, angle: number): Vec2 {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cs - dy * sn, y: about.y + dx * sn + dy * cs };
}

/** `p` scaled about `about` by `factor`. */
export function scalePoint(p: Vec2, about: Vec2, factor: number): Vec2 {
  return { x: about.x + (p.x - about.x) * factor, y: about.y + (p.y - about.y) * factor };
}

/**
 * Rotate about `about` by `angle` radians (CCW). Text turns with its insertion point; leader points turn.
 * Hatch loops and the associative seed turn, but the hatch angle stays: ISO 128-50 hatching is at 45° to
 * the sheet, not to the part.
 */
export function rotateAnnotation(a: Annotation, about: Vec2, angle: number): Annotation {
  const r = (p: Vec2) => rotatePoint(p, about, angle);
  if (a.kind === 'text') return { ...a, pos: r(a.pos), angle: a.angle + angle };
  if (a.kind === 'leader') return { ...a, points: a.points.map(r) };
  const assoc = a.assoc && { ...a.assoc, seed: r(a.assoc.seed) };
  return { ...a, loops: a.loops.map((l) => l.map((c) => rotateCurve(c, about, angle))), ...(assoc && { assoc }) };
}

/**
 * Scale about `about` by `factor` (> 0). Only positions and loops scale: text and leader heights and the
 * hatch spacing are paper mm (ISO 3098, ISO 128-50) and stay as they are.
 */
export function scaleAnnotation(a: Annotation, about: Vec2, factor: number): Annotation {
  const s = (p: Vec2) => scalePoint(p, about, factor);
  if (a.kind === 'text') return { ...a, pos: s(a.pos) };
  if (a.kind === 'leader') return { ...a, points: a.points.map(s) };
  const assoc = a.assoc && { ...a.assoc, seed: s(a.assoc.seed) };
  return { ...a, loops: a.loops.map((l) => l.map((c) => scaleCurve(c, about, factor))), ...(assoc && { assoc }) };
}
