// Helpers to build the WPC sheet documents. Views take their geometry from geometry.gen.ts (the fitted
// projection data of the shipped WPC drawing set); everything else - dimensions, leaders, hatching, tables,
// notes and the title block fields - is created here with the app's own data model, so screen, PDF and SVG
// follow the same Norm rules (ISO 128-2 line types, ISO 129-1 dimensions, ISO 128-50 hatching, BBRZ block).
import { endpoints } from '../../../geom';
import type { Curve, Vec2 } from '../../../geom/types';
import { newId, newSheet, toLocal, toSheet } from '../../../model/doc';
import type {
  AnchorPoint, DimAnchor, DimText, Hatch, Leader, LinearDimension, LineTypeId,
  ProjectionLink, RadialDimension, SheetDoc, SheetFormat, Orientation, SurfaceRemoval, SurfaceSymbol,
  TextNote, View,
} from '../../../model/types';
import { WPC, type GPrim, type GView } from './geometry.gen';

export type ViewOpts = {
  scale?: number;
  origin: Vec2;
  /** Projection link: parent view plus the axis this view may still slide along. */
  link?: { parent: View; freeAxis: 'x' | 'y' };
  /** false = never print the view label (ISO 128-3: views in projection need no designation). */
  label?: boolean;
};

interface AnchorCand {
  entityId: string;
  point: AnchorPoint;
  p: Vec2;
}

const P = (x: number, y: number): Vec2 => ({ x, y });

/** Sheet point -> view-local point. */
export function loc(view: View, sx: number, sy: number): Vec2 {
  return toLocal(view, { x: sx, y: sy });
}

export class WpcDoc {
  readonly doc: SheetDoc;
  private anchors = new Map<string, AnchorCand[]>();

  constructor(format: SheetFormat, orientation: Orientation) {
    this.doc = newSheet();
    this.doc.format = format;
    this.doc.orientation = orientation;
    this.doc.lineGroup = '0.5';
    this.doc.titleBlockTemplate = 'bbrz';
    this.doc.titleBlock = { documentType: 'Fertigungszeichnung', generalTolerance: 'ISO 2768-mK' };
    this.doc.views = [];
  }

  title(fields: Partial<Record<string, string>>): void {
    this.doc.titleBlock = { ...this.doc.titleBlock, ...fields } as SheetDoc['titleBlock'];
  }

  addView(name: string, opts: ViewOpts): View {
    const link: ProjectionLink | null = opts.link ? { parentId: opts.link.parent.id, freeAxis: opts.link.freeAxis } : null;
    const view: View = { id: newId('v'), name, scale: opts.scale ?? 1, origin: opts.origin, link };
    if (opts.label === false) view.label = false;
    this.doc.views.push(view);
    return view;
  }

  // ---------- geometry ----------

  addCurve(view: View, curve: { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'circle'; c: Vec2; r: number } | { kind: 'arc'; c: Vec2; r: number; start: number; end: number }, lineType: LineTypeId): string {
    const id = newId('e');
    this.doc.entities.push({ id, viewId: view.id, layer: '0', lineType, geom: curve });
    const list = this.anchors.get(view.id) ?? [];
    if (curve.kind === 'line') {
      list.push({ entityId: id, point: 'start', p: curve.a }, { entityId: id, point: 'end', p: curve.b });
    } else {
      list.push({ entityId: id, point: 'center', p: curve.c });
      if (curve.kind === 'arc') {
        const e = endpoints(curve);
        if (e) list.push({ entityId: id, point: 'start', p: e[0] }, { entityId: id, point: 'end', p: e[1] });
      }
    }
    this.anchors.set(view.id, list);
    return id;
  }

  line(view: View, x1: number, y1: number, x2: number, y2: number, lineType: LineTypeId = 'visible'): string {
    return this.addCurve(view, { kind: 'line', a: P(x1, y1), b: P(x2, y2) }, lineType);
  }

  circle(view: View, cx: number, cy: number, r: number, lineType: LineTypeId = 'visible'): string {
    return this.addCurve(view, { kind: 'circle', c: P(cx, cy), r }, lineType);
  }

  arc(view: View, cx: number, cy: number, r: number, a0: number, a1: number, lineType: LineTypeId = 'visible'): string {
    return this.addCurve(view, { kind: 'arc', c: P(cx, cy), r, start: a0, end: a1 }, lineType);
  }

  /** Adds a generated view's primitives (polylines fall back to single line entities). */
  addPrims(view: View, prims: GPrim[], lineType: LineTypeId = 'visible'): void {
    for (const p of prims) {
      if (p[0] === 'L') this.line(view, p[1], p[2], p[3], p[4], lineType);
      else if (p[0] === 'C') this.circle(view, p[1], p[2], p[3], lineType);
      else if (p[0] === 'A') this.arc(view, p[1], p[2], p[3], p[4], p[5], lineType);
      else for (let i = 0; i < p[1].length - 1; i++) this.line(view, p[1][i][0], p[1][i][1], p[1][i + 1][0], p[1][i + 1][1], lineType);
    }
  }

  addGView(view: View, name: string, lineType: LineTypeId = 'visible'): GView {
    const g = WPC[name];
    if (!g) throw new Error(`no generated view "${name}"`);
    this.addPrims(view, g.prims, lineType);
    return g;
  }

  /** Id of a circle in `view` centred at a view-local point; for radial dimensions on generated geometry. */
  circleAt(view: View, x: number, y: number, tol = 0.01): string {
    for (const e of this.doc.entities) {
      if (e.viewId !== view.id || e.geom.kind !== 'circle') continue;
      if (Math.hypot(e.geom.c.x - x, e.geom.c.y - y) <= tol) return e.id;
    }
    throw new Error(`no circle at ${x},${y} in view ${view.name}`);
  }

  /** Centre cross of a hole or symmetry mark, in SHEET coordinates around a sheet point. */
  centerCross(view: View, sx: number, sy: number, halfSheet: number): void {
    const lx = (sx - view.origin.x) / view.scale;
    const ly = (sy - view.origin.y) / view.scale;
    const h = halfSheet / view.scale;
    this.line(view, lx - h, ly, lx + h, ly, 'center');
    this.line(view, lx, ly - h, lx, ly + h, 'center');
  }

  /** Centre mark in view-local coordinates. */
  centerMark(view: View, cx: number, cy: number, half: number): void {
    this.line(view, cx - half, cy, cx + half, cy, 'center');
    this.line(view, cx, cy - half, cx, cy + half, 'center');
  }

  // ---------- dimensions ----------

  private anchorAt(view: View, p: Vec2): DimAnchor {
    let best: { c: AnchorCand; d: number } | null = null;
    for (const c of this.anchors.get(view.id) ?? []) {
      const d = Math.hypot(c.p.x - p.x, c.p.y - p.y);
      if (d > 0.006) continue;
      if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && c.point === 'center' && best.c.point !== 'center')) best = { c, d };
    }
    return best ? { ref: { entityId: best.c.entityId, point: best.c.point }, fallback: p } : { ref: null, fallback: p };
  }

  private text(prefix = '', suffix = '', override: string | null = null): DimText {
    return { override, prefix, suffix };
  }

  /** Horizontal linear dimension through local points a and b, dimension line at sheet y `yLine`. */
  dimH(view: View, a: Vec2, b: Vec2, yLine: number, t?: Partial<DimText>): LinearDimension {
    const A = toSheet(view, a);
    const B = toSheet(view, b);
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const off = yLine - mid.y;
    const dim: LinearDimension = {
      kind: 'linear', id: newId('d'), viewId: view.id, layer: '0',
      a: this.anchorAt(view, a), b: this.anchorAt(view, b),
      orientation: 'horizontal', offset: off, text: { ...this.text(), ...t },
    };
    this.doc.dimensions.push(dim);
    return dim;
  }

  /** Vertical linear dimension through local points a and b, dimension line at sheet x `xLine`. */
  dimV(view: View, a: Vec2, b: Vec2, xLine: number, t?: Partial<DimText>): LinearDimension {
    const A = toSheet(view, a);
    const B = toSheet(view, b);
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const off = xLine - mid.x;
    const dim: LinearDimension = {
      kind: 'linear', id: newId('d'), viewId: view.id, layer: '0',
      a: this.anchorAt(view, a), b: this.anchorAt(view, b),
      orientation: 'vertical', offset: off, text: { ...this.text(), ...t },
    };
    this.doc.dimensions.push(dim);
    return dim;
  }

  /** Aligned linear dimension through local points a and b, dimension line at sheet distance `offset`. */
  dimA(view: View, a: Vec2, b: Vec2, offset: number, t?: Partial<DimText>): LinearDimension {
    const dim: LinearDimension = {
      kind: 'linear', id: newId('d'), viewId: view.id, layer: '0',
      a: this.anchorAt(view, a), b: this.anchorAt(view, b),
      orientation: 'aligned', offset, text: { ...this.text(), ...t },
    };
    this.doc.dimensions.push(dim);
    return dim;
  }

  /** Chain of horizontal dimensions through consecutive points, all on the sheet y `yLine`. */
  chainH(view: View, pts: Vec2[], yLine: number): void {
    for (let i = 0; i < pts.length - 1; i++) this.dimH(view, pts[i], pts[i + 1], yLine);
  }

  /** Chain of vertical dimensions through consecutive points, all on the sheet x `xLine`. */
  chainV(view: View, pts: Vec2[], xLine: number): void {
    for (let i = 0; i < pts.length - 1; i++) this.dimV(view, pts[i], pts[i + 1], xLine);
  }

  dimDia(view: View, entityId: string, angle: number, leader: number, t?: Partial<DimText>): RadialDimension {
    const dim: RadialDimension = {
      kind: 'diameter', id: newId('d'), viewId: view.id, layer: '0',
      entityId, angle, leader, text: { ...this.text(), ...t },
    };
    this.doc.dimensions.push(dim);
    return dim;
  }

  dimRad(view: View, entityId: string, angle: number, leader: number, t?: Partial<DimText>): RadialDimension {
    const dim: RadialDimension = {
      kind: 'radius', id: newId('d'), viewId: view.id, layer: '0',
      entityId, angle, leader, text: { ...this.text(), ...t },
    };
    this.doc.dimensions.push(dim);
    return dim;
  }

  // ---------- annotations ----------

  textNote(view: View, x: number, y: number, text: string, h = 2.5, align: 'left' | 'center' | 'right' = 'left', angle = 0, va: 'bottom' | 'middle' | 'top' = 'bottom'): TextNote {
    // `y` is a LOCAL anchor point; `va` shifts by the paper text height, converted to view units.
    const dy = va === 'top' ? -h / view.scale : va === 'middle' ? -h / (2 * view.scale) : 0;
    const t: TextNote = { kind: 'text', id: newId('a'), viewId: view.id, layer: '0', pos: P(x, y + dy), text, height: h, angle, align };
    this.doc.annotations.push(t);
    return t;
  }

  leader(view: View, tip: Vec2, knee: Vec2, text: string, opts: { h?: number; terminator?: 'arrow' | 'dot' | 'none'; style?: 'note' | 'item' } = {}): Leader {
    const l: Leader = {
      kind: 'leader', id: newId('a'), viewId: view.id, layer: '0',
      points: [tip, knee], terminator: opts.terminator ?? 'arrow', style: opts.style ?? 'note',
      text, height: opts.h ?? 3.5,
    };
    this.doc.annotations.push(l);
    return l;
  }

  /** Item number (ISO 6433) on a straight leader ending in a dot, lettered at twice the dimension height. */
  balloon(view: View, tip: Vec2, end: Vec2, n: number): Leader {
    const l: Leader = {
      kind: 'leader', id: newId('a'), viewId: view.id, layer: '0',
      points: [tip, end], terminator: 'dot', style: 'item', text: String(n), height: 7,
    };
    this.doc.annotations.push(l);
    return l;
  }

  /** Hatch one cut region of a generated view (loops from its `hatch` data). */
  hatchGView(view: View, g: GView, angle = 45, spacing = 2): Hatch | null {
    if (!g.hatch) return null;
    const loops = g.hatch.flat().map((wire) => this.wireCurves(wire));
    const h: Hatch = { kind: 'hatch', id: newId('h'), viewId: view.id, layer: '0', loops, angle, spacing };
    this.doc.annotations.push(h);
    return h;
  }

  /** One hatch boundary wire of `hatch` data as a curve chain. */
  wireCurves(wire: GPrim[]): Curve[] {
    const out: Curve[] = [];
    for (const p of wire) {
      if (p[0] === 'L') out.push({ kind: 'line', a: P(p[1], p[2]), b: P(p[3], p[4]) });
      else if (p[0] === 'C') out.push({ kind: 'circle', c: P(p[1], p[2]), r: p[3] });
      else if (p[0] === 'A') out.push({ kind: 'arc', c: P(p[1], p[2]), r: p[3], start: p[4], end: p[5] });
      else for (let i = 0; i < p[1].length - 1; i++) out.push({ kind: 'line', a: P(p[1][i][0], p[1][i][1]), b: P(p[1][i + 1][0], p[1][i + 1][1]) });
    }
    return out;
  }

  surface(view: View, x: number, y: number, opts: { roughness?: string; removal?: SurfaceRemoval; collective?: boolean; angle?: number } = {}): SurfaceSymbol {
    const s: SurfaceSymbol = {
      kind: 'surface', id: newId('a'), viewId: view.id, layer: '0',
      pos: P(x, y), angle: opts.angle ?? 0, removal: opts.removal ?? 'any',
      fields: { roughness: opts.roughness ?? '', second: '', process: '', lay: '', allowance: '' },
      collective: opts.collective ?? false,
    };
    this.doc.annotations.push(s);
    return s;
  }

  /** Cutting-plane line (ISO 128-40): narrow dash line, wide ends, arrows and letters. Sheet coordinates. */
  cutline(view: View, ax: number, ay: number, bx: number, by: number, letter: string, d: Vec2): void {
    const ll = (x: number, y: number): Vec2 => toLocal(view, { x, y });
    const a = ll(ax, ay);
    const b = ll(bx, by);
    this.line(view, a.x, a.y, b.x, b.y, 'center');
    const L = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    for (const [px, py, sx, sy] of [[ax, ay, ux, uy], [bx, by, -ux, -uy]] as const) {
      const e0 = ll(px, py);
      const e1 = ll(px + sx * 7, py + sy * 7);
      this.line(view, e0.x, e0.y, e1.x, e1.y, 'visible');
      const a0 = { x: px + sx * 1, y: py + sy * 1 };
      const tip = { x: a0.x + d.x * 8, y: a0.y + d.y * 8 };
      const lt = ll(tip.x, tip.y);
      const la = ll(a0.x, a0.y);
      this.leader(view, lt, la, '', { terminator: 'arrow' });
      const lp = ll(tip.x + d.x * 2 - sx * 3.5, tip.y + d.y * 2 - sy * 3.5);
      this.textNote(view, lp.x, lp.y, letter, 5, 'center', 0, 'middle');
    }
  }

  /** View arrow (ISO 128-3): arrow with letter showing the viewing direction of a moved view. Sheet coordinates. */
  viewArrow(view: View, tx: number, ty: number, d: Vec2, letter: string): void {
    const a0 = { x: tx - d.x * 12, y: ty - d.y * 12 };
    const la = toLocal(view, a0);
    const lt = toLocal(view, { x: tx, y: ty });
    this.line(view, la.x, la.y, lt.x, lt.y, 'thin');
    this.leader(view, lt, la, '', { terminator: 'arrow' });
    const lp = toLocal(view, { x: a0.x - d.x * 3, y: a0.y - d.y * 3 });
    this.textNote(view, lp.x, lp.y, letter, 5, 'center', 0, 'middle');
  }

  /** Origin marker of a coordinate dimensioning: small circle plus "0/0". */
  originMark(view: View, sx: number, sy: number): void {
    const lx = (sx - view.origin.x) / view.scale;
    const ly = (sy - view.origin.y) / view.scale;
    this.circle(view, lx, ly, 1.2 / view.scale, 'thin');
    this.textNote(view, lx - 2.5 / view.scale, ly - 1 / view.scale, '0/0', 2.5, 'right', 0, 'top');
  }

  /** ISO 7573 style table drawn as drawing geometry: grid from `cols` widths, `rows` top-down, text per cell. */
  table(view: View, x: number, yTop: number, cols: number[], rows: string[][], rh: number, h = 2.5): void {
    const sx = (sheetX: number): number => (sheetX - view.origin.x) / view.scale;
    const sy = (sheetY: number): number => (sheetY - view.origin.y) / view.scale;
    const width = cols.reduce((a, b) => a + b, 0);
    for (let i = 0; i <= rows.length; i++) {
      const y = yTop - i * rh;
      this.line(view, sx(x), sy(y), sx(x + width), sy(y), 'thin');
    }
    let xx = x;
    this.line(view, sx(xx), sy(yTop), sx(xx), sy(yTop - rows.length * rh), 'thin');
    for (const w of cols) {
      xx += w;
      this.line(view, sx(xx), sy(yTop), sx(xx), sy(yTop - rows.length * rh), 'thin');
    }
    for (let i = 0; i < rows.length; i++) {
      let cx = x;
      for (let c = 0; c < rows[i].length; c++) {
        if (rows[i][c]) this.textNote(view, sx(cx + 1.2), sy(yTop - i * rh - rh / 2), rows[i][c], h, 'left', 0, 'middle');
        cx += cols[c];
      }
    }
  }

  /** "Hinweise:" block on the sheet (ISO 3098 heights, 5 mm line step). Sheet coordinates. */
  notes(view: View, x: number, y: number, lines: string[], h = 2.5, head = 'Hinweise:'): void {
    const at = (sx: number, sy: number): Vec2 => toLocal(view, { x: sx, y: sy });
    const h0 = at(x, y);
    this.textNote(view, h0.x, h0.y, head, 3.5);
    lines.forEach((n, i) => {
      const p = at(x, y - 6 - i * (h * 2));
      this.textNote(view, p.x, p.y, n, h);
    });
  }
}
