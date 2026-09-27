/**
 * Just enough of an Excel reader for the UK's food table.
 *
 * An .xlsx file is a zip of XML: a list of sheets, a table of shared strings
 * and one file of cells per sheet. This reads those into rows of text, which
 * is all a food composition table needs — no formulas worked out, no dates,
 * no styles. A general spreadsheet library would do far more and bring far
 * more with it, for one file read once.
 */
import yauzl, { type Entry, type ZipFile } from 'yauzl';

export interface Sheet {
  name: string;
  /** Row by row, cell by cell, as text; gaps are empty strings. */
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text to plain text: entities, numeric character references. */
export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const c of letters.toUpperCase()) index = index * 26 + (c.charCodeAt(0) - 64);
  return index - 1;
}

/** Every piece of text inside an element, joined: rich text is several runs. */
const textOf = (xml: string): string => unescapeXml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

export function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const at = /\br="(\d+)"/.exec(row[1]);
    const rowIndex = at ? Number(at[1]) - 1 : rows.length;
    const cells: string[] = [];
    for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes);
      const column = ref ? columnIndex(ref[1]) : cells.length;
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's' && value !== undefined) text = strings[Number(value)] ?? '';
      else if (type === 'inlineStr') text = textOf(body);
      else if (value !== undefined) text = unescapeXml(value);
      while (cells.length < column) cells.push('');
      cells[column] = text;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

async function readEntries(path: string): Promise<{ zip: ZipFile; entries: Map<string, Entry> }> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, opened) => (error || !opened ? reject(error ?? new Error('unreadable file')) : resolve(opened))),
  );
  const entries = new Map<string, Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      entries.set(entry.fileName.replace(/^\/+/, ''), entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  return { zip, entries };
}

async function readText(zip: ZipFile, entry: Entry): Promise<string> {
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
    zip.openReadStream(entry, (error, opened) => (error || !opened ? reject(error ?? new Error('unreadable entry')) : resolve(opened))),
  );
  // Events rather than `for await`: yauzl's streams never end when iterated that way.
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/** Every sheet of a workbook, in the workbook's order, as rows of text. */
export async function readWorkbook(path: string): Promise<Sheet[]> {
  const { zip, entries } = await readEntries(path);
  try {
    const workbook = entries.get('xl/workbook.xml');
    const rels = entries.get('xl/_rels/workbook.xml.rels');
    if (!workbook || !rels) throw new Error('not an Excel workbook');
    const strings = entries.has('xl/sharedStrings.xml') ? sharedStrings(await readText(zip, entries.get('xl/sharedStrings.xml')!)) : [];

    const targets = new Map<string, string>();
    for (const rel of (await readText(zip, rels)).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = /\bId="([^"]+)"/.exec(rel[1])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(rel[1])?.[1];
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    }

    const sheets: Sheet[] = [];
    for (const sheet of (await readText(zip, workbook)).matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = unescapeXml(/\bname="([^"]*)"/.exec(sheet[1])?.[1] ?? '');
      const rid = /\br:id="([^"]+)"/.exec(sheet[1])?.[1];
      const target = rid ? targets.get(rid) : undefined;
      const entry = target ? entries.get(`xl/${target}`) : undefined;
      if (entry) sheets.push({ name, rows: sheetRows(await readText(zip, entry), strings) });
    }
    return sheets;
  } finally {
    zip.close();
  }
}
