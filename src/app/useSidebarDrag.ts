import { useState, type DragEvent, type HTMLAttributes } from "react";
import {
  collections,
  type Catalog,
  type KnowledgeObject,
} from "../services/workspace";

type Drag =
  | {
      kind: "notebook";
      item: KnowledgeObject;
      source: string | null;
      fromFavorites?: boolean;
    }
  | { kind: "collection"; id: string };
type Target =
  | { kind: "collection"; id: string; after?: boolean }
  | { kind: "pin" }
  | { kind: "favorites"; id?: string; after?: boolean }
  | { kind: "remove" }
  | { kind: "trash" };
export function membershipAfterDrop(
  ids: string[],
  source: string | null,
  target: string | null,
  copy: boolean,
) {
  return [
    ...new Set([
      ...ids.filter((id) => copy || id !== source),
      ...(target ? [target] : []),
    ]),
  ];
}
export function reorderedCollections(
  ids: string[],
  source: string,
  target: string,
  after: boolean,
) {
  if (source === target) return ids;
  const next = ids.filter((id) => id !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
}
export function useSidebarDrag(
  catalog: Catalog,
  busy: boolean,
  run: (task: () => Promise<void>) => Promise<void>,
  changed: () => Promise<void>,
  trash: (item: KnowledgeObject) => void,
  trashCollection: (id: string) => void,
  pin: (id: string) => void,
  reorderFavorite: (id: string, target: string, after: boolean) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [copy, setCopy] = useState(false);
  const clear = () => {
    setDrag(null);
    setTarget(null);
    setCopy(false);
  };
  const name = (id: string) =>
    catalog.collections.find((c) => c.id === id)?.name ?? "collection";
  const sourceName =
    drag?.kind === "notebook"
      ? drag.fromFavorites
        ? "Favorites"
        : drag.source
          ? name(drag.source)
          : null
      : null;
  const valid = (t: Target) =>
    !busy &&
    drag &&
    (drag.kind === "collection"
      ? t.kind === "pin" ||
        t.kind === "trash" ||
        (t.kind === "collection" && t.id !== drag.id)
      : t.kind !== "pin" &&
        (t.kind !== "remove" || !!drag.source || !!drag.fromFavorites)) &&
    !(
      drag.kind === "notebook" &&
      t.kind === "collection" &&
      t.id === drag.source
    ) &&
    !(
      drag.kind === "notebook" &&
      t.kind === "favorites" &&
      t.id === drag.item.id
    );
  const start = (value: Drag): HTMLAttributes<HTMLElement> => ({
    draggable: !busy,
    onDragStart: (event) => {
      if (
        (event.target as HTMLElement).closest(
          ".collection-options-trigger, .collection-membership-trigger",
        )
      ) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.setData("application/x-knot-sidebar", value.kind);
      event.dataTransfer.effectAllowed =
        value.kind === "collection" ? "move" : "copyMove";
      setDrag(value);
    },
    onDragEnd: clear,
  });
  const drop = (t: Target): HTMLAttributes<HTMLElement> => ({
    onDragOver: (event) => {
      if (!valid(t)) return;
      event.preventDefault();
      event.stopPropagation();
      const copying = event.ctrlKey || event.metaKey;
      event.dataTransfer.dropEffect =
        drag?.kind === "notebook" &&
        ((t.kind === "favorites" && !drag.fromFavorites) ||
          (t.kind === "collection" && (!drag.source || copying)))
          ? "copy"
          : "move";
      setCopy(copying);
      const after =
        (drag?.kind === "collection" && t.kind === "collection") ||
        (t.kind === "favorites" && !!t.id)
          ? event.clientY >
            event.currentTarget.getBoundingClientRect().top +
              event.currentTarget.getBoundingClientRect().height / 2
          : undefined;
      setTarget({
        ...t,
        ...(t.kind === "collection" || t.kind === "favorites" ? { after } : {}),
      });
      const library = event.currentTarget.closest(".library");
      if (library) {
        const box = library.getBoundingClientRect();
        if (event.clientY < box.top + 36) library.scrollTop -= 12;
        if (event.clientY > box.bottom - 36) library.scrollTop += 12;
      }
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        setTarget(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!valid(t) || !drag) return;
      event.preventDefault();
      event.stopPropagation();
      const current = drag;
      const copying = event.ctrlKey || event.metaKey;
      const after =
        (t.kind === "collection" || t.kind === "favorites") &&
        event.clientY >
          event.currentTarget.getBoundingClientRect().top +
            event.currentTarget.getBoundingClientRect().height / 2;
      clear();
      if (current.kind === "collection" && t.kind === "trash") {
        trashCollection(current.id);
        return;
      }
      if (current.kind === "notebook" && t.kind === "trash") {
        trash(current.item);
        return;
      }
      void run(async () => {
        if (current.kind === "collection" && t.kind === "pin") {
          pin(current.id);
        } else if (current.kind === "collection" && t.kind === "collection") {
          await collections.reorder(
            reorderedCollections(
              catalog.collections.map((c) => c.id),
              current.id,
              t.id,
              after,
            ),
          );
          pin(current.id);
        } else if (current.kind === "notebook" && t.kind === "favorites") {
          if (!catalog.favorites.includes(current.item.id))
            await collections.favorite(current.item.id, true);
          if (t.id) reorderFavorite(current.item.id, t.id, after);
        } else if (
          current.kind === "notebook" &&
          current.fromFavorites &&
          t.kind === "remove"
        ) {
          await collections.favorite(current.item.id, false);
        } else if (current.kind === "notebook") {
          const latest = await collections.get(current.item.id);
          await collections.save(current.item.id, {
            collections: membershipAfterDrop(
              latest.collections,
              current.source,
              t.kind === "collection" ? t.id : null,
              t.kind === "collection" && copying,
            ),
          });
        }
        await changed();
      });
    },
  });
  const indicator = (id: string) =>
    target?.kind === "collection" && target.id === id
      ? drag?.kind === "collection"
        ? target.after
          ? "after"
          : "before"
        : "inside"
      : undefined;
  const message = !target
    ? ""
    : target.kind === "pin"
      ? "Pin collection to sidebar"
      : target.kind === "favorites"
        ? target.id
          ? `Place ${target.after ? "after" : "before"} ${catalog.favorites.includes(target.id) ? "favorite" : "notebook"}`
          : "Add to Favorites"
        : target.kind === "trash"
          ? `Move ${drag?.kind === "collection" ? "collection" : "notebook"} to Trash`
          : target.kind === "remove"
            ? `Remove from ${sourceName}`
            : drag?.kind === "collection"
              ? `Place ${target.after ? "after" : "before"} ${name(target.id)}`
              : drag?.kind === "notebook" && drag.source && !copy
                ? `Move from ${sourceName} to ${name(target.id)}`
                : `Add to ${name(target.id)}`;
  const favoriteIndicator = (id: string) =>
    target?.kind === "favorites" && target.id === id
      ? target.after
        ? "after"
        : "before"
      : undefined;
  return {
    drag,
    target,
    sourceName,
    message,
    start,
    drop,
    indicator,
    favoriteIndicator,
  };
}
