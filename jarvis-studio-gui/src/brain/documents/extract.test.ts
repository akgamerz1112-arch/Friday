import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  DocumentError,
  documentKind,
  docxXmlToText,
  extractDocument,
  sheetXmlToRows,
  unsupportedDocumentKind,
} from "./extract";

/** Tiny zip writer (stored or deflated) so the tests need no fixture files. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function makeZip(files: Record<string, string>, deflate = false): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflate ? await deflateRaw(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = new Uint8Array([
      ...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(0, 4),
      ...le(data.length, 4), ...le(raw.length, 4), ...le(nameB.length, 2), ...le(0, 2), ...nameB, ...data,
    ]);
    central.push(
      new Uint8Array([
        ...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(0, 4),
        ...le(data.length, 4), ...le(raw.length, 4), ...le(nameB.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2),
        ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nameB,
      ]),
    );
    parts.push(local);
    offset += local.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array([
    ...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(central.length, 2), ...le(central.length, 2),
    ...le(cdSize, 4), ...le(offset, 4), ...le(0, 2),
  ]);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const DOCX = `<w:document><w:body>
<w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>line</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Rent</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

describe("documentKind", () => {
  it("recognises Office files and flags unsupported ones", () => {
    expect(documentKind("Reports/Q3.DOCX")).toBe("docx");
    expect(documentKind("a/b.xlsx")).toBe("xlsx");
    expect(documentKind("deck.pptx")).toBe("pptx");
    expect(documentKind("notes.txt")).toBeNull();
    expect(unsupportedDocumentKind("scan.pdf")).toBe("pdf");
    expect(unsupportedDocumentKind("old.doc")).toBe("legacy-office");
    expect(unsupportedDocumentKind("new.docx")).toBeNull();
  });
});

describe("docx", () => {
  it("keeps paragraph breaks, decodes entities and joins table cells", () => {
    const t = docxXmlToText(DOCX);
    expect(t).toContain("Hello & welcome");
    expect(t).toContain("Second line");
    expect(t).toContain("Name | Amount");
    expect(t).toContain("Rent | 5000");
  });

  it("extracts from a stored zip and from a deflated zip", async () => {
    for (const deflate of [false, true]) {
      const zip = await makeZip({ "word/document.xml": DOCX }, deflate);
      const r = await extractDocument("docx", zip);
      expect(r.text).toContain("Rent | 5000");
      expect(r.truncated).toBe(false);
    }
  });

  it("truncates honestly and reports how much was left out", async () => {
    const zip = await makeZip({ "word/document.xml": DOCX });
    const r = await extractDocument("docx", zip, 20);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(20);
    expect(r.omittedChars).toBeGreaterThan(0);
  });
});

describe("xlsx", () => {
  const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="inlineStr"><is><t>x &lt; y</t></is></c></row>
</sheetData></worksheet>`;

  it("fills gaps between columns and resolves shared strings", () => {
    const rows = sheetXmlToRows(sheet, ["Item", "Price"]);
    expect(rows[0]).toEqual(["Item", "", "Price"]);
    expect(rows[1]).toEqual(["42", "TRUE", "x < y"]);
  });

  it("reads sheet names and follows relationships", async () => {
    const zip = await makeZip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Budget &amp; Plan" sheetId="1" r:id="rId7"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Item</t></si><si><r><t>Pri</t></r><r><t>ce</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": sheet,
    });
    const r = await extractDocument("xlsx", zip);
    expect(r.text).toContain("## Sheet: Budget & Plan (2 rows)");
    expect(r.text).toContain("Item |  | Price");
    expect(r.text).toContain("42 | TRUE | x < y");
  });
});

describe("pptx", () => {
  it("orders slides numerically (slide10 after slide2)", async () => {
    const mk = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const zip = await makeZip({
      "ppt/slides/slide10.xml": mk("Ten"),
      "ppt/slides/slide2.xml": mk("Two"),
      "ppt/slides/slide1.xml": mk("One"),
    });
    const r = await extractDocument("pptx", zip);
    expect(r.text.indexOf("One")).toBeLessThan(r.text.indexOf("Two"));
    expect(r.text.indexOf("Two")).toBeLessThan(r.text.indexOf("Ten"));
    expect(r.text).toContain("## Slide 3\nTen");
  });
});

describe("bad input", () => {
  it("rejects non-zip bytes with a clear code", async () => {
    let code = "";
    try {
      await extractDocument("docx", new TextEncoder().encode("just some text, not a zip file at all"));
    } catch (e) {
      code = e instanceof DocumentError ? e.code : "other";
    }
    expect(code).toBe("not_zip");
  });

  it("rejects a zip that is not the expected document type", async () => {
    const zip = await makeZip({ "hello.txt": "hi" });
    let code = "";
    try {
      await extractDocument("xlsx", zip);
    } catch (e) {
      code = e instanceof DocumentError ? e.code : "other";
    }
    expect(code).toBe("corrupt");
  });

  it("decodes base64", () => {
    expect(Array.from(base64ToBytes("SGk="))).toEqual([72, 105]);
  });
});
