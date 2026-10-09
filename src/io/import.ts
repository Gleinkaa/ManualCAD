// RawDrawing (DXF or DWG) → SheetDoc. Decides sheet format, views and line types; turns foreign entities into
// ManualCAD's lines, circles, arcs, dimensions, texts, hatches and leaders, and reports what it could not keep.
import { intersect } from '../geom';
import type { ArcCurve, Curve, Vec2 } from '../geom/types';
import { newId } from '../model/doc';
import { HATCH_SPACING_DEFAULT, SHEET_SIZES, STANDARD_SCALES, TEXT_HEIGHTS } from '../model/standards';
import type {
  AngularDimension,
  Annotation,
  DimAnchor,
  DimText,
  Dimension,
  Entity,
  Hatch,
  Leader,
  LinearOrientation,
  LineGroupId,
  LineTypeId,
  Orientation,
  SheetDoc,
  SheetFormat,
  TextNote,
  TitleBlockField,
  View,
} from '../model/types';
import { FRAME, TITLE_BLOCK } from '../plot/frame';
import { decodeTextCodes, mtextToLines } from './mtext';
import type { RawDrawing, RawEntity, RawLayer, RawLoopEdge, RawVertex } from './raw';

export interface ImportResult {
  doc: SheetDoc;
  /** Human-readable summary and warnings, one per line. */
  report: string[];
}

export interface ImportOptions {
  /** Name shown for the main view (default: "Front view"). */
  viewName?: string;
}

const EPS = 1e-6;
const SNAP = 1e-3;
const TAU = 2 * Math.PI;
const CONSTRUCTION_LENGTH = 1000;

// ---------------------------------------------------------------------------------------------------------------
// Flattened items: entities with resolved style, block transforms applied, in mm.

interface Resolved {
  layer: string;
  color: number;             // ACI, resolved through layer/block
  linetype: string;          // resolved name
  lineweight: number;        // 1/100 mm, -1 unknown
  paper: boolean;
  handle: string;
}

type Item = Resolved & (
  | { kind: 'curve'; curve: Curve; construction: boolean }
  | { kind: 'text'; pos: Vec2; text: string; height: number; angle: number; halign: 'left' | 'center' | 'right'; valign: 'baseline' | 'bottom' | 'middle' | 'top' }
  | { kind: 'hatch'; loops: Curve[][]; solid: boolean; angle: number; spacing: number | null }
  | { kind: 'dimension'; raw: Extract<RawEntity, { kind: 'dimension' }> }
  | { kind: 'leader'; points: Vec2[]; arrow: boolean; text: string | null; height: number; annotation: string | null }
  | { kind: 'viewport'; center: Vec2; width: number; height: number; viewCenter: Vec2; viewHeight: number; id: number }
);

/** Similarity transform (uniform scale, rotation, optional reflection, translation) applied to block contents. */
interface Xform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function apply(m: Xform, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function compose(outer: Xform, inner: Xform): Xform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

function det(m: Xform): number {
  return m.a * m.d - m.b * m.c;
}

/** Scale along x and y of a transform (uniform when equal). */
function scalesOf(m: Xform): { sx: number; sy: number } {
  return { sx: Math.hypot(m.a, m.b), sy: Math.hypot(m.c, m.d) };
}

function angleOf(m: Xform): number {
  return Math.atan2(m.b, m.a);
}

class Report {
  lines: string[] = [];
  private counts = new Map<string, number>();

  count(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  finish(): string[] {
    const out = [...this.lines];
    for (const [k, n] of [...this.counts.entries()].sort()) out.push(`${n} ${k}${n === 1 ? '' : 's'}`.replace(/ss$/, 's'));
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** Import a drawing. The result is a fresh SheetDoc; nothing of the caller's document is kept. */
export function importDrawing(raw: RawDrawing, opts: ImportOptions = {}): ImportResult {
  const report = new Report();
  const items = flatten(raw, report);
  const paperLayout = activeLayout(raw);
  const paperOffset = paperLayout ? { x: paperLayout.marginLeft, y: paperLayout.marginBottom } : { x: 0, y: 0 };

  // sheet: from the layout's paper size, else to fit the model extents
  const modelItems = items.filter((i) => !i.paper && i.kind !== 'viewport');
  const paperItems = items.filter((i) => i.paper && i.kind !== 'viewport');
  const viewports = items.filter((i): i is Extract<Item, { kind: 'viewport' }> => i.paper && i.kind === 'viewport' && i.id !== 1 && i.viewHeight > 0);
  const extents = bboxOf(modelItems);

  let format: SheetFormat;
  let orientation: Orientation;
  const views: View[] = [];
  const lineGroup = chooseLineGroup(items);
  const doc: SheetDoc = {
    version: 1,
    format: 'A3',
    orientation: 'landscape',
    lineGroup,
    titleBlock: { documentType: 'Fertigungszeichnung', generalTolerance: 'ISO 2768-m', sheet: '1/1' },
    layers: [{ name: '0', visible: true }],
    views,
    entities: [],
    dimensions: [],
    annotations: [],
    partsList: [],
  };

  if (paperLayout && paperLayout.paperWidth > 0 && paperLayout.paperHeight > 0 && (viewports.length > 0 || paperItems.length > 0)) {
    ({ format, orientation } = nearestFormat(paperLayout.paperWidth, paperLayout.paperHeight));
    doc.format = format;
    doc.orientation = orientation;
    report.lines.push(`Sheet ${format} ${orientation} from layout "${paperLayout.name}" (${fmt(paperLayout.paperWidth)} × ${fmt(paperLayout.paperHeight)} mm).`);
  } else {
    const fit = fitSheet(extents);
    doc.format = fit.format;
    doc.orientation = fit.orientation;
    report.lines.push(`Sheet ${fit.format} ${fit.orientation} chosen to fit the drawing at ${scaleText(fit.scale)}.`);
    viewports.length = 0;
    const size = sheetSizeOf(fit.format, fit.orientation);
    const area = drawingArea(size);
    const cx = extents ? (extents.min.x + extents.max.x) / 2 : 0;
    const cy = extents ? (extents.min.y + extents.max.y) / 2 : 0;
    views.push({
      id: 'v-front',
      name: opts.viewName ?? 'Front view',
      scale: fit.scale,
      origin: { x: (area.x0 + area.x1) / 2 - cx * fit.scale, y: (area.y0 + area.y1) / 2 - cy * fit.scale },
      link: null,
    });
  }

  // views from viewports: paper = origin + model × scale
  const windows: { view: View; min: Vec2; max: Vec2 }[] = [];
  viewports.forEach((vp, idx) => {
    const scale = vp.height / vp.viewHeight;
    const center = { x: vp.center.x + paperOffset.x, y: vp.center.y + paperOffset.y };
    const view: View = {
      id: idx === 0 ? 'v-front' : newId('v'),
      name: idx === 0 ? (opts.viewName ?? 'Front view') : `View ${idx + 1}`,
      scale: snapScale(scale),
      origin: { x: center.x - vp.viewCenter.x * scale, y: center.y - vp.viewCenter.y * scale },
      link: null,
      label: false,
    };
    views.push(view);
    const hw = vp.width / scale / 2;
    const hh = vp.height / scale / 2;
    windows.push({ view, min: { x: vp.viewCenter.x - hw, y: vp.viewCenter.y - hh }, max: { x: vp.viewCenter.x + hw, y: vp.viewCenter.y + hh } });
  });
  if (viewports.length > 0) report.lines.push(`${viewports.length} view${viewports.length === 1 ? '' : 's'} from layout viewports (${views.map((v) => scaleText(v.scale)).join(', ')}).`);
  if (views.length === 0) views.push({ id: 'v-front', name: opts.viewName ?? 'Front view', scale: 1, origin: { x: 120, y: 160 }, link: null });

  // paper-space geometry (frames, notes) goes into a sheet view at 1:1, except what sits inside ManualCAD's own title block
  let sheetView: View | null = null;
  const tb = titleBlockRect(doc);
  let skippedTitle = 0;
  const placed: { item: Item; view: View }[] = [];
  for (const it of paperItems) {
    const shifted = translateItem(it, paperOffset);
    const box = itemBox(shifted);
    if (box && box.min.x >= tb.x0 - EPS && box.max.x <= tb.x1 + EPS && box.min.y >= tb.y0 - EPS && box.max.y <= tb.y1 + EPS) {
      skippedTitle++;
      continue;
    }
    if (!sheetView) {
      sheetView = { id: newId('v'), name: 'Sheet', scale: 1, origin: { x: 0, y: 0 }, link: null, label: false };
      views.push(sheetView);
    }
    placed.push({ item: shifted, view: sheetView });
  }
  if (skippedTitle) report.lines.push(`${skippedTitle} paper-space objects inside the title block left out (ManualCAD draws its own title block).`);

  for (const it of modelItems) {
    const box = itemBox(it);
    const c = box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 } : null;
    const w = c ? windows.find((win) => c.x >= win.min.x && c.x <= win.max.x && c.y >= win.min.y && c.y <= win.max.y) : undefined;
    placed.push({ item: it, view: w?.view ?? views[0] });
  }

  // title block fields from block attributes
  for (const [field, value] of titleFields(raw)) doc.titleBlock[field] = value;

  // entities first (dimensions and leaders look them up), then the rest
  const layers = new Set<string>(['0']);
  const byHandle = new Map<string, Entity>();
  for (const { item, view } of placed) {
    if (item.kind !== 'curve') continue;
    const lineType = item.construction ? 'construction' : mapLineType(item, raw, lineGroup);
    const ent: Entity = { id: newId('e'), viewId: view.id, layer: item.layer, lineType, geom: item.curve };
    doc.entities.push(ent);
    byHandle.set(item.handle, ent);
    layers.add(item.layer);
    report.count('entit' + 'y');
  }
  const texts: { note: TextNote; item: Extract<Item, { kind: 'text' }> }[] = [];
  for (const { item, view } of placed) {
    if (item.kind === 'text') {
      const note = textNote(item, view, report);
      if (note) {
        doc.annotations.push(note);
        texts.push({ note, item });
        layers.add(item.layer);
      }
    } else if (item.kind === 'hatch') {
      const h = hatch(item, view, report);
      if (h) {
        doc.annotations.push(h);
        layers.add(item.layer);
      }
    } else if (item.kind === 'dimension') {
      const d = dimension(item, view, doc, report);
      if (d) {
        doc.dimensions.push(d);
        layers.add(item.layer);
      }
    }
  }
  for (const { item, view } of placed) {
    if (item.kind !== 'leader') continue;
    const l = leader(item, view, doc, texts, report);
    if (l) {
      doc.annotations.push(l);
      layers.add(item.layer);
    }
  }
  doc.layers = [...layers].map((name) => ({ name, visible: true }));
  report.lines.unshift(
    `Imported ${doc.entities.length} entities, ${doc.dimensions.length} dimensions, ${doc.annotations.length} annotations into ${views.length} view${views.length === 1 ? '' : 's'}; line group ${lineGroup}.`,
  );
  return { doc, report: report.finish().filter((l) => !/^\d+ entit/.test(l)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Flattening

function flatten(raw: RawDrawing, report: Report): Item[] {
  const out: Item[] = [];
  const k = raw.unitFactor;
  const unit: Xform = { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };
  const skippedLayers = new Set<string>();
  const walk = (entities: RawEntity[], m: Xform, parent: Resolved | null, depth: number): void => {
    for (const e of entities) {
      const layer = raw.layers.get(e.layer);
      if (layer && (layer.frozen || layer.off)) {
        skippedLayers.add(e.layer);
        continue;
      }
      if (/^defpoints$/i.test(e.layer)) continue;
      const res = resolve(e, layer, parent);
      emit(e, res, m, raw, out, report, (name, ins) => {
        if (depth > 8) return;
        const block = raw.blocks.get(name);
        if (!block) {
          report.count(`missing block "${name}"`);
          return;
        }
        const local: Xform = {
          a: ins.scale.x * Math.cos(ins.rotation),
          b: ins.scale.x * Math.sin(ins.rotation),
          c: -ins.scale.y * Math.sin(ins.rotation),
          d: ins.scale.y * Math.cos(ins.rotation),
          e: ins.pos.x,
          f: ins.pos.y,
        };
        const base: Xform = { a: 1, b: 0, c: 0, d: 1, e: -block.base.x, f: -block.base.y };
        walk(block.entities, compose(m, compose(local, base)), res, depth + 1);
      });
    }
  };
  walk(raw.entities, unit, null, 0);
  if (skippedLayers.size) report.lines.push(`Frozen or switched-off layers left out: ${[...skippedLayers].join(', ')}.`);
  return out;
}

function resolve(e: RawEntity, layer: RawLayer | undefined, parent: Resolved | null): Resolved {
  const color = e.color === 256 || e.color < 0 ? (layer?.color ?? 7) : e.color === 0 ? (parent?.color ?? layer?.color ?? 7) : e.color;
  const lt = e.linetype.toUpperCase();
  const linetype = lt === 'BYLAYER' || lt === '' ? (layer?.linetype ?? 'CONTINUOUS') : lt === 'BYBLOCK' ? (parent?.linetype ?? layer?.linetype ?? 'CONTINUOUS') : e.linetype;
  const lineweight = e.lineweight >= 0 ? e.lineweight : e.lineweight === -2 ? (parent?.lineweight ?? -1) : (layer?.lineweight ?? -1) >= 0 ? layer!.lineweight : -1;
  return { layer: e.layer, color, linetype, lineweight, paper: parent ? parent.paper : e.paperSpace, handle: e.handle };
}

function emit(
  e: RawEntity,
  res: Resolved,
  m: Xform,
  raw: RawDrawing,
  out: Item[],
  report: Report,
  insert: (name: string, ins: Extract<RawEntity, { kind: 'insert' }>) => void,
): void {
  const curve = (c: Curve, construction = false) => {
    for (const t of transformCurve(c, m)) out.push({ ...res, kind: 'curve', curve: t, construction });
  };
  switch (e.kind) {
    case 'line':
      curve({ kind: 'line', a: e.a, b: e.b });
      return;
    case 'circle':
      curve({ kind: 'circle', c: e.c, r: e.r });
      return;
    case 'arc':
      curve({ kind: 'arc', c: e.c, r: e.r, start: e.start, end: e.end });
      return;
    case 'polyline':
      for (const c of polylineCurves(e.vertices, e.closed)) curve(c);
      return;
    case 'text': {
      if (e.tag !== null && e.text.trim() === '') {
        report.count('empty attribute');
        return;
      }
      const { sx } = scalesOf(m);
      out.push({ ...res, kind: 'text', pos: apply(m, e.pos), text: decodeTextCodes(e.text), height: e.height * sx, angle: e.angle + angleOf(m), halign: e.halign, valign: e.valign });
      return;
    }
    case 'mtext': {
      const { sx } = scalesOf(m);
      const lines = mtextToLines(e.text);
      if (lines.length === 0) return;
      const h = e.height * sx;
      const lineStep = h * 5 / 3;
      const col = (e.attachment - 1) % 3;
      const row = Math.floor((e.attachment - 1) / 3); // 0 top, 1 middle, 2 bottom
      const total = h + (lines.length - 1) * lineStep;
      const topY = row === 0 ? 0 : row === 1 ? total / 2 : total;
      const angle = e.angle + angleOf(m);
      const up = { x: -Math.sin(angle), y: Math.cos(angle) };
      const origin = apply(m, e.pos);
      lines.forEach((text, i) => {
        const dy = topY - h - i * lineStep; // baseline offset from the insertion point, along "up"
        out.push({
          ...res,
          kind: 'text',
          pos: { x: origin.x + up.x * dy, y: origin.y + up.y * dy },
          text,
          height: h,
          angle,
          halign: col === 0 ? 'left' : col === 1 ? 'center' : 'right',
          valign: 'baseline',
        });
      });
      return;
    }
    case 'insert':
      insert(e.name, e);
      for (const a of e.attribs) emit(a, resolve(a, raw.layers.get(a.layer), res), m, raw, out, report, insert);
      return;
    case 'hatch': {
      const loops: Curve[][] = [];
      for (const edges of e.loops) {
        const loop: Curve[] = [];
        for (const edge of edges) for (const c of edgeCurves(edge, report)) loop.push(...transformCurve(c, m));
        if (loop.length) loops.push(loop);
      }
      if (!loops.length) return;
      const { sx } = scalesOf(m);
      const first = e.lines[0];
      const spacing = first ? Math.hypot(first.offset.x, first.offset.y) * sx : null;
      const angle = first ? first.angle + (angleOf(m) * 180) / Math.PI : e.angle + 45 + (angleOf(m) * 180) / Math.PI;
      out.push({ ...res, kind: 'hatch', loops, solid: e.solid, angle, spacing });
      return;
    }
    case 'dimension': {
      const t = (p: Vec2) => apply(m, p);
      const { sx } = scalesOf(m);
      out.push({
        ...res,
        kind: 'dimension',
        raw: { ...e, defPoint: t(e.defPoint), textMid: e.textMid && t(e.textMid), p13: t(e.p13), p14: t(e.p14), p15: t(e.p15), p16: t(e.p16), rotation: e.rotation + angleOf(m), text: e.text, userText: e.userText },
      });
      void sx;
      return;
    }
    case 'leader':
      out.push({ ...res, kind: 'leader', points: e.points.map((p) => apply(m, p)), arrow: e.arrow, text: null, height: 0, annotation: e.annotation });
      return;
    case 'mleader': {
      const { sx } = scalesOf(m);
      const line = e.lines[0];
      if (!line || line.length === 0) return;
      const pts = line.map((p) => apply(m, p));
      if (e.landing) pts.push(apply(m, e.landing));
      const lines = mtextToLines(e.text);
      out.push({ ...res, kind: 'leader', points: pts, arrow: e.arrow, text: lines[0] ?? null, height: e.textHeight * sx, annotation: null });
      return;
    }
    case 'spline': {
      const pts = splinePoints(e);
      report.count('spline drawn as line segments');
      for (let i = 0; i + 1 < pts.length; i++) curve({ kind: 'line', a: pts[i], b: pts[i + 1] });
      return;
    }
    case 'ellipse': {
      report.count('ellipse drawn as line segments');
      for (const c of ellipseCurves(e)) curve(c);
      return;
    }
    case 'solid': {
      report.count('filled area drawn as outline');
      const p = e.points.length === 4 ? [e.points[0], e.points[1], e.points[3], e.points[2]] : e.points;
      for (let i = 0; i < p.length; i++) curve({ kind: 'line', a: p[i], b: p[(i + 1) % p.length] });
      return;
    }
    case 'xline': {
      const d = Math.hypot(e.dir.x, e.dir.y) || 1;
      const u = { x: (e.dir.x / d) * CONSTRUCTION_LENGTH, y: (e.dir.y / d) * CONSTRUCTION_LENGTH };
      curve({ kind: 'line', a: e.ray ? e.p : { x: e.p.x - u.x, y: e.p.y - u.y }, b: { x: e.p.x + u.x, y: e.p.y + u.y } }, true);
      return;
    }
    case 'viewport':
      out.push({ ...res, kind: 'viewport', center: apply(m, e.center), width: e.width * scalesOf(m).sx, height: e.height * scalesOf(m).sx, viewCenter: e.viewCenter, viewHeight: e.viewHeight, id: e.id });
      return;
    case 'unsupported':
      report.count(`${e.type} object skipped`);
      return;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers

/** Curve under a transform: lines and uniformly scaled circles/arcs stay exact; non-uniform scaling samples the curve. */
function transformCurve(c: Curve, m: Xform): Curve[] {
  if (c.kind === 'line') return [{ kind: 'line', a: apply(m, c.a), b: apply(m, c.b) }];
  const { sx, sy } = scalesOf(m);
  if (Math.abs(sx - sy) > 1e-9 * Math.max(sx, sy) || Math.abs(m.a * m.c + m.b * m.d) > 1e-9) {
    const pts = sampleCurve(c, 32).map((p) => apply(m, p));
    const out: Curve[] = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push({ kind: 'line', a: pts[i], b: pts[i + 1] });
    return out;
  }
  if (c.kind === 'circle') return [{ kind: 'circle', c: apply(m, c.c), r: c.r * sx }];
  const centre = apply(m, c.c);
  const rot = angleOf(m);
  if (det(m) >= 0) return [{ kind: 'arc', c: centre, r: c.r * sx, start: c.start + rot, end: c.end + rot }];
  // reflection: the sweep direction flips
  const refl = (a: number) => Math.atan2(-Math.sin(a), Math.cos(a)); // mirror across x before rotation
  return [{ kind: 'arc', c: centre, r: c.r * sx, start: refl(c.end) + rot, end: refl(c.start) + rot }];
}

function sampleCurve(c: Curve, n: number): Vec2[] {
  if (c.kind === 'line') return [c.a, c.b];
  const start = c.kind === 'circle' ? 0 : c.start;
  const sweep = c.kind === 'circle' ? TAU : sweepOf(c.start, c.end);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    pts.push({ x: c.c.x + c.r * Math.cos(a), y: c.c.y + c.r * Math.sin(a) });
  }
  return pts;
}

function sweepOf(start: number, end: number): number {
  const s = (end - start) % TAU;
  return s <= 0 ? s + TAU : s;
}

function translateItem(it: Item, d: Vec2): Item {
  const t = (p: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });
  const tc = (c: Curve): Curve => (c.kind === 'line' ? { ...c, a: t(c.a), b: t(c.b) } : { ...c, c: t(c.c) });
  switch (it.kind) {
    case 'curve':
      return { ...it, curve: tc(it.curve) };
    case 'text':
      return { ...it, pos: t(it.pos) };
    case 'hatch':
      return { ...it, loops: it.loops.map((l) => l.map(tc)) };
    case 'dimension':
      return { ...it, raw: { ...it.raw, defPoint: t(it.raw.defPoint), textMid: it.raw.textMid && t(it.raw.textMid), p13: t(it.raw.p13), p14: t(it.raw.p14), p15: t(it.raw.p15), p16: t(it.raw.p16) } };
    case 'leader':
      return { ...it, points: it.points.map(t) };
    case 'viewport':
      return { ...it, center: t(it.center) };
  }
}

/** Arc between two vertices from a polyline bulge (tan of a quarter of the included angle; negative = clockwise). */
export function bulgeArc(p1: Vec2, p2: Vec2, bulge: number): ArcCurve | null {
  const theta = 4 * Math.atan(bulge);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || Math.abs(theta) < 1e-9) return null;
  const r = Math.abs(d / (2 * Math.sin(theta / 2)));
  const h = d / 2 / Math.tan(theta / 2);
  const c = { x: (p1.x + p2.x) / 2 - (dy / d) * h, y: (p1.y + p2.y) / 2 + (dx / d) * h };
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
  return bulge > 0 ? { kind: 'arc', c, r, start: a1, end: a2 } : { kind: 'arc', c, r, start: a2, end: a1 };
}

function polylineCurves(vertices: RawVertex[], closed: boolean): Curve[] {
  const out: Curve[] = [];
  const n = vertices.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) < EPS) continue;
    const arc = bulgeArc(a.p, b.p, a.bulge);
    out.push(arc ?? { kind: 'line', a: a.p, b: b.p });
  }
  return out;
}

function edgeCurves(edge: RawLoopEdge, report: Report): Curve[] {
  switch (edge.kind) {
    case 'line':
      return [{ kind: 'line', a: edge.a, b: edge.b }];
    case 'arc': {
      const full = Math.abs(sweepOf(edge.start, edge.end) - TAU) < 1e-9 || Math.abs(edge.end - edge.start) >= TAU - 1e-9;
      if (full) return [{ kind: 'circle', c: edge.c, r: edge.r }];
      return [edge.ccw ? { kind: 'arc', c: edge.c, r: edge.r, start: edge.start, end: edge.end } : { kind: 'arc', c: edge.c, r: edge.r, start: -edge.end, end: -edge.start }];
    }
    case 'polyline':
      return polylineCurves(edge.vertices, edge.closed);
    case 'ellipse': {
      report.count('ellipse drawn as line segments');
      const pts = ellipsePoints(edge.c, edge.major, edge.ratio, edge.start, edge.end);
      if (!edge.ccw) pts.reverse();
      return chain(pts);
    }
    case 'spline': {
      report.count('spline drawn as line segments');
      return chain(splinePoints(edge));
    }
  }
}

function chain(pts: Vec2[]): Curve[] {
  const out: Curve[] = [];
  for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > EPS) out.push({ kind: 'line', a: pts[i], b: pts[i + 1] });
  return out;
}

function ellipsePoints(c: Vec2, major: Vec2, ratio: number, start: number, end: number): Vec2[] {
  const a = Math.hypot(major.x, major.y);
  const b = a * ratio;
  const rot = Math.atan2(major.y, major.x);
  const sweep = end <= start ? end + TAU - start : end - start;
  const n = Math.max(8, Math.ceil((sweep / TAU) * 48));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    pts.push({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return pts;
}

function ellipseCurves(e: Extract<RawEntity, { kind: 'ellipse' }>): Curve[] {
  return chain(ellipsePoints(e.c, e.major, e.ratio, e.start, e.end));
}

/** Points along a B-spline (de Boor; weights honoured) or, with fit points only, a Catmull-Rom curve through them. */
export function splinePoints(s: { degree: number; knots: number[]; control: Vec2[]; weights: number[]; fit: Vec2[] }): Vec2[] {
  const p = s.degree;
  const ctrl = s.control;
  if (ctrl.length > p && s.knots.length >= ctrl.length + p + 1) {
    const w = s.weights.length === ctrl.length ? s.weights : ctrl.map(() => 1);
    const u0 = s.knots[p];
    const u1 = s.knots[ctrl.length];
    const n = Math.max(16, ctrl.length * 8);
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i === n ? u1 : u0 + ((u1 - u0) * i) / n;
      pts.push(deBoor(u, p, s.knots, ctrl, w));
    }
    return pts;
  }
  const fit = s.fit.length ? s.fit : ctrl;
  if (fit.length < 2) return fit;
  const pts: Vec2[] = [];
  for (let i = 0; i + 1 < fit.length; i++) {
    const p0 = fit[Math.max(0, i - 1)];
    const p1 = fit[i];
    const p2 = fit[i + 1];
    const p3 = fit[Math.min(fit.length - 1, i + 2)];
    const segs = 8;
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  pts.push(fit[fit.length - 1]);
  return pts;
}

function deBoor(u: number, p: number, knots: number[], ctrl: Vec2[], w: number[]): Vec2 {
  let k = knots.findIndex((kt, i) => i >= p && i < ctrl.length && u >= kt && u < knots[i + 1]);
  if (k < 0) k = ctrl.length - 1;
  const d = [];
  for (let j = 0; j <= p; j++) d.push({ x: ctrl[j + k - p].x * w[j + k - p], y: ctrl[j + k - p].y * w[j + k - p], w: w[j + k - p] });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = knots[i + p - r + 1] - knots[i];
      const alpha = den === 0 ? 0 : (u - knots[i]) / den;
      d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y, w: (1 - alpha) * d[j - 1].w + alpha * d[j].w };
    }
  }
  return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
}

interface Box {
  min: Vec2;
  max: Vec2;
}

function grow(b: Box | null, p: Vec2): Box {
  if (!b) return { min: { ...p }, max: { ...p } };
  return { min: { x: Math.min(b.min.x, p.x), y: Math.min(b.min.y, p.y) }, max: { x: Math.max(b.max.x, p.x), y: Math.max(b.max.y, p.y) } };
}

function curveBox(c: Curve): Box {
  let b: Box | null = null;
  for (const p of sampleCurve(c, 16)) b = grow(b, p);
  return b!;
}

function itemBox(it: Item): Box | null {
  switch (it.kind) {
    case 'curve':
      return curveBox(it.curve);
    case 'text':
      return { min: it.pos, max: it.pos };
    case 'hatch': {
      let b: Box | null = null;
      for (const l of it.loops) for (const c of l) for (const p of sampleCurve(c, 8)) b = grow(b, p);
      return b;
    }
    case 'dimension': {
      const r = it.raw;
      let b: Box | null = null;
      for (const p of [r.defPoint, r.p13, r.p14, r.p15]) b = grow(b, p);
      return b;
    }
    case 'leader': {
      let b: Box | null = null;
      for (const p of it.points) b = grow(b, p);
      return b;
    }
    case 'viewport':
      return null;
  }
}

function bboxOf(items: Item[]): Box | null {
  let b: Box | null = null;
  for (const it of items) {
    if (it.kind === 'curve' && it.construction) continue;
    const ib = itemBox(it);
    if (!ib) continue;
    b = grow(grow(b, ib.min), ib.max);
  }
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// Sheet and views

function activeLayout(raw: RawDrawing) {
  const paper = raw.layouts.filter((l) => !/^model$/i.test(l.name));
  return paper.find((l) => l.blockName === '*Paper_Space') ?? paper[0] ?? null;
}

function sheetSizeOf(format: SheetFormat, orientation: Orientation): { w: number; h: number } {
  const s = SHEET_SIZES[format];
  return orientation === 'portrait' ? { w: s.w, h: s.h } : { w: s.h, h: s.w };
}

function nearestFormat(w: number, h: number): { format: SheetFormat; orientation: Orientation } {
  const orientation: Orientation = w >= h ? 'landscape' : 'portrait';
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  let best: SheetFormat = 'A4';
  let bestErr = Infinity;
  for (const f of Object.keys(SHEET_SIZES) as SheetFormat[]) {
    const s = SHEET_SIZES[f];
    const err = Math.abs(s.h - long) + Math.abs(s.w - short);
    if (err < bestErr) {
      bestErr = err;
      best = f;
    }
  }
  return { format: best, orientation };
}

/** Space for views: inside the frame, above the title block row. */
function drawingArea(size: { w: number; h: number }): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: FRAME.left, y0: FRAME.bottom + TITLE_BLOCK.height, x1: size.w - FRAME.right, y1: size.h - FRAME.top };
}

function fitSheet(extents: Box | null): { format: SheetFormat; orientation: Orientation; scale: number } {
  if (!extents) return { format: 'A3', orientation: 'landscape', scale: 1 };
  const w = extents.max.x - extents.min.x;
  const h = extents.max.y - extents.min.y;
  const margin = 10;
  const scales = [1, ...STANDARD_SCALES.filter((s) => s < 1)];
  for (const scale of scales) {
    for (const format of ['A4', 'A3', 'A2', 'A1', 'A0'] as SheetFormat[]) {
      for (const orientation of (format === 'A4' ? ['portrait', 'landscape'] : ['landscape', 'portrait']) as Orientation[]) {
        const area = drawingArea(sheetSizeOf(format, orientation));
        if (w * scale + 2 * margin <= area.x1 - area.x0 && h * scale + 2 * margin <= area.y1 - area.y0) return { format, orientation, scale };
      }
    }
  }
  return { format: 'A0', orientation: 'landscape', scale: 1 / 100 };
}

function titleBlockRect(doc: SheetDoc): { x0: number; y0: number; x1: number; y1: number } {
  const size = sheetSizeOf(doc.format, doc.orientation);
  const x1 = size.w - FRAME.right;
  return { x0: x1 - TITLE_BLOCK.width, y0: FRAME.bottom, x1, y1: FRAME.bottom + TITLE_BLOCK.height };
}

function snapScale(s: number): number {
  for (const std of STANDARD_SCALES) if (Math.abs(s - std) / std < 0.01) return std;
  return Math.round(s * 1000) / 1000;
}

function scaleText(s: number): string {
  return s >= 1 ? `${round3(s)}:1` : `1:${round3(1 / s)}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Line types (ADR-0001: the meaning of a line comes from layer, line type and pen colour, never free)

const HIDDEN_RE = /hidden|verdeckt|unsichtbar|gestrichelt|strichlinie|^dash(ed)?(2|x2)?$|ISO0?[23]W|ACAD_ISO0?[23]/i;
const PHANTOM_RE = /phantom|zweipunkt|2xpunkt|2punkt|strich.?2|dashdotdot|divide|ISO1[23]W|ACAD_ISO1[23]/i;
const CENTER_RE = /center|centre|achs|mittel|strichpunkt|symmetr|dashdot|ISO(04|10|11)W|ACAD_ISO(04|10|11)|schnitt|section/i;
const CONSTRUCTION_RE = /ansichtsfenster|viewport|konstruktion|construction|hilfslinie|^xline/i;
const NARROW_LAYER_RE = /0[.,]?(18|25|35)\b|thin|schmal|dünn|duenn|narrow|bema|dim|text|schraff|hatch|beschrift|masz|maß/i;
const WIDE_LAYER_RE = /0[.,]?(5|50|7|70)\b|breit|wide|kontur|outline|sichtbar|visible|umriss|körper|koerper/i;

function mapLineType(item: Resolved, raw: RawDrawing, group: LineGroupId): LineTypeId {
  const names = `${item.layer} ${item.linetype}`;
  if (CONSTRUCTION_RE.test(item.layer)) return 'construction';
  if (HIDDEN_RE.test(names)) return 'hidden';
  if (PHANTOM_RE.test(names)) return 'phantom';
  if (CENTER_RE.test(names)) return 'center';
  const pattern = raw.linetypes.get(item.linetype) ?? raw.linetypes.get(item.linetype.toUpperCase()) ?? [];
  if (pattern.length > 1) {
    const dots = pattern.filter((p) => Math.abs(p) < 0.11 * Math.max(...pattern.map(Math.abs))).length;
    if (dots >= 2) return 'phantom';
    if (dots === 1) return 'center';
    return 'hidden';
  }
  return isWide(item, group) ? 'visible' : 'thin';
}

/** Wide (visible edge) or narrow, from lineweight, pen colour (BBRZ plot style: red/yellow wide) and layer name. */
function isWide(item: Resolved, group: LineGroupId): boolean {
  if (item.lineweight >= 0) return item.lineweight >= (group === '0.7' ? 50 : 40);
  if (WIDE_LAYER_RE.test(item.layer)) return true;
  if (NARROW_LAYER_RE.test(item.layer)) return false;
  if (item.color === 1 || item.color === 2) return true;
  if (item.color === 3 || item.color === 4 || item.color === 5 || item.color === 6 || item.color === 8 || item.color === 9 || item.color >= 250) return false;
  return true;
}

function chooseLineGroup(items: Item[]): LineGroupId {
  let seven = 0;
  let five = 0;
  for (const it of items) {
    if (it.kind !== 'curve') continue;
    if (it.lineweight >= 60 || it.color === 1 || /0[.,]?70?\b/.test(it.layer)) seven++;
    else if ((it.lineweight >= 40 && it.lineweight < 60) || it.color === 2 || /0[.,]?50?\b/.test(it.layer)) five++;
  }
  return seven > five ? '0.7' : '0.5';
}

// ---------------------------------------------------------------------------------------------------------------
// Annotations and dimensions

function snapHeight(h: number): number {
  let best = TEXT_HEIGHTS[0];
  for (const t of TEXT_HEIGHTS) if (Math.abs(t - h) < Math.abs(best - h)) best = t;
  return best;
}

function toLocal(view: View, p: Vec2): Vec2 {
  return { x: (p.x - view.origin.x) / view.scale, y: (p.y - view.origin.y) / view.scale };
}

/** Model items are already in the view's real mm; sheet-view items (paper) are at 1:1, so the same conversion serves both. */
function localOf(view: View, p: Vec2, paper: boolean): Vec2 {
  return paper ? toLocal(view, p) : p;
}

function textNote(item: Extract<Item, { kind: 'text' }>, view: View, report: Report): TextNote | null {
  const paperHeight = item.height * (item.paper ? 1 : view.scale);
  if (paperHeight < 1) {
    report.count('text below 1 mm skipped');
    return null;
  }
  if (item.text.trim() === '') return null;
  const h = snapHeight(paperHeight);
  // move the anchor down to the baseline for middle/top aligned text
  const shift = item.valign === 'middle' ? h / 2 : item.valign === 'top' ? h : 0;
  const up = { x: -Math.sin(item.angle), y: Math.cos(item.angle) };
  const s = item.paper ? 1 : view.scale;
  const pos = { x: item.pos.x - (up.x * shift) / s, y: item.pos.y - (up.y * shift) / s };
  return { kind: 'text', id: newId('t'), viewId: view.id, layer: item.layer, pos: localOf(view, pos, item.paper), text: item.text, height: h, angle: item.angle, align: item.halign };
}

function hatch(item: Extract<Item, { kind: 'hatch' }>, view: View, report: Report): Hatch | null {
  const loops = item.loops.map((l) => l.map((c) => (item.paper ? curveToLocal(view, c) : c))).filter((l) => l.length > 0);
  if (!loops.length) return null;
  const s = item.paper ? 1 : view.scale;
  let spacing = item.spacing !== null ? Math.round(item.spacing * s * 100) / 100 : HATCH_SPACING_DEFAULT;
  if (item.solid) {
    report.count('solid fill drawn as dense hatching');
    spacing = 0.7;
  }
  if (!(spacing > 0.1)) spacing = HATCH_SPACING_DEFAULT;
  const angle = ((item.angle % 180) + 180) % 180;
  return { kind: 'hatch', id: newId('h'), viewId: view.id, layer: item.layer, loops, angle: Math.round(angle * 100) / 100, spacing };
}

function curveToLocal(view: View, c: Curve): Curve {
  if (c.kind === 'line') return { kind: 'line', a: toLocal(view, c.a), b: toLocal(view, c.b) };
  if (c.kind === 'circle') return { kind: 'circle', c: toLocal(view, c.c), r: c.r / view.scale };
  return { kind: 'arc', c: toLocal(view, c.c), r: c.r / view.scale, start: c.start, end: c.end };
}

function anchorFor(doc: SheetDoc, viewId: string, p: Vec2): DimAnchor {
  for (const e of doc.entities) {
    if (e.viewId !== viewId || e.lineType === 'construction') continue;
    const g = e.geom;
    if (g.kind === 'circle') {
      if (near(g.c, p)) return { ref: { entityId: e.id, point: 'center' }, fallback: p };
      continue;
    }
    const ends = g.kind === 'line' ? [g.a, g.b] : [{ x: g.c.x + g.r * Math.cos(g.start), y: g.c.y + g.r * Math.sin(g.start) }, { x: g.c.x + g.r * Math.cos(g.end), y: g.c.y + g.r * Math.sin(g.end) }];
    if (near(ends[0], p)) return { ref: { entityId: e.id, point: 'start' }, fallback: p };
    if (near(ends[1], p)) return { ref: { entityId: e.id, point: 'end' }, fallback: p };
    if (g.kind === 'arc' && near(g.c, p)) return { ref: { entityId: e.id, point: 'center' }, fallback: p };
  }
  return { ref: null, fallback: p };
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < SNAP && Math.abs(a.y - b.y) < SNAP;
}

function dimText(raw: string): DimText {
  const t = decodeTextCodes(raw).trim();
  if (t === '' || t === '<>') return { override: null, prefix: '', suffix: '' };
  const i = t.indexOf('<>');
  if (i >= 0) return { override: null, prefix: t.slice(0, i), suffix: t.slice(i + 2) };
  return { override: t, prefix: '', suffix: '' };
}

function dimension(item: Extract<Item, { kind: 'dimension' }>, view: View, doc: SheetDoc, report: Report): Dimension | null {
  const r = item.raw;
  const s = item.paper ? 1 : view.scale;
  const L = (p: Vec2) => localOf(view, p, item.paper);
  const base = { id: newId('d'), viewId: view.id, layer: item.layer, text: dimText(r.text) };
  switch (r.dimType) {
    case 'linear':
    case 'aligned': {
      const a = L(r.p13);
      const b = L(r.p14);
      const def = L(r.defPoint);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let orientation: LinearOrientation;
      let n: Vec2;
      if (r.dimType === 'aligned') {
        orientation = 'aligned';
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        n = { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
      } else {
        const rot = ((r.rotation % Math.PI) + Math.PI) % Math.PI;
        if (Math.abs(rot) < 1e-6 || Math.abs(rot - Math.PI) < 1e-6) {
          orientation = 'horizontal';
          n = { x: 0, y: 1 };
        } else if (Math.abs(rot - Math.PI / 2) < 1e-6) {
          orientation = 'vertical';
          n = { x: 1, y: 0 };
        } else {
          orientation = { angle: Math.PI / 2 + rot };
          n = { x: Math.cos(Math.PI / 2 + rot), y: Math.sin(Math.PI / 2 + rot) };
        }
      }
      const offset = ((def.x - mid.x) * n.x + (def.y - mid.y) * n.y) * s;
      return { kind: 'linear', ...base, a: anchorFor(doc, view.id, a), b: anchorFor(doc, view.id, b), orientation, offset };
    }
    case 'diameter':
    case 'radius': {
      const p1 = L(r.defPoint);
      const p2 = L(r.p15);
      const centre = r.dimType === 'diameter' ? { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } : p1;
      const radius = r.dimType === 'diameter' ? Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2 : Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const ent = doc.entities.find((e) => e.viewId === view.id && e.geom.kind !== 'line' && near(e.geom.c, centre) && Math.abs(e.geom.r - radius) < SNAP * 10);
      if (!ent) {
        report.count(`${r.dimType} dimension without its circle skipped`);
        return null;
      }
      const angle = r.dimType === 'diameter' ? Math.atan2(p1.y - centre.y, p1.x - centre.x) : Math.atan2(p2.y - centre.y, p2.x - centre.x);
      const leaderLen = r.textMid ? Math.max(0, (Math.hypot(r.textMid.x - (item.paper ? view.origin.x + centre.x : centre.x), r.textMid.y - (item.paper ? view.origin.y + centre.y : centre.y)) - radius) * s) : 0;
      return { kind: r.dimType, ...base, entityId: ent.id, angle, leader: Math.round(leaderLen * 10) / 10 };
    }
    case 'angular':
    case 'angular3': {
      let leg1: [Vec2, Vec2];
      let leg2: [Vec2, Vec2];
      let arcPoint: Vec2;
      if (r.dimType === 'angular') {
        leg1 = [L(r.p13), L(r.p14)];
        leg2 = [L(r.p15), L(r.defPoint)];
        arcPoint = L(r.p16);
      } else {
        const v = L(r.p15);
        leg1 = [v, L(r.p13)];
        leg2 = [v, L(r.p14)];
        arcPoint = L(r.defPoint);
      }
      const vertex = lineIntersection(leg1, leg2);
      if (!vertex) {
        report.count('angular dimension between parallel lines skipped');
        return null;
      }
      const u1 = unit(leg1[1], leg1[0]);
      const u2 = unit(leg2[1], leg2[0]);
      const dir = unit(arcPoint, vertex);
      let best: { s1: 1 | -1; s2: 1 | -1 } | null = null;
      for (const s1 of [1, -1] as const) {
        for (const s2 of [1, -1] as const) {
          const a = { x: s1 * u1.x, y: s1 * u1.y };
          const b = { x: s2 * u2.x, y: s2 * u2.y };
          if (insideSector(a, b, dir)) best = { s1, s2 };
        }
      }
      const senses = best ?? { s1: 1, s2: 1 };
      const dim: AngularDimension = {
        kind: 'angular',
        ...base,
        leg1: { a: anchorFor(doc, view.id, leg1[0]), b: anchorFor(doc, view.id, leg1[1]) },
        leg2: { a: anchorFor(doc, view.id, leg2[0]), b: anchorFor(doc, view.id, leg2[1]) },
        sense1: senses.s1,
        sense2: senses.s2,
        radius: Math.hypot(arcPoint.x - vertex.x, arcPoint.y - vertex.y) * s,
      };
      return dim;
    }
    case 'ordinate':
      report.count('ordinate dimension skipped');
      return null;
  }
}

function unit(to: Vec2, from: Vec2): Vec2 {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function insideSector(a: Vec2, b: Vec2, d: Vec2): boolean {
  // d lies between a and b (the sector below 180°) when it is on b's side of a and on a's side of b
  const cab = a.x * b.y - a.y * b.x;
  if (Math.abs(cab) < 1e-9) return false;
  const cad = a.x * d.y - a.y * d.x;
  const cdb = d.x * b.y - d.y * b.x;
  return Math.sign(cad) === Math.sign(cab) && Math.sign(cdb) === Math.sign(cab);
}

function lineIntersection(l1: [Vec2, Vec2], l2: [Vec2, Vec2]): Vec2 | null {
  const d1 = { x: l1[1].x - l1[0].x, y: l1[1].y - l1[0].y };
  const d2 = { x: l2[1].x - l2[0].x, y: l2[1].y - l2[0].y };
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2[0].x - l1[0].x) * d2.y - (l2[0].y - l1[0].y) * d2.x) / den;
  return { x: l1[0].x + d1.x * t, y: l1[0].y + d1.y * t };
}

void intersect;

function leader(item: Extract<Item, { kind: 'leader' }>, view: View, doc: SheetDoc, texts: { note: TextNote; item: Extract<Item, { kind: 'text' }> }[], report: Report): Leader | null {
  if (item.points.length < 2) return null;
  const s = item.paper ? 1 : view.scale;
  let pts = item.points.map((p) => localOf(view, p, item.paper));
  let text = item.text;
  let height = item.height > 0 ? snapHeight(item.height * s) : 0;
  if (text === null) {
    // the note: the text the LEADER points at (340), else the nearest text to its end
    const last = item.points[item.points.length - 1];
    let pick = item.annotation ? texts.find((t) => t.item.handle === item.annotation) : undefined;
    if (!pick) {
      let bestD = Infinity;
      for (const t of texts) {
        if (t.note.viewId !== view.id) continue;
        const p = t.item.pos;
        const d = Math.hypot(p.x - last.x, p.y - last.y);
        if (d < bestD && d < 4 * t.item.height + 2) {
          bestD = d;
          pick = t;
        }
      }
    }
    if (pick) {
      text = pick.note.text;
      height = pick.note.height;
      const i = doc.annotations.indexOf(pick.note);
      if (i >= 0) doc.annotations.splice(i, 1);
      texts.splice(texts.indexOf(pick), 1);
    }
  }
  if (!height) height = snapHeight(3.5);
  // AutoCAD's hook line (short horizontal last segment) is drawn by ManualCAD itself as the reference line
  if (text && pts.length >= 3) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) * s;
    if (Math.abs(b.y - a.y) < 1e-6 && len <= 3 * height) pts = pts.slice(0, -1);
  }
  void report;
  const l: Leader = {
    kind: 'leader',
    id: newId('l'),
    viewId: view.id,
    layer: item.layer,
    points: pts,
    terminator: item.arrow ? 'arrow' : 'none',
    style: 'note',
    text: text ?? '',
    height,
  };
  return l;
}

// ---------------------------------------------------------------------------------------------------------------
// Title block fields from block attributes (BBRZ and common German/English tags)

const FIELD_TAGS: [RegExp, TitleBlockField][] = [
  [/zeichnung(s)?-?n(r|ummer)|drawing-?no|dwg-?no|^znr|^nummer$/i, 'drawingNumber'],
  [/titel|benennung|^title$|bezeichnung/i, 'title'],
  [/^ma(ss|ß)stab$|^scale$/i, 'scale'],
  [/klasse|firma|schule|owner|^company$|auftraggeber/i, 'owner'],
  [/toleranz|tolerance/i, 'generalTolerance'],
  [/gez|gezeichnet|drawn|erstellt|^name$|bearbeiter/i, 'createdBy'],
  [/gepr|geprüft|gepruft|approved|genehmigt/i, 'approvedBy'],
  [/datum|date|tag$/i, 'date'],
  [/doku|dokumentenart|dokumentart|document/i, 'documentType'],
  [/blatt|sheet/i, 'sheet'],
  [/werkstoff|material/i, 'material'],
];

function titleFields(raw: RawDrawing): Map<TitleBlockField, string> {
  const out = new Map<TitleBlockField, string>();
  const visit = (entities: RawEntity[], depth: number) => {
    for (const e of entities) {
      if (e.kind !== 'insert') continue;
      for (const a of e.attribs) {
        if (a.kind !== 'text' || a.tag === null) continue;
        const value = decodeTextCodes(a.text).trim();
        if (!value) continue;
        const tag = a.tag.replace(/[_\-.]/g, ' ');
        const hit = FIELD_TAGS.find(([re]) => re.test(tag));
        if (!hit) continue;
        const field = hit[1];
        if (field === 'createdBy' && /tag|datum/i.test(tag)) continue;
        if (field === 'date' && /gepr/i.test(tag)) continue;
        if (field === 'approvedBy' && /tag|datum/i.test(tag)) continue;
        if (out.has(field)) continue;
        out.set(field, field === 'generalTolerance' && /^[a-z]{1,2}$/i.test(value) ? `ISO 2768-${value}` : value);
      }
      const block = raw.blocks.get(e.name);
      if (block && depth < 4) visit(block.entities, depth + 1);
    }
  };
  visit(raw.entities, 0);
  return out;
}

// re-export for the DWG adapter and tests
export type { Annotation };
