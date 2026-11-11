export type AiStarter = { label: string; prompt: string };
export function parseAiSuggestions(text: string): AiStarter[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 3)
    throw Error("Invalid suggestions");
  const seen = new Set<string>();
  return value.filter((item): item is AiStarter => {
    if (
      !item ||
      typeof item.label !== "string" ||
      typeof item.prompt !== "string" ||
      !item.label.trim() ||
      !item.prompt.trim() ||
      item.label.length > 80 ||
      item.prompt.length > 400 ||
      /https?:/i.test(item.prompt) ||
      seen.has(item.label.toLowerCase())
    )
      return false;
    seen.add(item.label.toLowerCase());
    return true;
  });
}
