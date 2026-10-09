// Typed coordinate parsing and cursor constraints (ortho, polar, direct distance). Pure, no DOM.
import type { Vec2 } from '../geom/types';

export type ParsedInput =
  | { kind: 'absolute'; p: Vec2 }
  | { kind: 'relative'; d: Vec2 }
  | { kind: 'number'; value: number }
  /** An angle on its own: `<20`, `20°`, `20deg`, `20d`. Locks the direction of the next point. */
  | { kind: 'angle'; deg: number };

/** Length and/or angle locked while rubber-banding (AutoCAD dynamic input: type a value, Tab to lock it). */
export interface InputLock {
  length: number | null;
  angleDeg: number | null;
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const LEN = `(${NUM})\\s*(?:mm)?`;
const ANG = `(${NUM})\\s*(?:°|deg|d)?`;
const CART = new RegExp(`^(@)?\\s*${LEN}\\s*,\\s*${LEN}$`, 'i');
const POLAR = new RegExp(`^(@)?\\s*${LEN}\\s*<\\s*${ANG}$`, 'i');
const NUMBER = new RegExp(`^${LEN}$`, 'i');
const ANGLE = new RegExp(`^(?:<\\s*${ANG}|(${NUM})\\s*(?:°|deg|d))$`, 'i');

const DEG = Math.PI / 180;

/**
 * `x,y` absolute, `@dx,dy` relative, `@len<angle` relative polar, `len<angle` absolute polar,
 * `@` = last point, a bare number = distance, `<angle` or `angle°` = angle only. All values in
 * view-local real mm (an `mm` suffix is accepted), angles in degrees (`°`, `deg` or `d` accepted).
 */
export function parseCoordinate(text: string): ParsedInput | null {
  const t = text.trim();
  if (t === '@') return { kind: 'relative', d: { x: 0, y: 0 } };
  let m = CART.exec(t);
  if (m) {
    const p = { x: Number(m[2]), y: Number(m[3]) };
    return m[1] ? { kind: 'relative', d: p } : { kind: 'absolute', p };
  }
  m = POLAR.exec(t);
  if (m) {
    const l = Number(m[2]);
    const a = Number(m[3]) * DEG;
    const p = { x: l * Math.cos(a), y: l * Math.sin(a) };
    return m[1] ? { kind: 'relative', d: p } : { kind: 'absolute', p };
  }
  m = NUMBER.exec(t);
  if (m) return { kind: 'number', value: Number(m[1]) };
  m = ANGLE.exec(t);
  if (m) return { kind: 'angle', deg: Number(m[1] ?? m[2]) };
  return null;
}

/** Resolve a parsed coordinate to a view-local point. Relative input needs `last`; a number needs `base` and `dir`. */
export function resolveInput(parsed: ParsedInput, last: Vec2 | null, base: Vec2 | null, dir: Vec2 | null): Vec2 | null {
  switch (parsed.kind) {
    case 'absolute':
      return parsed.p;
    case 'relative':
      return last ? { x: last.x + parsed.d.x, y: last.y + parsed.d.y } : null;
    case 'number':
      return base && dir ? directDistance(base, dir, parsed.value) : null;
    case 'angle':
      return null;
  }
}

/**
 * Constrain the cursor `p` by a dynamic-input lock around `base`: a locked angle projects onto that ray,
 * a locked length keeps the cursor direction at that distance, both fix the point. Null when nothing is locked.
 */
export function applyLock(base: Vec2, p: Vec2, lock: InputLock): Vec2 | null {
  if (lock.angleDeg === null && lock.length === null) return null;
  if (lock.angleDeg !== null) {
    const a = lock.angleDeg * DEG;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const along = lock.length ?? Math.max(0, (p.x - base.x) * ux + (p.y - base.y) * uy);
    return { x: base.x + along * ux, y: base.y + along * uy };
  }
  return directDistance(base, p, lock.length!) ?? { x: base.x + lock.length!, y: base.y };
}

/** Point at `distance` from `base` towards `toward` (the rubber-band cursor). */
export function directDistance(base: Vec2, toward: Vec2, distance: number): Vec2 | null {
  const dx = toward.x - base.x;
  const dy = toward.y - base.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-12) return null;
  return { x: base.x + (dx / l) * distance, y: base.y + (dy / l) * distance };
}

/** Ortho: keep the larger of the horizontal/vertical displacement. */
export function applyOrtho(base: Vec2, p: Vec2): Vec2 {
  return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
}

/**
 * Polar tracking: if the cursor is within `tolerance` (perpendicular distance) of a ray at a multiple of
 * `incrementDeg` from `base`, project it onto that ray. Returns the snapped point and angle, or null.
 */
export function applyPolar(base: Vec2, p: Vec2, incrementDeg: number, tolerance: number): { p: Vec2; angleDeg: number } | null {
  const dx = p.x - base.x;
  const dy = p.y - base.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-12) return null;
  const ang = Math.atan2(dy, dx) / DEG;
  const snapped = Math.round(ang / incrementDeg) * incrementDeg;
  const a = snapped * DEG;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  if (along <= 0) return null;
  const off = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
  if (off > tolerance) return null;
  return { p: { x: base.x + along * Math.cos(a), y: base.y + along * Math.sin(a) }, angleDeg: ((snapped % 360) + 360) % 360 };
}

/** Parse a scale like "1:2", "2:1", "0.5" or "2". */
export function parseScale(text: string): number | null {
  const t = text.trim();
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 0 && b > 0 ? a / b : null;
  }
  const n = Number(t);
  return t !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Format a number for prompts and the status bar. */
export function fmt(n: number, digits = 2): string {
  const r = n.toFixed(digits);
  return r === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : r;
}
