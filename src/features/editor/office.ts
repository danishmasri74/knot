import { unzipSync } from "fflate";

export interface OfficeSource {
  key: string;
  name: string;
  size: number;
}
export const OFFICE_LIMIT = 5 * 1024 * 1024;
export function extractOfficeXml(bytes: Uint8Array, name: string): string {
  if (!/\.docx$/i.test(name))
    throw new Error(
      "Unsupported format. Only .docx body-text previews are supported.",
    );
  if (bytes.length > OFFICE_LIMIT)
    throw new Error("Office preview limit is 5 MiB.");
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== "word/document.xml") return false;
      if (++count > 1) throw new Error("Duplicate document XML.");
      if (entry.originalSize > 1024 * 1024 || entry.size > 1024 * 1024)
        throw new Error("Document XML exceeds the 1 MiB preview limit.");
      return true;
    },
  });
  const xml = files["word/document.xml"];
  if (!xml)
    throw new Error(
      "Missing Word document XML. Encrypted files are unsupported.",
    );
  if (xml.length > 1024 * 1024)
    throw new Error("Document XML exceeds the preview limit.");
  return new TextDecoder("utf-8", { fatal: true }).decode(xml);
}

export function officeParagraphs(xml: string): string[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XML declarations with entities are unsupported.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "document" ||
    document.documentElement.namespaceURI !== ns
  )
    throw new Error("Invalid or unsupported Word document XML.");
  const body = document.getElementsByTagNameNS(ns, "body")[0];
  if (!body) throw new Error("Missing document body.");
  const paragraphs = Array.from(body.getElementsByTagNameNS(ns, "p"));
  if (paragraphs.length > 5000)
    throw new Error("Preview limit is 5,000 paragraphs.");
  let length = 0;
  return paragraphs.map((p) => {
    const text = Array.from(p.getElementsByTagNameNS(ns, "*"))
      .map((node) => {
        if (node.localName === "t") return node.textContent ?? "";
        if (node.localName === "tab") return "\t";
        if (node.localName === "br" || node.localName === "cr") return "\n";
        return "";
      })
      .join("");
    length += text.length;
    if (length > 100000)
      throw new Error("Preview limit is 100,000 text characters.");
    return text;
  });
}
