// UI session state persisted next to the autosaved drawing: viewport, settings, toggles, undo history. No DOM.
import { LINE_TYPES } from '../model/standards';
import type { SheetDoc } from '../model/types';
import type { AppSettings } from './commands/types';
import { snapshot } from './history';

export interface SessionView {
  cx: number;                // sheet mm at the canvas centre
  cy: number;
  zoom: number;             // CSS px per sheet mm
}

export interface Session {
  view: SessionView | null;
  settings: AppSettings;
  toggles: { snap: boolean; ortho: boolean; polar: boolean };
  /** Undo/redo snapshots, only valid for the document whose snapshot hashes to `doc`. */
  history: { doc: string; undo: string[]; redo: string[] } | null;
}

/** Undo steps kept across reloads (localStorage is small). */
export const PERSISTED_UNDO = 30;

/** Cheap FNV-1a fingerprint of a document snapshot (ties persisted history to the autosaved drawing). */
export function docHash(doc: SheetDoc): string {
  const text = snapshot(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${text.length}`;
}

export function encodeSession(s: Session): string {
  return JSON.stringify({ v: 1, ...s });
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/**
 * Parse a stored session against the restored document. Invalid or stale fields fall back to `defaults`;
 * history is dropped unless it belongs to exactly this document.
 */
export function decodeSession(json: string | null, doc: SheetDoc, defaults: AppSettings): Session {
  const out: Session = { view: null, settings: { ...defaults }, toggles: { snap: true, ortho: false, polar: false }, history: null };
  if (!json) return out;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return out;
  }
  if (!raw || raw.v !== 1) return out;

  const v = raw.view as Partial<SessionView> | null | undefined;
  if (v && num(v.cx) && num(v.cy) && num(v.zoom) && v.zoom > 0) out.view = { cx: v.cx, cy: v.cy, zoom: v.zoom };

  const s = (raw.settings ?? {}) as Partial<AppSettings>;
  const d = out.settings;
  if (typeof s.currentViewId === 'string' && doc.views.some((w) => w.id === s.currentViewId)) d.currentViewId = s.currentViewId;
  if (typeof s.lineType === 'string' && s.lineType in LINE_TYPES) d.lineType = s.lineType;
  if (typeof s.layer === 'string' && doc.layers.some((l) => l.name === s.layer)) d.layer = s.layer;
  if (num(s.filletRadius) && s.filletRadius >= 0) d.filletRadius = s.filletRadius;
  if (num(s.chamferA) && s.chamferA >= 0) d.chamferA = s.chamferA;
  if (num(s.chamferB) && s.chamferB >= 0) d.chamferB = s.chamferB;
  if (s.offsetDistance === null || (num(s.offsetDistance) && s.offsetDistance > 0)) d.offsetDistance = s.offsetDistance;
  if (num(s.textHeight) && s.textHeight > 0) d.textHeight = s.textHeight;
  if (num(s.hatchAngle)) d.hatchAngle = s.hatchAngle;
  if (num(s.hatchSpacing) && s.hatchSpacing > 0) d.hatchSpacing = s.hatchSpacing;

  const t = (raw.toggles ?? {}) as Partial<Session['toggles']>;
  if (typeof t.snap === 'boolean') out.toggles.snap = t.snap;
  if (typeof t.ortho === 'boolean') out.toggles.ortho = t.ortho;
  if (typeof t.polar === 'boolean') out.toggles.polar = t.polar && !out.toggles.ortho;

  const h = raw.history as Session['history'] | undefined;
  if (h && typeof h.doc === 'string' && h.doc === docHash(doc) && strs(h.undo) && strs(h.redo)) out.history = h;
  return out;
}
