// DOM construction: toolbar, canvas, command line, status bar, title block dialog.
import { LINE_TYPES } from '../model/standards';
import type { LineTypeId, PartsListRow, TitleBlockField } from '../model/types';

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
  coords: HTMLElement;
  viewInfo: HTMLElement;
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

const BUTTONS: [string, string, string][][] = [
  [['NEW', 'New', 'New drawing (NEW); UNDO restores the previous one'], ['OPEN', 'Open', 'Open .mcad (Ctrl+O)'], ['SAVE', 'Save', 'Save .mcad (Ctrl+S)'], ['PLOT', 'PDF', 'Export PDF'], ['TITLEBLOCK', 'Title block', 'Edit title block (TB), or double-click it'], ['PARTSLIST', 'Parts list', 'Edit parts list (PARTS), or double-click it; -PARTSLIST on the command line']],
  [['LINE', 'Line', 'LINE (L)'], ['CIRCLE', 'Circle', 'CIRCLE (C)'], ['ARC', 'Arc', 'ARC (A)'], ['RECTANG', 'Rect', 'RECTANG (REC)'], ['HATCH', 'Hatch', 'HATCH (H)']],
  [['OFFSET', 'Offset', 'OFFSET (O)'], ['TRIM', 'Trim', 'TRIM (TR)'], ['EXTEND', 'Extend', 'EXTEND (EX)'], ['FILLET', 'Fillet', 'FILLET (F)'], ['CHAMFER', 'Chamfer', 'CHAMFER (CHA)']],
  [['MOVE', 'Move', 'MOVE (M)'], ['COPY', 'Copy', 'COPY (CO)'], ['MIRROR', 'Mirror', 'MIRROR (MI)'], ['ERASE', 'Erase', 'ERASE (E / Del)']],
  [['TEXT', 'Text', 'TEXT (DT)'], ['SKETCH', 'Freehand', 'SKETCH (SK): freehand break line, ISO 128-2 01.1'], ['LEADER', 'Leader', 'LEADER (LE): note on a leader line, ISO 128-22'], ['BALLOON', 'Item no.', 'BALLOON (BAL): item number on a leader, ISO 6433']],
  [['DIMLINEAR', 'Linear', 'DIMLINEAR (DLI)'], ['DIMALIGNED', 'Aligned', 'DIMALIGNED (DAL)'], ['DIMRADIUS', 'Radius', 'DIMRADIUS (DRA)'], ['DIMDIAMETER', 'Diameter', 'DIMDIAMETER (DDI)'], ['DIMANGULAR', 'Angular', 'DIMANGULAR (DAN)'], ['DIMEDIT', 'Dim text', 'DIMEDIT (DED)']],
  [['VIEW', 'View', 'VIEW (V)'], ['ZOOM E', 'Fit', 'ZOOM Extents (Z E), or double-click the middle mouse button'], ['UNDO', 'Undo', 'UNDO (Ctrl+Z)'], ['REDO', 'Redo', 'REDO (Ctrl+Y)']],
];

export function buildUI(root: HTMLElement): UIRefs {
  const format = select('mc-format', 'Sheet format', ['A4', 'A3', 'A2', 'A1', 'A0'].map((f) => [f, f]));
  const orientation = select('mc-orientation', 'Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']]);
  const lineGroup = select('mc-linegroup', 'Line group (ISO 128-2)', [['0.5', '0.5'], ['0.7', '0.7']]);
  const view = select('mc-view', 'Current view', []);
  const lineType = select('mc-linetype', 'Line type for new objects, or for the selection', LINE_TYPE_ORDER.map((id) => [id, lineTypeLabel(id)]));
  const layer = select('mc-layer', 'Current layer', []);
  const layerList = el('div', { class: 'mc-layer-list' });
  const layerNew = el('input', { class: 'mc-layer-new', placeholder: 'New layer…', size: '10' });
  const layers = el('details', { class: 'mc-layers' }, el('summary', { title: 'Layer visibility' }, 'Layers'), el('div', { class: 'mc-popup' }, layerList, layerNew));

  const commandButtons: HTMLButtonElement[] = [];
  const groups = BUTTONS.map((g) =>
    el(
      'div',
      { class: 'mc-group' },
      ...g.map(([cmd, label, title]) => {
        const b = el('button', { type: 'button', title, 'data-cmd': cmd }, label);
        commandButtons.push(b);
        return b;
      }),
    ),
  );

  const settings = el(
    'div',
    { class: 'mc-group mc-settings' },
    labelled('Sheet', format),
    orientation,
    labelled('Line group', lineGroup),
    labelled('View', view),
    labelled('Line type', lineType),
    labelled('Layer', layer),
    layers,
  );
  const toolbar = el('header', { class: 'mc-toolbar' }, el('div', { class: 'mc-row' }, el('strong', { class: 'mc-brand' }, 'ManualCAD'), settings), el('div', { class: 'mc-row' }, ...groups));

  const canvas = el('canvas', { class: 'mc-canvas', tabindex: '0' });
  const canvasWrap = el('main', { class: 'mc-canvas-wrap' }, canvas);

  const history = el('div', { class: 'mc-history' });
  const prompt = el('span', { class: 'mc-prompt' }, 'Command:');
  const input = el('input', { class: 'mc-input', autocomplete: 'off', spellcheck: 'false' });
  const cmd = el('section', { class: 'mc-command' }, history, el('div', { class: 'mc-cmdline' }, prompt, input));

  const coords = el('span', { class: 'mc-coords' }, '0.00, 0.00');
  const viewInfo = el('span', { class: 'mc-viewinfo' });
  const toggle = (label: string, key: string) => el('button', { type: 'button', class: 'mc-toggle', title: `${label} (${key})` }, label);
  const toggles = { snap: toggle('SNAP', 'F3'), ortho: toggle('ORTHO', 'F8'), polar: toggle('POLAR', 'F10') };
  const status = el('footer', { class: 'mc-status' }, coords, viewInfo, el('span', { class: 'mc-spacer' }), toggles.snap, toggles.ortho, toggles.polar);

  const fileInput = el('input', { type: 'file', accept: '.mcad,.json,application/json', style: 'display:none' });

  root.replaceChildren(el('div', { class: 'mc-root' }, toolbar, canvasWrap, cmd, status, fileInput));
  return { canvas, canvasWrap, format, orientation, lineGroup, view, lineType, layer, layerList, layerNew, history, prompt, input, coords, viewInfo, toggles, fileInput, commandButtons };
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
  const ok = el('button', { type: 'submit', class: 'mc-primary' }, 'OK');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const form = el('form', { method: 'dialog' }, el('h3', {}, 'Title block (ISO 7200)'), ...rows, el('div', { class: 'mc-dialog-buttons' }, cancel, ok));
  const dlg = el('dialog', { class: 'mc-dialog' }, form);
  document.body.append(dlg);
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', () => {
    const out: Partial<Record<TitleBlockField, string>> = {};
    for (const [f, i] of inputs) if (i.value.trim()) out[f] = i.value.trim();
    onSave(out);
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose();
  });
  dlg.showModal();
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
  const ok = el('button', { type: 'submit', class: 'mc-primary' }, 'OK');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const form = el(
    'form',
    { method: 'dialog' },
    el('h3', {}, 'Parts list (ISO 7573)'),
    el('table', { class: 'mc-pl-table' }, head, body),
    el('div', { class: 'mc-dialog-buttons' }, add, el('span', { class: 'mc-spacer' }), cancel, ok),
  );
  const dlg = el('dialog', { class: 'mc-dialog' }, form);
  document.body.append(dlg);
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', () => {
    const out: PartsListRow[] = [];
    for (const tr of body.children) {
      const r = blank('');
      for (const i of tr.querySelectorAll('input')) r[i.name as keyof PartsListRow] = i.value.trim();
      if (PL_COLUMNS.some(([f]) => f !== 'quantity' && r[f])) out.push(r);
    }
    onSave(out);
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose();
  });
  dlg.showModal();
  if (rows.length === 0) add.click();
}
