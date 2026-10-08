// DXF group-code tokenizer: the ASCII file as a flat list of (code, value) pairs, plus small accessors.

export interface Tag {
  code: number;
  value: string;
}

/** Split an ASCII DXF text into tags. Lines come in pairs: group code, then value. Tolerates CRLF and a trailing newline. */
export function parseTags(text: string): Tag[] {
  const lines = text.split('\n');
  const tags: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeText = lines[i].trim();
    if (codeText === '') continue;
    const code = Number(codeText);
    if (!Number.isFinite(code)) throw new Error(`invalid DXF: group code "${codeText}" at line ${i + 1}`);
    let value = lines[i + 1];
    if (value.endsWith('\r')) value = value.slice(0, -1);
    tags.push({ code, value: code === 0 || code === 2 || (code >= 5 && code <= 9) ? value.trim() : value.replace(/^\s+/, '') });
  }
  return tags;
}

/** A tag list with lookup helpers. Repeated codes (polyline vertices) are read in order with `all`. */
export class Tags {
  readonly tags: Tag[];

  constructor(tags: Tag[]) {
    this.tags = tags;
  }

  first(code: number): string | undefined {
    const t = this.tags.find((x) => x.code === code);
    return t?.value;
  }

  str(code: number, fallback = ''): string {
    return this.first(code) ?? fallback;
  }

  num(code: number, fallback = 0): number {
    const v = this.first(code);
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  has(code: number): boolean {
    return this.tags.some((x) => x.code === code);
  }

  all(code: number): string[] {
    return this.tags.filter((x) => x.code === code).map((x) => x.value);
  }

  nums(code: number): number[] {
    return this.all(code).map(Number);
  }

  /** 2D point from an x code and its y partner (10 → 20, 11 → 21, …). */
  point(xCode: number, fallback = { x: 0, y: 0 }): { x: number; y: number } {
    const x = this.first(xCode);
    const y = this.first(xCode + 10);
    if (x === undefined || y === undefined) return fallback;
    return { x: Number(x), y: Number(y) };
  }

  /** All 2D points of an x code, in file order, paired with the next y tag that follows each. */
  points(xCode: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < this.tags.length; i++) {
      if (this.tags[i].code !== xCode) continue;
      for (let j = i + 1; j < this.tags.length; j++) {
        if (this.tags[j].code === xCode + 10) {
          out.push({ x: Number(this.tags[i].value), y: Number(this.tags[j].value) });
          break;
        }
        if (this.tags[j].code === xCode) break;
      }
    }
    return out;
  }
}
