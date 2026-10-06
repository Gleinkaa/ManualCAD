// Screen <-> sheet mapping for the canvas: px = (mm - pan) * zoom, y flipped. Pure math, no DOM.
import type { Vec2 } from '../geom/types';
import type { CanvasTransform } from '../plot';

export class Viewport {
  zoom = 2;                  // device px per sheet mm
  panX = 0;                  // sheet mm at the left edge
  panY = 0;                  // sheet mm at the bottom edge
  width = 1;                 // device px
  height = 1;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  toScreen(p: Vec2): Vec2 {
    return { x: (p.x - this.panX) * this.zoom, y: this.height - (p.y - this.panY) * this.zoom };
  }

  toSheet(px: number, py: number): Vec2 {
    return { x: px / this.zoom + this.panX, y: (this.height - py) / this.zoom + this.panY };
  }

  /** Zoom by `factor` keeping the sheet point under (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    const before = this.toSheet(px, py);
    this.zoom = Math.min(400, Math.max(0.05, this.zoom * factor));
    const after = this.toSheet(px, py);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
  }

  /** Pan by a screen delta in device px (drag direction). */
  panBy(dxPx: number, dyPx: number): void {
    this.panX -= dxPx / this.zoom;
    this.panY += dyPx / this.zoom;
  }

  /** Fit a sheet of w × h mm with a margin fraction around it. */
  fit(w: number, h: number, margin = 0.05): void {
    const zx = this.width / (w * (1 + 2 * margin));
    const zy = this.height / (h * (1 + 2 * margin));
    this.zoom = Math.min(zx, zy);
    this.panX = w / 2 - this.width / this.zoom / 2;
    this.panY = h / 2 - this.height / this.zoom / 2;
  }

  transform(): CanvasTransform {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY, heightPx: this.height };
  }
}
