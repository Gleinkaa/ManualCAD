// Command registry: AutoCAD English names and aliases.
import { dimaligned, dimdiameter, dimlinear, dimradius } from './dims';
import { arc, circle, line, rectang } from './draw';
import { chamfer, copy, erase, extend, fillet, mirror, move, offset, trim } from './modify';
import { layer, ltype, titleblock, view, zoom } from './settings';
import type { CommandFn } from './types';

export const COMMANDS: Record<string, CommandFn> = {
  LINE: line,
  CIRCLE: circle,
  ARC: arc,
  RECTANG: rectang,
  OFFSET: offset,
  TRIM: trim,
  EXTEND: extend,
  FILLET: fillet,
  CHAMFER: chamfer,
  MOVE: move,
  COPY: copy,
  MIRROR: mirror,
  ERASE: erase,
  DIMLINEAR: dimlinear,
  DIMALIGNED: dimaligned,
  DIMRADIUS: dimradius,
  DIMDIAMETER: dimdiameter,
  VIEW: view,
  LTYPE: ltype,
  LAYER: layer,
  ZOOM: zoom,
  TITLEBLOCK: titleblock,
};

/** Commands the app handles itself (files, undo); they never enter the command runner. */
export const HOST_COMMANDS = ['UNDO', 'REDO', 'SAVE', 'OPEN', 'NEW', 'PLOT', 'EXPORTPDF'] as const;
export type HostCommand = (typeof HOST_COMMANDS)[number];

export const ALIASES: Record<string, string> = {
  L: 'LINE',
  C: 'CIRCLE',
  A: 'ARC',
  REC: 'RECTANG',
  RECTANGLE: 'RECTANG',
  O: 'OFFSET',
  TR: 'TRIM',
  EX: 'EXTEND',
  F: 'FILLET',
  CHA: 'CHAMFER',
  M: 'MOVE',
  CO: 'COPY',
  CP: 'COPY',
  MI: 'MIRROR',
  E: 'ERASE',
  DLI: 'DIMLINEAR',
  DAL: 'DIMALIGNED',
  DRA: 'DIMRADIUS',
  DDI: 'DIMDIAMETER',
  V: 'VIEW',
  LT: 'LTYPE',
  '-LT': 'LTYPE',
  LINETYPE: 'LTYPE',
  '-LINETYPE': 'LTYPE',
  LA: 'LAYER',
  '-LAYER': 'LAYER',
  Z: 'ZOOM',
  TB: 'TITLEBLOCK',
  U: 'UNDO',
  QSAVE: 'SAVE',
  SAVEAS: 'SAVE',
  PRINT: 'PLOT',
};

/** Canonical command name for typed text, or null. */
export function resolveCommand(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/^_/, '');
  const name = ALIASES[t] ?? t;
  return name in COMMANDS || (HOST_COMMANDS as readonly string[]).includes(name) ? name : null;
}
