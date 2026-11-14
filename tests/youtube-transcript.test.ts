import { describe, expect, it } from "vitest";
import {
  activeChapter,
  activeLine,
  formatTimestamp,
  lineMatches,
  parseTranscript,
  transcriptLines,
  transcriptRows,
  youtubeVideoId,
  type TranscriptSegment,
} from "../src/services/youtube-transcript";

const seg = (start: number, text: string, duration = 2000): TranscriptSegment => ({
  start,
  duration,
  text,
});

describe("formatTimestamp", () => {
  it("uses m:ss under an hour and h:mm:ss after", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65_400)).toBe("1:05");
    expect(formatTimestamp(754_999)).toBe("12:34");
    expect(formatTimestamp(3_723_000)).toBe("1:02:03");
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});

describe("transcriptLines", () => {
  it("merges short captions into lines that end at sentences", () => {
    const lines = transcriptLines([
      seg(0, "So a transformation"),
      seg(2000, "is really a function."),
      seg(5500, "Vectors go in,"),
      seg(7000, "vectors come out."),
      seg(11_000, "Next."),
    ]);
    expect(lines).toEqual([
      { start: 0, text: "So a transformation is really a function." },
      { start: 5500, text: "Vectors go in, vectors come out." },
      { start: 11_000, text: "Next." },
    ]);
    // Under 5 seconds, a sentence end doesn't break the line yet.
    expect(transcriptLines([seg(0, "Hi."), seg(1500, "There.")])).toHaveLength(1);
  });

  it("breaks after 10 seconds even mid-sentence", () => {
    const lines = transcriptLines([seg(0, "and"), seg(4000, "then"), seg(10_000, "more")]);
    expect(lines.map((l) => l.start)).toEqual([0, 10_000]);
  });

  it("uses start times only, so overlapping auto captions still merge", () => {
    const lines = transcriptLines([seg(4320, "This is a three.", 4120), seg(6810, "It's sloppily", 4390)]);
    expect(lines).toHaveLength(1);
  });

  it("starts a new line at each chapter", () => {
    const lines = transcriptLines([seg(0, "intro"), seg(2000, "still intro"), seg(4000, "vectors")], [
      { start: 0, title: "Intro" },
      { start: 3000, title: "Vectors" },
    ]);
    expect(lines.map((l) => l.start)).toEqual([0, 4000]);
  });
});

describe("transcriptRows", () => {
  it("puts each chapter heading before its first line", () => {
    const rows = transcriptRows(
      [
        { start: 0, text: "a" },
        { start: 4000, text: "b" },
        { start: 9000, text: "c" },
      ],
      [
        { start: 0, title: "Intro" },
        { start: 3000, title: "Vectors" },
      ],
    );
    expect(rows.map((r) => (r.type === "chapter" ? `# ${r.title}` : r.text))).toEqual([
      "# Intro",
      "a",
      "# Vectors",
      "b",
      "c",
    ]);
    expect(rows.filter((r) => r.type === "line").map((r) => r.type === "line" && r.index)).toEqual([0, 1, 2]);
  });
});

describe("activeLine and activeChapter", () => {
  const lines = [
    { start: 1000, text: "a" },
    { start: 5000, text: "b" },
    { start: 9000, text: "c" },
  ];
  it("finds the line playing at a time", () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 1000)).toBe(0);
    expect(activeLine(lines, 8999)).toBe(1);
    expect(activeLine(lines, 60_000)).toBe(2);
    expect(activeLine([], 10)).toBe(-1);
  });
  it("finds the chapter playing at a time", () => {
    const chapters = [
      { start: 0, title: "Intro" },
      { start: 5000, title: "Body" },
    ];
    expect(activeChapter(chapters, 4999)?.title).toBe("Intro");
    expect(activeChapter(chapters, 5000)?.title).toBe("Body");
    expect(activeChapter([], 5000)).toBeUndefined();
  });
});

describe("lineMatches", () => {
  it("ignores case and accents; an empty query matches", () => {
    expect(lineMatches("Café au lait", "cafe")).toBe(true);
    expect(lineMatches("Matrix", "MAT")).toBe(true);
    expect(lineMatches("Matrix", "vector")).toBe(false);
    expect(lineMatches("Anything", "  ")).toBe(true);
  });
});

describe("parseTranscript", () => {
  const valid = {
    version: 1,
    videoId: "jNQXAC9IVRw",
    title: "Me at the zoo",
    channel: "jawed",
    duration: 19,
    track: { id: ".en", language: "en", name: "English", kind: "manual" },
    tracks: [{ id: ".en", language: "en", name: "English", kind: "manual" }],
    chapters: [],
    segments: [seg(1200, "All right"), { start: "x" }],
    fetchedAt: 1,
  };
  it("accepts saved JSON and drops malformed segments", () => {
    const t = parseTranscript(JSON.stringify(valid));
    expect(t?.segments).toEqual([seg(1200, "All right")]);
  });
  it("treats anything unexpected as missing", () => {
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript("{")).toBeNull();
    expect(parseTranscript(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    expect(parseTranscript(JSON.stringify({ ...valid, track: { kind: "other" } }))).toBeNull();
  });
});

describe("youtubeVideoId", () => {
  it("reads common YouTube addresses", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://youtu.be/jNQXAC9IVRw?t=3")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://m.youtube.com/shorts/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://www.youtube.com/embed/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://example.com/watch?v=jNQXAC9IVRw")).toBeNull();
    expect(youtubeVideoId("not a url")).toBeNull();
  });
});

describe("transcriptPassages", () => {
  it("groups lines into about 45-second passages led by their time", async () => {
    const { transcriptPassages } = await import("../src/services/youtube-transcript");
    const segments = Array.from({ length: 12 }, (_, i) => seg(i * 10_000, `Sentence ${i}.`));
    const passages = transcriptPassages({ segments, chapters: [] });
    expect(passages.map((p) => p.start)).toEqual([0, 50_000, 100_000]);
    expect(passages[0].text.startsWith("[0:00] Sentence 0.")).toBe(true);
  });
  it("starts a new passage at a chapter and caps its length", async () => {
    const { transcriptPassages } = await import("../src/services/youtube-transcript");
    const chapters = [
      { start: 0, title: "A" },
      { start: 20_000, title: "B" },
    ];
    const passages = transcriptPassages({ segments: [seg(0, "a."), seg(20_000, "b.")], chapters });
    expect(passages.map((p) => p.start)).toEqual([0, 20_000]);
    const long = transcriptPassages(
      { segments: [seg(0, "x".repeat(200) + "."), seg(6000, "y".repeat(200) + ".")], chapters: [] },
      45_000,
      300,
    );
    expect(long).toHaveLength(2);
  });
});
