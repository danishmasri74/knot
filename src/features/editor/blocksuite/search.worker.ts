import type { DeckData } from "./card-deck";
import { savedSearchContent } from "./search";
import type { Snapshot } from "../../../services/workspace";
let deck: DeckData | undefined;
self.onmessage = (event: MessageEvent<{ id: string; snapshot: Snapshot; deck?: DeckData }>) => {
  deck ??= event.data.deck;
  try {
    self.postMessage({
      content: savedSearchContent(event.data.id, event.data.snapshot, deck),
    });
  } catch {
    self.postMessage({ error: "Unreadable or oversized saved body" });
  }
};
