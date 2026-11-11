import {
  aiInlineRuns,
  type AiBlock,
} from "../features/editor/blocksuite/ai-content";
import { readCitationSources } from "../services/ai-citations";

function Inline({ text }: { text: string }) {
  return (
    <>
      {aiInlineRuns(text).map((run, i) => {
        const content = run.attributes?.italic ? (
          <em>{run.insert}</em>
        ) : (
          run.insert
        );
        return run.attributes?.bold ? (
          <strong key={i}>{content}</strong>
        ) : (
          <span key={i}>{content}</span>
        );
      })}
    </>
  );
}

export function AiBlocksPreview({
  blocks,
  context,
}: {
  blocks: AiBlock[];
  context?: string;
}) {
  let number = 0;
  return (
    <>
      {blocks.map((block, i) => {
        number = block.type === "numbered" ? number + 1 : 0;
        return (
          <div key={i}>
            <AiBlockPreview block={block} number={number} context={context} />
            {!!block.sourceRefs?.length && (
              <small>
                {block.sourceRefs
                  .map(
                    (ref) =>
                      readCitationSources(context).find(
                        (s) => s.kind === "web" && s.ref === ref,
                      )?.citation ?? "Unavailable evidence",
                  )
                  .join(" ")}
              </small>
            )}
          </div>
        );
      })}
    </>
  );
}
function AiBlockPreview({
  block: b,
  number,
  context,
}: {
  block: AiBlock;
  number: number;
  context?: string;
}) {
  if (b.children?.length)
    return (
      <section>
        <h4>
          <Inline text={b.text} />
        </h4>
        <AiBlocksPreview blocks={b.children} context={context} />
      </section>
    );
  if (b.type === "table")
    return (
      <div style={{ overflowX: "auto" }}>
        <strong>
          <Inline text={b.text} />
        </strong>
        <table>
          <thead>
            <tr>
              {b.columns?.map((c, i) => (
                <th key={i}>
                  <Inline text={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows?.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    <Inline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (b.type === "kanban")
    return (
      <section>
        <h4>
          <Inline text={b.text} />
        </h4>
        {b.columns?.map((stage, i) => (
          <div key={i}>
            <strong>{stage}</strong>
            <ul>
              {b.rows
                ?.filter((r) => r[1] === stage)
                .map((r, j) => (
                  <li key={j}>
                    <Inline text={r[0]} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    );
  if (/^h[1-3]$/.test(b.type))
    return (
      <h4>
        <Inline text={b.text} />
      </h4>
    );
  if (b.type === "bulleted")
    return (
      <div>
        • <Inline text={b.text} />
      </div>
    );
  if (b.type === "numbered")
    return (
      <div>
        {number}. <Inline text={b.text} />
      </div>
    );
  if (b.type === "todo")
    return (
      <div>
        ☐ <Inline text={b.text} />
      </div>
    );
  return (
    <p>
      <Inline text={b.text} />
    </p>
  );
}
