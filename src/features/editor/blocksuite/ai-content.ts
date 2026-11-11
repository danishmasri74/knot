import { Text, type Doc } from "@blocksuite/store";
import type { DatabaseBlockModel } from "@blocksuite/blocks";

export type AiContent = {
  sourceRefs?: string[];
  type:
    | "paragraph"
    | "h1"
    | "h2"
    | "h3"
    | "bulleted"
    | "numbered"
    | "todo"
    | "table"
    | "kanban";
  text: string;
  columns?: string[];
  rows?: string[][];
};
export type AiBlock = AiContent & { children?: AiContent[] };

export function aiInlineRuns(
  text: string,
): { insert: string; attributes?: { bold?: true; italic?: true } }[] {
  return text
    .split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\n]+\*)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.length > 6 && part.startsWith("***") && part.endsWith("***"))
        return {
          insert: part.slice(3, -3),
          attributes: { bold: true, italic: true },
        };
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
        return { insert: part.slice(2, -2), attributes: { bold: true } };
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*"))
        return { insert: part.slice(1, -1), attributes: { italic: true } };
      return { insert: part };
    });
}
const types = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bulleted",
  "numbered",
  "todo",
  "table",
  "kanban",
];
export function validAiContent(b: AiContent): boolean {
  if (!b || !types.includes(b.type) || typeof b.text !== "string") return false;
  if (
    b.columns !== undefined &&
    (!Array.isArray(b.columns) ||
      b.columns.length > 8 ||
      b.columns.some((c) => typeof c !== "string"))
  )
    return false;
  if (
    b.rows !== undefined &&
    (!Array.isArray(b.rows) ||
      b.rows.length > 40 ||
      b.rows.some(
        (r) =>
          !Array.isArray(r) ||
          r.length > 8 ||
          r.some((c) => typeof c !== "string"),
      ))
  )
    return false;
  if (b.type === "table")
    return (
      !!b.columns?.length &&
      !!b.rows?.length &&
      b.rows.every((r) => r.length === b.columns!.length)
    );
  if (b.type === "kanban")
    return (
      !!b.columns?.length &&
      new Set(b.columns).size === b.columns.length &&
      !!b.rows?.length &&
      b.rows.every((r) => r.length === 2 && b.columns!.includes(r[1]))
    );
  return !b.columns?.length && !b.rows?.length;
}
export function aiBlockText(b: AiBlock): string {
  return [
    b.text,
    ...(b.columns ?? []),
    ...(b.rows ?? []).map((r) => r.join(" | ")),
    ...(b.children ?? []).map(aiBlockText),
  ]
    .filter(Boolean)
    .join("\n");
}
export function appendAiContent(doc: Doc, parent: string, b: AiContent) {
  if (b.type === "table" || b.type === "kanban") {
    const title = { id: "title", name: "Title", type: "title", data: {} };
    const status = { id: "status", name: "Status", type: "select", data: {} };
    const palette = [
      "var(--affine-tag-blue)",
      "var(--affine-tag-yellow)",
      "var(--affine-tag-green)",
    ];
    const options = b.columns!.map((value, i) => ({
      id: `stage-${i}`,
      value,
      color: palette[i % palette.length],
    }));
    const columns =
      b.type === "kanban"
        ? [title, { ...status, data: { options } }]
        : [
            { ...title, name: b.columns![0] },
            ...b.columns!.slice(1).map((name, i) => ({
              id: `column-${i}`,
              name,
              type: "rich-text",
              data: {},
            })),
          ];
    const cells: DatabaseBlockModel["cells"] = {};
    const rows = b.rows!.map((row) => ({ row, rowId: doc.generateBlockId() }));
    for (const { row, rowId } of rows) {
      cells[rowId] =
        b.type === "kanban"
          ? {
              [status.id]: {
                columnId: status.id,
                value: options.find((o) => o.value === row[1])!.id,
              },
            }
          : Object.fromEntries(
              columns
                .slice(1)
                .map((c, i) => [
                  c.id,
                  { columnId: c.id, value: new Text(aiInlineRuns(row[i + 1])) },
                ]),
            );
    }
    const props = {
      title: new Text(aiInlineRuns(b.text)),
      columns,
      cells,
      views: [
        {
          id: doc.generateBlockId(),
          mode: b.type,
          name: b.type === "table" ? "Table" : "Kanban",
          filter: { type: "group", op: "and", conditions: [] },
          header: { titleColumn: title.id, iconColumn: "type" },
          columns: columns.map((c) => ({
            id: c.id,
            hide: b.type === "kanban" && c.type === "title",
            width: 200,
          })),
          ...(b.type === "kanban"
            ? {
                groupBy: {
                  type: "groupBy",
                  columnId: status.id,
                  name: "select",
                },
                groupProperties: [
                  ...options.map((o) => ({
                    key: o.id,
                    hide: false,
                    manuallyCardSort: [],
                  })),
                  { key: "Ungroups", hide: false, manuallyCardSort: [] },
                ],
              }
            : {}),
        },
      ],
    };
    const id = doc.addBlock("affine:database", props, parent);
    for (const { row, rowId } of rows) {
      const rowProps = { id: rowId, text: new Text(aiInlineRuns(row[0])) };
      doc.addBlock("affine:paragraph", rowProps, id);
    }
  } else if (["bulleted", "numbered", "todo"].includes(b.type)) {
    doc.addBlock(
      "affine:list",
      {
        type: b.type as "bulleted" | "numbered" | "todo",
        text: new Text(aiInlineRuns(b.text)),
        checked: false,
      },
      parent,
    );
  } else {
    doc.addBlock(
      "affine:paragraph",
      {
        type: b.type === "paragraph" ? "text" : (b.type as "h1" | "h2" | "h3"),
        text: new Text(aiInlineRuns(b.text)),
      },
      parent,
    );
  }
}
export function appendAiBlock(doc: Doc, parent: string, b: AiBlock) {
  appendAiContent(
    doc,
    parent,
    b.children?.length ? { type: "h2", text: b.text } : b,
  );
  for (const child of b.children ?? []) appendAiContent(doc, parent, child);
}

export function aiBlockSize(b: AiBlock) {
  const parts = b.children?.length
    ? [{ type: "h2", text: b.text } as AiContent, ...b.children]
    : [b];
  return {
    width: Math.max(
      360,
      ...parts.map((p) =>
        p.type === "table"
          ? Math.max(600, (p.columns?.length ?? 0) * 200 + 80)
          : p.type === "kanban"
            ? Math.max(760, (p.columns?.length ?? 0) * 280 + 80)
            : 360,
      ),
    ),
    height:
      80 +
      parts.reduce(
        (height, p) =>
          height +
          (p.type === "table"
            ? 160 + (p.rows?.length ?? 0) * 80
            : p.type === "kanban"
              ? 200 + (p.rows?.length ?? 0) * 120
              : 48 + Math.ceil(p.text.length / 28) * 30),
        0,
      ),
  };
}
