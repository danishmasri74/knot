import type { BlockModel, Doc } from "@blocksuite/store";
import type * as Y from "yjs";

type Popped = {
  type: "undo" | "redo";
  changedParentTypes: Map<Y.AbstractType<unknown>, Y.YEvent<Y.AbstractType<unknown>>[]>;
};

/** Calls back with the notes an undo or redo changed, from the editor
 * shortcut or Knot's own buttons alike. A change inside a note's text, or to
 * a block nested anywhere in it, counts for that note. Returns a stop
 * function. */
export function watchHistoryNotes(
  doc: Doc,
  onChange: (type: "undo" | "redo", noteIds: string[]) => void,
) {
  const blocks = doc.spaceDoc.getMap("blocks");
  const popped = ({ type, changedParentTypes }: Popped) => {
    const ids = new Set<string>();
    for (const [changed, events] of changedParentTypes) {
      // Blocks added or removed: their ids are the changed keys.
      if (changed === (blocks as unknown)) {
        for (const event of events)
          for (const key of (event as Y.YMapEvent<unknown>).keysChanged)
            ids.add(key);
        continue;
      }
      // Anything else lives inside one block's map; climb to it.
      let item = changed._item;
      while (item) {
        if (item.parent === (blocks as unknown)) {
          if (item.parentSub) ids.add(item.parentSub);
          break;
        }
        item = (item.parent as Y.AbstractType<unknown>)._item;
      }
    }
    const notes = new Set<string>();
    for (const id of ids) {
      // A block that no longer exists (an undone insert) is covered by its
      // parent, whose children list changed too.
      let model: BlockModel | null | undefined = doc.getBlock(id)?.model;
      while (model && model.flavour !== "affine:note")
        model = doc.getParent(model);
      if (model) notes.add(model.id);
    }
    if (notes.size) onChange(type, [...notes]);
  };
  doc.history.on("stack-item-popped", popped as never);
  return () => doc.history.off("stack-item-popped", popped as never);
}
