// Dimensioning constants and Norm rules (ISO 129-1, mechanical engineering, as taught in Austrian training).
import type { NormRule } from '../model/standards';

/**
 * Arrowhead length as a multiple of the narrow line width d: 10·d → 2.5 mm in line group 0.5, 3.5 mm in 0.7.
 * Source: ISO 129-1 terminator figure, textbook rule (Tabellenbuch Metall: Maßpfeil 2,5 mm bei Liniengruppe 0,5).
 */
export const ARROW_LENGTH_FACTOR = 10;

/** Closed filled arrowhead, 30° included angle (ISO 129-1 default terminator for mechanical drawings). */
export const ARROW_ANGLE = (30 * Math.PI) / 180;

/**
 * Extension lines overshoot the dimension line by about 8·d (= 2 mm in line group 0.5).
 * Source: ISO 129-1; TU München/INGGO course notes ("ca. 2 mm über die Maßpfeile hinaus").
 * No gap between the object and the extension line (mechanical engineering practice).
 */
export const EXTENSION_OVERSHOOT_FACTOR = 8;

/** Gap between dimension line and text baseline, as a fraction of the text height (ISO 129-1 only says "slightly above"; house value). */
export const TEXT_GAP_FACTOR = 0.25;

/**
 * Text advance per character as a fraction of the text height, for fit decisions only.
 * ISO 3098-1 type B: line width h/10, digit width ≈ 6/10 h minus stroke + 2/10 h spacing → ≈ 0.7 h.
 */
export const TEXT_WIDTH_FACTOR = 0.7;

/** Dimension line continues beyond an outside arrowhead by this many arrow lengths (drawing-board practice). */
export const OUTSIDE_TAIL_FACTOR = 1;

/** Maximum decimals of a dimension value. */
export const MAX_DECIMALS = 3;

export const DIM_RULES: NormRule[] = [
  { id: 'DIM-LINE-NARROW', source: 'ISO 129-1 / ISO 128-2', text: 'Dimension, extension and leader lines are narrow continuous lines (01.1).' },
  { id: 'DIM-ARROW', source: 'ISO 129-1', text: 'Terminators are closed filled arrowheads, 30° included angle, length ≈ 10 × narrow line width.' },
  { id: 'DIM-EXT-OVERSHOOT', source: 'ISO 129-1', text: 'Extension lines extend about 8 × line width (≈ 2 mm) beyond the dimension line, without a gap at the object.' },
  { id: 'DIM-TEXT-ABOVE', source: 'ISO 129-1', text: 'Dimension values stand slightly above and parallel to the dimension line, readable from the bottom or right (method 1).' },
  { id: 'DIM-TEXT-HEIGHT', source: 'ISO 129-1 / ISO 3098-1', text: 'Dimension text height follows the line group (3.5 mm for 0.5, 5 mm for 0.7), ISO 3098 type B lettering.' },
  { id: 'DIM-UNITS', source: 'ISO 129-1', text: 'Lengths are in mm without unit symbol; decimal comma; no trailing zeros.' },
  { id: 'DIM-SPACE', source: 'ISO 129-1', text: 'If the space between extension lines is too small, arrowheads are placed outside pointing in; if the value does not fit either, it stands outside on the extended dimension line.' },
  { id: 'DIM-RADIUS', source: 'ISO 129-1', text: 'Radii carry the symbol R; one arrowhead touches the arc, the dimension line runs from (or towards) the centre.' },
  { id: 'DIM-DIAMETER', source: 'ISO 129-1', text: 'Diameters carry the symbol ⌀; the dimension line passes through the centre with arrowheads on the circle.' },
  { id: 'DIM-DISTANCE', source: 'ISO 129-1 (training practice)', text: 'First dimension line ≈ 10 mm from the outline, further parallel dimension lines ≈ 7 mm apart.' },
];
