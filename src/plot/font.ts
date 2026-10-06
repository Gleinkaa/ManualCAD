// osifont (ISO 3098 type B lettering), LGPL-3.0 with font exception, see public/fonts/LICENSE-osifont.txt.

/** CSS font-family name to use for canvas text. */
export const FONT_FAMILY = 'osifont';
export const FONT_FILE = 'fonts/osifont-lgpl3fe.ttf';

/** Cap height / em size, from the font's OS/2 table (sCapHeight 1515 / unitsPerEm 2048). */
export const CAP_HEIGHT_EM = 1515 / 2048;

/** Font size (em, paper mm) that gives the requested ISO 3098 cap height h. */
export function fontSizeForCapHeight(h: number): number {
  return h / CAP_HEIGHT_EM;
}

// Advance widths in 1/1000 em for U+0020..U+00FF, read from the font's hmtx table.
const ADVANCE = [
  435, 220, 391, 613, 466, 764, 614, 204, 255, 255, 464, 465, 233, 465, 201, 491, 468, 342, 466, 480, 513, 497, 495, 478,
  516, 503, 222, 255, 465, 464, 465, 464, 811, 614, 582, 490, 588, 490, 490, 580, 591, 221, 414, 564, 492, 666, 587, 587,
  563, 597, 564, 540, 538, 589, 615, 761, 616, 614, 540, 266, 462, 266, 390, 465, 315, 481, 503, 405, 503, 496, 439, 502,
  503, 218, 218, 492, 268, 642, 494, 493, 507, 507, 407, 466, 347, 494, 466, 612, 464, 464, 464, 314, 221, 314, 466, 438,
  438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438, 438,
  438, 438, 438, 438, 438, 438, 438, 438, 435, 220, 479, 565, 531, 438, 438, 521, 438, 668, 438, 539, 438, 438, 668, 438,
  391, 465, 321, 328, 315, 549, 594, 221, 438, 293, 438, 539, 642, 617, 657, 464, 614, 614, 614, 614, 614, 614, 764, 490,
  490, 490, 490, 490, 221, 221, 221, 221, 627, 587, 587, 587, 587, 587, 587, 467, 591, 589, 589, 589, 589, 614, 503, 588,
  481, 481, 481, 481, 481, 481, 639, 405, 496, 496, 496, 496, 218, 218, 218, 218, 495, 494, 493, 493, 493, 493, 493, 466,
  545, 494, 494, 494, 494, 464, 503, 464,
];
const WIDE: Record<string, number> = { '⌀': 668 };

/** Approximate text width in paper mm at cap height h (no kerning). */
export function textWidth(text: string, h: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    em += code >= 32 && code < 256 ? ADVANCE[code - 32] : (WIDE[ch] ?? 600);
  }
  return (em / 1000) * fontSizeForCapHeight(h);
}

export function fontUrl(): string {
  return `${import.meta.env.BASE_URL}${FONT_FILE}`;
}

let loading: Promise<void> | null = null;

/** Loads the ISO 3098 font (osifont) for canvas use. Resolves when ready. */
export function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  loading ??= new FontFace(FONT_FAMILY, `url(${fontUrl()})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch((err: unknown) => {
      loading = null;
      console.warn('osifont could not be loaded, falling back to sans-serif', err);
    });
  return loading;
}

let ttfBase64: Promise<string | null> | null = null;

/** The TTF as base64 for PDF embedding; null when it can't be fetched (e.g. in tests). */
export function fontBase64(): Promise<string | null> {
  ttfBase64 ??= fetch(fontUrl())
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    })
    .catch(() => {
      ttfBase64 = null;
      return null;
    });
  return ttfBase64;
}
