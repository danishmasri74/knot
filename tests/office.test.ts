import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractOfficeXml, OFFICE_LIMIT } from "../src/features/editor/office";
describe("Office archive preview bounds", () => {
  it("extracts only the original main XML without changing input bytes", () => {
    const xml = "<document>café &amp; text</document>";
    const bytes = zipSync({
      "word/document.xml": strToU8(xml),
      "word/media/large.bin": new Uint8Array(2 * 1024 * 1024),
    });
    const original = bytes.slice();
    expect(extractOfficeXml(bytes, "Unicode.DOCX")).toBe(xml);
    expect(bytes).toEqual(original);
  });
  it("rejects unsupported formats, corrupt archives and missing body parts", () => {
    for (const name of ["a.doc", "a.docm", "a.xlsx", "a.pptx"])
      expect(() => extractOfficeXml(new Uint8Array(), name)).toThrow(
        "Unsupported",
      );
    expect(() =>
      extractOfficeXml(new Uint8Array([1, 2, 3]), "a.docx"),
    ).toThrow();
    expect(() => extractOfficeXml(zipSync({}), "a.docx")).toThrow("Missing");
  });
  it("bounds compressed input and declared expansion before extraction", () => {
    expect(() =>
      extractOfficeXml(new Uint8Array(OFFICE_LIMIT + 1), "a.docx"),
    ).toThrow("5 MiB");
    expect(() =>
      extractOfficeXml(
        zipSync({ "word/document.xml": new Uint8Array(1024 * 1024 + 1) }),
        "a.docx",
      ),
    ).toThrow("1 MiB");
  });
});
