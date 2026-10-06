// Command registry: AutoCAD English names and aliases.
import { balloon, leader, sketch, text } from './annotate';
import { dimaligned, dimangular, dimdiameter, dimedit, dimlinear, dimradius } from './dims';
import { arc, circle, line, rectang } from './draw';
import { hatch } from './hatch';
import { chamfer, copy, erase, extend, fillet, mirror, move, offset, trim } from './modify';
import { layer, ltype, partslist, titleblock, view, zoom } from './settings';
import type { CommandFn } from './types';

export const COMMANDS: Record<string, CommandFn> = {
  LINE: line,
  CIRCLE: circle,
  ARC: arc,
  RECTANG: rectang,
  HATCH: hatch,
  OFFSET: offset,
  TRIM: trim,
  EXTEND: extend,
  FILLET: fillet,
  CHAMFER: chamfer,
  MOVE: move,
  COPY: copy,
  MIRROR: mirror,
  ERASE: erase,
  TEXT: text,
  SKETCH: sketch,
  LEADER: leader,
  BALLOON: balloon,
  DIMLINEAR: dimlinear,
  DIMALIGNED: dimaligned,
  DIMRADIUS: dimradius,
  DIMDIAMETER: dimdiameter,
  DIMANGULAR: dimangular,
  DIMEDIT: dimedit,
  VIEW: view,
  LTYPE: ltype,
  LAYER: layer,
  ZOOM: zoom,
  TITLEBLOCK: titleblock,
  PARTSLIST: partslist,
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
  H: 'HATCH',
  BH: 'HATCH',
  BHATCH: 'HATCH',
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
  DT: 'TEXT',
  DTEXT: 'TEXT',
  SK: 'SKETCH',
  LE: 'LEADER',
  LEAD: 'LEADER',
  QLEADER: 'LEADER',
  MLEADER: 'LEADER',
  MLD: 'LEADER',
  BAL: 'BALLOON',
  ITEM: 'BALLOON',
  DLI: 'DIMLINEAR',
  DAL: 'DIMALIGNED',
  DRA: 'DIMRADIUS',
  DDI: 'DIMDIAMETER',
  DAN: 'DIMANGULAR',
  DED: 'DIMEDIT',
  V: 'VIEW',
  LT: 'LTYPE',
  '-LT': 'LTYPE',
  LINETYPE: 'LTYPE',
  '-LINETYPE': 'LTYPE',
  LA: 'LAYER',
  '-LAYER': 'LAYER',
  Z: 'ZOOM',
  TB: 'TITLEBLOCK',
  PARTS: 'PARTSLIST',
  BOM: 'PARTSLIST',
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
