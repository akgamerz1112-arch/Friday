/**
 * Document intelligence, step 1: turn a .docx / .xlsx / .pptx into plain text the
 * model can read. Pure TypeScript, no dependencies, no network.
 *
 * Why no library: these formats are zip files of XML. The WebView (and Node 18+)
 * already ship `DecompressionStream`, so a ~100-line zip reader is enough and adds
 * nothing to the APK or the CI install.
 *
 * What it does NOT do (say so honestly when asked): PDF, the old .doc/.xls/.ppt
 * binary formats, password-protected files, images inside documents, Excel
 * charts/macros, and Excel dates (they come out as the serial number Excel stores).
 */

export type DocKind = "docx" | "xlsx" | "pptx";

export interface ExtractedDocument {
  kind: DocKind;
  text: string;
  /** True when the output was cut at `maxChars`. */
  truncated: boolean;
  /** Characters that were left out (0 when not truncated). */
  omittedChars: number;
}

/** Same ceiling the Android side uses for a base64 read (see PhonePlugin.readFile). */
export const MAX_DOC_BYTES = 12_000_000;
/** One unpacked XML part may not exceed this (zip-bomb guard). */
const MAX_PART_BYTES = 8_000_000;
/** Default size of what goes back to the model (~4k tokens). */
export const DEFAULT_MAX_CHARS = 15_000;
const MAX_SHEET_ROWS = 300;
const MAX_SHEET_COLS = 40;

export type DocumentErrorCode = "unsupported" | "not_zip" | "corrupt" | "too_big";

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  constructor(message: string, code: DocumentErrorCode) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
  }
}

/** Which extractor a file name needs, or null when it's not one of ours. */
export function documentKind(path: string): DocKind | null {
  const m = /\.(docx|xlsx|pptx)$/i.exec(path.trim());
  return m ? (m[1]!.toLowerCase() as DocKind) : null;
}

/** Old binary Office formats and PDF — recognised only so we can say "not supported". */
export function unsupportedDocumentKind(path: string): "pdf" | "legacy-office" | null {
  const m = /\.(pdf|doc|xls|ppt)$/i.exec(path.trim());
  if (!m) return null;
  return m[1]!.toLowerCase() === "pdf" ? "pdf" : "legacy-office";
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── minimal zip reader ──────────────────────────────────────────────────────

interface ZipEntry {
  method: number;
  compSize: number;
  localOffset: number;
}

export interface ZipFile {
  names(): string[];
  /** Unpacked bytes of one entry, or null when it isn't in the archive. */
  read(name: string): Promise<Uint8Array | null>;
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export function openZip(bytes: Uint8Array): ZipFile {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: last 22+ bytes (a comment may follow it).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocumentError("Not a zip-based Office file.", "not_zip");
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  if (count === 0xffff || p === 0xffffffff) {
    throw new DocumentError("Zip64 archives aren't supported.", "unsupported");
  }
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(v, p) !== 0x02014b50) {
      throw new DocumentError("The file's zip directory is damaged.", "corrupt");
    }
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      method: u16(v, p + 10),
      compSize: u32(v, p + 20),
      localOffset: u32(v, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: () => [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lo = e.localOffset;
      if (lo + 30 > bytes.length || u32(v, lo) !== 0x04034b50) {
        throw new DocumentError("The file's zip data is damaged.", "corrupt");
      }
      const start = lo + 30 + u16(v, lo + 26) + u16(v, lo + 28);
      const raw = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method !== 8) throw new DocumentError("Unsupported zip compression.", "unsupported");
      return inflateRaw(raw);
    },
  };
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new DocumentError("A part of the document is too large to read.", "too_big");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ── XML helpers (regex, not DOM: Node tests have no DOMParser) ──────────────

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const t = e.toLowerCase();
    if (t === "amp") return "&";
    if (t === "lt") return "<";
    if (t === "gt") return ">";
    if (t === "quot") return '"';
    if (t === "apos") return "'";
    const code = t.startsWith("#x") ? parseInt(t.slice(2), 16) : parseInt(t.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

async function readText(zip: ZipFile, name: string): Promise<string | null> {
  const b = await zip.read(name);
  return b ? new TextDecoder("utf-8").decode(b) : null;
}

const numericSuffix = (name: string): number => {
  const m = /(\d+)\.xml$/.exec(name);
  return m ? parseInt(m[1]!, 10) : 0;
};

// ── DOCX ────────────────────────────────────────────────────────────────────

export function docxXmlToText(xml: string): string {
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (m[1] !== undefined) out.push(decodeEntities(m[1]));
    else if (tok.startsWith("<w:tab")) out.push("\t");
    else if (tok.startsWith("<w:br")) out.push("\n");
    else if (tok === "</w:tc>") out.push(" | ");
    else out.push("\n"); // </w:p> or </w:tr>
  }
  return out
    .join("")
    .replace(/\n+ \| /g, " | ") // a cell's own paragraph break sits before its separator
    .replace(/ \| (?=\n|$)/g, "") // trailing cell separator at the end of a table row
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(zip: ZipFile): Promise<string> {
  const main = await readText(zip, "word/document.xml");
  if (main === null) throw new DocumentError("This isn't a Word document.", "corrupt");
  let text = docxXmlToText(main);
  const notes: string[] = [];
  for (const part of ["word/footnotes.xml", "word/endnotes.xml"]) {
    const x = await readText(zip, part);
    const t = x ? docxXmlToText(x) : "";
    if (t) notes.push(t);
  }
  if (notes.length) text += `\n\n--- Footnotes ---\n${notes.join("\n")}`;
  return text;
}

// ── XLSX ────────────────────────────────────────────────────────────────────

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    const parts = [...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decodeEntities(m[1] ?? ""));
    out.push(parts.join(""));
  }
  return out;
}

export function sheetXmlToRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const c of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      if (type === "s" && v !== undefined) value = strings[parseInt(v, 10)] ?? "";
      else if (type === "inlineStr") {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
      } else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = decodeEntities(v);
      const idx = ref ? colIndex(ref) : cells.length;
      if (idx >= MAX_SHEET_COLS) continue;
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    rows.push(cells);
  }
  return rows;
}

async function extractXlsx(zip: ZipFile): Promise<string> {
  const wb = await readText(zip, "xl/workbook.xml");
  if (wb === null) throw new DocumentError("This isn't an Excel workbook.", "corrupt");
  const rels = (await readText(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  const target = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = r[1] ?? "";
    const id = /\bId="([^"]+)"/.exec(a)?.[1];
    const t = /\bTarget="([^"]+)"/.exec(a)?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const strings = sharedStrings(await readText(zip, "xl/sharedStrings.xml"));

  const sheets: { name: string; part: string }[] = [];
  let i = 0;
  for (const s of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    i++;
    const a = s[1] ?? "";
    const name = decodeEntities(/\bname="([^"]*)"/.exec(a)?.[1] ?? `Sheet${i}`);
    const rid = /\br:id="([^"]+)"/.exec(a)?.[1];
    sheets.push({ name, part: (rid && target.get(rid)) || `xl/worksheets/sheet${i}.xml` });
  }

  const blocks: string[] = [];
  for (const sh of sheets) {
    const xml = await readText(zip, sh.part);
    if (xml === null) continue;
    const rows = sheetXmlToRows(xml, strings);
    const shown = rows.slice(0, MAX_SHEET_ROWS);
    const lines = shown.map((r) => r.join(" | "));
    const more = rows.length > shown.length ? `\n[... ${rows.length - shown.length} more rows not shown]` : "";
    blocks.push(`## Sheet: ${sh.name} (${rows.length} rows)\n${lines.join("\n")}${more}`);
  }
  if (!blocks.length) throw new DocumentError("No readable sheets in this workbook.", "corrupt");
  return blocks.join("\n\n");
}

// ── PPTX ────────────────────────────────────────────────────────────────────

async function extractPptx(zip: ZipFile): Promise<string> {
  const slides = zip
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b));
  if (!slides.length) throw new DocumentError("This isn't a PowerPoint file.", "corrupt");
  const blocks: string[] = [];
  let n = 0;
  for (const name of slides) {
    n++;
    const xml = (await readText(zip, name)) ?? "";
    const paras: string[] = [];
    for (const p of xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
      const t = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
      if (t.trim()) paras.push(t);
    }
    blocks.push(`## Slide ${n}\n${paras.join("\n")}`);
  }
  return blocks.join("\n\n");
}

// ── entry point ─────────────────────────────────────────────────────────────

export function truncate(text: string, maxChars: number): { text: string; omitted: number } {
  if (text.length <= maxChars) return { text, omitted: 0 };
  return { text: text.slice(0, maxChars), omitted: text.length - maxChars };
}

export async function extractDocument(
  kind: DocKind,
  bytes: Uint8Array,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<ExtractedDocument> {
  if (bytes.length > MAX_DOC_BYTES) {
    throw new DocumentError("That document is too large to read here.", "too_big");
  }
  const zip = openZip(bytes);
  const full = kind === "docx" ? await extractDocx(zip) : kind === "xlsx" ? await extractXlsx(zip) : await extractPptx(zip);
  const { text, omitted } = truncate(full, maxChars);
  return { kind, text, truncated: omitted > 0, omittedChars: omitted };
}
