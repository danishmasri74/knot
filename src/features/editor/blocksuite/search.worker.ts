import { savedSearchText } from "./search";
import type { Snapshot } from "../../../services/workspace";
self.onmessage = (event: MessageEvent<{ id: string; snapshot: Snapshot }>) => {
  try {
    self.postMessage({
      text: savedSearchText(event.data.id, event.data.snapshot),
    });
  } catch {
    self.postMessage({ error: "Unreadable or oversized saved body" });
  }
};
