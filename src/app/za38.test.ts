// End-to-end: the ZA 38 exercise drawn through the command line (src/app/testcases/za38.ts), then checked.
import { describe, expect, it } from 'vitest';
import { dimensionText, measure, plotDimension } from '../dim';
import type { Primitive } from '../dim/types';
import type { Vec2 } from '../geom/types';
import type { Hatch, Leader, LinearDimension } from '../model/types';
import { frameGeometry, hatchSheetSegments, plotSheet, sheetToSvg, textWidth } from '../plot';
import { drawZA38 } from './testcases/za38';

describe('ZA 38 end to end', () => {
  const { doc, log } = drawZA38();

  it('runs every command without errors', () => {
    expect(log.filter((l) => /error|unknown|invalid|no closed boundary|requires/i.test(l))).toEqual([]);
  });

  it('dimensions read as in the book', () => {
    const texts = doc.dimensions.map((d) => dimensionText(doc, d));
    for (const t of ['40', '52', '136', '28', '60', '66', '⌀28', '⌀35', '⌀50', '⌀30', '⌀24', '⌀15', '35', '62', '115', '15', '25', '30°', '17', '30', '14', '22', '⌀14']) {
      expect(texts).toContain(t);
    }
    const angular = doc.dimensions.find((d) => d.kind === 'angular')!;
    expect(measure(doc, angular)).toBeCloseTo(30, 6);
  });

  it('slides the ⌀ values off the centreline they cross, alternating above and below it', () => {
    const v1 = doc.views[0];
    const diameters = doc.dimensions.filter((d): d is LinearDimension => d.kind === 'linear' && d.viewId === v1.id && d.text.prefix === '⌀');
    expect(diameters).toHaveLength(6);
    expect(diameters.filter((d) => (d.textShift ?? 0) < 0)).toHaveLength(3);
    expect(diameters.filter((d) => (d.textShift ?? 0) > 0)).toHaveLength(3);
    for (const d of diameters) {
      const [t] = plotDimension(doc, d).filter((p) => p.kind === 'text');
      expect(t.kind).toBe('text');
      if (t.kind === 'text') expect(Math.abs(t.pos.y - v1.origin.y)).toBeGreaterThan(1); // not on the axis
    }
  });

  it('hatches the five cut regions at 45°, inside the sheet frame, with the bores left free', () => {
    const hatches = doc.annotations.filter((a): a is Hatch => a.kind === 'hatch');
    expect(hatches).toHaveLength(5);
    expect(hatches.every((h) => h.angle === 45)).toBe(true);
    const { frame } = frameGeometry(doc);
    for (const h of hatches) {
      const segs = hatchSheetSegments(doc, h);
      expect(segs.length).toBeGreaterThan(2);
      for (const [a, b] of segs) {
        for (const p of [a, b]) {
          expect(p.x).toBeGreaterThan(frame.x0);
          expect(p.x).toBeLessThan(frame.x1);
          expect(p.y).toBeGreaterThan(frame.y0);
          expect(p.y).toBeLessThan(frame.y1);
        }
      }
    }
    // no hatch line crosses the blind bore of part 1 (|y| < 6.5 for 0 < x < 28, view-local)
    const v1 = doc.views[0];
    const bore = (p: { x: number; y: number }) => {
      const l = { x: (p.x - v1.origin.x) / v1.scale, y: (p.y - v1.origin.y) / v1.scale };
      return l.x > 0.5 && l.x < 27.5 && Math.abs(l.y) < 6;
    };
    for (const h of hatches.filter((x) => x.viewId === v1.id)) {
      for (const [a, b] of hatchSheetSegments(doc, h)) {
        expect(bore({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(false);
      }
    }
  });

  it('plots the full sheet: frame, title block, parts list, views, annotations', () => {
    const prims = plotSheet(doc, { includeConstruction: false, screenColors: false });
    const texts = prims.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['Welle', 'Gabelhebel', 'ZA 38', '1', '2']));
    // the cut notes of the Vorlage, each on a leader with an arrowhead on the cut surface
    const notes = ['Senkung ⌀20 x 17 tief', 'Bohrung ⌀13 x 28 tief', 'Ausdrehung auf ⌀42 x 10 tief', 'Senkung ⌀20 x 8 tief', 'Einfräsung 4 tief'];
    expect(texts).toEqual(expect.arrayContaining(notes));
    const leaders = doc.annotations.filter((a): a is Leader => a.kind === 'leader');
    expect(leaders.map((l) => l.text).sort()).toEqual([...notes].sort());
    expect(leaders.every((l) => l.terminator === 'arrow' && l.points.length >= 2)).toBe(true);
    expect(doc.entities.some((e) => e.lineType === 'freehand')).toBe(true);
    const { sheet } = frameGeometry(doc);
    for (const p of prims) {
      if (p.kind === 'polyline') for (const q of p.points) expect(q.x >= -1e-6 && q.x <= sheet.w + 1e-6 && q.y >= -1e-6 && q.y <= sheet.h + 1e-6).toBe(true);
    }
    const svg = sheetToSvg(doc, prims);
    expect(svg).toMatch(/^<svg [^>]*width="210mm" height="297mm"/);
    expect(svg).toContain('>Gabelhebel</text>');
  });

  it('keeps every value and note readable: inside the frame, no line, arc or other text through it', () => {
    // Text boxes in the text's own frame (rotated values too), from the plot's width estimate, shrunk by
    // 0.3 mm so a value standing a text gap off its own dimension line does not count as touching it.
    const prims = plotSheet(doc, { includeConstruction: false, screenColors: false });
    const isSheetText = (p: Primitive): p is Extract<Primitive, { kind: 'text' }> =>
      p.kind === 'text' && !/^(frame|titleblock|partslist)/.test(p.tag ?? '');
    const boxes = prims.filter(isSheetText).map((p) => {
      const w = textWidth(p.text, p.height);
      const u0 = p.align === 'left' ? 0 : p.align === 'right' ? -w : -w / 2;
      const v0 = p.baseline === 'bottom' ? 0 : p.baseline === 'top' ? -p.height : -p.height / 2;
      return { p, u0, u1: u0 + w, v0, v1: v0 + p.height, c: Math.cos(p.angle), s: Math.sin(p.angle) };
    });
    type Box = (typeof boxes)[number];
    const inside = (b: Box, q: Vec2, m = 0.3) => {
      const dx = q.x - b.p.pos.x, dy = q.y - b.p.pos.y;
      const u = dx * b.c + dy * b.s, v = -dx * b.s + dy * b.c;
      return u > b.u0 + m && u < b.u1 - m && v > b.v0 + m && v < b.v1 - m;
    };
    const corners = (b: Box): Vec2[] => [[b.u0, b.v0], [b.u1, b.v0], [b.u1, b.v1], [b.u0, b.v1]].map(([u, v]) => ({ x: b.p.pos.x + u * b.c - v * b.s, y: b.p.pos.y + u * b.s + v * b.c }));
    const { frame } = frameGeometry(doc);
    const problems: string[] = [];
    for (const b of boxes) {
      if (corners(b).some((q) => q.x < frame.x0 || q.x > frame.x1 || q.y < frame.y0 || q.y > frame.y1)) problems.push(`"${b.p.text}" leaves the frame`);
      for (const o of boxes) if (o !== b && corners(o).some((q) => inside(b, q, 0.2))) problems.push(`"${o.p.text}" overlaps "${b.p.text}"`);
    }
    const samples = (p: Primitive): Vec2[] => {
      const out: Vec2[] = [];
      if (p.kind === 'polyline') {
        for (let k = 0; k + 1 < p.points.length; k++) {
          const a = p.points[k], z = p.points[k + 1];
          const n = Math.max(2, Math.ceil(Math.hypot(z.x - a.x, z.y - a.y) / 0.1));
          for (let i = 0; i <= n; i++) out.push({ x: a.x + ((z.x - a.x) * i) / n, y: a.y + ((z.y - a.y) * i) / n });
        }
      } else if (p.kind === 'arc') {
        let end = p.end;
        while (end < p.start) end += 2 * Math.PI;
        const n = Math.max(8, Math.ceil(((end - p.start) * p.r) / 0.1));
        for (let i = 0; i <= n; i++) {
          const t = p.start + ((end - p.start) * i) / n;
          out.push({ x: p.c.x + p.r * Math.cos(t), y: p.c.y + p.r * Math.sin(t) });
        }
      }
      return out;
    };
    for (const p of prims) {
      const pts = samples(p);
      for (const b of boxes) if (pts.some((q) => inside(b, q))) problems.push(`"${b.p.text}" crossed by ${p.kind} ${p.tag ?? ''}`);
    }
    expect(problems).toEqual([]);
  });
});
