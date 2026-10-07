// Command registry: AutoCAD English names and aliases, plus the catalogue behind HELP and the command line's autocomplete.
import { balloon, leader, sketch, text, textedit } from './annotate';
import { dimaligned, dimangular, dimdiameter, dimedit, dimlinear, dimradius } from './dims';
import { arc, circle, line, rectang } from './draw';
import { gripstretch, stretch } from './grips';
import { hatch, hatchedit } from './hatch';
import { chamfer, copy, erase, extend, fillet, mirror, move, offset, rotate, scaleCmd, trim } from './modify';
import { layer, ltype, partslist, partslistCommandLine, titleblock, view, zoom } from './settings';
import type { CommandFn } from './types';

export const COMMANDS: Record<string, CommandFn> = {
  LINE: line,
  CIRCLE: circle,
  ARC: arc,
  RECTANG: rectang,
  HATCH: hatch,
  HATCHEDIT: hatchedit,
  OFFSET: offset,
  TRIM: trim,
  EXTEND: extend,
  FILLET: fillet,
  CHAMFER: chamfer,
  MOVE: move,
  COPY: copy,
  ROTATE: rotate,
  SCALE: scaleCmd,
  MIRROR: mirror,
  STRETCH: stretch,
  ERASE: erase,
  TEXT: text,
  TEXTEDIT: textedit,
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
  '-PARTSLIST': partslistCommandLine,
  GRIPSTRETCH: gripstretch,
};

/** Registered commands that are not typed by users: started by the app, kept out of HELP and autocomplete. */
const HIDDEN_COMMANDS: ReadonlySet<string> = new Set(['GRIPSTRETCH']);

export function isHiddenCommand(name: string): boolean {
  return HIDDEN_COMMANDS.has(name);
}

/** Commands the app handles itself (files, undo, help, pan); they never enter the command runner. */
export const HOST_COMMANDS = ['UNDO', 'REDO', 'SAVE', 'OPEN', 'NEW', 'PLOT', 'EXPORTPDF', 'HELP', 'PAN'] as const;
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
  HE: 'HATCHEDIT',
  O: 'OFFSET',
  TR: 'TRIM',
  EX: 'EXTEND',
  F: 'FILLET',
  CHA: 'CHAMFER',
  M: 'MOVE',
  CO: 'COPY',
  CP: 'COPY',
  RO: 'ROTATE',
  SC: 'SCALE',
  MI: 'MIRROR',
  S: 'STRETCH',
  E: 'ERASE',
  DT: 'TEXT',
  DTEXT: 'TEXT',
  ED: 'TEXTEDIT',
  DDEDIT: 'TEXTEDIT',
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
  P: 'PAN',
  TB: 'TITLEBLOCK',
  PARTS: 'PARTSLIST',
  BOM: 'PARTSLIST',
  '-PARTS': '-PARTSLIST',
  U: 'UNDO',
  QSAVE: 'SAVE',
  SAVEAS: 'SAVE',
  PRINT: 'PLOT',
  '?': 'HELP',
};

export type CommandGroup = 'File' | 'Draw' | 'Modify' | 'Annotate' | 'Dimension' | 'Sheet';

export interface CommandInfo {
  name: string;
  group: CommandGroup;
  /** One line: what it does and how it is driven. */
  summary: string;
}

/** The catalogue shown by HELP and used by the command line's autocomplete, in menu order. */
export const COMMAND_INFO: CommandInfo[] = [
  { name: 'NEW', group: 'File', summary: 'New drawing. UNDO brings the previous one back.' },
  { name: 'OPEN', group: 'File', summary: 'Open a .mcad file (Ctrl+O).' },
  { name: 'SAVE', group: 'File', summary: 'Save as .mcad (Ctrl+S).' },
  { name: 'PLOT', group: 'File', summary: 'Export the sheet as PDF, black lines, construction lines left out.' },
  { name: 'LINE', group: 'Draw', summary: 'Line segments: click or type points (x,y · @dx,dy · @len<angle · a distance along the cursor). Close, Undo, Enter to finish.' },
  { name: 'CIRCLE', group: 'Draw', summary: 'Circle by centre and radius (Diameter option), or 2P by two diameter end points.' },
  { name: 'ARC', group: 'Draw', summary: 'Arc through three points, or Center: centre, start, end (counter-clockwise).' },
  { name: 'RECTANG', group: 'Draw', summary: 'Rectangle by two corners, or Dimensions: length and width.' },
  { name: 'HATCH', group: 'Draw', summary: 'Section hatching (ISO 128-50): pick a point inside a closed outline; the area previews under the cursor. Angle, Spacing, Flip (45°↔135°), Gap tolerance, Undo.' },
  { name: 'SKETCH', group: 'Draw', summary: 'Freehand break line (ISO 128-2 01.1) through clicked points, for partial sections.' },
  { name: 'OFFSET', group: 'Modify', summary: 'Parallel copy at a distance (or Through a point): pick the object, then the side.' },
  { name: 'TRIM', group: 'Modify', summary: 'Cut objects at cutting edges: select edges (Enter = all), then click the parts to remove, or Fence.' },
  { name: 'EXTEND', group: 'Modify', summary: 'Lengthen objects to boundary edges: select edges (Enter = all), then click the ends to extend.' },
  { name: 'FILLET', group: 'Modify', summary: 'Round a corner with Radius; radius 0 joins two lines at a sharp corner.' },
  { name: 'CHAMFER', group: 'Modify', summary: 'Bevel a corner with two Distances.' },
  { name: 'MOVE', group: 'Modify', summary: 'Move the selection from a base point to a second point.' },
  { name: 'COPY', group: 'Modify', summary: 'Copy the selection, repeatedly, from a base point.' },
  { name: 'ROTATE', group: 'Modify', summary: 'Rotate the selection about a base point by a typed angle or a picked direction; Copy keeps the source, Reference by two angles.' },
  { name: 'SCALE', group: 'Modify', summary: 'Scale the selection about a base point by a factor; Reference by two lengths.' },
  { name: 'STRETCH', group: 'Modify', summary: 'Move the ends inside a crossing window: two corners, base point, second point. Objects fully inside move whole.' },
  { name: 'MIRROR', group: 'Modify', summary: 'Mirror the selection across a line of two points; text keeps its reading direction.' },
  { name: 'ERASE', group: 'Modify', summary: 'Delete the selection (Delete key with a selection).' },
  { name: 'HATCHEDIT', group: 'Modify', summary: 'Change angle and spacing of hatches; double-click a hatch.' },
  { name: 'TEXTEDIT', group: 'Modify', summary: 'Change the text of notes and leaders; double-click a text.' },
  { name: 'DIMEDIT', group: 'Modify', summary: 'Replace dimension text; <> stands for the measured value (%%c = ⌀, %%d = °, %%p = ±). Double-click a dimension.' },
  { name: 'TEXT', group: 'Annotate', summary: 'Single-line text (ISO 3098): start point, height, rotation, then lines of text. Justify Left/Center/Right.' },
  { name: 'LEADER', group: 'Annotate', summary: 'Note on a leader line (ISO 128-22): arrowhead on an outline, dot inside; Terminator overrides it.' },
  { name: 'BALLOON', group: 'Annotate', summary: 'Item number (ISO 6433) on a leader, lettered at twice the dimension text height.' },
  { name: 'DIMLINEAR', group: 'Dimension', summary: 'Horizontal or vertical dimension between two points (Enter: pick a line). Text option overrides the value.' },
  { name: 'DIMALIGNED', group: 'Dimension', summary: 'Dimension parallel to the two points.' },
  { name: 'DIMRADIUS', group: 'Dimension', summary: 'Radius of an arc or circle, R prefixed.' },
  { name: 'DIMDIAMETER', group: 'Dimension', summary: 'Diameter of a circle or arc, ⌀ prefixed.' },
  { name: 'DIMANGULAR', group: 'Dimension', summary: 'Angle between two lines, or Enter for vertex and two points.' },
  { name: 'VIEW', group: 'Sheet', summary: 'Views: New (name, scale, origin, projection-linked), Move, Set current, SCale, Unlink, LAbel.' },
  { name: 'ZOOM', group: 'Sheet', summary: 'Extents (whole sheet), Window (two corners). Wheel zooms at the cursor; middle button pans; double-click middle = extents.' },
  { name: 'PAN', group: 'Sheet', summary: 'Pan with the left mouse button until Esc or Enter (for mice without a middle button).' },
  { name: 'LTYPE', group: 'Sheet', summary: 'Line type for new objects, or for the selection: Visible, Thin, Hidden, Center, Phantom, Freehand, COnstruction.' },
  { name: 'LAYER', group: 'Sheet', summary: 'Layers show and hide only: New, ON, OFF, Set.' },
  { name: 'TITLEBLOCK', group: 'Sheet', summary: 'Edit the title block (ISO 7200); double-click it on the sheet.' },
  { name: 'PARTSLIST', group: 'Sheet', summary: 'Edit the parts list (ISO 7573); double-click it on the sheet. -PARTSLIST stays on the command line.' },
  { name: 'UNDO', group: 'Sheet', summary: 'Undo (Ctrl+Z).' },
  { name: 'REDO', group: 'Sheet', summary: 'Redo (Ctrl+Y).' },
  { name: 'HELP', group: 'Sheet', summary: 'This list (F1, ?).' },
];

/** Aliases of a command, shortest first. */
export function aliasesOf(name: string): string[] {
  return Object.entries(ALIASES)
    .filter(([, n]) => n === name)
    .map(([a]) => a)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** Known command names: the catalogue, registered commands and host commands. */
export function allCommandNames(): string[] {
  const names = new Set<string>([...COMMAND_INFO.map((c) => c.name), ...Object.keys(COMMANDS), ...HOST_COMMANDS]);
  return [...names].filter((n) => !HIDDEN_COMMANDS.has(n) && (n in COMMANDS || (HOST_COMMANDS as readonly string[]).includes(n)));
}

/** Autocomplete (case-insensitive): exact and alias matches first, then prefix matches, then substring matches, alphabetical within a rank. */
export function suggestCommands(prefix: string, limit = 8): { name: string; alias: string | null; summary: string }[] {
  const t = prefix.trim().toUpperCase().replace(/^_/, '');
  if (!t) return [];
  const info = new Map(COMMAND_INFO.map((c) => [c.name, c.summary]));
  const out: { name: string; alias: string | null; summary: string; rank: number }[] = [];
  const seen = new Set<string>();
  const push = (name: string, alias: string | null, rank: number) => {
    if (seen.has(name)) return;
    if (HIDDEN_COMMANDS.has(name) || (!(name in COMMANDS) && !(HOST_COMMANDS as readonly string[]).includes(name))) return;
    seen.add(name);
    out.push({ name, alias, summary: info.get(name) ?? '', rank });
  };
  if (ALIASES[t]) push(ALIASES[t], t, 0);
  if (t in COMMANDS || (HOST_COMMANDS as readonly string[]).includes(t)) push(t, null, 0);
  for (const name of allCommandNames()) if (name.startsWith(t)) push(name, aliasesOf(name)[0] ?? null, 1);
  for (const [a, name] of Object.entries(ALIASES)) if (a.startsWith(t)) push(name, a, 2);
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Canonical command name for typed text, or null. */
export function resolveCommand(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/^_/, '');
  const name = ALIASES[t] ?? t;
  return name in COMMANDS || (HOST_COMMANDS as readonly string[]).includes(name) ? name : null;
}
