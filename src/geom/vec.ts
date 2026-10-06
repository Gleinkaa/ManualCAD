import type { Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; }
export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function cross(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
export function len(a: Vec2): number { return Math.hypot(a.x, a.y); }
export function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function norm(a: Vec2): Vec2 { const l = len(a); return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; }
export function perp(a: Vec2): Vec2 { return { x: -a.y, y: a.x }; }
export function polar(origin: Vec2, length: number, angle: number): Vec2 {
  return { x: origin.x + length * Math.cos(angle), y: origin.y + length * Math.sin(angle) };
}
