import { expect, test } from "vitest";
import { youtubeCards } from "../src/features/editor/blocksuite/youtube-toolbar";

type Fake = { id: string; flavour: string; parent: Fake | null } & Record<
  string,
  unknown
>;
const doc = {
  id: "doc",
  spaceDoc: { getMap: () => new Map<string, string>() },
};
const note: Fake = { id: "note", flavour: "affine:note", parent: null };
const card = (id: string, videoId: string, parent: Fake | null): Fake => ({
  id,
  flavour: "affine:embed-youtube",
  parent,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  videoId,
  title: id,
  doc,
});
const onBoard = card("board", "aaaaaaaaaaa", null);
const zoo = card("zoo", "bbbbbbbbbbb", null);
const inNote = card("inNote", "ccccccccccc", note);
const host = {
  getBlocksByFlavour: () =>
    [onBoard, zoo, inNote].map((model) => ({ model })) as never,
};
const ids = (scope?: Parameters<typeof youtubeCards>[1]) =>
  youtubeCards(host, scope).map((source) => source.blockId);

test("a selected board card sends only its own video", () => {
  expect(ids({ blocks: ["board"] })).toEqual(["board"]);
});
test("a selected note brings the videos inside it", () => {
  expect(ids({ blocks: ["note"] })).toEqual(["inNote"]);
  expect(ids("note")).toEqual(["inNote"]);
});
test("a selection without cards brings none; no scope brings all", () => {
  expect(ids({ blocks: [] })).toEqual([]);
  expect(ids()).toEqual(["board", "zoo", "inNote"]);
});
