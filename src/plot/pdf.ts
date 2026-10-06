import { jsPDF } from 'jspdf';
import type { Vec2 } from '../geom/types';
import { sheetSize } from '../model/standards';
import type { SheetDoc } from '../model/types';
import { FONT_FAMILY, fontBase64, fontSizeForCapHeight } from './font';
import { plotSheet } from './sheet';
import type { Primitive, StrokeStyle } from './types';

const PT_PER_MM = 72 / 25.4;

/** Vector PDF of the sheet at exact 1:1 paper size (prints to scale), ISO 3098 font embedded. */
export async function exportPdf(doc: SheetDoc): Promise<Blob> {
  const { w, h } = sheetSize(doc.format, doc.orientation);
  const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
  pdf.setProperties({ title: doc.titleBlock.title ?? '', subject: doc.titleBlock.drawingNumber ?? '', creator: 'ManualCAD' });

  const ttf = await fontBase64();
  if (ttf) {
    pdf.addFileToVFS('osifont.ttf', ttf);
    pdf.addFont('osifont.ttf', FONT_FAMILY, 'normal');
    pdf.setFont(FONT_FAMILY, 'normal');
  } else {
    pdf.setFont('helvetica', 'normal');
  }

  const prims = plotSheet(doc, { includeConstruction: false, screenColors: false });
  drawPdf(pdf, prims, h);
  return pdf.output('blob');
}

/** Draws primitives (sheet mm, y up) into a jsPDF page in mm (y down). Always black. */
export function drawPdf(pdf: jsPDF, prims: Primitive[], pageH: number): void {
  const Y = (y: number): number => pageH - y;
  pdf.setLineCap('butt');
  pdf.setLineJoin('miter');
  pdf.setDrawColor(0, 0, 0);
  pdf.setFillColor(0, 0, 0);
  pdf.setTextColor(0, 0, 0);

  const stroke = (s: StrokeStyle): void => {
    pdf.setLineWidth(s.width);
    pdf.setLineDashPattern(s.dash, s.dashOffset);
    pdf.stroke();
  };

  for (const p of prims) {
    if (p.tag === 'sheet-edge') continue; // the paper edge is the trimmed edge
    switch (p.kind) {
      case 'polyline':
        if (p.points.length < 2) break;
        pdf.moveTo(p.points[0].x, Y(p.points[0].y));
        for (const q of p.points.slice(1)) pdf.lineTo(q.x, Y(q.y));
        if (p.closed) pdf.close();
        stroke(p.style);
        break;
      case 'arc': {
        const segs = arcBeziers(p.c, p.r, p.start, p.end);
        pdf.moveTo(segs[0][0].x, Y(segs[0][0].y));
        for (const [, c1, c2, e] of segs) pdf.curveTo(c1.x, Y(c1.y), c2.x, Y(c2.y), e.x, Y(e.y));
        stroke(p.style);
        break;
      }
      case 'fill':
        if (p.points.length < 3) break;
        pdf.moveTo(p.points[0].x, Y(p.points[0].y));
        for (const q of p.points.slice(1)) pdf.lineTo(q.x, Y(q.y));
        pdf.close();
        pdf.fill();
        break;
      case 'text': {
        pdf.setFontSize(fontSizeForCapHeight(p.height) * PT_PER_MM);
        const width = pdf.getTextWidth(p.text);
        const along = p.align === 'right' ? -width : p.align === 'center' ? -width / 2 : 0;
        const up = p.baseline === 'top' ? -p.height : p.baseline === 'middle' ? -p.height / 2 : 0;
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        const x = p.pos.x + along * cos - up * sin;
        const y = p.pos.y + along * sin + up * cos;
        pdf.text(p.text, x, Y(y), { angle: (p.angle * 180) / Math.PI, baseline: 'alphabetic' });
        break;
      }
    }
  }
  pdf.setLineDashPattern([], 0);
}

/** Counter-clockwise arc as cubic Bezier segments of at most 90°: [start, control1, control2, end]. */
export function arcBeziers(c: Vec2, r: number, start: number, end: number): [Vec2, Vec2, Vec2, Vec2][] {
  let sweep = end - start;
  if (sweep <= 0) sweep += 2 * Math.PI * Math.ceil(-sweep / (2 * Math.PI) + 1e-12);
  const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  const out: [Vec2, Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < n; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
    const p3 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
    out.push([
      p0,
      { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) },
      { x: p3.x + k * Math.sin(a1), y: p3.y - k * Math.cos(a1) },
      p3,
    ]);
  }
  return out;
}
