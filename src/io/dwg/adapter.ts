// DWG → RawDrawing through LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web, GPL-3).
// Loaded only from here, so the reader stays its own chunk; see ADR-0004 for the licence question.
import type { Vec2 } from '../../geom/types';
import type { RawBlock, RawDrawing, RawEntity, RawLayout, RawLoopEdge, RawStyle, RawVertex } from '../raw';
import { unitsToMm } from '../raw';

export interface DwgOptions {
  /** Directory of libredwg-web.wasm (Node); the browser build resolves the file itself. */
  wasmDir?: string;
}

// The package's typings describe the database closely but not completely (several fields are optional or
// differ between DWG versions); the adapter reads them as plain records and tolerates missing ones.
type Rec = Record<string, any>;

const DEG = 180 / Math.PI;

// The package's exports map hides the wasm file, so Vite gets it by path; the URL is resolved at build time.
import wasmFile from '../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url';

function wasmUrl(): string {
  return wasmFile;
}

/** LibreDWG lineweight codes → 1/100 mm; 29 by layer, 30 by block, 31 default. */
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

function lineweight(code: unknown): number {
  if (typeof code !== 'number') return -1;
  if (code === 29 || code === 31) return -1;
  if (code === 30) return -2;
  return LINEWEIGHTS[code] ?? -1;
}

export async function dwgToRaw(bytes: Uint8Array, opts: DwgOptions = {}): Promise<RawDrawing> {
  const lib = await import('@mlightcad/libredwg-web');
  // a fresh module per file: a failed read leaves the instance unusable
  const wasm = opts.wasmDir
    ? await lib.createModule({ locateFile: (f: string) => `${opts.wasmDir}/${f}` })
    : await lib.createModule({ locateFile: () => wasmUrl() });
  const reader = lib.LibreDwg.createByWasmInstance(wasm);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const data = reader.dwg_read_data(buffer, lib.Dwg_File_Type.DWG);
  if (!data) throw new Error('not a DWG file, or a version LibreDWG cannot read');
  const db = reader.convert(data) as unknown as Rec;
  try {
    return databaseToRaw(db);
  } finally {
    try {
      reader.dwg_free(data);
    } catch {
      // freeing is best effort
    }
  }
}

export function databaseToRaw(db: Rec): RawDrawing {
  const records: Rec[] = db.tables?.BLOCK_RECORD?.entries ?? [];
  const byHandle = new Map<string, Rec>();
  for (const r of records) byHandle.set(String(r.handle), r);
  const modelRec = records.find((r) => r.name === '*Model_Space');
  const paperRecs = records.filter((r) => typeof r.name === 'string' && r.name.startsWith('*Paper_Space'));
  const paperHandles = new Set(paperRecs.map((r) => String(r.handle)));
  const activePaper = paperRecs.find((r) => r.name === '*Paper_Space') ?? paperRecs[0];

  const layers = new Map<string, RawDrawing['layers'] extends Map<string, infer L> ? L : never>();
  for (const l of db.tables?.LAYER?.entries ?? []) {
    layers.set(String(l.name), { name: String(l.name), color: Math.abs(num(l.colorIndex, 7)), linetype: String(l.lineType || 'CONTINUOUS'), lineweight: lineweight(l.lineweight), frozen: !!l.frozen, off: !!l.off });
  }
  const linetypes = new Map<string, number[]>();
  for (const lt of db.tables?.LTYPE?.entries ?? []) {
    linetypes.set(String(lt.name), ((lt.pattern ?? []) as Rec[]).map((p) => num(p.elementLength, 0)));
  }
  const blocks = new Map<string, RawBlock>();
  for (const r of records) {
    if (r === modelRec || paperHandles.has(String(r.handle))) continue;
    blocks.set(String(r.name), { name: String(r.name), base: pt(r.basePoint), entities: ((r.entities ?? []) as Rec[]).map((e) => convert(e, false)).filter((e): e is RawEntity => e !== null) });
  }
  const layouts: RawLayout[] = [];
  for (const l of db.objects?.LAYOUT ?? []) {
    const rec = byHandle.get(String(l.paperSpaceTableId));
    const min = pt(l.minLimit);
    const max = pt(l.maxLimit);
    layouts.push({
      name: String(l.layoutName ?? ''),
      blockName: rec ? String(rec.name) : '',
      paperWidth: max.x - min.x,
      paperHeight: max.y - min.y,
      marginLeft: Math.max(0, -min.x),
      marginBottom: Math.max(0, -min.y),
      rotation: 0,
    });
  }
  layouts.sort((a, b) => (num((db.objects?.LAYOUT ?? []).find((x: Rec) => x.layoutName === a.name)?.tabOrder, 0)) - num((db.objects?.LAYOUT ?? []).find((x: Rec) => x.layoutName === b.name)?.tabOrder, 0));

  const entities: RawEntity[] = [];
  const modelHandle = modelRec ? String(modelRec.handle) : '';
  const activeHandle = activePaper ? String(activePaper.handle) : '';
  for (const e of (db.entities ?? []) as Rec[]) {
    const owner = String(e.ownerBlockRecordSoftId ?? '');
    const paper = owner === activeHandle;
    if (owner !== modelHandle && !paper) continue; // block contents and attributes come through their owners
    const r = convert(e, paper);
    if (r) entities.push(r);
  }
  // DWG files written by AutoCAD keep model-space entities in the record, not the flat list, in some versions
  if (entities.length === 0 && modelRec?.entities?.length) {
    for (const e of modelRec.entities as Rec[]) {
      const r = convert(e, false);
      if (r) entities.push(r);
    }
    if (activePaper?.entities) for (const e of activePaper.entities as Rec[]) {
      const r = convert(e, true);
      if (r) entities.push(r);
    }
  }
  return { version: String(db.header?.ACADVER ?? 'DWG'), unitFactor: unitsToMm(num(db.header?.INSUNITS, 0)), layers, linetypes, blocks, layouts, entities };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : fallback;
}

function pt(p: Rec | undefined): Vec2 {
  return { x: num(p?.x, 0), y: num(p?.y, 0) };
}

function style(e: Rec, paper: boolean): RawStyle {
  const lt = String(e.lineType ?? '');
  return { layer: String(e.layer ?? '0'), color: num(e.colorIndex, 256), linetype: lt === '' ? 'BYLAYER' : lt, lineweight: lineweight(e.lineweight), paperSpace: paper, handle: String(e.handle ?? '') };
}

function halign(code: number): 'left' | 'center' | 'right' {
  return code === 1 || code === 4 ? 'center' : code === 2 ? 'right' : 'left';
}

function valign(code: number, h: number): 'baseline' | 'bottom' | 'middle' | 'top' {
  if (h === 4) return 'middle';
  return code === 1 ? 'bottom' : code === 2 ? 'middle' : code === 3 ? 'top' : 'baseline';
}

function textFrom(t: Rec, base: RawStyle, tag: string | null, alignment?: Rec): RawEntity {
  const h = num(t.halign, 0);
  const v = num(t.valign, 0);
  const aligned = h !== 0 || v !== 0;
  const pos = aligned ? pt(alignment ?? t.endPoint ?? t.startPoint) : pt(t.startPoint);
  return { ...base, kind: 'text', pos, text: String(t.text ?? ''), height: num(t.textHeight, 2.5), angle: num(t.rotation, 0), halign: halign(h), valign: valign(v, h), tag };
}

function vertices(list: Rec[] | undefined): RawVertex[] {
  return (list ?? []).map((v) => ({ p: pt(v), bulge: num(v.bulge, 0) }));
}

function loopEdges(path: Rec): RawLoopEdge[] {
  const flag = num(path.boundaryPathTypeFlag, 0);
  if (flag & 2 || path.vertices) return [{ kind: 'polyline', vertices: vertices(path.vertices), closed: path.isClosed !== false && path.isClosed !== 0 }];
  const out: RawLoopEdge[] = [];
  for (const edge of (path.edges ?? []) as Rec[]) {
    switch (num(edge.type, 0)) {
      case 1:
        out.push({ kind: 'line', a: pt(edge.start), b: pt(edge.end) });
        break;
      case 2:
        out.push({ kind: 'arc', c: pt(edge.center), r: num(edge.radius, 0), start: num(edge.startAngle, 0), end: num(edge.endAngle, 2 * Math.PI), ccw: edge.isCCW !== false && edge.isCCW !== 0 });
        break;
      case 3:
        out.push({ kind: 'ellipse', c: pt(edge.center), major: pt(edge.end), ratio: num(edge.lengthOfMinorAxis, 1), start: num(edge.startAngle, 0), end: num(edge.endAngle, 2 * Math.PI), ccw: edge.isCCW !== false && edge.isCCW !== 0 });
        break;
      case 4:
        out.push({ kind: 'spline', degree: num(edge.degree, 3), knots: (edge.knots ?? []).map((k: unknown) => num(k, 0)), control: ((edge.controlPoints ?? []) as Rec[]).map(pt), weights: ((edge.controlPoints ?? []) as Rec[]).map((c) => num(c.weight, 1)), fit: ((edge.fitPoints ?? []) as Rec[]).map(pt) });
        break;
    }
  }
  return out;
}

/** One database entity to its raw form; null for what carries no drawing content. */
export function convert(e: Rec, paper: boolean): RawEntity | null {
  const s = style(e, paper);
  switch (String(e.type)) {
    case 'LINE':
      return { ...s, kind: 'line', a: pt(e.startPoint), b: pt(e.endPoint) };
    case 'CIRCLE':
      return { ...s, kind: 'circle', c: pt(e.center), r: num(e.radius, 0) };
    case 'ARC':
      return { ...s, kind: 'arc', c: pt(e.center), r: num(e.radius, 0), start: num(e.startAngle, 0), end: num(e.endAngle, 0) };
    case 'LWPOLYLINE': {
      const flag = num(e.flag, 0);
      return { ...s, kind: 'polyline', vertices: vertices(e.vertices), closed: (flag & 512) !== 0 || (flag & 1) !== 0 };
    }
    case 'POLYLINE2D':
    case 'POLYLINE':
      return { ...s, kind: 'polyline', vertices: vertices(e.vertices), closed: (num(e.flag, 0) & 1) !== 0 };
    case 'TEXT':
      return textFrom(e, s, null);
    case 'ATTDEF':
    case 'ATTRIB': {
      if ((num(e.flags, 0) & 1) !== 0) return null;
      const t = e.text && typeof e.text === 'object' ? e.text : e;
      return textFrom(t, s, String(e.tag ?? ''), e.alignmentPoint);
    }
    case 'MTEXT': {
      const dir = e.direction ? pt(e.direction) : null;
      const angle = dir && (dir.x !== 0 || dir.y !== 0) ? Math.atan2(dir.y, dir.x) : num(e.rotation, 0);
      return { ...s, kind: 'mtext', pos: pt(e.insertionPoint), text: String(e.text ?? ''), height: num(e.textHeight, 2.5), angle, attachment: num(e.attachmentPoint, 1), width: num(e.rectWidth, 0) };
    }
    case 'INSERT':
      return {
        ...s,
        kind: 'insert',
        name: String(e.name ?? ''),
        pos: pt(e.insertionPoint),
        scale: { x: num(e.xScale, 1), y: num(e.yScale, 1) },
        rotation: num(e.rotation, 0),
        attribs: ((e.attribs ?? []) as Rec[]).map((a) => convert(a, paper)).filter((a): a is RawEntity => a !== null),
      };
    case 'HATCH': {
      const loops = ((e.boundaryPaths ?? []) as Rec[]).map(loopEdges).filter((l) => l.length > 0);
      const lines = ((e.definitionLines ?? []) as Rec[]).map((l) => ({ angle: num(l.angle, 0) * DEG, base: pt(l.base), offset: pt(l.offset) }));
      return { ...s, kind: 'hatch', loops, solid: num(e.solidFill, 0) === 1 || e.solidFill === true, pattern: String(e.patternName ?? ''), angle: num(e.patternAngle, 0) * DEG, scale: num(e.patternScale, 1), lines };
    }
    case 'DIMENSION': {
      const kinds = ['linear', 'aligned', 'angular', 'diameter', 'radius', 'angular3', 'ordinate'] as const;
      const flags = num(e.dimensionType, 0);
      const marker = String(e.subclassMarker ?? '');
      let dimType = kinds[flags & 7] ?? 'linear';
      if (/Aligned/.test(marker) && num(e.rotationAngle, 0) === 0 && (flags & 7) === 1) dimType = 'aligned';
      if (/Rotated/.test(marker)) dimType = 'linear';
      if (/Radial/.test(marker)) dimType = 'radius';
      if (/Diametric/.test(marker)) dimType = 'diameter';
      if (/3Point/.test(marker)) dimType = 'angular3';
      if (/2Line/.test(marker)) dimType = 'angular';
      if (/Ordinate/.test(marker)) dimType = 'ordinate';
      // libredwg-web 0.7 hands over only one point of the first leg of a 2-line angular dimension (its
      // subDefinitionPoint2 repeats the second leg's start), so the angle cannot be rebuilt
      if (dimType === 'angular') {
        const a = pt(e.subDefinitionPoint1);
        const b = pt(e.subDefinitionPoint2);
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) return { ...s, kind: 'unsupported', type: 'angular dimension (leg not readable from DWG)' };
      }
      return {
        ...s,
        kind: 'dimension',
        dimType,
        defPoint: pt(e.definitionPoint),
        textMid: e.textPoint ? pt(e.textPoint) : null,
        p13: pt(e.subDefinitionPoint1),
        p14: pt(e.subDefinitionPoint2),
        p15: pt(e.centerPoint),
        p16: pt(e.arcPoint),
        rotation: num(e.rotationAngle, 0),
        text: String(e.text ?? ''),
        userText: (flags & 128) !== 0,
      };
    }
    case 'LEADER':
      return { ...s, kind: 'leader', points: ((e.vertices ?? []) as Rec[]).map(pt), arrow: e.isArrowheadEnabled !== false, annotation: e.annotationId ? String(e.annotationId) : null };
    case 'MULTILEADER': {
      const sections = (e.leaderSections ?? []) as Rec[];
      const lines: Vec2[][] = [];
      let landing: Vec2 | null = null;
      for (const sec of sections) {
        for (const ll of (sec.leaderLines ?? []) as Rec[]) lines.push(((ll.vertices ?? []) as Rec[]).map(pt));
        if (sec.lastLeaderLinePoint && (sec.lastLeaderLinePointSet ?? true)) landing = pt(sec.lastLeaderLinePoint);
      }
      return { ...s, kind: 'mleader', lines, text: String(e.textContent ?? ''), textPos: e.textAnchor ? pt(e.textAnchor) : null, textHeight: num(e.textHeight, 0), arrow: true, landing };
    }
    case 'SPLINE':
      return {
        ...s,
        kind: 'spline',
        degree: num(e.degree, 3),
        knots: ((e.knots ?? []) as unknown[]).map((k) => num(k, 0)),
        control: ((e.controlPoints ?? []) as Rec[]).map(pt),
        weights: ((e.weights ?? []) as unknown[]).map((w) => num(w, 1)),
        fit: ((e.fitPoints ?? []) as Rec[]).map(pt),
      };
    case 'ELLIPSE':
      return { ...s, kind: 'ellipse', c: pt(e.center), major: pt(e.majorAxisEndPoint), ratio: num(e.axisRatio, 1), start: num(e.startAngle, 0), end: num(e.endAngle, 2 * Math.PI) };
    case 'VIEWPORT':
      return {
        ...s,
        kind: 'viewport',
        center: pt(e.viewportCenter),
        width: num(e.width, 0),
        height: num(e.height, 0),
        viewCenter: pt(e.displayCenter),
        viewHeight: num(e.viewHeight, 0),
        id: num(e.viewportId, 0),
        on: num(e.status, 0) >= 0,
      };
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const p = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(pt);
      return p.length >= 3 ? { ...s, kind: 'solid', points: p } : null;
    }
    case 'RAY':
    case 'XLINE':
      return { ...s, kind: 'xline', p: pt(e.startPoint ?? e.basePoint ?? e.point), dir: pt(e.unitDirection ?? e.unitDirectionVector ?? e.direction), ray: e.type === 'RAY' };
    case 'POINT':
    case 'ATTRIB_SEQEND':
    case 'SEQEND':
      return null;
    default:
      return { ...s, kind: 'unsupported', type: String(e.type) };
  }
}
