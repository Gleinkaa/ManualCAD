// Title block templates (CONTEXT.md "Title block", ADR-0006): layout data only, no drawing. The sheet chooses its
// template; plot/frame.ts draws it with the line group's widths, io maps the DXF attribute tags onto the fields.
// Positions are relative to the title block's bottom-left corner, paper mm, y up.
import type { Orientation, PartsListRow, SheetDoc, SheetFormat, TitleBlockField, TitleBlockTemplateId } from './types';

export interface TitleBlockBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A printed, editable field. Its value is shrunk along the ISO 3098 series until it fits the box. */
export interface TitleBlockFieldDef {
  field: TitleBlockField;
  /** DXF/DWG attribute tag that carries the value in the template's block (BBRZ), null when there is none. */
  tag: string | null;
  box: TitleBlockBox;
  /** Preferred lettering height (ISO 3098 series). */
  valueH: number;
  align: 'left' | 'center';
  /** 'middle' = centred vertically in the box, a number = baseline that far above the box bottom. */
  baseline: 'middle' | number;
}

/** A fixed caption. `w` is the width it must fit into (shrunk along the ISO 3098 series). */
export interface TitleBlockCaption {
  text: string;
  x: number;
  y: number;
  w: number;
  align: 'left' | 'center';
  baseline: 'top' | 'middle' | 'bottom';
}

/** A parts list column (ISO 7573). */
export interface PartsListColumnDef {
  field: keyof PartsListRow;
  caption: string[];         // one or two caption lines
  w: number;
  center?: boolean;
  /** Attribute tag of the column in the template's parts list block, digits left out (TEIL1 and TEIL are both "TEIL"). */
  tag?: string;
}

export interface PartsListLayout {
  headerHeight: number;
  rowHeight: number;
  /** Preferred lettering height of the row values. */
  valueH: number;
  columns: PartsListColumnDef[];
}

export interface TitleBlockTemplate {
  id: TitleBlockTemplateId;
  name: string;
  /** Where the layout comes from. */
  source: string;
  width: number;
  height: number;
  /** Sheets the template is made for; null = every format and orientation. */
  sheets: { format: SheetFormat; orientation: Orientation }[] | null;
  /** Inner rulings [x0, y0, x1, y1]; the outline is the frame and the wide top/left edge. */
  rules: [number, number, number, number][];
  captions: TitleBlockCaption[];
  fields: TitleBlockFieldDef[];
  /** First-angle projection symbol (ISO 5456-2): centre and lettering height h, or null. */
  projection: { x: number; y: number; h: number } | null;
  partsList: PartsListLayout;
}

// --- ISO 7200 ---------------------------------------------------------------------------------------------------

interface IsoCell {
  field: TitleBlockField | null;
  caption: string;
  x: number;
  y: number;
  w: number;
  h: number;
  valueH: number;
  center?: boolean;
}

// Layout after ISO 7200 Fig. 1 (identification row at the bottom, legal owner left, title above the
// identification number, administrative row on top) plus the Austrian-practice row for scale,
// material and general tolerance on top. Captions per ÖNORM EN ISO 7200 (German).
const ISO_CELLS: IsoCell[] = [
  { field: 'owner', caption: '', x: 0, y: 0, w: 55, h: 28, valueH: 5, center: true },
  { field: 'drawingNumber', caption: 'Zeichnungsnummer', x: 55, y: 0, w: 60, h: 12, valueH: 5 },
  { field: 'revision', caption: 'Änd.', x: 115, y: 0, w: 12, h: 12, valueH: 3.5 },
  { field: 'date', caption: 'Ausgabedatum', x: 127, y: 0, w: 30, h: 12, valueH: 3.5 },
  { field: 'sheet', caption: 'Blatt', x: 157, y: 0, w: 23, h: 12, valueH: 3.5 },
  { field: 'title', caption: 'Benennung', x: 55, y: 12, w: 125, h: 16, valueH: 7 },
  { field: 'createdBy', caption: 'Erstellt durch', x: 0, y: 28, w: 45, h: 10, valueH: 3.5 },
  { field: 'approvedBy', caption: 'Genehmigt von', x: 45, y: 28, w: 45, h: 10, valueH: 3.5 },
  { field: 'documentType', caption: 'Dokumentart', x: 90, y: 28, w: 90, h: 10, valueH: 3.5 },
  { field: null, caption: '', x: 0, y: 38, w: 22, h: 10, valueH: 0 }, // projection method symbol
  { field: 'scale', caption: 'Maßstab', x: 22, y: 38, w: 28, h: 10, valueH: 3.5 },
  { field: 'material', caption: 'Werkstoff', x: 50, y: 38, w: 65, h: 10, valueH: 3.5 },
  { field: 'generalTolerance', caption: 'Allgemeintoleranz', x: 115, y: 38, w: 65, h: 10, valueH: 3.5 },
];

/** Cell grid → rulings (each inner cell edge once), captions top-left, values bottom-left or centred. */
function fromCells(cells: IsoCell[], width: number, height: number): Pick<TitleBlockTemplate, 'rules' | 'captions' | 'fields'> {
  const rules: TitleBlockTemplate['rules'] = [];
  const seen = new Set<string>();
  const rule = (x0: number, y0: number, x1: number, y1: number): void => {
    const onOutline = (x0 === x1 && (x0 === 0 || x0 === width)) || (y0 === y1 && (y0 === 0 || y0 === height));
    const key = `${x0},${y0},${x1},${y1}`;
    if (onOutline || seen.has(key)) return;
    seen.add(key);
    rules.push([x0, y0, x1, y1]);
  };
  for (const c of cells) {
    rule(c.x, c.y + c.h, c.x + c.w, c.y + c.h);
    rule(c.x + c.w, c.y, c.x + c.w, c.y + c.h);
  }
  const captions = cells.filter((c) => c.caption).map((c): TitleBlockCaption => ({ text: c.caption, x: c.x + 1, y: c.y + c.h - 1, w: c.w - 2, align: 'left', baseline: 'top' }));
  const fields = cells
    .filter((c) => c.field)
    .map((c): TitleBlockFieldDef => ({
      field: c.field!,
      tag: null,
      box: { x: c.x, y: c.y, w: c.w, h: c.h },
      valueH: c.valueH,
      align: c.center ? 'center' : 'left',
      baseline: c.center ? 'middle' : c.h > 12 ? 3 : 1.5,
    }));
  return { rules, captions, fields };
}

/** ISO 7573 parts list: captions per ÖNORM EN ISO 7573 (German); widths sum to the title block width. */
const ISO_PARTS: PartsListLayout = {
  headerHeight: 8,
  rowHeight: 7,
  valueH: 3.5,
  columns: [
    { field: 'item', caption: ['Pos.'], w: 10, center: true },
    { field: 'quantity', caption: ['Menge'], w: 12, center: true },
    { field: 'name', caption: ['Benennung'], w: 45 },
    { field: 'standard', caption: ['Sachnummer/', 'Norm-Kurzbezeichnung'], w: 38 },
    { field: 'material', caption: ['Werkstoff'], w: 30 },
    { field: 'stock', caption: ['Rohmaße'], w: 25 },
    { field: 'remark', caption: ['Bemerkung'], w: 20 },
  ],
};

const ISO_7200: TitleBlockTemplate = {
  id: 'iso7200',
  name: 'ISO 7200',
  source: 'ÖNORM EN ISO 7200, 180 mm wide (fits A4 portrait), same block on every format',
  width: 180,
  height: 48,
  sheets: null,
  ...fromCells(ISO_CELLS, 180, 48),
  projection: { x: 11, y: 43, h: 3.5 },
  partsList: ISO_PARTS,
};

// --- BBRZ ---------------------------------------------------------------------------------------------------------

/** Parts list of `Stückliste_BBRZ` / `Stückliste_Erweiterung_BBRZ`: header 8 mm, rows 6 mm, five columns. */
const BBRZ_PARTS: PartsListLayout = {
  headerHeight: 8,
  rowHeight: 6,
  valueH: 2.5,
  columns: [
    { field: 'item', caption: ['Pos.-', 'Nr.'], w: 10, center: true, tag: 'TEIL' },
    { field: 'standard', caption: ['Zeichn.-/Sach-Nr.'], w: 30, tag: 'ZEICHNUNGSNUMMER' },
    { field: 'quantity', caption: ['Menge/', 'Einheit'], w: 10, center: true, tag: 'TEIL-STÜCK' },
    { field: 'name', caption: ['Benennung'], w: 55, tag: 'TEIL-BENENNUNG' },
    { field: 'material', caption: ['Werkstoff / Normkurzbezeichnung / Spez.'], w: 75, tag: 'TEIL-WERKSTOFF/NORMKBZ' },
  ],
};

const left = (x: number, y: number, w: number, baseline: TitleBlockCaption['baseline'] = 'middle') => (text: string): TitleBlockCaption => ({ text, x, y, w, align: 'left', baseline });
const centred = (x: number, y: number, w: number) => (text: string): TitleBlockCaption => ({ text, x, y, w, align: 'center', baseline: 'top' });

/**
 * `A4 bis A0_PLR_m_SK_BBRZ`: 180 × 51 mm. Left column scale / general tolerance / projection, middle the
 * drawn-by and checked-by grid, document type and title, right column class, school and drawing number.
 */
const BBRZ: TitleBlockTemplate = {
  id: 'bbrz',
  name: 'BBRZ (A4–A0)',
  source: 'samples/bbrz/A4 bis A0_PLR_m_SK_BBRZ.dwg',
  width: 180,
  height: 51,
  sheets: null,
  rules: [
    [0, 34, 180, 34],
    [0, 17, 18, 17],
    [18, 0, 18, 51],
    [120, 0, 120, 51],
    [120, 17, 180, 17],
    [18, 24.5, 120, 24.5],
    [56, 34, 56, 51],
    [74, 34, 74, 51],
    [18, 42, 120, 42],
    [18, 46, 120, 46],
  ],
  captions: [
    centred(9, 49.5, 16)('Maßstab'),
    centred(9, 32.5, 16)('Allgemein-'),
    centred(9, 29.9, 16)('toleranzen'),
    centred(9, 15.5, 16)('Projektion'),
    left(19, 43, 36, 'bottom')('Gezeichnet von'),
    left(19, 36.75, 36, 'bottom')('Geprüft von'),
    left(57.8, 47.3, 15, 'bottom')('Tag'),
    left(75.3, 47.3, 44, 'bottom')('Name'),
    left(19, 31.5, 22)('Dokumentenart'),
    left(19, 22, 22)('Titel'),
    left(121, 48.5, 58)('Auftraggeber / Klasse'),
    left(121, 31.5, 58)('Firma / Schule'),
    left(121, 14.5, 58)('Zeichnungsnummer'),
  ],
  fields: [
    { field: 'scale', tag: 'MAßSTAB', box: { x: 0, y: 38.5, w: 18, h: 7.5 }, valueH: 5, align: 'center', baseline: 'middle' },
    { field: 'secondaryScale', tag: 'NEBENMAßSTAB', box: { x: 0, y: 34.5, w: 18, h: 5.5 }, valueH: 2.5, align: 'center', baseline: 'middle' },
    { field: 'generalTolerance', tag: 'TOLERANZ', box: { x: 0, y: 18.5, w: 18, h: 5 }, valueH: 2.5, align: 'left', baseline: 'middle' },
    { field: 'date', tag: 'PLOT-TAG', box: { x: 56, y: 42, w: 18, h: 4 }, valueH: 2.5, align: 'left', baseline: 'middle' },
    { field: 'createdBy', tag: 'GEZ-NAME', box: { x: 74, y: 42, w: 46, h: 4 }, valueH: 2.5, align: 'left', baseline: 'middle' },
    { field: 'approvedDate', tag: 'GEPR-TAG', box: { x: 56, y: 34, w: 18, h: 8 }, valueH: 2.5, align: 'left', baseline: 'middle' },
    { field: 'approvedBy', tag: 'GEPR-NAME', box: { x: 74, y: 34, w: 46, h: 8 }, valueH: 2.5, align: 'left', baseline: 'middle' },
    { field: 'documentType', tag: 'DOKU_ART', box: { x: 41.5, y: 24.5, w: 78.5, h: 9.5 }, valueH: 5, align: 'left', baseline: 'middle' },
    { field: 'title', tag: 'TITEL_BENENNUNG', box: { x: 18, y: 0, w: 102, h: 24.5 }, valueH: 7, align: 'center', baseline: 'middle' },
    { field: 'client', tag: 'KLASSE', box: { x: 120, y: 34, w: 60, h: 12 }, valueH: 5, align: 'center', baseline: 'middle' },
    { field: 'owner', tag: null, box: { x: 120, y: 17, w: 60, h: 12.5 }, valueH: 5, align: 'center', baseline: 'middle' },
    { field: 'drawingNumber', tag: 'ZEICHNUNGNR.', box: { x: 120, y: 0, w: 60, h: 12 }, valueH: 5, align: 'center', baseline: 'middle' },
  ],
  projection: { x: 9, y: 7.5, h: 2.5 },
  partsList: BBRZ_PARTS,
};

/** `A4-PLR_m_kleinem_SK_BBRZ-MB`: the 15 mm school title block for A4 portrait exercise sheets. */
const BBRZ_SMALL: TitleBlockTemplate = {
  id: 'bbrz-small',
  name: 'BBRZ small (A4)',
  source: 'samples/bbrz/A4-PLR_m_kleinem_SK_BBRZ-MB.dwg',
  width: 180,
  height: 15,
  sheets: [{ format: 'A4', orientation: 'portrait' }],
  rules: [
    [45, 0, 45, 15],
    [80, 0, 80, 15],
    [0, 7.5, 80, 7.5],
  ],
  captions: [
    left(1, 14.4, 43, 'top')('Name'),
    left(1, 6.9, 43, 'top')('Blatt Nr.'),
    left(46, 14.4, 33, 'top')('Datum'),
    left(46, 6.9, 33, 'top')('Klasse'),
    left(81, 14.4, 98, 'top')('Benennung'),
  ],
  fields: [
    { field: 'createdBy', tag: 'NAME', box: { x: 9, y: 7.5, w: 36, h: 7 }, valueH: 3.5, align: 'left', baseline: 'middle' },
    { field: 'sheet', tag: 'BLATT-NR', box: { x: 13, y: 0.5, w: 32, h: 7 }, valueH: 3.5, align: 'left', baseline: 'middle' },
    { field: 'date', tag: 'DATUM', box: { x: 54, y: 7.5, w: 26, h: 7 }, valueH: 3.5, align: 'left', baseline: 'middle' },
    { field: 'client', tag: 'KLASSE', box: { x: 54, y: 0.5, w: 26, h: 7 }, valueH: 3.5, align: 'left', baseline: 'middle' },
    { field: 'title', tag: 'BENENNUNG', box: { x: 96, y: 0, w: 84, h: 15 }, valueH: 3.5, align: 'left', baseline: 'middle' },
  ],
  projection: null,
  partsList: BBRZ_PARTS,
};

export const TITLE_BLOCK_TEMPLATES: Record<TitleBlockTemplateId, TitleBlockTemplate> = {
  iso7200: ISO_7200,
  bbrz: BBRZ,
  'bbrz-small': BBRZ_SMALL,
};

/** The sheet's template; files written before templates existed use ISO 7200. */
export function titleBlockTemplate(doc: Pick<SheetDoc, 'titleBlockTemplate'>): TitleBlockTemplate {
  return TITLE_BLOCK_TEMPLATES[doc.titleBlockTemplate ?? 'iso7200'] ?? ISO_7200;
}

/** Whether the template is made for the sheet's format and orientation (BBRZ small: A4 portrait only). */
export function templateFitsSheet(t: TitleBlockTemplate, format: SheetFormat, orientation: Orientation): boolean {
  return !t.sheets || t.sheets.some((s) => s.format === format && s.orientation === orientation);
}

/** The fields the template prints. */
export function templateFields(t: TitleBlockTemplate): TitleBlockField[] {
  return t.fields.map((f) => f.field);
}

/** English labels for the title block editor (the sheet itself stays German). */
export const TITLE_BLOCK_FIELD_LABELS: Record<TitleBlockField, string> = {
  title: 'Title',
  drawingNumber: 'Drawing number',
  owner: 'Owner / company / school',
  client: 'Client / class',
  material: 'Material',
  scale: 'Scale (empty = main view)',
  secondaryScale: 'Secondary scale',
  generalTolerance: 'General tolerance',
  createdBy: 'Created by',
  date: 'Date',
  approvedBy: 'Approved by',
  approvedDate: 'Approval date',
  revision: 'Revision',
  sheet: 'Sheet',
  documentType: 'Document type',
};
