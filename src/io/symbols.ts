// Symbol blocks in DXF/DWG: the attribute tags of the BBRZ blocks `Oberflächenzeichen_BBRZ` and
// `Kegel-Keil-Verhältnis_BBRZ` (samples/bbrz). Export writes them, import recognises a block by them.
import type { SurfaceFields } from '../model/types';
import { decodeTextCodes } from './mtext';

/** Surface texture fields ↔ BBRZ attribute tags, with the prompts of the BBRZ block. */
export const SURFACE_TAGS: { field: keyof SurfaceFields; tag: string; prompt: string }[] = [
  { field: 'roughness', tag: 'RAUHEIT', prompt: 'Rauheitswert eingeben' },
  { field: 'second', tag: 'OBERFLÄCHENANGABE_ZUSATZ', prompt: 'Zusätzliche Oberflächenangabe eingeben' },
  { field: 'process', tag: 'Oberflächenbehandlung optional', prompt: 'optionale Oberflächenbehandlung eingeben' },
  { field: 'lay', tag: 'FERTIGUNGSRIEFEN', prompt: 'Zeichen für Fertigungsriefen eingeben' },
  { field: 'allowance', tag: 'BEARBEIT.-ZUGABE', prompt: 'Bearbeitungszugabe eingeben' },
];

/** The taper/slope ratio attribute of the BBRZ block. */
export const TAPER_TAG = { tag: 'KKV', prompt: 'Kegel- oder Keilverhältnis eingeben:' };

/** A tag reduced for comparison: upper case letters only (AutoCAD upper-cases tags, umlauts may arrive escaped). */
export function tagKey(tag: string): string {
  return decodeTextCodes(tag).normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
}
