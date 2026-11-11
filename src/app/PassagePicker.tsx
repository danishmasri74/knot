import { useEffect, useState, type ReactNode } from "react";
import type { DocCollection } from "@blocksuite/store";
import {
  structuredAiBlocks,
  type ContextBlock,
} from "../features/editor/blocksuite/ai";
import {
  savedSearchText,
  SEARCH_DOCUMENTS,
  SEARCH_TOTAL_BYTES,
} from "../features/editor/blocksuite/search";
import { repository, type KnowledgeObject } from "../services/workspace";
import { detectWebUrls, webSourceLabel } from "../services/web-sources";
import { ShellIcon } from "./ShellIcon";

export type Passage = {
  source: KnowledgeObject;
  block: ContextBlock;
  label: string;
  noteTitle?: string;
};

export function PassagePicker({
  choices,
  collection,
  onPick,
  onNote,
  onUrls,
  browseActions,
  browseImages,
}: {
  choices: KnowledgeObject[];
  collection?: DocCollection;
  onPick: (passage: Passage) => void;
  onNote?: (note: KnowledgeObject) => void;
  onUrls?: (urls: string[]) => void;
  browseActions?: ReactNode;
  browseImages?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Passage[]>([]);
  const [status, setStatus] = useState("");
  const addressParts = query.trim().split(/\s+/);
  const isWebsite =
    !!onUrls &&
    addressParts.every((part) => detectWebUrls(part, true).length === 1);
  const urls = isWebsite ? detectWebUrls(query, true) : [];
  const noteMatches = onNote
    ? choices
        .filter((note) =>
          note.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, query.trim() ? 12 : 4)
    : [];
  useEffect(() => {
    let active = true;
    const term = query.trim().toLowerCase();
    if (!term || isWebsite) return;
    async function search() {
      const matches: Passage[] = [];
      let partial = choices.length > SEARCH_DOCUMENTS;
      let bytes = 0;
      for (const source of choices.slice(0, SEARCH_DOCUMENTS)) {
        if (!active) return;
        const doc = collection?.getDoc(source.id);
        let blocks: ContextBlock[];
        if (doc?.loaded && doc.root) blocks = structuredAiBlocks(doc.root);
        else {
          const snapshot = await repository.load(source.id);
          if (!snapshot) continue;
          bytes += snapshot.collection.length + snapshot.document.length;
          if (bytes > SEARCH_TOTAL_BYTES) {
            partial = true;
            break;
          }
          try {
            blocks = JSON.parse(savedSearchText(source.id, snapshot, true));
          } catch {
            partial = true;
            continue;
          }
        }
        const titles = new Map<string, string>();
        for (const block of blocks) {
          if (
            block.note &&
            block.parent === block.note &&
            block.text.trim() &&
            !titles.has(block.note)
          )
            titles.set(block.note, block.text.trim().slice(0, 80));
        }
        for (const block of blocks) {
          const index = block.text.toLowerCase().indexOf(term);
          if (index < 0) continue;
          const label = block.text.slice(
            Math.max(0, index - 40),
            index + term.length + 90,
          );
          matches.push({
            source,
            block,
            label,
            noteTitle: block.note ? titles.get(block.note) : undefined,
          });
          if (matches.length === 30) break;
        }
        if (matches.length === 30) {
          partial = true;
          break;
        }
      }
      if (active) {
        setHits(matches);
        setStatus(
          partial
            ? "Showing partial results."
            : matches.length
              ? ""
              : "No matching passages.",
        );
      }
    }
    const timer = setTimeout(
      () => void search().catch((e) => active && setStatus(String(e))),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, choices, collection, isWebsite]);
  return (
    <div className={onNote ? "ask-picker-content" : undefined}>
      <input
        autoFocus
        aria-label={
          onUrls
            ? "Search attachments or paste a website URL"
            : "Search passages"
        }
        placeholder={
          onUrls
            ? "Search notes or paste a URL..."
            : "Find a passage by its words..."
        }
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHits([]);
          setStatus("Searching...");
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.nativeEvent.isComposing &&
            urls.length
          ) {
            event.preventDefault();
            onUrls?.(urls);
          }
        }}
      />
      <div className={onNote ? "ask-picker-body" : undefined}>
        {urls.length > 0 ? (
          <div className="ask-picker-results">
            <button type="button" onClick={() => onUrls?.(urls)}>
              <ShellIcon name="link" />
              <span>
                {urls.length === 1
                  ? `Attach ${webSourceLabel(urls[0])}`
                  : `Attach ${urls.length} websites`}
              </span>
            </button>
          </div>
        ) : (
          <>
            {!query.trim() && browseActions}
            {noteMatches.length > 0 && (
              <div className="ask-picker-results">
                <div className="ask-picker-heading">Notes</div>
                {noteMatches.map((note) => (
                  <button
                    type="button"
                    key={note.id}
                    onClick={() => onNote?.(note)}
                  >
                    <ShellIcon name="note" /> <span>{note.title}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() ? (
              <div
                className={
                  onNote ? "ask-picker-results ask-picker-passages" : undefined
                }
              >
                {onNote && hits.length > 0 && (
                  <div className="ask-picker-heading">Passages</div>
                )}
                {status && <small role="status">{status}</small>}
                {hits.map((hit) => (
                  <button
                    type="button"
                    key={JSON.stringify([hit.source.id, hit.block.id])}
                    onClick={() => onPick(hit)}
                  >
                    <ShellIcon name="note" />
                    <span>
                      <strong>
                        {[hit.source.title, hit.noteTitle]
                          .filter(Boolean)
                          .join(" / ")}
                      </strong>{" "}
                      {hit.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              browseImages
            )}
          </>
        )}
      </div>
    </div>
  );
}
