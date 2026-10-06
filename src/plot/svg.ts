// Plain SVG of plotted primitives (sheet mm, y up → SVG y down). For previews, docs and visual checks.
import { frameGeometry } from './frame';
import type { SheetDoc } from '../model/types';
import type { Primitive, StrokeStyle } from './types';

const n = (v: number) => +v.toFixed(3);

function stroke(s: StrokeStyle): string {
  const dash = s.dash.length ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : '';
  return `fill="none" stroke="${s.color}" stroke-width="${n(s.width)}" stroke-linecap="round"${dash}`;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The sheet as a standalone SVG document at true paper size (width/height in mm). */
export function sheetToSvg(doc: SheetDoc, prims: Primitive[]): string {
  const { sheet } = frameGeometry(doc);
  const y = (v: number) => n(sheet.h - v);
  const out: string[] = [];
  for (const p of prims) {
    if (p.kind === 'polyline') {
      const pts = p.points.map((q) => `${n(q.x)},${y(q.y)}`).join(' ');
      out.push(`<${p.closed ? 'polygon' : 'polyline'} points="${pts}" ${stroke(p.style)}/>`);
    } else if (p.kind === 'arc') {
      if (Math.abs(p.end - p.start) >= 2 * Math.PI - 1e-9) {
        out.push(`<circle cx="${n(p.c.x)}" cy="${y(p.c.y)}" r="${n(p.r)}" ${stroke(p.style)}/>`);
      } else {
        const a = { x: p.c.x + p.r * Math.cos(p.start), y: p.c.y + p.r * Math.sin(p.start) };
        const b = { x: p.c.x + p.r * Math.cos(p.end), y: p.c.y + p.r * Math.sin(p.end) };
        const large = p.end - p.start > Math.PI ? 1 : 0;
        // counter-clockwise in y-up is sweep-flag 0 once y is flipped
        out.push(`<path d="M${n(a.x)},${y(a.y)} A${n(p.r)},${n(p.r)} 0 ${large} 0 ${n(b.x)},${y(b.y)}" ${stroke(p.style)}/>`);
      }
    } else if (p.kind === 'fill') {
      out.push(`<polygon points="${p.points.map((q) => `${n(q.x)},${y(q.y)}`).join(' ')}" fill="${p.color}"/>`);
    } else {
      const anchor = p.align === 'left' ? 'start' : p.align === 'right' ? 'end' : 'middle';
      const base = p.baseline === 'bottom' ? 'auto' : p.baseline === 'top' ? 'hanging' : 'middle';
      const deg = n((-p.angle * 180) / Math.PI);
      // cap height → font size: ISO 3098 type B fonts have a cap height of about 0.7 em
      out.push(
        `<text x="${n(p.pos.x)}" y="${y(p.pos.y)}" font-family="osifont, sans-serif" font-size="${n(p.height / 0.7)}" ` +
          `text-anchor="${anchor}" dominant-baseline="${base}" fill="${p.color}" transform="rotate(${deg} ${n(p.pos.x)} ${y(p.pos.y)})">${esc(p.text)}</text>`,
      );
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.w}mm" height="${sheet.h}mm" viewBox="0 0 ${sheet.w} ${sheet.h}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`
  );
}
