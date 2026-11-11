import { extractWebSource } from "./web-source-extraction";
self.onmessage = (
  event: MessageEvent<{ body: string; contentType: string }>,
) => {
  try {
    self.postMessage({
      result: extractWebSource(event.data.body, event.data.contentType),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
