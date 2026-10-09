// DXF entities (raw tag lists) to the reader-independent `RawEntity` form.
import type { Vec2 } from '../../geom/types';
import type { HAlign, RawDrawing, RawEntity, RawHatchLine, RawLayout, RawLoopEdge, RawStyle, RawVertex, VAlign } from '../raw';
import { unitsToMm } from '../raw';
import { headerNum, readDxf, type DxfEntity, type DxfFile } from './read';
import type { Tags } from './tags';

const DEG = Math.PI / 180;

/** Parse an ASCII DXF text into a RawDrawing. */
export function dxfToRaw(text: string): RawDrawing {
  const file = readDxf(text);
  const layers = new Map<string, RawDrawing['layers'] extends Map<string, infer L> ? L : never>();
  for (const l of file.layers.values()) layers.set(l.name, { name: l.name, color: Math.abs(l.color), linetype: l.linetype, lineweight: l.lineweight, frozen: l.frozen, off: l.color < 0 });
  const linetypes = new Map<string, number[]>();
  for (const lt of file.linetypes.values()) linetypes.set(lt.name, lt.pattern);
  const blocks = new Map<string, { name: string; base: Vec2; entities: RawEntity[] }>();
  for (const b of file.blocks.values()) blocks.set(b.name, { name: b.name, base: b.base, entities: b.entities.map(convert).filter((e): e is RawEntity => e !== null) });
  const layouts: RawLayout[] = file.layouts.map((l) => {
    const k = l.paperUnits === 0 ? 25.4 : 1;
    return { name: l.name, blockName: l.blockName, paperWidth: l.paperWidth * k, paperHeight: l.paperHeight * k, marginLeft: l.marginLeft * k, marginBottom: l.marginBottom * k, rotation: l.rotation };
  });
  const unitFactor = unitsToMm(headerNum(file, '$INSUNITS', 70, 0));
  return { version: file.version, unitFactor, layers, linetypes, blocks, layouts, entities: file.entities.map(convert).filter((e): e is RawEntity => e !== null) };
}

export { readDxf, type DxfFile };

function style(t: Tags): RawStyle {
  return { layer: t.str(8, '0'), color: t.num(62, 256), linetype: t.str(6, 'BYLAYER'), lineweight: t.num(370, -1), paperSpace: t.num(67) === 1, handle: t.str(5) };
}

function halign(code: number): HAlign {
  // 72: 0 left, 1 centre, 2 right, 3 aligned, 4 middle, 5 fit
  return code === 1 || code === 4 ? 'center' : code === 2 ? 'right' : 'left';
}

function valign(code: number, h72: number): VAlign {
  // 73: 0 baseline, 1 bottom, 2 middle, 3 top; 72 = 4 (middle) implies middle
  if (h72 === 4) return 'middle';
  return code === 1 ? 'bottom' : code === 2 ? 'middle' : code === 3 ? 'top' : 'baseline';
}

function textEntity(e: DxfEntity, tag: string | null): RawEntity {
  const t = e.tags;
  const h72 = t.num(72);
  const h73 = t.num(73, tag === null ? 0 : t.num(74));
  const aligned = h72 !== 0 || h73 !== 0;
  // alignment point (11) is the anchor unless the text is left/baseline aligned
  const pos = aligned && t.has(11) ? t.point(11) : t.point(10);
  return { ...style(t), kind: 'text', pos, text: t.str(1), height: t.num(40, 2.5), angle: t.num(50) * DEG, halign: halign(h72), valign: valign(h73, h72), tag };
}

function polylineVertices(e: DxfEntity): { vertices: RawVertex[]; closed: boolean } {
  const t = e.tags;
  if (e.type === 'LWPOLYLINE') {
    // 10/20 pairs each optionally followed by 42 (bulge) before the next 10
    const vertices: RawVertex[] = [];
    const tags = t.tags;
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].code !== 10) continue;
      let y = 0;
      let bulge = 0;
      for (let j = i + 1; j < tags.length && tags[j].code !== 10; j++) {
        if (tags[j].code === 20) y = Number(tags[j].value);
        else if (tags[j].code === 42) bulge = Number(tags[j].value);
      }
      vertices.push({ p: { x: Number(tags[i].value), y }, bulge });
    }
    return { vertices, closed: (t.num(70) & 1) !== 0 };
  }
  const vertices = e.children.filter((c) => c.type === 'VERTEX' && (c.tags.num(70) & 16) === 0 && (c.tags.num(70) & 8) === 0).map((c) => ({ p: c.tags.point(10), bulge: c.tags.num(42) }));
  return { vertices, closed: (t.num(70) & 1) !== 0 };
}

function hatchEntity(e: DxfEntity): RawEntity {
  const t = e.tags;
  const tags = t.tags;
  const loops: RawLoopEdge[][] = [];
  const lines: RawHatchLine[] = [];
  const nLoops = t.num(91);
  let i = tags.findIndex((x) => x.code === 91) + 1;
  const num = (code: number): number => {
    while (i < tags.length && tags[i].code !== code) i++;
    const v = i < tags.length ? Number(tags[i].value) : 0;
    i++;
    return v;
  };
  const pt = (code = 10): Vec2 => {
    const x = num(code);
    const y = num(code + 10);
    return { x, y };
  };
  for (let l = 0; l < nLoops && i < tags.length; l++) {
    const flags = num(92);
    const edges: RawLoopEdge[] = [];
    if (flags & 2) {
      const hasBulge = num(72) !== 0;
      const closed = num(73) !== 0;
      const n = num(93);
      const vertices: RawVertex[] = [];
      for (let k = 0; k < n; k++) {
        const p = pt(10);
        const bulge = hasBulge ? num(42) : 0;
        vertices.push({ p, bulge });
      }
      edges.push({ kind: 'polyline', vertices, closed });
    } else {
      const n = num(93);
      for (let k = 0; k < n; k++) {
        const type = num(72);
        if (type === 1) edges.push({ kind: 'line', a: pt(10), b: pt(11) });
        else if (type === 2) {
          const c = pt(10);
          const r = num(40);
          const start = num(50) * DEG;
          const end = num(51) * DEG;
          const ccw = num(73) !== 0;
          edges.push({ kind: 'arc', c, r, start, end, ccw });
        } else if (type === 3) {
          const c = pt(10);
          const major = pt(11);
          const ratio = num(40);
          const start = num(50) * DEG;
          const end = num(51) * DEG;
          const ccw = num(73) !== 0;
          edges.push({ kind: 'ellipse', c, major, ratio, start, end, ccw });
        } else if (type === 4) {
          const degree = num(94);
          num(73); // rational
          num(74); // periodic
          const nk = num(95);
          const nc = num(96);
          const knots: number[] = [];
          for (let q = 0; q < nk; q++) knots.push(num(40));
          const control: Vec2[] = [];
          const weights: number[] = [];
          for (let q = 0; q < nc; q++) {
            control.push(pt(10));
            // optional weight 42 directly after the point
            if (tags[i]?.code === 42) weights.push(Number(tags[i++].value));
          }
          const fit: Vec2[] = [];
          if (tags[i]?.code === 97) {
            const nf = num(97);
            for (let q = 0; q < nf; q++) fit.push(pt(11));
          }
          edges.push({ kind: 'spline', degree, knots, control, weights, fit });
        }
      }
    }
    // source boundary objects: 97 count + 330 handles
    if (tags[i]?.code === 97) {
      const n = num(97);
      for (let q = 0; q < n; q++) num(330);
    }
    loops.push(edges);
  }
  // pattern definition lines after the loops: 78 count, then per line 53 43 44 45 46 79 (+49 dashes)
  const n78 = tags.findIndex((x, idx) => idx >= i && x.code === 78);
  if (n78 >= 0) {
    i = n78;
    const n = num(78);
    for (let k = 0; k < n; k++) {
      const angle = num(53);
      const base = { x: num(43), y: num(44) };
      const offset = { x: num(45), y: num(46) };
      const nd = num(79);
      for (let q = 0; q < nd; q++) num(49);
      lines.push({ angle, base, offset });
    }
  }
  return { ...style(t), kind: 'hatch', loops, solid: t.num(70) === 1, pattern: t.str(2), angle: t.num(52), scale: t.num(41, 1), lines };
}

function dimensionEntity(e: DxfEntity): RawEntity {
  const t = e.tags;
  const flags = t.num(70);
  const kinds = ['linear', 'aligned', 'angular', 'diameter', 'radius', 'angular3', 'ordinate'] as const;
  const dimType = kinds[flags & 7] ?? 'linear';
  return {
    ...style(t),
    kind: 'dimension',
    dimType,
    defPoint: t.point(10),
    textMid: t.has(11) ? t.point(11) : null,
    p13: t.point(13),
    p14: t.point(14),
    p15: t.point(15),
    p16: t.point(16),
    rotation: t.num(50) * DEG,
    text: t.str(1),
    userText: (flags & 128) !== 0,
  };
}

function mleaderEntity(e: DxfEntity): RawEntity {
  // MULTILEADER: vertices of each leader line sit between "LEADER_LINE{" and "}" markers (code 302/304),
  // the text in 304 after "}" of the context, the text location in 12/22, the landing in 10/20 of the leader.
  const tags = e.tags.tags;
  const lines: Vec2[][] = [];
  let cur: Vec2[] | null = null;
  let depth: string[] = [];
  let text = '';
  let textPos: Vec2 | null = null;
  let landing: Vec2 | null = null;
  let textHeight = 0;
  for (let i = 0; i < tags.length; i++) {
    const tg = tags[i];
    if ((tg.code === 300 || tg.code === 302 || tg.code === 303 || tg.code === 304) && tg.value.endsWith('{')) {
      depth.push(tg.value);
      if (tg.value === 'LEADER_LINE{') {
        cur = [];
        lines.push(cur);
      }
      continue;
    }
    if ((tg.code === 300 || tg.code === 301 || tg.code === 303 || tg.code === 305 || tg.code === 302 || tg.code === 304) && tg.value === '}') {
      const top = depth.pop();
      if (top === 'LEADER_LINE{') cur = null;
      continue;
    }
    const top = depth[depth.length - 1];
    if (cur && tg.code === 10 && tags[i + 1]?.code === 20) cur.push({ x: Number(tg.value), y: Number(tags[i + 1].value) });
    else if (top === 'LEADER{' && tg.code === 10 && tags[i + 1]?.code === 20) landing = { x: Number(tg.value), y: Number(tags[i + 1].value) };
    else if (top === 'CONTEXT_DATA{' && tg.code === 304) text = tg.value;
    else if (top === 'CONTEXT_DATA{' && tg.code === 12 && tags[i + 1]?.code === 22) textPos = { x: Number(tg.value), y: Number(tags[i + 1].value) };
    else if (top === 'CONTEXT_DATA{' && tg.code === 41 && textHeight === 0) textHeight = Number(tg.value);
  }
  return { ...style(e.tags), kind: 'mleader', lines, text, textPos, textHeight, arrow: true, landing };
}

/** One DXF entity to its raw form; null for entities that carry no drawing content (POINT, SEQEND, …). */
export function convert(e: DxfEntity): RawEntity | null {
  const t = e.tags;
  switch (e.type) {
    case 'LINE':
      return { ...style(t), kind: 'line', a: t.point(10), b: t.point(11) };
    case 'CIRCLE':
      return { ...style(t), kind: 'circle', c: t.point(10), r: t.num(40) };
    case 'ARC':
      return { ...style(t), kind: 'arc', c: t.point(10), r: t.num(40), start: t.num(50) * DEG, end: t.num(51) * DEG };
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (e.type === 'POLYLINE' && (t.num(70) & (8 | 16 | 32 | 64)) !== 0) return { ...style(t), kind: 'unsupported', type: '3D POLYLINE' };
      return { ...style(t), kind: 'polyline', ...polylineVertices(e) };
    }
    case 'TEXT':
      return textEntity(e, null);
    case 'ATTDEF':
    case 'ATTRIB': {
      const r = textEntity(e, t.str(2));
      // invisible attributes (70 & 1) are not drawn
      return (t.num(70) & 1) !== 0 ? null : r;
    }
    case 'MTEXT':
      return { ...style(t), kind: 'mtext', pos: t.point(10), text: t.all(3).join('') + t.str(1), height: t.num(40, 2.5), angle: mtextAngle(t), attachment: t.num(71, 1), width: t.num(41) };
    case 'INSERT':
      return {
        ...style(t),
        kind: 'insert',
        name: t.str(2),
        pos: t.point(10),
        scale: { x: t.num(41, 1), y: t.num(42, 1) },
        rotation: t.num(50) * DEG,
        attribs: e.children.map(convert).filter((a): a is RawEntity => a !== null),
      };
    case 'HATCH':
      return hatchEntity(e);
    case 'DIMENSION':
      return dimensionEntity(e);
    case 'LEADER': {
      const points = t.points(10);
      return { ...style(t), kind: 'leader', points, arrow: t.num(71, 1) !== 0, annotation: t.first(340) ?? null };
    }
    case 'MULTILEADER':
    case 'MLEADER':
      return mleaderEntity(e);
    case 'SPLINE':
      return { ...style(t), kind: 'spline', degree: t.num(71, 3), knots: t.nums(40), control: t.points(10), weights: t.nums(41), fit: t.points(11) };
    case 'ELLIPSE':
      return { ...style(t), kind: 'ellipse', c: t.point(10), major: t.point(11), ratio: t.num(40, 1), start: t.num(41), end: t.num(42, 2 * Math.PI) };
    case 'VIEWPORT':
      return {
        ...style(t),
        kind: 'viewport',
        center: t.point(10),
        width: t.num(40),
        height: t.num(41),
        viewCenter: t.point(12),
        viewHeight: t.num(45),
        id: t.num(69),
        on: t.num(68, 1) > 0,
      };
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const p = [t.point(10), t.point(11), t.point(12)];
      if (t.has(13)) p.push(t.point(13));
      return { ...style(t), kind: 'solid', points: p };
    }
    case 'XLINE':
    case 'RAY':
      return { ...style(t), kind: 'xline', p: t.point(10), dir: t.point(11), ray: e.type === 'RAY' };
    case 'POINT':
    case 'SEQEND':
    case 'ENDBLK':
      return null;
    default:
      return { ...style(t), kind: 'unsupported', type: e.type };
  }
}

function mtextAngle(t: Tags): number {
  if (t.has(11)) {
    const d = t.point(11);
    if (d.x !== 0 || d.y !== 0) return Math.atan2(d.y, d.x);
  }
  return t.num(50) * DEG;
}
