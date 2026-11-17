import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import type { Code, ListItem, PhrasingContent, RootContent } from "mdast";
import { ShellIcon } from "./ShellIcon";
import { parseAnswer, safeHref } from "../services/answer-markdown";

export type AnswerMarkdownProps = {
  text: string;
  /** Plain text runs: where citations and slide links become elements. */
  renderText: (value: string) => ReactNode[];
  onLink: (href: string) => void;
  /** A fenced block Knot draws itself (a quiz); undefined draws code. */
  renderCode?: (node: Code, index: number) => ReactNode | undefined;
};

/**
 * An Ask Knot answer drawn from its Markdown tree as React elements: no HTML
 * is ever interpreted, links open only web and email addresses, and remote
 * images are never loaded (their description shows instead).
 */
export const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
  renderText,
  onLink,
  renderCode,
}: AnswerMarkdownProps) {
  const root = useMemo(() => parseAnswer(text), [text]);
  let codeIndex = 0;

  const inline = (nodes: PhrasingContent[]): ReactNode[] =>
    nodes.map((node, i) => {
      switch (node.type) {
        case "text":
          return <Fragment key={i}>{renderText(node.value)}</Fragment>;
        case "strong":
          return <strong key={i}>{inline(node.children)}</strong>;
        case "emphasis":
          return <em key={i}>{inline(node.children)}</em>;
        case "delete":
          return <s key={i}>{inline(node.children)}</s>;
        case "inlineCode":
          return <code key={i}>{node.value}</code>;
        case "break":
          return <br key={i} />;
        case "link":
        case "linkReference": {
          const href = node.type === "link" ? safeHref(node.url) : undefined;
          return href ? (
            <a
              key={i}
              href={href}
              title={href}
              onClick={(event) => {
                event.preventDefault();
                onLink(href);
              }}
            >
              {inline(node.children)}
            </a>
          ) : (
            <span key={i}>{inline(node.children)}</span>
          );
        }
        case "image":
        case "imageReference":
          return (
            <span key={i} className="ask-image-alt">
              <ShellIcon name="image" />
              {node.alt || "Image"}
            </span>
          );
        case "html":
          return <span key={i}>{node.value}</span>;
        case "footnoteReference":
          return <span key={i}>[^{node.identifier}]</span>;
        default:
          return null;
      }
    });

  const item = (node: ListItem, key: number) => {
    const task = typeof node.checked === "boolean";
    const content = node.children.map((child, i) =>
      // Tight list items read as lines, not separate paragraphs.
      child.type === "paragraph" && !node.spread ? (
        <span key={i} className="ask-li-text">
          {inline(child.children)}
        </span>
      ) : (
        block(child, i)
      ),
    );
    return (
      <li key={key} className={task ? "ask-task" : undefined}>
        {task ? (
          <>
            <input
              type="checkbox"
              checked={!!node.checked}
              disabled
              aria-label={node.checked ? "Done" : "Not done"}
            />
            <div className={node.checked ? "ask-task-done" : undefined}>
              {content}
            </div>
          </>
        ) : (
          content
        )}
      </li>
    );
  };

  function block(node: RootContent, key: number): ReactNode {
    switch (node.type) {
      case "heading":
        return node.depth <= 2 ? (
          <h4 key={key} data-depth={node.depth}>
            {inline(node.children)}
          </h4>
        ) : (
          <h5 key={key} data-depth={node.depth}>
            {inline(node.children)}
          </h5>
        );
      case "paragraph":
        return <p key={key}>{inline(node.children)}</p>;
      case "list": {
        // Bullets go only when every item is a checkbox.
        const tasks = node.children.every(
          (child) => typeof child.checked === "boolean",
        );
        const items = node.children.map(item);
        return node.ordered ? (
          <ol key={key} start={node.start ?? undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key} className={tasks ? "ask-tasks" : undefined}>
            {items}
          </ul>
        );
      }
      case "blockquote":
        return (
          <blockquote key={key}>
            {node.children.map((child, i) => block(child, i))}
          </blockquote>
        );
      case "code": {
        const own = renderCode?.(node, codeIndex++);
        return own !== undefined ? (
          <div key={key}>{own}</div>
        ) : (
          <CodeBlock key={key} lang={node.lang ?? ""} value={node.value} />
        );
      }
      case "table": {
        const [head, ...rows] = node.children;
        const align = (i: number) => node.align?.[i] ?? undefined;
        return (
          <div key={key} className="ask-table" tabIndex={0}>
            <table>
              {head && (
                <thead>
                  <tr>
                    {head.children.map((cell, i) => (
                      <th key={i} style={{ textAlign: align(i) }}>
                        {inline(cell.children)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.children.map((cell, i) => (
                      <td key={i} style={{ textAlign: align(i) }}>
                        {inline(cell.children)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "thematicBreak":
        return <hr key={key} />;
      case "html":
        return <p key={key}>{node.value}</p>;
      default:
        return null;
    }
  }

  return (
    <div className="ask-prose">
      {root.children.map((node, i) => block(node, i))}
    </div>
  );
});

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ask-code">
      <div className="ask-code-bar">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <ShellIcon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}
