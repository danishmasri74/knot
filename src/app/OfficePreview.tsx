import { useEffect, useState } from "react";
import { attachments } from "../services/workspace";
import {
  OFFICE_LIMIT,
  officeParagraphs,
  type OfficeSource,
} from "../features/editor/office";

export function OfficePreview({
  sources,
  onClose,
}: {
  sources: OfficeSource[];
  onClose: () => void;
}) {
  const [key, setKey] = useState(sources[0].key);
  const [attempt, setAttempt] = useState(0);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const source = sources.find((source) => source.key === key)!;
  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setParagraphs(null);
    setError("");
    void (async () => {
      try {
        if (!/\.docx$/i.test(source.name))
          throw new Error(
            "Unsupported format. Only .docx body-text previews are supported.",
          );
        if (source.size > OFFICE_LIMIT)
          throw new Error("Office preview limit is 5 MiB.");
        const bytes = new Uint8Array(await attachments.get(key));
        if (cancelled) return;
        if (bytes.length > OFFICE_LIMIT)
          throw new Error("Office preview limit is 5 MiB.");
        worker = new Worker(
          new URL("../features/editor/office.worker.ts", import.meta.url),
          { type: "module" },
        );
        const xml = await new Promise<string>((resolve, reject) => {
          timer = setTimeout(() => {
            worker?.terminate();
            reject(new Error("Office preview timed out."));
          }, 5000);
          worker!.onerror = () =>
            reject(new Error("Unable to decode Office file."));
          worker!.onmessage = (event) =>
            event.data.error
              ? reject(new Error(event.data.error))
              : resolve(event.data.xml);
          worker!.postMessage({ bytes, name: source.name }, [bytes.buffer]);
        });
        if (!cancelled) setParagraphs(officeParagraphs(xml));
      } catch (error) {
        if (!cancelled)
          setError(
            `Unable to preview: ${String(error)} Original attachment retained.`,
          );
      } finally {
        clearTimeout(timer);
        worker?.terminate();
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [key, source.name, source.size, attempt]);
  return (
    <section className="office-preview" aria-label="Office preview">
      <div className="actions">
        <strong>Office preview · Read only</strong>
        <select
          aria-label="Office attachment"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        >
          {sources.map((source) => (
            <option key={source.key} value={source.key}>
              {source.name}
            </option>
          ))}
        </select>
        <button onClick={onClose}>Close Office preview</button>
      </div>
      <p>
        DOCX body text only. Layout, formatting, images, headers, comments and
        embedded objects are omitted; tracked changes are not interpreted. Table
        cells appear as paragraphs. Original file retained.
      </p>
      {error ? (
        <div role="alert">
          {error}{" "}
          <button onClick={() => setAttempt(attempt + 1)}>
            Retry Office preview
          </button>
        </div>
      ) : paragraphs === null ? (
        <p role="status">Loading preview…</p>
      ) : (
        <div className="office-text">
          {paragraphs.some((p) => p.trim()) ? (
            paragraphs.map((p, i) => <p key={i}>{p || "\u00a0"}</p>)
          ) : (
            <p>No supported body text in this document.</p>
          )}
        </div>
      )}
    </section>
  );
}
