export interface JotCapture {
  id: string;
  destination: string;
  text: string;
}
export function validateJot(value: JotCapture) {
  if (
    !value.id ||
    !value.destination ||
    !value.text.trim() ||
    value.text.length > 10000
  )
    throw new Error(
      "Choose a destination and enter 1–10,000 characters of text.",
    );
}
