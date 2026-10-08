/** Toolbar icons: 20×20 viewBox line art, stroke = currentColor. Keys are command names. */
export const ICONS: Record<string, string> = {
  // --- file ---------------------------------------------------------------
  NEW: '<path d="M4.5 2.5h7l4 4v11h-11z"/><path d="M11.5 2.5v4h4"/>',
  OPEN: '<path d="M2.5 16.5v-12h5l2 2h8v10z"/><path d="M2.5 9h15"/>',
  SAVE: '<path d="M2.5 13v4.5h15V13"/><path d="M10 2.5v10M6.5 9l3.5 3.5L13.5 9"/>',
  PLOT:
    '<path d="M6 7.5V3h8v4.5"/><path d="M6 14.5H3.5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H14"/><path d="M6 11.5h8v5.5H6z"/>',
  DXFOUT: '<path d="M4.5 2.5h7l4 4v11h-11z"/><path d="M11.5 2.5v4h4"/><path d="M7 14l2-2.5L7 9M11 9l2 2.5L11 14" stroke-width="1.2"/>',
  TITLEBLOCK:
    '<rect x="2.5" y="3.5" width="15" height="13"/><path d="M9.5 16.5V12h8"/><path d="M9.5 14.25h8" stroke-width="1"/>',
  PARTSLIST:
    '<rect x="2.5" y="3.5" width="15" height="13"/><path d="M2.5 7.5h15M2.5 11.5h15"/><path d="M7 3.5v13" stroke-width="1"/>',
  // --- draw ---------------------------------------------------------------
  LINE:
    '<path d="M4 16L16 4"/><circle cx="4" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="4" r="1.5" fill="currentColor" stroke="none"/>',
  CIRCLE: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/>',
  ARC:
    '<path d="M17 10A7 7 0 1 0 10 17"/><circle cx="17" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="17" r="1.5" fill="currentColor" stroke="none"/>',
  RECTANG: '<rect x="3" y="5" width="14" height="10"/>',
  HATCH:
    '<rect x="3" y="4" width="14" height="12"/><path d="M3 7l3-3M3 11l7-7M3 15L14 4M6 16L17 5M10 16l7-7M14 16l3-3" stroke-width="1"/>',
  // --- modify (geometry) --------------------------------------------------
  OFFSET: '<path d="M3 17V9a6 6 0 0 1 6-6h8"/><path d="M7 17V9a2 2 0 0 1 2-2h8"/>',
  TRIM:
    '<circle cx="6.5" cy="15.5" r="2"/><circle cx="13.5" cy="15.5" r="2"/><path d="M8 14l4.5-11M12 14L7.5 3"/><path d="M2.5 6.5h5.5"/><path d="M12 6.5h5.5" stroke-width="1" stroke-dasharray="1.5 1.5"/>',
  EXTEND:
    '<path d="M16.5 2.5v15"/><path d="M2.5 10H9"/><path d="M9 10h7.5" stroke-width="1" stroke-dasharray="2 2"/><path d="M13 7.5l3.5 2.5-3.5 2.5"/>',
  FILLET:
    '<path d="M3 17V8a5 5 0 0 1 5-5h9"/><path d="M3 8V3h5" stroke-width="1" stroke-dasharray="1.5 1.5"/>',
  CHAMFER:
    '<path d="M3 17V8l5-5h9"/><path d="M3 8V3h5" stroke-width="1" stroke-dasharray="1.5 1.5"/>',
  // --- modify (transform) -------------------------------------------------
  MOVE:
    '<path d="M10 2.5v15M2.5 10h15"/><path d="M7.5 5l2.5-2.5L12.5 5M7.5 15l2.5 2.5 2.5-2.5M5 7.5L2.5 10 5 12.5M15 7.5l2.5 2.5-2.5 2.5"/>',
  COPY: '<rect x="7" y="7" width="10" height="10"/><path d="M4.5 13V4.5H13"/>',
  ROTATE: '<path d="M16.5 10a6.5 6.5 0 1 1-2-4.7"/><path d="M11.5 5.3h3v-3"/>',
  SCALE:
    '<rect x="3" y="3" width="14" height="14"/><path d="M3 12h5v5"/><path d="M8 12l6.5-6.5M10.5 5.5h4v4"/>',
  STRETCH:
    '<path d="M2.5 14.5h7l4-9h4"/><path d="M8 4.5h9v12H8z" stroke-width="1" stroke-dasharray="2 1.5"/><path d="M14.5 2.5l3 3-3 3"/>',
  MIRROR:
    '<path d="M10 2.5v15" stroke-width="1" stroke-dasharray="4 1.5 1 1.5"/><path d="M7.5 5L3 15h4.5z"/><path d="M12.5 5L17 15h-4.5z"/>',
  ERASE:
    '<path d="M12 3l5.5 5.5-7 7H6.5L3 12z"/><path d="M8 7l5.5 5.5"/><path d="M3 17.5h14"/>',
  // --- annotate -----------------------------------------------------------
  TEXT: '<path d="M4.5 17L10 3l5.5 14M6.5 12h7" stroke-width="2"/>',
  SKETCH: '<path d="M2.5 12c2.5-7 5-7 7.5 0s5 7 7.5 0"/>',
  LEADER:
    '<path d="M3 16l7-7h7"/><path d="M3 16l3.7-2L5 12.3z" fill="currentColor"/>',
  BALLOON:
    '<circle cx="13" cy="7" r="4.5"/><path d="M11.8 5.7l1.5-1.2v5"/><path d="M3.5 16.5l6.3-6.3"/><circle cx="3.5" cy="16.5" r="1.5" fill="currentColor" stroke="none"/>',
  // --- dimensions ---------------------------------------------------------
  DIMLINEAR:
    '<path d="M3.5 3.5v11M16.5 3.5v11" stroke-width="1"/><path d="M3.5 10h13"/><path d="M3.5 10l3.5-1.2v2.4zM16.5 10L13 8.8v2.4z" fill="currentColor"/>',
  DIMALIGNED:
    '<g transform="rotate(-40 10 10)"><path d="M3 7v6M17 7v6" stroke-width="1"/><path d="M3 10h14"/><path d="M3 10l4-1.5v3zM17 10l-4-1.5v3z" fill="currentColor"/></g>',
  DIMRADIUS:
    '<circle cx="8" cy="12" r="5.5"/><path d="M8 12l8-8"/><path d="M11.9 8.1l-1.7 3.3-1.6-1.6z" fill="currentColor"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/>',
  DIMDIAMETER:
    '<circle cx="10" cy="10" r="6.5"/><path d="M3 17L17 3"/><path d="M14.6 5.4l-1.3 2.9-1.6-1.6zM5.4 14.6l2.9-1.3-1.6-1.6z" fill="currentColor"/>',
  DIMANGULAR:
    '<path d="M3 17h14M3 17L11 4.5"/><path d="M12 17A9 9 0 0 0 7.85 9.42"/><path d="M12 17l-1-3h2zM7.85 9.42l3.05.78-1 1.6z" fill="currentColor"/>',
  DIMEDIT:
    '<path d="M2.5 12v5.5M12.5 12v5.5" stroke-width="1"/><path d="M2.5 15h10"/><path d="M2.5 15l3.2-1.3v2.6zM12.5 15l-3.2-1.3v2.6z" fill="currentColor"/><path d="M7.5 10.5l.7-3.2L14.5 1l3.2 3.2-6.3 6.3z"/><path d="M8.2 7.3l3.2 3.2" stroke-width="1"/>',
  HATCHEDIT:
    '<rect x="2.5" y="7.5" width="10" height="10"/><path d="M2.5 10.5l3-3M2.5 13.5l6-6M2.5 16.5l9-9M5.5 17.5l7-7M8.5 17.5l4-4M11.5 17.5l1-1" stroke-width="1"/><path d="M9.5 10.5l.7-3.2L16.5 1l3.2 3.2-6.3 6.3z" fill="#fff"/><path d="M10.2 7.3l3.2 3.2" stroke-width="1"/>',
  // --- views / navigation -------------------------------------------------
  VIEW:
    '<rect x="2.5" y="5" width="9" height="10"/><circle cx="7" cy="10" r="2.5"/><rect x="14" y="5" width="3.5" height="10"/><path d="M14 7.5h3.5M14 12.5h3.5" stroke-width="1" stroke-dasharray="1 1"/>',
  'ZOOM E':
    '<path d="M2.5 6.5v-4h4M13.5 2.5h4v4M17.5 13.5v4h-4M6.5 17.5h-4v-4"/><circle cx="9.5" cy="9.5" r="3.5"/><path d="M12 12l3 3"/>',
  'ZOOM W':
    '<rect x="2.5" y="2.5" width="9.5" height="7.5" stroke-width="1" stroke-dasharray="2 1.5"/><circle cx="11.5" cy="11.5" r="4"/><path d="M14.5 14.5l3 3"/>',
  PAN:
    '<path d="M5 11V5.5a1.5 1.5 0 0 1 3 0V10"/><path d="M8 10V3.5a1.5 1.5 0 0 1 3 0V10"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M14 10V6.5a1.5 1.5 0 0 1 3 0V12c0 3.5-2.5 5.5-6 5.5H9.5c-1.8 0-3-.7-4-1.8L3.2 13.2a1.3 1.3 0 0 1 1.8-1.8L5 12.5"/>',
  UNDO: '<path d="M7 5L4 8l3 3"/><path d="M4 8h7a4.5 4.5 0 0 1 0 9H6.5"/>',
  REDO: '<path d="M13 5l3 3-3 3"/><path d="M16 8H9a4.5 4.5 0 0 0 0 9h4.5"/>',
  HELP:
    '<circle cx="10" cy="10" r="7.5"/><path d="M7.6 7.8a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 .8-1 1.7"/><circle cx="10" cy="14.2" r=".9" fill="currentColor" stroke="none"/>',
  LAYERS:
    '<path d="M10 2.5l7.5 3.75L10 10 2.5 6.25z"/><path d="M2.5 10l7.5 3.75L17.5 10"/><path d="M2.5 13.75l7.5 3.75 7.5-3.75"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An <svg> element for `name`, or null when there is no icon. */
export function iconElement(name: string): SVGSVGElement | null {
  const markup = ICONS[name];
  if (markup === undefined) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}
