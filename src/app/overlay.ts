// Screen-space overlays: crosshair, snap glyphs, selection windows, markers. Device px.
import type { SnapKind, Vec2 } from '../geom/types';

const SNAP_COLOR = '#e6a100';

export function drawCrosshair(ctx: CanvasRenderingContext2D, p: Vec2, w: number, h: number, pickbox: number, dpr: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(30,30,30,0.75)';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  const x = Math.round(p.x) + 0.5;
  const y = Math.round(p.y) + 0.5;
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
  if (pickbox > 0) ctx.strokeRect(x - pickbox, y - pickbox, pickbox * 2, pickbox * 2);
  ctx.restore();
}

/** AutoCAD-like marker glyph per snap kind, plus a tooltip. */
export function drawSnapMarker(ctx: CanvasRenderingContext2D, p: Vec2, kind: SnapKind, label: string, dpr: number): void {
  const s = 6 * dpr;
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  switch (kind) {
    case 'endpoint':
      ctx.rect(p.x - s, p.y - s, 2 * s, 2 * s);
      break;
    case 'midpoint':
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.lineTo(p.x - s, p.y + s);
      ctx.closePath();
      break;
    case 'center':
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      break;
    case 'quadrant':
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(p.x - s, p.y - s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.moveTo(p.x + s, p.y - s);
      ctx.lineTo(p.x - s, p.y + s);
      break;
    case 'perpendicular':
      ctx.moveTo(p.x - s, p.y - s);
      ctx.lineTo(p.x - s, p.y + s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.moveTo(p.x - s, p.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + s);
      break;
    case 'tangent':
      ctx.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2);
      ctx.moveTo(p.x - s, p.y - s * 0.8);
      ctx.lineTo(p.x + s, p.y - s * 0.8);
      break;
    case 'nearest':
      ctx.moveTo(p.x - s, p.y - s);
      ctx.lineTo(p.x + s, p.y - s);
      ctx.lineTo(p.x - s, p.y + s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.closePath();
      break;
  }
  ctx.stroke();
  tooltip(ctx, { x: p.x + 2 * s, y: p.y + 3 * s }, label, dpr);
  ctx.restore();
}

export function tooltip(ctx: CanvasRenderingContext2D, p: Vec2, text: string, dpr: number): void {
  ctx.save();
  ctx.font = `${12 * dpr}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8 * dpr;
  const h = 18 * dpr;
  ctx.fillStyle = 'rgba(255,255,225,0.95)';
  ctx.strokeStyle = '#888';
  ctx.lineWidth = dpr;
  ctx.fillRect(p.x, p.y, w, h);
  ctx.strokeRect(p.x, p.y, w, h);
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x + 4 * dpr, p.y + h / 2);
  ctx.restore();
}

/** Left→right window = blue solid, right→left crossing = green dashed. */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, dpr: number): void {
  const crossing = b.x < a.x;
  ctx.save();
  ctx.fillStyle = crossing ? 'rgba(40,180,60,0.15)' : 'rgba(40,110,230,0.15)';
  ctx.strokeStyle = crossing ? 'rgb(30,140,50)' : 'rgb(30,90,210)';
  ctx.lineWidth = dpr;
  if (crossing) ctx.setLineDash([6 * dpr, 4 * dpr]);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
}

export function drawMarker(ctx: CanvasRenderingContext2D, p: Vec2, dpr: number, color = '#c03030'): void {
  const s = 8 * dpr;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(p.x - s, p.y);
  ctx.lineTo(p.x + s, p.y);
  ctx.moveTo(p.x, p.y - s);
  ctx.lineTo(p.x, p.y + s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Small x/y axis icon at the current view's origin. */
export function drawViewOrigin(ctx: CanvasRenderingContext2D, p: Vec2, dpr: number): void {
  const s = 18 * dpr;
  ctx.save();
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + s, p.y);
  ctx.stroke();
  ctx.strokeStyle = '#2a9d3a';
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - s);
  ctx.stroke();
  ctx.restore();
}

/** Dashed tracking line (polar / ortho alignment) from base to cursor. */
export function drawTrackLine(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, dpr: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(30,120,40,0.8)';
  ctx.lineWidth = dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + (dx / l) * 5000, a.y + (dy / l) * 5000);
  ctx.stroke();
  ctx.restore();
}

/** Grip square (AutoCAD-like): filled blue, red when hot (hovered or being dragged). */
export function drawGrip(ctx: CanvasRenderingContext2D, p: Vec2, hot: boolean, dpr: number): void {
  const s = 4 * dpr;
  ctx.save();
  ctx.fillStyle = hot ? '#d33a2f' : '#1e6fd9';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = dpr;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
  ctx.strokeRect(x - s + 0.5, y - s + 0.5, 2 * s - 1, 2 * s - 1);
  ctx.restore();
}
