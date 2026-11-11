import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const folders = process.argv.slice(2);
if (!folders.length) throw Error("Pass the before and after benchmark folders");
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = {};
for (const folder of folders) {
  const samples = JSON.parse(
    await readFile(path.join(folder, "samples.json"), "utf8"),
  );
  results[folder] = [];
  for (const zoom of [0.15, 1])
    for (const route of ["chapter-edge", "empty"]) {
      const rows = samples.filter((s) => s.zoom === zoom && s.route === route);
      if (rows.length !== 5)
        throw Error(`${folder}: expected five trials for ${zoom}/${route}`);
      results[folder].push({
        zoom,
        route,
        trials: rows.length,
        p50: median(rows.map((r) => r.p50)),
        p95: median(rows.map((r) => r.p95)),
        p95Range: [
          Math.min(...rows.map((r) => r.p95)),
          Math.max(...rows.map((r) => r.p95)),
        ],
        worst: Math.max(...rows.map((r) => r.worst)),
        over50: rows.reduce((n, r) => n + r.over50, 0),
        releaseToClick: median(rows.map((r) => r.releaseToClickMs)),
        worstReleaseToClick: Math.max(...rows.map((r) => r.releaseToClickMs)),
        transforms: rows.reduce((n, r) => n + r.transforms, 0),
        mounts: rows.reduce((n, r) => n + r.mounts, 0),
        previews: rows.reduce((n, r) => n + r.previews, 0),
        storage: rows.reduce((n, r) => n + r.storage, 0),
      });
    }
}
console.log(JSON.stringify(results, null, 2));
await writeFile(
  "test-results/canvas-panning-summary.json",
  JSON.stringify(results, null, 2),
);
