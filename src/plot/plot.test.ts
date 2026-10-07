import { describe, expect, it } from 'vitest';
import { newSheet } from '../model/doc';
import type { SheetDoc } from '../model/types';
import { fitDash, lineStyle, PARTS_COLUMNS, plotCurve, plotFrame, plotSheet, textWidth, titleBlockFields, viewLabel, type Primitive } from './index';
import { arcBeziers } from './pdf';

const screen = { includeConstruction: true, screenColors: true };
const print = { includeConstruction: false, screenColors: false };

function sheet(patch: Partial<SheetDoc> = {}): SheetDoc {
  return { ...newSheet(), ...patch };
}

const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);

describe('lineStyle', () => {
  it('takes widths from line group 0.5', () => {
    const doc = sheet({ lineGroup: '0.5' });
    expect(lineStyle(doc, 'visible', print).width).toBe(0.5);
    expect(lineStyle(doc, 'thin', print).width).toBe(0.25);
    expect(lineStyle(doc, 'center', print).width).toBe(0.25);
  });

  it('takes widths from line group 0.7', () => {
    const doc = sheet({ lineGroup: '0.7' });
    expect(lineStyle(doc, 'visible', print).width).toBe(0.7);
    expect(lineStyle(doc, 'hidden', print).width).toBe(0.35);
  });

  it('scales ISO 128-2 element lengths by the line width', () => {
    const d = 0.35;
    const doc = sheet({ lineGroup: '0.7' });
    expect(lineStyle(doc, 'visible', print).dash).toEqual([]);
    expect(lineStyle(doc, 'hidden', print).dash).toEqual([12 * d, 3 * d].map((x) => expect.closeTo(x, 9)));
    expect(lineStyle(doc, 'center', print).dash).toEqual([24 * d, 3 * d, 0.5 * d, 3 * d].map((x) => expect.closeTo(x, 9)));
    expect(lineStyle(doc, 'phantom', print).dash).toHaveLength(6);
    expect(lineStyle(sheet({ lineGroup: '0.5' }), 'center', print).dash[0]).toBeCloseTo(6);
  });

  it('is black for print and coloured on screen', () => {
    const doc = sheet();
    for (const t of ['visible', 'thin', 'hidden', 'center', 'phantom'] as const) expect(lineStyle(doc, t, print).color).toBe('#000000');
    expect(lineStyle(doc, 'center', screen).color).not.toBe('#000000');
    expect(lineStyle(doc, 'construction', screen).color).not.toBe(lineStyle(doc, 'thin', screen).color);
  });
});

describe('fitDash', () => {
  const doc = sheet({ lineGroup: '0.5' });
  const center = lineStyle(doc, 'center', print);

  it.each([20, 37.3, 50, 101, 333.3])('length %f mm: whole periods plus a closing long dash', (len) => {
    const s = fitDash(center, len);
    const period = sum(s.dash);
    const n = (len - s.dash[0]) / period;
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(s.dashOffset).toBe(0);
    // Only a slight stretch for longer lines.
    if (len > 50) expect(Math.abs(s.dash[0] / center.dash[0] - 1)).toBeLessThan(0.2);
    // Proportions are kept.
    expect(s.dash[1] / s.dash[0]).toBeCloseTo(center.dash[1] / center.dash[0]);
  });

  it('makes very short curves continuous', () => {
    expect(fitDash(center, 5).dash).toEqual([]);
    expect(fitDash(lineStyle(doc, 'hidden', print), 2).dash).toEqual([]);
  });

  it('leaves continuous lines alone', () => {
    const vis = lineStyle(doc, 'visible', print);
    expect(fitDash(vis, 100)).toEqual(vis);
  });
});

describe('plotCurve', () => {
  const doc = sheet({
    views: [
      { id: 'v1', name: 'Front view', scale: 1, origin: { x: 100, y: 100 }, link: null },
      { id: 'v2', name: 'Z', scale: 2, origin: { x: 300, y: 150 }, link: null },
    ],
  });

  it('maps a line at 2:1 to sheet mm', () => {
    const [p] = plotCurve(doc, 'v2', { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 5 } }, 'visible', print);
    expect(p).toMatchObject({ kind: 'polyline', points: [{ x: 300, y: 150 }, { x: 320, y: 160 }], closed: false });
  });

  it('scales arc radius and fits the dash to the paper length', () => {
    const [p] = plotCurve(doc, 'v2', { kind: 'arc', c: { x: 5, y: 0 }, r: 20, start: 0, end: Math.PI }, 'center', print);
    if (p.kind !== 'arc') throw new Error('expected arc');
    expect(p.c).toEqual({ x: 310, y: 150 });
    expect(p.r).toBe(40);
    const len = Math.PI * 40;
    const n = (len - p.style.dash[0]) / sum(p.style.dash);
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
  });

  it('fits closed circles to whole periods', () => {
    const [p] = plotCurve(doc, 'v2', { kind: 'circle', c: { x: 0, y: 0 }, r: 10 }, 'hidden', print);
    if (p.kind !== 'arc') throw new Error('expected arc');
    expect(p.end - p.start).toBeCloseTo(2 * Math.PI);
    const n = (2 * Math.PI * 20) / sum(p.style.dash);
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
  });

  it('skips construction lines unless included', () => {
    const c = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } } as const;
    expect(plotCurve(doc, 'v1', c, 'construction', print)).toEqual([]);
    expect(plotCurve(doc, 'v1', c, 'construction', screen)).toHaveLength(1);
  });
});

function rect(prims: Primitive[], tag: string): { x0: number; y0: number; x1: number; y1: number; width: number } {
  const p = prims.find((q) => q.tag === tag && q.kind === 'polyline' && q.closed);
  if (!p || p.kind !== 'polyline') throw new Error(`no ${tag}`);
  const xs = p.points.map((q) => q.x);
  const ys = p.points.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), width: p.style.width };
}

describe('plotFrame', () => {
  it('A4 portrait: 20 mm filing margin, 10 mm elsewhere, 180 mm title block', () => {
    const doc = sheet({ format: 'A4', orientation: 'portrait' });
    const prims = plotFrame(doc, print);
    expect(rect(prims, 'sheet-edge')).toMatchObject({ x0: 0, y0: 0, x1: 210, y1: 297 });
    expect(rect(prims, 'frame')).toEqual({ x0: 20, y0: 10, x1: 200, y1: 287, width: 0.7 });
    const fields = titleBlockFields(doc);
    expect(Math.min(...fields.map((f) => f.x))).toBe(20);
    expect(Math.max(...fields.map((f) => f.x + f.w))).toBe(200);
    expect(Math.min(...fields.map((f) => f.y))).toBe(10);
  });

  it('A3 landscape: frame and title block in the bottom-right corner', () => {
    const doc = sheet({ format: 'A3', orientation: 'landscape' });
    const prims = plotFrame(doc, print);
    expect(rect(prims, 'frame')).toEqual({ x0: 20, y0: 10, x1: 410, y1: 287, width: 0.7 });
    const fields = titleBlockFields(doc);
    expect(Math.min(...fields.map((f) => f.x))).toBe(230);
    expect(Math.max(...fields.map((f) => f.x + f.w))).toBe(410);
  });

  it('has four centring marks 0.7 mm wide on the sheet axes', () => {
    const doc = sheet({ format: 'A3', orientation: 'landscape' });
    const marks = plotFrame(doc, print).filter((p) => p.kind === 'polyline' && p.tag === 'frame' && !p.closed);
    expect(marks).toHaveLength(4);
    for (const m of marks) if (m.kind === 'polyline') expect(m.style.width).toBe(0.7);
    const left = marks.find((m) => m.kind === 'polyline' && m.points[0].x === 0);
    expect(left).toMatchObject({ points: [{ x: 0, y: 148.5 }, { x: 25, y: 148.5 }] });
  });

  it('fills the scale from the main view when empty, and shows the entered values', () => {
    const doc = sheet({ titleBlock: { title: 'Lagerbock', drawingNumber: 'MC-001', material: 'S235JR' } });
    doc.views[0].scale = 0.5;
    const texts = plotFrame(doc, print).flatMap((p) => (p.kind === 'text' ? [p.text] : []));
    expect(texts).toEqual(expect.arrayContaining(['1:2', 'Lagerbock', 'MC-001', 'S235JR', 'Maßstab', 'Werkstoff']));
  });

  it('shrinks long values to fit their field', () => {
    const doc = sheet({ titleBlock: { title: 'Sehr lange Benennung eines Bauteils mit Zusatz' } });
    const t = plotFrame(doc, print).find((p) => p.kind === 'text' && p.tag === 'titleblock:title');
    expect(t && t.kind === 'text' && t.height).toBeLessThan(7);
  });
});

describe('parts list (ISO 7573)', () => {
  const row = (item: string, name: string, material = '') => ({ item, quantity: '1', name, standard: '', material, stock: '', remark: '' });
  const za38 = () =>
    sheet({ format: 'A4', orientation: 'portrait', partsList: [row('1', 'Welle', 'S235JR'), row('2', 'Gabel', 'S235JR')] });

  it('draws nothing when the list is empty', () => {
    expect(plotFrame(sheet(), print).some((p) => p.tag?.startsWith('partslist'))).toBe(false);
  });

  it('columns span exactly the title block width', () => {
    expect(PARTS_COLUMNS.reduce((s, c) => s + c.w, 0)).toBe(180);
  });

  it('has a wide outline and header separator and thin inner rulings', () => {
    const lines = plotFrame(za38(), print).filter((p): p is Extract<Primitive, { kind: 'polyline' }> => p.kind === 'polyline' && p.tag === 'partslist');
    const wide = lines.filter((l) => l.style.width === 0.7);
    const thin = lines.filter((l) => l.style.width === 0.25);
    // outline (left + top as one polyline) ending at the list top y = 58 + 8 + 2 * 7 = 80
    expect(wide.some((l) => l.points.length === 3 && l.points[1].y === 80 && l.points[2].x === 200)).toBe(true);
    expect(wide.some((l) => l.points.every((q) => q.y === 66))).toBe(true);
    // one row ruling between the two rows + six column rulings
    expect(thin.filter((l) => l.points[0].y === l.points[1].y)).toHaveLength(1);
    expect(thin.filter((l) => l.points[0].x === l.points[1].x)).toHaveLength(6);
  });

  it('shows German captions and the row values in their cells, fitted to the column', () => {
    const prims = plotFrame(za38(), print);
    const texts = prims.filter((p): p is Extract<Primitive, { kind: 'text' }> => p.kind === 'text');
    expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Pos.', 'Menge', 'Benennung', 'Werkstoff', 'Rohmaße', 'Bemerkung', 'Welle', 'Gabel', 'S235JR']));
    const gabel = texts.find((t) => t.tag === 'partslist:1:name')!;
    expect(gabel.pos.y).toBeCloseTo(73 + 3.5);
    for (const c of PARTS_COLUMNS) {
      for (const cap of c.caption) {
        const t = texts.find((x) => x.text === cap)!;
        expect(textWidth(cap, t.height)).toBeLessThanOrEqual(c.w - 2);
      }
    }
  });
});

describe('view labels', () => {
  const doc = sheet({
    views: [
      { id: 'v1', name: 'Front view', scale: 2, origin: { x: 100, y: 100 }, link: null },
      { id: 'v2', name: 'A-A', scale: 2, origin: { x: 250, y: 100 }, link: null },
      { id: 'v3', name: 'Z', scale: 5, origin: { x: 300, y: 200 }, link: null },
      { id: 'v4', name: 'Y', scale: 0.5, origin: { x: 300, y: 200 }, link: null },
    ],
  });

  it('labels per ISO 128-3', () => {
    expect(viewLabel(doc, doc.views[0])).toBeNull();
    expect(viewLabel(doc, doc.views[1])).toBe('A-A');
    expect(viewLabel(doc, doc.views[2])).toBe('Z (5:1)');
    expect(viewLabel(doc, doc.views[3])).toBe('Y (1:2)');
  });

  it('places the label above the view geometry', () => {
    doc.entities = [{ id: 'e1', viewId: 'v3', layer: '0', lineType: 'visible', geom: { kind: 'circle', c: { x: 0, y: 0 }, r: 4 } }];
    const label = plotSheet(doc, print).find((p) => p.tag === 'label:v3');
    expect(label).toMatchObject({ kind: 'text', text: 'Z (5:1)', align: 'center' });
    if (label?.kind === 'text') expect(label.pos.y).toBeGreaterThan(220);
  });

  it('clears dimensions above the view, and can be switched off', () => {
    doc.entities = [{ id: 'e1', viewId: 'v2', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } } }];
    doc.dimensions = [{
      kind: 'linear', id: 'd1', viewId: 'v2', layer: '0', orientation: 'horizontal', offset: 30,
      a: { ref: null, fallback: { x: 0, y: 0 } }, b: { ref: null, fallback: { x: 20, y: 0 } }, text: { override: null, prefix: '', suffix: '' },
    }];
    const label = plotSheet(doc, print).find((p) => p.tag === 'label:v2');
    const dimText = plotSheet(doc, print).find((p) => p.tag === 'dim:d1' && p.kind === 'text');
    if (label?.kind !== 'text' || dimText?.kind !== 'text') throw new Error('missing text');
    expect(label.pos.y).toBeGreaterThan(dimText.pos.y + dimText.height);
    doc.views[1].label = false;
    expect(viewLabel(doc, doc.views[1])).toBeNull();
    doc.views[1].label = undefined;
    doc.dimensions = [];
  });
});

describe('plotSheet', () => {
  it('skips hidden layers and construction lines when printing', () => {
    const doc = sheet();
    doc.layers.push({ name: 'off', visible: false });
    const line = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } } as const;
    doc.entities = [
      { id: 'a', viewId: 'v-front', layer: '0', lineType: 'visible', geom: line },
      { id: 'b', viewId: 'v-front', layer: 'off', lineType: 'visible', geom: line },
      { id: 'c', viewId: 'v-front', layer: '0', lineType: 'construction', geom: line },
    ];
    const tags = (opts: typeof print): string[] => plotSheet(doc, opts).flatMap((p) => (p.tag?.startsWith('entity:') ? [p.tag] : []));
    expect(tags(print)).toEqual(['entity:a']);
    expect(tags(screen)).toEqual(['entity:a', 'entity:c']);
  });
});

describe('arcBeziers', () => {
  it('approximates a quarter circle within 0.03 % of r', () => {
    const [[p0, c1, c2, p3]] = arcBeziers({ x: 0, y: 0 }, 10, 0, Math.PI / 2);
    expect(p0.x).toBeCloseTo(10);
    expect(p3.y).toBeCloseTo(10);
    const mid = { x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8, y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8 };
    expect(Math.abs(Math.hypot(mid.x, mid.y) - 10)).toBeLessThan(0.003);
  });

  it('splits a full circle into four segments', () => {
    expect(arcBeziers({ x: 0, y: 0 }, 1, 0, 2 * Math.PI)).toHaveLength(4);
  });
});

describe('exportPdf', () => {
  it('writes a page at the exact paper size in mm', async () => {
    const { exportPdf } = await import('./index');
    const doc = sheet({ format: 'A4', orientation: 'portrait', titleBlock: { title: 'Welle' } });
    doc.entities = [{ id: 'e', viewId: 'v-front', layer: '0', lineType: 'center', geom: { kind: 'arc', c: { x: 0, y: 0 }, r: 20, start: 0, end: 2 } }];
    const blob = await exportPdf(doc);
    const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(text.startsWith('%PDF-')).toBe(true);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(Number(box?.[1]) / (72 / 25.4)).toBeCloseTo(210, 1);
    expect(Number(box?.[2]) / (72 / 25.4)).toBeCloseTo(297, 1);
  });
});

describe('plotSheet dimensions and linked views', () => {
  function docWithDim(): SheetDoc {
    const doc = sheet();
    doc.entities = [{ id: 'e1', viewId: 'v-front', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } } }];
    doc.dimensions = [{
      kind: 'linear', id: 'd1', viewId: 'v-front', layer: '0',
      a: { ref: { entityId: 'e1', point: 'start' }, fallback: { x: 0, y: 0 } },
      b: { ref: { entityId: 'e1', point: 'end' }, fallback: { x: 40, y: 0 } },
      orientation: 'horizontal', offset: -10, text: { override: null, prefix: '', suffix: '' },
    }];
    return doc;
  }

  it("tags dimension primitives 'dim:<id>' and colours them thin on screen, black in print", () => {
    const doc = docWithDim();
    const color = (p: Primitive): string => (p.kind === 'polyline' || p.kind === 'arc' ? p.style.color : p.color);
    const onScreen = plotSheet(doc, screen).filter((p) => p.tag === 'dim:d1');
    expect(onScreen.length).toBeGreaterThan(2);
    expect(onScreen.every((p) => color(p) === lineStyle(doc, 'thin', screen).color)).toBe(true);
    const printed = plotSheet(doc, print).filter((p) => p.tag === 'dim:d1');
    expect(printed.every((p) => color(p) === '#000000')).toBe(true);
    expect(plotSheet(doc, print).some((p) => p.tag === 'd1')).toBe(false);
  });

  it('gives views with a projection link no label', () => {
    const doc = sheet();
    doc.views.push(
      { id: 'side', name: 'Side view', scale: 1, origin: { x: 250, y: 160 }, link: { parentId: 'v-front', freeAxis: 'x' } },
      { id: 'det', name: 'Z', scale: 5, origin: { x: 300, y: 80 }, link: null },
    );
    expect(viewLabel(doc, doc.views[1])).toBeNull();
    expect(viewLabel(doc, doc.views[2])).toBe('Z (5:1)');
    expect(plotSheet(doc, print).some((p) => p.tag === 'label:side')).toBe(false);
  });
});
