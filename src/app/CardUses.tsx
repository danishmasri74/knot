import {
  cardPreview,
  type DeckData,
} from "../features/editor/blocksuite/card-deck";
import {
  CardPlacement,
  cardPlacement,
  type CardUse,
  type PlacementIndex,
} from "./CardPlacement";
import { ShellIcon } from "./ShellIcon";
import { ShellMenu } from "./ShellMenu";

export type OpenCardUse = (cardId: string, use: CardUse) => Promise<void>;

/** A card's uses, canvases first (the open canvas on top), then notes that
 * show it, each with what to call it and a second line. */
export function describeUses(
  index: PlacementIndex | undefined,
  id: string,
  deck: DeckData | undefined,
  canvas?: string,
) {
  const owners = new Map(index?.owners.map((owner) => [owner.id, owner]));
  const name = (owner: string) =>
    owners.get(owner)?.title || "Untitled notebook";
  const edited = (owner: string) => {
    const updated = owners.get(owner)?.updated_at;
    return updated
      ? `Edited ${new Date(updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "";
  };
  const uses = index?.uses.get(id) ?? [];
  const canvases = uses
    .filter((use) => use.kind === "canvas")
    .sort(
      (a, b) =>
        Number(b.owner === canvas) - Number(a.owner === canvas) ||
        name(a.owner).localeCompare(name(b.owner), undefined, {
          numeric: true,
        }),
    )
    .map((use) => ({
      use,
      title: name(use.owner),
      detail: [
        use.owner === canvas ? "This canvas" : edited(use.owner),
        use.count > 1 ? `${use.count} copies` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  const notes = uses
    .filter((use) => use.kind === "note" && use.host)
    .map((use) => {
      const host = deck?.[use.host!];
      return {
        use,
        title:
          (host &&
            cardPreview(host, "", deck)
              .split(/\r?\n/)[0]
              .trim()
              .slice(0, 80)) ||
          "Untitled note",
        detail: `In ${name(use.owner)}`,
      };
    });
  return { canvases, notes };
}

/** "On 3 canvases": a menu of where the card is used; picking a row opens
 * that notebook at the card (or the note showing it). */
export function PlacementMenu({
  index,
  cardId,
  deck,
  canvas,
  onOpen,
}: {
  index: PlacementIndex | undefined;
  cardId: string;
  deck: DeckData | undefined;
  canvas?: string;
  onOpen?: OpenCardUse;
}) {
  const placement = cardPlacement(index, cardId, canvas);
  const { canvases, notes } = describeUses(index, cardId, deck, canvas);
  if (!onOpen || (!canvases.length && !notes.length))
    return <CardPlacement placement={placement} />;
  const row = (entry: (typeof canvases)[number], icon: "notebook" | "note") => (
    <button
      key={`${entry.use.kind}:${entry.use.owner}:${entry.use.host ?? ""}`}
      type="button"
      onClick={() => void onOpen(cardId, entry.use)}
    >
      <ShellIcon name={icon} />
      <span className="placement-menu-text">
        <span>{entry.title}</span>
        {entry.detail && <small>{entry.detail}</small>}
      </span>
      <ShellIcon name="chevron" />
    </button>
  );
  return (
    <ShellMenu
      label="Where this card is used"
      className="placement-menu"
      icon={<CardPlacement placement={placement} />}
    >
      {canvases.length > 0 && (
        <div className="placement-menu-heading">Canvases</div>
      )}
      {canvases.map((entry) => row(entry, "notebook"))}
      {canvases.length > 0 && notes.length > 0 && (
        <div className="placement-menu-separator" role="separator" />
      )}
      {notes.length > 0 && (
        <div className="placement-menu-heading">Shown inside notes</div>
      )}
      {notes.map((entry) => row(entry, "note"))}
    </ShellMenu>
  );
}

/** The card page's "Used in" box: every place the card lives, as links. */
export function UsedIn({
  index,
  cardId,
  deck,
  onOpen,
}: {
  index: PlacementIndex | undefined;
  cardId: string;
  deck: DeckData | undefined;
  onOpen: OpenCardUse;
}) {
  const state = cardPlacement(index, cardId).state;
  const { canvases, notes } = describeUses(index, cardId, deck);
  const notebooks = new Set(
    [...canvases, ...notes].map((entry) => entry.use.owner),
  );
  const heading =
    state === "unknown"
      ? "Checking where it’s used…"
      : state === "trashed"
        ? "Only in a notebook in Trash"
        : notebooks.size
          ? `Used in ${notebooks.size} ${notebooks.size === 1 ? "notebook" : "notebooks"}`
          : "Not used anywhere yet";
  return (
    <section className="card-used-in" aria-label="Where this card is used">
      <h2>{heading}</h2>
      {notebooks.size > 0 && (
        <div className="card-used-in-links">
          {canvases.map((entry) => (
            <button
              key={`canvas:${entry.use.owner}`}
              type="button"
              title={entry.detail}
              onClick={() => void onOpen(cardId, entry.use)}
            >
              <ShellIcon name="notebook" />
              <span>{entry.title}</span>
              {entry.use.count > 1 && <small>×{entry.use.count}</small>}
            </button>
          ))}
          {notes.map((entry) => (
            <button
              key={`note:${entry.use.owner}:${entry.use.host}`}
              type="button"
              className="card-used-in-note"
              title={entry.detail}
              onClick={() => void onOpen(cardId, entry.use)}
            >
              <ShellIcon name="note" />
              <span>Inside “{entry.title}”</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
