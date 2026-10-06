import { FONT_FAMILY, fontSizeForCapHeight } from './font';
import type { Primitive, StrokeStyle } from './types';

/** Maps sheet mm to canvas pixels: px = (mm - pan) * zoom, with y flipped by the renderer. */
export interface CanvasTransform {
  zoom: number;              // px per sheet mm
  panX: number;              // sheet mm at canvas left edge
  panY: number;              // sheet mm at canvas bottom edge
  heightPx: number;          // canvas height in px (for the y flip)
}

export function renderCanvas(ctx: CanvasRenderingContext2D, prims: Primitive[], t: CanvasTransform): void {
  const X = (x: number): number => (x - t.panX) * t.zoom;
  const Y = (y: number): number => t.heightPx - (y - t.panY) * t.zoom;

  const stroke = (s: StrokeStyle): void => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * t.zoom);
    ctx.setLineDash(s.dash.map((d) => d * t.zoom));
    ctx.lineDashOffset = s.dashOffset * t.zoom;
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const p of prims) {
    switch (p.kind) {
      case 'polyline': {
        if (p.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(X(p.points[0].x), Y(p.points[0].y));
        for (const q of p.points.slice(1)) ctx.lineTo(X(q.x), Y(q.y));
        if (p.closed) ctx.closePath();
        stroke(p.style);
        break;
      }
      case 'arc': {
        // y flip mirrors angles: counter-clockwise on paper = anticlockwise on canvas with negated angles.
        ctx.beginPath();
        ctx.arc(X(p.c.x), Y(p.c.y), p.r * t.zoom, -p.start, -p.end, true);
        stroke(p.style);
        break;
      }
      case 'fill': {
        if (p.points.length < 3) break;
        ctx.beginPath();
        ctx.moveTo(X(p.points[0].x), Y(p.points[0].y));
        for (const q of p.points.slice(1)) ctx.lineTo(X(q.x), Y(q.y));
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        break;
      }
      case 'text': {
        const h = p.height * t.zoom;
        if (h < 1) break; // too small to read; skip
        ctx.save();
        ctx.translate(X(p.pos.x), Y(p.pos.y));
        ctx.rotate(-p.angle);
        ctx.font = `${fontSizeForCapHeight(h)}px ${FONT_FAMILY}, sans-serif`;
        ctx.textAlign = p.align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = p.color;
        // Baselines refer to the cap height box: bottom = alphabetic baseline.
        const dy = p.baseline === 'top' ? h : p.baseline === 'middle' ? h / 2 : 0;
        ctx.fillText(p.text, 0, dy);
        ctx.restore();
        break;
      }
    }
  }
  ctx.restore();
}
