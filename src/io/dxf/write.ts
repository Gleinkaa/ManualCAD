// SheetDoc → DXF R2000 (AC1015). Model space holds every view's geometry in real mm, placed so that
// paper = model × view scale; a layout "Sheet" carries the frame, title block, parts list and one viewport per view.
// Dimensions, leaders and the title block are written as plain geometry (the same primitives ManualCAD plots).
import { plotDimension } from '../../dim';
import type { Curve, Vec2 } from '../../geom/types';
import { layerVisible } from '../../model/doc';
import { DASH_LENGTHS, LINE_GROUPS, LINE_TYPES, sheetSize } from '../../model/standards';
import type { LineTypeId, SheetDoc, View } from '../../model/types';
import { plotAnnotation, plotFrame, plotSheet, type Primitive } from '../../plot';

const VERSION = 'AC1015';
const PLOT: { includeConstruction: boolean; screenColors: boolean } = { includeConstruction: false, screenColors: false };

/** Layer convention of the Austrian training drawings: the pen colour decides the plotted width. */
const CONVENTION: Record<LineTypeId, { layer: (g: '0.5' | '0.7') => string; color: (g: '0.5' | '0.7') => number; linetype: string }> = {
  visible: { layer: (g) => (g === '0.7' ? '0.70' : '0.50'), color: (g) => (g === '0.7' ? 1 : 2), linetype: 'CONTINUOUS' },
  thin: { layer: (g) => (g === '0.7' ? '0.35' : '0.25'), color: (g) => (g === '0.7' ? 3 : 4), linetype: 'CONTINUOUS' },
  hidden: { layer: () => 'Verdeckt', color: (g) => (g === '0.7' ? 3 : 4), linetype: 'HIDDEN' },
  center: { layer: () => 'Achsen', color: (g) => (g === '0.7' ? 3 : 4), linetype: 'CENTER' },
  phantom: { layer: () => 'Strich-2xPunkt', color: (g) => (g === '0.7' ? 3 : 4), linetype: 'PHANTOM' },
  freehand: { layer: (g) => (g === '0.7' ? '0.35' : '0.25'), color: (g) => (g === '0.7' ? 3 : 4), linetype: 'CONTINUOUS' },
  construction: { layer: () => 'Defpoints', color: () => 8, linetype: 'CONTINUOUS' },
};
const DIM_LAYER = 'Bemaßung';
const HATCH_LAYER = 'Schraffur';
const TEXT_LAYER = 'Text';
const SHEET_LAYER = 'Schriftkopf';

const n = (v: number): string => {
  const s = (Math.abs(v) < 1e-12 ? 0 : v).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

class Out {
  private parts: string[] = [];
  private seed = 0x100;

  tag(code: number, value: string | number): void {
    // R2000 DXF is code-page text, not UTF-8: anything beyond ASCII goes out as AutoCAD's \U+XXXX escape
    const v = typeof value === 'number' ? n(value) : value.replace(/[^\x00-\x7f]/g, (ch) => `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    this.parts.push(`${String(code).padStart(3, ' ')}\n${v}\n`);
  }

  point(code: number, p: Vec2, z = 0): void {
    this.tag(code, p.x);
    this.tag(code + 10, p.y);
    this.tag(code + 20, z);
  }

  handle(): string {
    return (this.seed++).toString(16).toUpperCase();
  }

  nextHandle(): string {
    return this.seed.toString(16).toUpperCase();
  }

  toString(): string {
    return this.parts.join('');
  }
}

interface Pen {
  layer: string;
  color: number;             // ACI
  linetype: string;
}

interface Writer {
  out: Out;
  modelHandle: string;
  paperHandle: string;
  layers: Map<string, { color: number; linetype: string; off: boolean }>;
}

export function writeDxf(doc: SheetDoc): string {
  const out = new Out();
  const sheet = sheetSize(doc.format, doc.orientation);
  const group = doc.lineGroup;
  const w: Writer = { out, modelHandle: '', paperHandle: '', layers: new Map() };
  const layer = (name: string, color: number, linetype = 'CONTINUOUS', off = false) => {
    if (!w.layers.has(name)) w.layers.set(name, { color, linetype, off });
  };
  layer('0', 7);
  for (const lt of Object.keys(CONVENTION) as LineTypeId[]) layer(CONVENTION[lt].layer(group), CONVENTION[lt].color(group), CONVENTION[lt].linetype);
  layer(DIM_LAYER, 4);
  layer(HATCH_LAYER, 6);
  layer(TEXT_LAYER, 3);
  layer(SHEET_LAYER, 1);
  for (const l of doc.layers) if (l.name !== '0') layer(l.name, 7, 'CONTINUOUS', !l.visible);

  // --- collect entities first (so the layer table is complete), then emit sections ---
  const model: ((wr: Writer) => void)[] = [];
  const paper: ((wr: Writer) => void)[] = [];
  const penOf = (lineType: LineTypeId, userLayer: string): Pen => {
    const c = CONVENTION[lineType];
    return userLayer === '0' || lineType === 'construction' ? { layer: c.layer(group), color: c.color(group), linetype: c.linetype } : { layer: userLayer, color: c.color(group), linetype: c.linetype };
  };
  const widthPen = (width: number, userLayer: string | null, fallbackLayer: string): Pen => {
    const wide = width >= LINE_GROUPS[group].wide - 1e-9;
    const base = penOf(wide ? 'visible' : 'thin', '0');
    return { ...base, layer: userLayer && userLayer !== '0' ? userLayer : fallbackLayer };
  };
  const viewScale = new Map<string, number>();
  const viewOffset = new Map<string, Vec2>();
  for (const v of doc.views) {
    viewScale.set(v.id, v.scale);
    viewOffset.set(v.id, { x: v.origin.x / v.scale, y: v.origin.y / v.scale });
  }
  const sheetToModel = (viewId: string, p: Vec2): Vec2 => {
    const s = viewScale.get(viewId)!;
    return { x: p.x / s, y: p.y / s };
  };

  for (const e of doc.entities) {
    if (e.lineType === 'construction') continue;
    const pen = penOf(e.lineType, e.layer);
    model.push((wr) => curveEntity(wr, false, pen, curveToModel(e.geom, viewOffset.get(e.viewId)!)));
  }
  const primsByView = new Map<string, Primitive[]>();
  const pushPrims = (viewId: string, prims: Primitive[]) => primsByView.set(viewId, [...(primsByView.get(viewId) ?? []), ...prims]);
  for (const d of doc.dimensions) {
    const prims = plotDimension(doc, d);
    pushPrims(d.viewId, prims);
    const s = viewScale.get(d.viewId)!;
    const userLayer = d.layer;
    for (const p of prims) model.push((wr) => primitiveEntity(wr, false, p, (q) => sheetToModel(d.viewId, q), 1 / s, () => widthPen(p.kind === 'text' || p.kind === 'fill' ? 0 : p.style.width, userLayer, DIM_LAYER)));
  }
  for (const a of doc.annotations) {
    const s = viewScale.get(a.viewId)!;
    if (a.kind === 'hatch') {
      const pen: Pen = { layer: a.layer !== '0' ? a.layer : HATCH_LAYER, color: 6, linetype: 'CONTINUOUS' };
      const loops = a.loops.map((l) => l.map((c) => curveToModel(c, viewOffset.get(a.viewId)!)));
      model.push((wr) => hatchEntity(wr, pen, loops, a.angle, a.spacing / s));
      pushPrims(a.viewId, plotAnnotation(doc, a, PLOT));
      continue;
    }
    const prims = plotAnnotation(doc, a, PLOT);
    pushPrims(a.viewId, prims);
    const fallback = a.kind === 'text' ? TEXT_LAYER : DIM_LAYER;
    for (const p of prims) model.push((wr) => primitiveEntity(wr, false, p, (q) => sheetToModel(a.viewId, q), 1 / s, () => widthPen(p.kind === 'text' || p.kind === 'fill' ? 0 : p.style.width, a.layer, fallback)));
  }
  for (const e of doc.entities) {
    if (e.lineType === 'construction') continue;
    pushPrims(e.viewId, [{ kind: 'polyline', points: curveSheetPoints(e.geom, doc.views.find((v) => v.id === e.viewId)!), closed: false, style: { width: 0, dash: [], dashOffset: 0, color: '#000' } }]);
  }

  // paper space: frame, title block, parts list, view labels, viewports
  const sheetPen = (p: Primitive): Pen => widthPen(p.kind === 'text' || p.kind === 'fill' ? 0 : p.style.width, null, SHEET_LAYER);
  for (const p of plotFrame(doc, PLOT)) paper.push((wr) => primitiveEntity(wr, true, p, (q) => q, 1, () => sheetPen(p)));
  for (const p of plotSheet(doc, PLOT)) if (p.tag?.startsWith('label:')) paper.push((wr) => primitiveEntity(wr, true, p, (q) => q, 1, () => sheetPen(p)));
  // the paper's own viewport (id 1) comes first, then one per view with content
  paper.push((wr) => viewportEntity(wr, 1, { x: sheet.w / 2, y: sheet.h / 2 }, sheet.w, sheet.h, { x: sheet.w / 2, y: sheet.h / 2 }, sheet.h));
  let vpId = 2;
  for (const v of doc.views) {
    const prims = primsByView.get(v.id);
    if (!prims || prims.length === 0) continue;
    const box = primitiveBox(prims);
    const pad = 3;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const vw = box.max.x - box.min.x + 2 * pad;
    const vh = box.max.y - box.min.y + 2 * pad;
    const id = vpId++;
    paper.push((wr) => viewportEntity(wr, id, { x: cx, y: cy }, vw, vh, { x: cx / v.scale, y: cy / v.scale }, vh / v.scale));
  }

  // --- HEADER ---
  const ext = modelExtents(doc);
  out.tag(0, 'SECTION');
  out.tag(2, 'HEADER');
  header(out, '$ACADVER', 1, VERSION);
  header(out, '$DWGCODEPAGE', 3, 'ANSI_1252');
  headerPoint(out, '$INSBASE', { x: 0, y: 0 });
  headerPoint(out, '$EXTMIN', ext.min);
  headerPoint(out, '$EXTMAX', ext.max);
  headerPoint(out, '$LIMMIN', { x: 0, y: 0 });
  headerPoint(out, '$LIMMAX', { x: sheet.w, y: sheet.h });
  header(out, '$LTSCALE', 40, 1);
  header(out, '$TEXTSIZE', 40, LINE_GROUPS[group].dimText);
  header(out, '$TEXTSTYLE', 7, 'Standard');
  header(out, '$CLAYER', 8, '0');
  header(out, '$CELTYPE', 6, 'BYLAYER');
  header(out, '$CECOLOR', 62, 256);
  header(out, '$CELTSCALE', 40, 1);
  header(out, '$DIMSCALE', 40, 1);
  header(out, '$DIMSTYLE', 2, 'Standard');
  header(out, '$LUNITS', 70, 2);
  header(out, '$LUPREC', 70, 2);
  header(out, '$AUNITS', 70, 0);
  header(out, '$AUPREC', 70, 0);
  header(out, '$MEASUREMENT', 70, 1);
  header(out, '$INSUNITS', 70, 4);
  header(out, '$TILEMODE', 70, 1);
  header(out, '$PSLTSCALE', 70, 1);
  header(out, '$LWDISPLAY', 290, 0);
  headerPoint(out, '$PEXTMIN', { x: 0, y: 0 });
  headerPoint(out, '$PEXTMAX', { x: sheet.w, y: sheet.h });
  headerPoint(out, '$PLIMMIN', { x: 0, y: 0 });
  headerPoint(out, '$PLIMMAX', { x: sheet.w, y: sheet.h });
  const handseedPos = out; // $HANDSEED must be larger than every handle; written as a generous constant
  header(handseedPos, '$HANDSEED', 5, 'FFFFF');
  out.tag(0, 'ENDSEC');

  // --- CLASSES ---
  out.tag(0, 'SECTION');
  out.tag(2, 'CLASSES');
  out.tag(0, 'ENDSEC');

  // --- TABLES ---
  out.tag(0, 'SECTION');
  out.tag(2, 'TABLES');
  const vportTable = tableStart(out, 'VPORT', 1);
  symbol(out, 'VPORT', vportTable, 'AcDbViewportTableRecord', (o) => {
    o.tag(2, '*Active');
    o.tag(70, 0);
    o.tag(10, 0);
    o.tag(20, 0);
    o.tag(11, 1);
    o.tag(21, 1);
    o.tag(12, (ext.min.x + ext.max.x) / 2);
    o.tag(22, (ext.min.y + ext.max.y) / 2);
    o.tag(13, 0);
    o.tag(23, 0);
    o.tag(14, 10);
    o.tag(24, 10);
    o.tag(15, 10);
    o.tag(25, 10);
    o.tag(16, 0);
    o.tag(26, 0);
    o.tag(36, 1);
    o.tag(17, 0);
    o.tag(27, 0);
    o.tag(37, 0);
    o.tag(40, Math.max(ext.max.y - ext.min.y, 1) * 1.2);
    o.tag(41, 1.5);
    o.tag(42, 50);
    o.tag(43, 0);
    o.tag(44, 0);
    o.tag(50, 0);
    o.tag(51, 0);
    o.tag(71, 0);
    o.tag(72, 1000);
    o.tag(73, 1);
    o.tag(74, 3);
    o.tag(75, 0);
    o.tag(76, 0);
    o.tag(77, 0);
    o.tag(78, 0);
    o.tag(281, 0);
    o.tag(65, 1);
    o.tag(110, 0);
    o.tag(120, 0);
    o.tag(130, 0);
    o.tag(111, 1);
    o.tag(121, 0);
    o.tag(131, 0);
    o.tag(112, 0);
    o.tag(122, 1);
    o.tag(132, 0);
    o.tag(79, 0);
    o.tag(146, 0);
  });
  out.tag(0, 'ENDTAB');

  const narrow = LINE_GROUPS[group].narrow;
  const ltypes: [string, string, number[]][] = [
    ['ByBlock', '', []],
    ['ByLayer', '', []],
    ['CONTINUOUS', 'Solid line', []],
    ['HIDDEN', 'Hidden ISO 128-2 02.1 __ __ __ __', [DASH_LENGTHS.dash * narrow, -DASH_LENGTHS.gap * narrow]],
    ['CENTER', 'Centre ISO 128-2 04.1 ____ . ____ . ____', [DASH_LENGTHS.longDash * narrow, -DASH_LENGTHS.gap * narrow, 0, -DASH_LENGTHS.gap * narrow]],
    ['PHANTOM', 'Phantom ISO 128-2 05.1 ____ . . ____ . . ____', [DASH_LENGTHS.longDash * narrow, -DASH_LENGTHS.gap * narrow, 0, -DASH_LENGTHS.gap * narrow, 0, -DASH_LENGTHS.gap * narrow]],
  ];
  const ltypeTable = tableStart(out, 'LTYPE', ltypes.length);
  for (const [name, desc, pattern] of ltypes) {
    symbol(out, 'LTYPE', ltypeTable, 'AcDbLinetypeTableRecord', (o) => {
      o.tag(2, name);
      o.tag(70, 0);
      o.tag(3, desc);
      o.tag(72, 65);
      o.tag(73, pattern.length);
      o.tag(40, pattern.reduce((s, d) => s + Math.abs(d), 0));
      for (const d of pattern) {
        o.tag(49, d);
        o.tag(74, 0);
      }
    });
  }
  out.tag(0, 'ENDTAB');

  const layerTable = tableStart(out, 'LAYER', w.layers.size);
  for (const [name, l] of w.layers) {
    symbol(out, 'LAYER', layerTable, 'AcDbLayerTableRecord', (o) => {
      o.tag(2, name);
      o.tag(70, 0);
      o.tag(62, l.off ? -l.color : l.color);
      o.tag(6, l.linetype);
      if (name === 'Defpoints') o.tag(290, 0);
      o.tag(370, -3);
    });
  }
  out.tag(0, 'ENDTAB');

  const styleTable = tableStart(out, 'STYLE', 1);
  symbol(out, 'STYLE', styleTable, 'AcDbTextStyleTableRecord', (o) => {
    o.tag(2, 'Standard');
    o.tag(70, 0);
    o.tag(40, 0);
    o.tag(41, 1);
    o.tag(50, 0);
    o.tag(71, 0);
    o.tag(42, LINE_GROUPS[group].dimText);
    o.tag(3, 'isocp.shx');
    o.tag(4, '');
  });
  out.tag(0, 'ENDTAB');

  for (const t of ['VIEW', 'UCS']) {
    tableStart(out, t, 0);
    out.tag(0, 'ENDTAB');
  }
  const appidTable = tableStart(out, 'APPID', 1);
  symbol(out, 'APPID', appidTable, 'AcDbRegAppTableRecord', (o) => {
    o.tag(2, 'ACAD');
    o.tag(70, 0);
  });
  out.tag(0, 'ENDTAB');

  const dimstyleTable = tableStart(out, 'DIMSTYLE', 1, 'AcDbDimStyleTable');
  out.tag(0, 'DIMSTYLE');
  out.tag(105, out.handle());
  out.tag(330, dimstyleTable);
  out.tag(100, 'AcDbSymbolTableRecord');
  out.tag(100, 'AcDbDimStyleTableRecord');
  out.tag(2, 'Standard');
  out.tag(70, 0);
  out.tag(0, 'ENDTAB');

  const blockRecordTable = tableStart(out, 'BLOCK_RECORD', 2);
  w.modelHandle = symbol(out, 'BLOCK_RECORD', blockRecordTable, 'AcDbBlockTableRecord', (o) => o.tag(2, '*Model_Space'));
  w.paperHandle = symbol(out, 'BLOCK_RECORD', blockRecordTable, 'AcDbBlockTableRecord', (o) => o.tag(2, '*Paper_Space'));
  out.tag(0, 'ENDTAB');
  out.tag(0, 'ENDSEC');

  // --- BLOCKS ---
  out.tag(0, 'SECTION');
  out.tag(2, 'BLOCKS');
  blockDef(out, '*Model_Space', w.modelHandle, false);
  blockDef(out, '*Paper_Space', w.paperHandle, true);
  out.tag(0, 'ENDSEC');

  // --- ENTITIES ---
  out.tag(0, 'SECTION');
  out.tag(2, 'ENTITIES');
  for (const f of model) f(w);
  for (const f of paper) f(w);
  out.tag(0, 'ENDSEC');

  // --- OBJECTS: root dictionary with the layout dictionary; Model and Sheet layouts ---
  out.tag(0, 'SECTION');
  out.tag(2, 'OBJECTS');
  const rootHandle = out.handle();
  const layoutDictHandle = out.handle();
  const modelLayoutHandle = out.handle();
  const sheetLayoutHandle = out.handle();
  out.tag(0, 'DICTIONARY');
  out.tag(5, rootHandle);
  out.tag(330, '0');
  out.tag(100, 'AcDbDictionary');
  out.tag(281, 1);
  out.tag(3, 'ACAD_LAYOUT');
  out.tag(350, layoutDictHandle);
  out.tag(0, 'DICTIONARY');
  out.tag(5, layoutDictHandle);
  out.tag(330, rootHandle);
  out.tag(100, 'AcDbDictionary');
  out.tag(281, 1);
  out.tag(3, 'Model');
  out.tag(350, modelLayoutHandle);
  out.tag(3, 'Sheet');
  out.tag(350, sheetLayoutHandle);
  layoutObject(out, modelLayoutHandle, layoutDictHandle, 'Model', 0, w.modelHandle, ext.max.x - ext.min.x + 20, ext.max.y - ext.min.y + 20, 1);
  layoutObject(out, sheetLayoutHandle, layoutDictHandle, 'Sheet', 1, w.paperHandle, sheet.w, sheet.h, 0);
  out.tag(0, 'ENDSEC');
  out.tag(0, 'EOF');
  return out.toString();
}

// ---------------------------------------------------------------------------------------------------------------

function header(out: Out, name: string, code: number, value: string | number): void {
  out.tag(9, name);
  out.tag(code, value);
}

function headerPoint(out: Out, name: string, p: Vec2): void {
  out.tag(9, name);
  out.point(10, p);
}

function tableStart(out: Out, name: string, count: number, subclass?: string): string {
  const h = out.handle();
  out.tag(0, 'TABLE');
  out.tag(2, name);
  out.tag(5, h);
  out.tag(330, '0');
  out.tag(100, 'AcDbSymbolTable');
  out.tag(70, count);
  if (subclass) out.tag(100, subclass);
  return h;
}

function symbol(out: Out, type: string, owner: string, subclass: string, body: (o: Out) => void): string {
  const h = out.handle();
  out.tag(0, type);
  out.tag(5, h);
  out.tag(330, owner);
  out.tag(100, 'AcDbSymbolTableRecord');
  out.tag(100, subclass);
  body(out);
  return h;
}

function blockDef(out: Out, name: string, record: string, paper: boolean): void {
  out.tag(0, 'BLOCK');
  out.tag(5, out.handle());
  out.tag(330, record);
  out.tag(100, 'AcDbEntity');
  if (paper) out.tag(67, 1);
  out.tag(8, '0');
  out.tag(100, 'AcDbBlockBegin');
  out.tag(2, name);
  out.tag(70, 0);
  out.point(10, { x: 0, y: 0 });
  out.tag(3, name);
  out.tag(1, '');
  out.tag(0, 'ENDBLK');
  out.tag(5, out.handle());
  out.tag(330, record);
  out.tag(100, 'AcDbEntity');
  if (paper) out.tag(67, 1);
  out.tag(8, '0');
  out.tag(100, 'AcDbBlockEnd');
}

function layoutObject(out: Out, handle: string, owner: string, name: string, tabOrder: number, blockRecord: string, w: number, h: number, flags70: number): void {
  out.tag(0, 'LAYOUT');
  out.tag(5, handle);
  out.tag(330, owner);
  out.tag(100, 'AcDbPlotSettings');
  out.tag(1, '');
  out.tag(2, 'none_device');
  out.tag(4, `ISO_${name === 'Model' ? 'A3' : 'sheet'}_(${n(w)}_x_${n(h)}_MM)`);
  out.tag(6, '');
  out.tag(40, 0);
  out.tag(41, 0);
  out.tag(42, 0);
  out.tag(43, 0);
  out.tag(44, w);
  out.tag(45, h);
  out.tag(46, 0);
  out.tag(47, 0);
  out.tag(48, 0);
  out.tag(49, 0);
  out.tag(140, 0);
  out.tag(141, 0);
  out.tag(142, 1);
  out.tag(143, 1);
  out.tag(70, 688);
  out.tag(72, 1);
  out.tag(73, 0);
  out.tag(74, 5);
  out.tag(7, '');
  out.tag(75, 0);
  out.tag(147, 1);
  out.tag(148, 0);
  out.tag(149, 0);
  out.tag(100, 'AcDbLayout');
  out.tag(1, name);
  out.tag(70, flags70);
  out.tag(71, tabOrder);
  out.tag(10, 0);
  out.tag(20, 0);
  out.tag(11, w);
  out.tag(21, h);
  out.point(12, { x: 0, y: 0 });
  out.point(14, { x: 0, y: 0 });
  out.point(15, { x: w, y: h });
  out.tag(146, 0);
  out.point(13, { x: 0, y: 0 });
  out.point(16, { x: 1, y: 0 });
  out.point(17, { x: 0, y: 1 });
  out.tag(76, 0);
  out.tag(330, blockRecord);
}

function entityStart(w: Writer, type: string, paper: boolean, pen: Pen): void {
  const o = w.out;
  o.tag(0, type);
  o.tag(5, o.handle());
  o.tag(330, paper ? w.paperHandle : w.modelHandle);
  o.tag(100, 'AcDbEntity');
  if (paper) o.tag(67, 1);
  o.tag(8, pen.layer);
  o.tag(62, pen.color);
  if (pen.linetype !== 'CONTINUOUS' && pen.linetype !== 'BYLAYER') o.tag(6, pen.linetype);
}

const DEG = 180 / Math.PI;

function curveEntity(w: Writer, paper: boolean, pen: Pen, c: Curve): void {
  const o = w.out;
  if (c.kind === 'line') {
    entityStart(w, 'LINE', paper, pen);
    o.tag(100, 'AcDbLine');
    o.point(10, c.a);
    o.point(11, c.b);
  } else if (c.kind === 'circle') {
    entityStart(w, 'CIRCLE', paper, pen);
    o.tag(100, 'AcDbCircle');
    o.point(10, c.c);
    o.tag(40, c.r);
  } else {
    entityStart(w, 'ARC', paper, pen);
    o.tag(100, 'AcDbCircle');
    o.point(10, c.c);
    o.tag(40, c.r);
    o.tag(100, 'AcDbArc');
    o.tag(50, normDeg(c.start * DEG));
    o.tag(51, normDeg(c.end * DEG));
  }
}

function normDeg(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** A plotted primitive (sheet mm) as DXF entities; `map` converts points, `k` scales lengths (heights, radii). */
function primitiveEntity(w: Writer, paper: boolean, p: Primitive, map: (q: Vec2) => Vec2, k: number, pen: () => Pen): void {
  const o = w.out;
  if (p.kind === 'polyline') {
    if (p.points.length < 2) return;
    if (p.points.length === 2 && !p.closed) {
      curveEntity(w, paper, pen(), { kind: 'line', a: map(p.points[0]), b: map(p.points[1]) });
      return;
    }
    entityStart(w, 'LWPOLYLINE', paper, pen());
    o.tag(100, 'AcDbPolyline');
    o.tag(90, p.points.length);
    o.tag(70, p.closed ? 1 : 0);
    for (const q of p.points) {
      const m = map(q);
      o.tag(10, m.x);
      o.tag(20, m.y);
    }
  } else if (p.kind === 'arc') {
    const c = map(p.c);
    const full = Math.abs(p.end - p.start) >= 2 * Math.PI - 1e-9;
    curveEntity(w, paper, pen(), full ? { kind: 'circle', c, r: p.r * k } : { kind: 'arc', c, r: p.r * k, start: p.start, end: p.end });
  } else if (p.kind === 'fill') {
    if (p.points.length < 3) return;
    entityStart(w, 'SOLID', paper, pen());
    o.tag(100, 'AcDbTrace');
    const q = p.points.map(map);
    // SOLID's corners go 1-2-4-3 (bow-tie order); a triangle repeats its last corner
    const corners = q.length >= 4 ? [q[0], q[1], q[3], q[2]] : [q[0], q[1], q[2], q[2]];
    corners.forEach((c, i) => o.point(10 + i, c));
  } else {
    entityStart(w, 'TEXT', paper, pen());
    o.tag(100, 'AcDbText');
    const pos = map(p.pos);
    o.point(10, pos);
    o.tag(40, p.height * k);
    o.tag(1, p.text.replace(/⌀/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p'));
    o.tag(50, normDeg(p.angle * DEG));
    o.tag(7, 'Standard');
    const h72 = p.align === 'left' ? 0 : p.align === 'center' ? 1 : 2;
    const h73 = p.baseline === 'bottom' ? 0 : p.baseline === 'middle' ? 2 : 3;
    o.tag(72, h72);
    o.point(11, pos);
    o.tag(100, 'AcDbText');
    o.tag(73, h73);
  }
}

function hatchEntity(w: Writer, pen: Pen, loops: Curve[][], angleDeg: number, spacing: number): void {
  const o = w.out;
  entityStart(w, 'HATCH', false, pen);
  o.tag(100, 'AcDbHatch');
  o.point(10, { x: 0, y: 0 });
  o.tag(210, 0);
  o.tag(220, 0);
  o.tag(230, 1);
  o.tag(2, 'ISO_HATCH');
  o.tag(70, 0);
  o.tag(71, 0);
  o.tag(91, loops.length);
  loops.forEach((loop, i) => {
    o.tag(92, i === 0 ? 1 : 16);
    o.tag(93, loop.length);
    for (const c of loop) {
      if (c.kind === 'line') {
        o.tag(72, 1);
        o.tag(10, c.a.x);
        o.tag(20, c.a.y);
        o.tag(11, c.b.x);
        o.tag(21, c.b.y);
      } else {
        o.tag(72, 2);
        o.tag(10, c.c.x);
        o.tag(20, c.c.y);
        o.tag(40, c.r);
        o.tag(50, c.kind === 'circle' ? 0 : normDeg(c.start * DEG));
        o.tag(51, c.kind === 'circle' ? 360 : normDeg(c.end * DEG) || 360);
        o.tag(73, 1);
      }
    }
    o.tag(97, 0);
  });
  o.tag(75, 0);
  o.tag(76, 1);
  o.tag(52, 0);
  o.tag(41, 1);
  o.tag(77, 0);
  o.tag(78, 1);
  const a = (angleDeg * Math.PI) / 180;
  o.tag(53, angleDeg);
  o.tag(43, 0);
  o.tag(44, 0);
  o.tag(45, -Math.sin(a) * spacing);
  o.tag(46, Math.cos(a) * spacing);
  o.tag(79, 0);
  o.tag(98, 0);
}

function viewportEntity(w: Writer, id: number, center: Vec2, width: number, height: number, viewCenter: Vec2, viewHeight: number): void {
  const o = w.out;
  entityStart(w, 'VIEWPORT', true, { layer: '0', color: 256, linetype: 'CONTINUOUS' });
  o.tag(100, 'AcDbViewport');
  o.point(10, center);
  o.tag(40, width);
  o.tag(41, height);
  o.tag(68, id === 1 ? 2 : 1);
  o.tag(69, id);
  o.tag(12, viewCenter.x);
  o.tag(22, viewCenter.y);
  o.tag(13, 0);
  o.tag(23, 0);
  o.tag(14, 10);
  o.tag(24, 10);
  o.tag(15, 10);
  o.tag(25, 10);
  o.tag(16, 0);
  o.tag(26, 0);
  o.tag(36, 1);
  o.tag(17, 0);
  o.tag(27, 0);
  o.tag(37, 0);
  o.tag(42, 50);
  o.tag(43, 0);
  o.tag(44, 0);
  o.tag(45, viewHeight);
  o.tag(50, 0);
  o.tag(51, 0);
  o.tag(72, 1000);
  o.tag(90, id === 1 ? 557088 : 0);
  o.tag(1, '');
  o.tag(281, 0);
  o.tag(71, 1);
  o.tag(74, 0);
  o.tag(110, 0);
  o.tag(120, 0);
  o.tag(130, 0);
  o.tag(111, 1);
  o.tag(121, 0);
  o.tag(131, 0);
  o.tag(112, 0);
  o.tag(122, 1);
  o.tag(132, 0);
  o.tag(79, 0);
  o.tag(146, 0);
}

// ---------------------------------------------------------------------------------------------------------------

function curveToModel(c: Curve, o: Vec2): Curve {
  const t = (p: Vec2): Vec2 => ({ x: p.x + o.x, y: p.y + o.y });
  if (c.kind === 'line') return { kind: 'line', a: t(c.a), b: t(c.b) };
  if (c.kind === 'circle') return { kind: 'circle', c: t(c.c), r: c.r };
  return { kind: 'arc', c: t(c.c), r: c.r, start: c.start, end: c.end };
}

function curveSheetPoints(c: Curve, view: View): Vec2[] {
  const t = (p: Vec2): Vec2 => ({ x: view.origin.x + p.x * view.scale, y: view.origin.y + p.y * view.scale });
  if (c.kind === 'line') return [t(c.a), t(c.b)];
  const r = c.r * view.scale;
  const cc = t(c.c);
  const pts: Vec2[] = [];
  const start = c.kind === 'circle' ? 0 : c.start;
  let sweep = c.kind === 'circle' ? 2 * Math.PI : (c.end - c.start) % (2 * Math.PI);
  if (sweep <= 0) sweep += 2 * Math.PI;
  for (let i = 0; i <= 16; i++) {
    const a = start + (sweep * i) / 16;
    pts.push({ x: cc.x + r * Math.cos(a), y: cc.y + r * Math.sin(a) });
  }
  return pts;
}

function primitiveBox(prims: Primitive[]): { min: Vec2; max: Vec2 } {
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  const add = (p: Vec2) => {
    min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
    max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
  };
  for (const p of prims) {
    if (p.kind === 'polyline' || p.kind === 'fill') p.points.forEach(add);
    else if (p.kind === 'arc') {
      add({ x: p.c.x - p.r, y: p.c.y - p.r });
      add({ x: p.c.x + p.r, y: p.c.y + p.r });
    } else {
      add(p.pos);
      add({ x: p.pos.x + p.text.length * p.height * 0.8, y: p.pos.y + p.height });
    }
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  return { min, max };
}

function modelExtents(doc: SheetDoc): { min: Vec2; max: Vec2 } {
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const e of doc.entities) {
    if (!layerVisible(doc, e.layer) || !LINE_TYPES[e.lineType].plotted) continue;
    const v = doc.views.find((x) => x.id === e.viewId)!;
    for (const p of curveSheetPoints(e.geom, v)) {
      const m = { x: p.x / v.scale, y: p.y / v.scale };
      min = { x: Math.min(min.x, m.x), y: Math.min(min.y, m.y) };
      max = { x: Math.max(max.x, m.x), y: Math.max(max.y, m.y) };
    }
  }
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
  return { min, max };
}
