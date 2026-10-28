import { extractOfficeXml } from "./office";
self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; name: string }>) => {
  try {
    self.postMessage({
      xml: extractOfficeXml(event.data.bytes, event.data.name),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
