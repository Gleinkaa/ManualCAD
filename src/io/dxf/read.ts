// DXF file structure: header variables, layer and line type tables, block definitions, layouts and entities.
// Entities stay as raw tag lists; `import.ts` interprets them.
import type { Vec2 } from '../../geom/types';
import { parseTags, Tags, type Tag } from './tags';

export interface DxfEntity {
  type: string;
  tags: Tags;
  /** ATTRIB entities of an INSERT, VERTEX entities of a POLYLINE (up to SEQEND). */
  children: DxfEntity[];
}

export interface DxfLayer {
  name: string;
  color: number;             // ACI, negative = layer off
  linetype: string;
  lineweight: number;        // 1/100 mm, -3 = default
  frozen: boolean;
}

export interface DxfLinetype {
  name: string;
  /** Dash lengths in drawing units, positive = dash, negative = gap, 0 = dot. Empty = continuous. */
  pattern: number[];
}

export interface DxfBlock {
  name: string;
  base: Vec2;
  entities: DxfEntity[];
  /** Block record handle (R13+), for LAYOUT lookup. */
  handle: string;
}

export interface DxfLayout {
  name: string;
  blockName: string;         // *Paper_Space, *Paper_Space0, … or *Model_Space
  paperWidth: number;        // plot paper units; see paperUnits
  paperHeight: number;
  marginLeft: number;
  marginBottom: number;
  /** 0 = inches, 1 = mm, 2 = pixels */
  paperUnits: number;
  rotation: number;          // 0..3 quarter turns
  tabOrder: number;
}

export interface DxfFile {
  version: string;           // $ACADVER, e.g. AC1015
  header: Map<string, Tags>;
  layers: Map<string, DxfLayer>;
  linetypes: Map<string, DxfLinetype>;
  blocks: Map<string, DxfBlock>;
  layouts: DxfLayout[];
  /** Entities of the ENTITIES section: model space plus the active paper space (group 67 = 1). */
  entities: DxfEntity[];
}

export function headerNum(file: DxfFile, name: string, code: number, fallback: number): number {
  return file.header.get(name)?.num(code, fallback) ?? fallback;
}

/** Parse an ASCII DXF document. Unknown sections and objects are skipped. */
export function readDxf(text: string): DxfFile {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const tags = parseTags(text);
  const file: DxfFile = { version: 'AC1009', header: new Map(), layers: new Map(), linetypes: new Map(), blocks: new Map(), layouts: [], entities: [] };
  let i = 0;
  while (i < tags.length) {
    const t = tags[i];
    if (t.code === 0 && t.value === 'EOF') break;
    if (t.code === 0 && t.value === 'SECTION') {
      const name = tags[i + 1]?.code === 2 ? tags[i + 1].value : '';
      const end = findSectionEnd(tags, i + 2);
      const body = tags.slice(i + 2, end);
      switch (name) {
        case 'HEADER':
          readHeader(body, file);
          break;
        case 'TABLES':
          readTables(body, file);
          break;
        case 'BLOCKS':
          readBlocks(body, file);
          break;
        case 'ENTITIES':
          file.entities = readEntities(body);
          break;
        case 'OBJECTS':
          readObjects(body, file);
          break;
      }
      i = end + 1;
      continue;
    }
    i++;
  }
  file.version = file.header.get('$ACADVER')?.str(1, 'AC1009') ?? 'AC1009';
  return file;
}

function findSectionEnd(tags: Tag[], from: number): number {
  for (let i = from; i < tags.length; i++) if (tags[i].code === 0 && tags[i].value === 'ENDSEC') return i;
  return tags.length;
}

function readHeader(body: Tag[], file: DxfFile): void {
  let name: string | null = null;
  let acc: Tag[] = [];
  const flush = () => {
    if (name) file.header.set(name, new Tags(acc));
  };
  for (const t of body) {
    if (t.code === 9) {
      flush();
      name = t.value;
      acc = [];
    } else acc.push(t);
  }
  flush();
}

/** Split a tag run into records starting at each 0-code tag. */
function records(body: Tag[]): { type: string; tags: Tag[] }[] {
  const out: { type: string; tags: Tag[] }[] = [];
  for (const t of body) {
    if (t.code === 0) out.push({ type: t.value, tags: [] });
    else out[out.length - 1]?.tags.push(t);
  }
  return out;
}

function readTables(body: Tag[], file: DxfFile): void {
  let current: string | null = null;
  for (const r of records(body)) {
    if (r.type === 'TABLE') {
      current = r.tags.find((t) => t.code === 2)?.value ?? null;
      continue;
    }
    if (r.type === 'ENDTAB') {
      current = null;
      continue;
    }
    const tg = new Tags(r.tags);
    if (current === 'LAYER' && r.type === 'LAYER') {
      const name = tg.str(2);
      const flags = tg.num(70);
      file.layers.set(name, { name, color: tg.num(62, 7), linetype: tg.str(6, 'Continuous'), lineweight: tg.num(370, -3), frozen: (flags & 1) !== 0 });
    } else if (current === 'LTYPE' && r.type === 'LTYPE') {
      const name = tg.str(2);
      file.linetypes.set(name, { name, pattern: tg.nums(49) });
    }
  }
}

function readBlocks(body: Tag[], file: DxfFile): void {
  let i = 0;
  while (i < body.length) {
    const t = body[i];
    if (t.code === 0 && t.value === 'BLOCK') {
      let j = i + 1;
      while (j < body.length && body[j].code !== 0) j++;
      const head = new Tags(body.slice(i + 1, j));
      let k = j;
      while (k < body.length && !(body[k].code === 0 && body[k].value === 'ENDBLK')) k++;
      const name = head.str(2) || head.str(3);
      // the block's owner (330) is its BLOCK_RECORD; LAYOUT objects point at that record
      file.blocks.set(name, { name, base: head.point(10), entities: readEntities(body.slice(j, k)), handle: head.str(330) });
      i = k + 1;
      continue;
    }
    i++;
  }
}

/** Entities of a tag run, with ATTRIB/VERTEX children folded into their INSERT/POLYLINE. */
export function readEntities(body: Tag[]): DxfEntity[] {
  const out: DxfEntity[] = [];
  let open: DxfEntity | null = null;
  for (const r of records(body)) {
    const e: DxfEntity = { type: r.type, tags: new Tags(r.tags), children: [] };
    if (r.type === 'SEQEND') {
      open = null;
      continue;
    }
    if (open && (r.type === 'ATTRIB' || r.type === 'VERTEX')) {
      open.children.push(e);
      continue;
    }
    out.push(e);
    // INSERT with attributes (66 = 1) and POLYLINE are followed by their children up to SEQEND
    open = (r.type === 'INSERT' && e.tags.num(66) === 1) || r.type === 'POLYLINE' ? e : null;
  }
  return out;
}

function readObjects(body: Tag[], file: DxfFile): void {
  for (const r of records(body)) {
    if (r.type !== 'LAYOUT') continue;
    const tg = new Tags(r.tags);
    const handle = tg.str(330);
    const block = [...file.blocks.values()].find((b) => b.handle === handle);
    // the first code 1 is the plot settings' page-setup name; the layout name is the one under AcDbLayout
    const names = tg.all(1);
    file.layouts.push({
      name: names[names.length - 1] ?? '',
      blockName: block?.name ?? '',
      paperWidth: tg.num(44),
      paperHeight: tg.num(45),
      marginLeft: tg.num(40),
      marginBottom: tg.num(41),
      paperUnits: tg.num(72, 1),
      rotation: tg.num(73),
      tabOrder: tg.num(71),
    });
  }
  file.layouts.sort((a, b) => a.tabOrder - b.tabOrder);
}
