// Title block and parts list blocks in DXF/DWG (ADR-0006). A block insert whose attribute tags are those of a
// title block template (BBRZ) selects that template and fills its fields; inserts of the BBRZ parts list blocks
// (`Stückliste_BBRZ`, `Stückliste_Erweiterung_BBRZ`) become parts list rows. Neither is exploded: ManualCAD draws
// its own title block and parts list. Inserts that match no template still fill fields by tag name.
import { TITLE_BLOCK_TEMPLATES, type TitleBlockTemplate } from '../model/titleblock';
import type { PartsListRow, TitleBlockField, TitleBlockTemplateId } from '../model/types';
import { decodeTextCodes } from './mtext';
import type { RawDrawing, RawEntity } from './raw';

type Insert = Extract<RawEntity, { kind: 'insert' }>;

/** A tag reduced for comparison: upper-case letters and digits (umlauts lose their dots, ß and punctuation go). */
export function titleTagKey(tag: string): string {
  return decodeTextCodes(tag).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Parts list tags carry the row number (TEIL1, TEIL1-STÜCK in the first row, TEIL, TEIL-STÜCK in extensions). */
function partsTagKey(tag: string): string {
  return titleTagKey(tag).replace(/^TEIL\d*/, 'TEIL');
}

const PARTS_COLUMNS = TITLE_BLOCK_TEMPLATES.bbrz.partsList.columns.filter((c) => c.tag);

function attributes(e: Insert): { tag: string; value: string }[] {
  const out: { tag: string; value: string }[] = [];
  for (const a of e.attribs) if (a.kind === 'text' && a.tag !== null) out.push({ tag: a.tag, value: decodeTextCodes(a.text).trim() });
  return out;
}

/** Template tags by key. */
function templateTags(t: TitleBlockTemplate): Map<string, TitleBlockField> {
  const out = new Map<string, TitleBlockField>();
  for (const f of t.fields) if (f.tag) out.set(titleTagKey(f.tag), f.field);
  return out;
}

/** The template whose tags the set contains best: at least three of them, more than any other template. */
export function matchTemplate(tags: Iterable<string>): TitleBlockTemplate | null {
  const keys = new Set([...tags].map(titleTagKey));
  let best: TitleBlockTemplate | null = null;
  let bestScore = 2;
  for (const t of Object.values(TITLE_BLOCK_TEMPLATES)) {
    let score = 0;
    for (const k of templateTags(t).keys()) if (keys.has(k)) score++;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

function isPartsRow(e: Insert): boolean {
  const keys = new Set(attributes(e).map((a) => partsTagKey(a.tag)));
  return keys.has('TEIL') && keys.has('TEILBENENNUNG');
}

/** What an insert is to the importer: a title block template, a parts list row, or neither (then it is exploded). */
export function sheetBlockKind(e: Insert): 'titleblock' | 'partsrow' | null {
  if (isPartsRow(e)) return 'partsrow';
  return matchTemplate(attributes(e).map((a) => a.tag)) ? 'titleblock' : null;
}

/** Title block fields of an insert that matches no template, by common German/English tag names. */
const FIELD_TAGS: [RegExp, TitleBlockField][] = [
  [/zeichnung(s)?-?n(r|ummer)|drawing-?no|dwg-?no|^znr|^nummer$/i, 'drawingNumber'],
  [/titel|benennung|^title$|bezeichnung/i, 'title'],
  [/^neben ?ma(ss|ß)stab$/i, 'secondaryScale'],
  [/^ma(ss|ß)stab$|^scale$/i, 'scale'],
  [/klasse|auftraggeber|client/i, 'client'],
  [/firma|schule|owner|^company$/i, 'owner'],
  [/toleranz|tolerance/i, 'generalTolerance'],
  [/gez|gezeichnet|drawn|erstellt|^name$|bearbeiter/i, 'createdBy'],
  [/gepr|geprüft|gepruft|approved|genehmigt/i, 'approvedBy'],
  [/datum|date|tag$/i, 'date'],
  [/doku|dokumentenart|dokumentart|document/i, 'documentType'],
  [/blatt|sheet/i, 'sheet'],
  [/werkstoff|material/i, 'material'],
];

function fieldByName(tag: string): TitleBlockField | null {
  const t = tag.replace(/[_\-.]/g, ' ');
  const hit = FIELD_TAGS.find(([re]) => re.test(t));
  if (!hit) return null;
  const field = hit[1];
  if ((field === 'createdBy' || field === 'approvedBy') && /tag|datum/i.test(t)) return /gepr/i.test(t) ? 'approvedDate' : null;
  if (field === 'date' && /gepr/i.test(t)) return 'approvedDate';
  return field;
}

/** A value as the title block stores it: placeholders ("----") are empty, a bare tolerance class gets "ISO 2768-". */
function fieldValue(field: TitleBlockField, value: string): string {
  if (/^-+$/.test(value)) return '';
  if (field === 'generalTolerance' && /^[a-z]{1,2}$/i.test(value)) return `ISO 2768-${value}`;
  return value;
}

export interface SheetBlocks {
  /** The template a recognised insert (or the drawing's own attribute definitions) selects; null = none found. */
  template: TitleBlockTemplateId | null;
  fields: Map<TitleBlockField, string>;
  rows: PartsListRow[];
  report: string[];
}

/** Title block template, field values and parts list rows from the drawing's block inserts. */
export function readSheetBlocks(raw: RawDrawing): SheetBlocks {
  const fields = new Map<TitleBlockField, string>();
  const rows: { row: PartsListRow; y: number; order: number }[] = [];
  const report: string[] = [];
  let template: TitleBlockTemplate | null = null;
  let source = '';
  const set = (field: TitleBlockField, value: string): void => {
    const v = fieldValue(field, value);
    if (v && !fields.has(field)) fields.set(field, v);
  };

  const visit = (entities: RawEntity[], depth: number): void => {
    for (const e of entities) {
      if (e.kind !== 'insert') continue;
      const attrs = attributes(e);
      if (isPartsRow(e)) {
        const row: PartsListRow = { item: '', quantity: '', name: '', standard: '', material: '', stock: '', remark: '' };
        for (const a of attrs) {
          const col = PARTS_COLUMNS.find((c) => partsTagKey(c.tag!) === partsTagKey(a.tag));
          if (col && !/^-+$/.test(a.value)) row[col.field] = a.value;
        }
        if (Object.values(row).some((v) => v !== '')) rows.push({ row, y: e.pos.y, order: rows.length });
        continue;
      }
      const t = matchTemplate(attrs.map((a) => a.tag));
      if (t) {
        if (!template) {
          template = t;
          source = e.name;
        }
        const tags = templateTags(t);
        for (const a of attrs) {
          const field = tags.get(titleTagKey(a.tag));
          if (field) set(field, a.value);
        }
        continue;
      }
      for (const a of attrs) {
        const field = fieldByName(a.tag);
        if (field) set(field, a.value);
      }
      const block = raw.blocks.get(e.name);
      if (block && depth < 4) visit(block.entities, depth + 1);
    }
  };
  visit(raw.entities, 0);

  // a template drawing opened as it is: its attribute definitions are loose in the drawing (their defaults are prompts, not values)
  if (!template) {
    const loose = raw.entities.filter((e): e is Extract<RawEntity, { kind: 'text' }> => e.kind === 'text' && e.tag !== null).map((e) => e.tag!);
    template = matchTemplate(loose);
    if (template) source = 'attribute definitions of the drawing';
  }

  const found = template as TitleBlockTemplate | null;
  if (found) report.push(`Title block template ${found.name} from ${source === 'attribute definitions of the drawing' ? source : `block "${source}"`}${fields.size ? `, ${fields.size} field${fields.size === 1 ? '' : 's'} filled` : ''}.`);
  rows.sort((a, b) => a.y - b.y || a.order - b.order);
  if (rows.length) report.push(`Parts list: ${rows.length} row${rows.length === 1 ? '' : 's'} from the BBRZ parts list blocks.`);
  return { template: found?.id ?? null, fields, rows: rows.map((r) => r.row), report };
}
