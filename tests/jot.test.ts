import { expect, it } from "vitest";
import { validateJot } from "../src/features/editor/jot";

it("bounds captures without trimming or transforming submitted text", () => {
  const capture = {
    id: "capture",
    destination: "document",
    text: " café\n你好 ",
  };
  const before = { ...capture };
  validateJot(capture);
  expect(capture).toEqual(before);
  validateJot({ ...capture, text: "x".repeat(10000) });
  for (const invalid of [
    { text: "x".repeat(10001) },
    { text: " \n " },
    { destination: "" },
    { id: "" },
  ])
    expect(() => validateJot({ ...capture, ...invalid })).toThrow();
});
