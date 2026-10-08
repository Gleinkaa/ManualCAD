// DOM construction: toolbar, canvas, command line (with autocomplete and option chips), status bar, dialogs.
import { LINE_TYPES } from '../model/standards';
import type { LineTypeId, PartsListRow, TitleBlockField } from '../model/types';
import { aliasesOf, COMMAND_INFO, type CommandGroup } from './commands';
import { iconElement } from './icons';

type Attrs = Record<string, string>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}

function select(cls: string, title: string, options: [string, string][]): HTMLSelectElement {
  const s = el('select', { class: cls, title });
  setOptions(s, options);
  return s;
}

export function setOptions(s: HTMLSelectElement, options: [string, string][], value?: string): void {
  const cur = value ?? s.value;
  s.replaceChildren(...options.map(([v, label]) => el('option', { value: v }, label)));
  if (options.some(([v]) => v === cur)) s.value = cur;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'mc-field' }, el('span', {}, text), control);
}

export interface UIRefs {
  canvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
  format: HTMLSelectElement;
  orientation: HTMLSelectElement;
  lineGroup: HTMLSelectElement;
  view: HTMLSelectElement;
  lineType: HTMLSelectElement;
  layer: HTMLSelectElement;
  layerList: HTMLElement;
  layerNew: HTMLInputElement;
  history: HTMLElement;
  prompt: HTMLElement;
  input: HTMLInputElement;
  /** Clickable option keywords of the current prompt. */
  chips: HTMLElement;
  /** Autocomplete popup above the command line. */
  suggest: HTMLElement;
  coords: HTMLElement;
  viewInfo: HTMLElement;
  selInfo: HTMLElement;
  /** What the hovered toolbar button does, or a mouse hint for the current state. */
  hint: HTMLElement;
  toggles: Record<'snap' | 'ortho' | 'polar', HTMLButtonElement>;
  fileInput: HTMLInputElement;
  /** Buttons that run a command line string. */
  commandButtons: HTMLButtonElement[];
}

export const LINE_TYPE_ORDER: LineTypeId[] = ['visible', 'thin', 'hidden', 'center', 'phantom', 'freehand', 'construction'];

export function lineTypeLabel(id: LineTypeId): string {
  const d = LINE_TYPES[id];
  return d.isoNo ? `${d.isoNo} ${d.label}` : d.label;
}

/** Toolbar: [command line string, label, tooltip]; a label starting with "|" is a separator inside the group. */
type ButtonDef = [string, string, string];

const GROUPS: { caption: string; buttons: (ButtonDef | '|')[] }[] = [
  {
    caption: 'File',
    buttons: [
      ['NEW', 'New', 'New drawing (NEW). UNDO restores the previous one'],
      ['OPEN', 'Open', 'Open .mcad, .dxf or .dwg (OPEN, Ctrl+O)'],
      ['SAVE', 'Save', 'Save .mcad (SAVE, Ctrl+S)'],
      ['PLOT', 'PDF', 'Export PDF (PLOT)'],
      ['DXFOUT', 'DXF', 'Export DXF (DXFOUT)'],
      '|',
      ['TITLEBLOCK', 'Title block', 'Edit title block (TB), or double-click it on the sheet'],
      ['PARTSLIST', 'Parts list', 'Edit parts list (PARTS), or double-click it on the sheet'],
    ],
  },
  {
    caption: 'Draw',
    buttons: [
      ['LINE', 'Line', 'Line (L)'],
      ['CIRCLE', 'Circle', 'Circle (C)'],
      ['ARC', 'Arc', 'Arc (A)'],
      ['RECTANG', 'Rect', 'Rectangle (REC)'],
      ['SKETCH', 'Freehand', 'Freehand break line (SK), ISO 128-2 01.1'],
      '|',
      ['HATCH', 'Hatch', 'Hatch a closed area (H): pick a point inside it, ISO 128-50'],
    ],
  },
  {
    caption: 'Modify',
    buttons: [
      ['OFFSET', 'Offset', 'Offset (O)'],
      ['TRIM', 'Trim', 'Trim (TR)'],
      ['EXTEND', 'Extend', 'Extend (EX)'],
      ['FILLET', 'Fillet', 'Fillet (F); radius 0 joins two lines at a corner'],
      ['CHAMFER', 'Chamfer', 'Chamfer (CHA)'],
      '|',
      ['MOVE', 'Move', 'Move (M)'],
      ['COPY', 'Copy', 'Copy (CO)'],
      ['ROTATE', 'Rotate', 'Rotate (RO)'],
      ['SCALE', 'Scale', 'Scale (SC)'],
      ['STRETCH', 'Stretch', 'Stretch the ends inside a crossing window (S)'],
      ['MIRROR', 'Mirror', 'Mirror (MI)'],
      ['ERASE', 'Erase', 'Erase (E, Delete)'],
    ],
  },
  {
    caption: 'Annotate',
    buttons: [
      ['TEXT', 'Text', 'Text (DT), ISO 3098'],
      ['LEADER', 'Leader', 'Note on a leader line (LE), ISO 128-22'],
      ['BALLOON', 'Item no.', 'Item number on a leader (BAL), ISO 6433'],
    ],
  },
  {
    caption: 'Dimension',
    buttons: [
      ['DIMLINEAR', 'Linear', 'Linear dimension (DLI)'],
      ['DIMALIGNED', 'Aligned', 'Aligned dimension (DAL)'],
      ['DIMRADIUS', 'Radius', 'Radius dimension (DRA)'],
      ['DIMDIAMETER', 'Diameter', 'Diameter dimension (DDI)'],
      ['DIMANGULAR', 'Angular', 'Angular dimension (DAN)'],
      ['DIMEDIT', 'Dim text', 'Dimension text (DED), or double-click a dimension'],
    ],
  },
  {
    caption: 'View',
    buttons: [
      ['VIEW', 'View', 'Views: new, move, set current, scale (V)'],
      ['ZOOM E', 'Fit', 'Zoom extents (Z E), or double-click the middle mouse button'],
      ['ZOOM W', 'Window', 'Zoom window (Z W)'],
      ['PAN', 'Pan', 'Pan with the left mouse button (P); Esc ends it'],
      '|',
      ['UNDO', 'Undo', 'Undo (Ctrl+Z)'],
      ['REDO', 'Redo', 'Redo (Ctrl+Y)'],
    ],
  },
];

/** Icon button for a command; falls back to its short label when no icon exists. */
export function commandButton(cmd: string, label: string, title: string): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'mc-tool', title, 'data-cmd': cmd, 'aria-label': label });
  const icon = iconElement(cmd);
  if (icon) b.append(icon);
  else b.classList.add('mc-tool-text');
  if (!icon) b.append(label);
  return b;
}

export function buildUI(root: HTMLElement): UIRefs {
  const format = select('mc-format', 'Sheet format', ['A4', 'A3', 'A2', 'A1', 'A0'].map((f) => [f, f]));
  const orientation = select('mc-orientation', 'Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']]);
  const lineGroup = select('mc-linegroup', 'Line group (ISO 128-2): line widths 0.5/0.25 or 0.7/0.35 mm', [['0.5', '0.5'], ['0.7', '0.7']]);
  const view = select('mc-view', 'Current view', []);
  const lineType = select('mc-linetype', 'Line type for new objects, or for the selection', LINE_TYPE_ORDER.map((id) => [id, lineTypeLabel(id)]));
  const layer = select('mc-layer', 'Current layer', []);
  const layerList = el('div', { class: 'mc-layer-list' });
  const layerNew = el('input', { class: 'mc-layer-new', placeholder: 'New layer…', size: '10' });
  const layers = el('details', { class: 'mc-layers' }, el('summary', { title: 'Layer visibility' }, 'Layers'), el('div', { class: 'mc-popup' }, layerList, layerNew));

  const commandButtons: HTMLButtonElement[] = [];
  const groups = GROUPS.map((g) => {
    const row = el('div', { class: 'mc-tools' });
    for (const b of g.buttons) {
      if (b === '|') {
        row.append(el('span', { class: 'mc-sep' }));
        continue;
      }
      const btn = commandButton(b[0], b[1], b[2]);
      commandButtons.push(btn);
      row.append(btn);
    }
    return el('div', { class: 'mc-group' }, row, el('div', { class: 'mc-caption' }, g.caption));
  });

  const help = commandButton('HELP', 'Help', 'Command reference (F1, HELP)');
  commandButtons.push(help);

  const settings = el(
    'div',
    { class: 'mc-settings' },
    labelled('Sheet', format),
    orientation,
    labelled('Line group', lineGroup),
    el('span', { class: 'mc-sep' }),
    labelled('View', view),
    labelled('Line type', lineType),
    labelled('Layer', layer),
    layers,
  );
  const toolbar = el(
    'header',
    { class: 'mc-toolbar' },
    el('div', { class: 'mc-row mc-row-settings' }, el('strong', { class: 'mc-brand' }, 'ManualCAD'), settings, el('span', { class: 'mc-spacer' }), help),
    el('div', { class: 'mc-row mc-row-tools' }, ...groups),
  );

  const canvas = el('canvas', { class: 'mc-canvas', tabindex: '0' });
  const canvasWrap = el('main', { class: 'mc-canvas-wrap' }, canvas);

  const history = el('div', { class: 'mc-history' });
  const prompt = el('span', { class: 'mc-prompt' }, 'Command:');
  const input = el('input', { class: 'mc-input', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Command line' });
  const chips = el('span', { class: 'mc-chips' });
  const suggest = el('div', { class: 'mc-suggest', hidden: '' });
  const cmd = el('section', { class: 'mc-command' }, history, el('div', { class: 'mc-cmdline' }, suggest, prompt, input, chips));

  const coords = el('span', { class: 'mc-coords' }, '0.00, 0.00');
  const viewInfo = el('span', { class: 'mc-viewinfo' });
  const selInfo = el('span', { class: 'mc-selinfo' });
  const hint = el('span', { class: 'mc-hint' });
  const toggle = (label: string, key: string, title: string) => el('button', { type: 'button', class: 'mc-toggle', title: `${title} (${key})` }, label);
  const toggles = {
    snap: toggle('SNAP', 'F3', 'Object snap: endpoints, midpoints, centres, intersections …'),
    ortho: toggle('ORTHO', 'F8', 'Ortho: horizontal and vertical only, with tracking from snapped points'),
    polar: toggle('POLAR', 'F10', 'Polar tracking every 15°'),
  };
  const status = el('footer', { class: 'mc-status' }, coords, viewInfo, selInfo, hint, el('span', { class: 'mc-spacer' }), toggles.snap, toggles.ortho, toggles.polar);

  const fileInput = el('input', { type: 'file', accept: '.mcad,.json,.dxf,.dwg,application/json', style: 'display:none' });

  root.replaceChildren(el('div', { class: 'mc-root' }, toolbar, canvasWrap, cmd, status, fileInput));
  return { canvas, canvasWrap, format, orientation, lineGroup, view, lineType, layer, layerList, layerNew, history, prompt, input, chips, suggest, coords, viewInfo, selInfo, hint, toggles, fileInput, commandButtons };
}

/** Modal dialog helper: the form submits with OK, Cancel and Esc close it; `onClose` runs after either. */
function modal(title: string, body: Node[], buttons: Node[], onSubmit: () => void, onClose: () => void, cls = ''): HTMLDialogElement {
  const ok = el('button', { type: 'submit', class: 'mc-primary' }, 'OK');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const form = el('form', { method: 'dialog' }, el('h3', {}, title), ...body, el('div', { class: 'mc-dialog-buttons' }, ...buttons, cancel, ok));
  const dlg = el('dialog', { class: `mc-dialog ${cls}`.trim() }, form);
  document.body.append(dlg);
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', onSubmit);
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose();
  });
  dlg.showModal();
  return dlg;
}

const TB_FIELDS: [TitleBlockField, string][] = [
  ['title', 'Title'],
  ['drawingNumber', 'Drawing number'],
  ['owner', 'Owner / company'],
  ['material', 'Material'],
  ['scale', 'Scale (empty = main view)'],
  ['generalTolerance', 'General tolerance'],
  ['createdBy', 'Created by'],
  ['approvedBy', 'Approved by'],
  ['date', 'Date'],
  ['revision', 'Revision'],
  ['sheet', 'Sheet'],
  ['documentType', 'Document type'],
];

/** Modal title block editor. Calls `onSave` with all fields (empty strings removed). */
export function openTitleBlockDialog(values: Partial<Record<TitleBlockField, string>>, onSave: (v: Partial<Record<TitleBlockField, string>>) => void, onClose: () => void): void {
  const inputs = new Map<TitleBlockField, HTMLInputElement>();
  const rows = TB_FIELDS.map(([f, label]) => {
    const i = el('input', { name: f, value: values[f] ?? '' });
    inputs.set(f, i);
    return el('label', { class: 'mc-tb-row' }, el('span', {}, label), i);
  });
  modal(
    'Title block (ISO 7200)',
    rows,
    [],
    () => {
      const out: Partial<Record<TitleBlockField, string>> = {};
      for (const [f, i] of inputs) if (i.value.trim()) out[f] = i.value.trim();
      onSave(out);
    },
    onClose,
  );
  inputs.get('title')?.focus();
}

const PL_COLUMNS: [keyof PartsListRow, string, number][] = [
  ['item', 'Item', 4],
  ['quantity', 'Qty', 4],
  ['name', 'Name', 16],
  ['standard', 'Part no. / standard', 14],
  ['material', 'Material', 11],
  ['stock', 'Stock size', 9],
  ['remark', 'Remark', 8],
];

/**
 * Modal parts list editor (ISO 7573): one row per part, row 1 is drawn lowest above the title block.
 * Calls `onSave` with the rows that have any value, in order.
 */
export function openPartsListDialog(rows: PartsListRow[], onSave: (rows: PartsListRow[]) => void, onClose: () => void): void {
  const body = el('tbody', {});
  const blank = (item: string): PartsListRow => ({ item, quantity: '1', name: '', standard: '', material: '', stock: '', remark: '' });
  const addRow = (r: PartsListRow) => {
    const tr = el('tr', {});
    for (const [f, label, size] of PL_COLUMNS) tr.append(el('td', {}, el('input', { name: f, value: r[f], size: String(size), 'aria-label': label })));
    const del = el('button', { type: 'button', title: 'Delete row' }, '×');
    del.addEventListener('click', () => tr.remove());
    tr.append(el('td', {}, del));
    body.append(tr);
    return tr;
  };
  for (const r of rows) addRow(r);
  const add = el('button', { type: 'button' }, 'Add row');
  add.addEventListener('click', () => {
    const tr = addRow(blank(String(body.children.length + 1)));
    tr.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  });
  const head = el('thead', {}, el('tr', {}, ...PL_COLUMNS.map(([, label]) => el('th', {}, label)), el('th', {})));
  modal(
    'Parts list (ISO 7573)',
    [el('table', { class: 'mc-pl-table' }, head, body)],
    [add, el('span', { class: 'mc-spacer' })],
    () => {
      const out: PartsListRow[] = [];
      for (const tr of body.children) {
        const r = blank('');
        for (const i of tr.querySelectorAll('input')) r[i.name as keyof PartsListRow] = i.value.trim();
        if (PL_COLUMNS.some(([f]) => f !== 'quantity' && r[f])) out.push(r);
      }
      onSave(out);
    },
    onClose,
  );
  if (rows.length === 0) add.click();
}

const GROUP_ORDER: CommandGroup[] = ['Draw', 'Modify', 'Annotate', 'Dimension', 'Sheet', 'File'];

const BASICS: [string, string][] = [
  ['Command line', 'Type a command or its alias and press Enter or Space. Enter on an empty line repeats the last command. Typing shows matching commands; Tab completes.'],
  ['Prompts', 'Every prompt lists its options in [brackets]; type the capital letters or click the chip next to the input. Enter accepts a <default>. Esc cancels.'],
  ['Points', 'Click, or type x,y (view mm), @dx,dy relative, @len<angle polar, or a bare number for a distance along the cursor direction.'],
  ['Object snap', 'SNAP (F3) finds endpoints, midpoints, centres, quadrants, intersections, perpendiculars and tangents. Type END, MID, CEN, QUA, INT, PER, TAN or NEA at a point prompt for one point only.'],
  ['Ortho and polar', 'ORTHO (F8) locks to horizontal/vertical and tracks snapped points across views like a T-square; POLAR (F10) tracks every 15°.'],
  ['Selecting', 'Click an object, or drag a window (left to right: inside) or crossing (right to left: touching). Shift removes. Select first, then a command, or the other way round. Delete erases the selection.'],
  ['Grips', 'Selected objects show blue grips. Drag an endpoint to stretch a line, a midpoint or centre to move it, a quadrant to resize a circle, a dimension line to move it. Grips that meet at a corner move together; Shift+click collects several grips, then drag one. While a grip is hot, Enter cycles Stretch, Move, Rotate, Scale and Mirror of the whole selection; Copy keeps the source. Hatches and associative dimensions follow.'],
  ['Mouse', 'Wheel zooms at the cursor. Middle button drags to pan; double-click it to fit the sheet. Right-click = Enter. Double-click a hatch, text or leader, dimension, the title block or the parts list to edit it.'],
  ['Line types', 'Line type and width come from the meaning of a line (visible edge, centre line …) and the sheet\'s line group, never chosen freely. Select objects and change the Line type box to retype them.'],
  ['Hatching', 'A cut surface must be a closed outline of visible, thin or freehand lines. HATCH previews the area under the cursor; if it is not closed, the open ends are marked in red; the Gap option bridges small gaps.'],
];

/** Modal command reference: basics, then every command with its aliases, grouped. */
export function openHelpDialog(onClose: () => void): void {
  const basics = el('dl', { class: 'mc-help-basics' }, ...BASICS.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const groups = GROUP_ORDER.map((g) => {
    const rows = COMMAND_INFO.filter((c) => c.group === g).map((c) =>
      el('tr', {}, el('td', { class: 'mc-help-name' }, c.name), el('td', { class: 'mc-help-alias' }, aliasesOf(c.name).join(', ')), el('td', {}, c.summary)),
    );
    return el('section', {}, el('h4', {}, g), el('table', { class: 'mc-help-table' }, ...rows));
  });
  const dlg = modal('ManualCAD help', [el('div', { class: 'mc-help' }, basics, ...groups)], [], () => {}, onClose, 'mc-dialog-help');
  dlg.querySelector<HTMLButtonElement>('button[type="button"]')?.remove();
}
