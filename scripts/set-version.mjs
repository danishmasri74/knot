// Keeps Knot's version identical in every place the build reads it.
//   node scripts/set-version.mjs 0.2.0   set all four
//   node scripts/set-version.mjs --check  print them; exit 1 if they differ
//   node scripts/set-version.mjs --check 0.2.0  also require this value
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const files = {
  "package.json": {
    read: (text) => JSON.parse(text).version,
    write: (text, v) => text.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`),
  },
  "src-tauri/tauri.conf.json": {
    read: (text) => JSON.parse(text).version,
    write: (text, v) => text.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`),
  },
  // Only the [package] table's version, never a dependency's.
  "src-tauri/Cargo.toml": {
    read: (text) => text.match(/^\[package\][^[]*?^version\s*=\s*"([^"]*)"/ms)?.[1],
    write: (text, v) =>
      text.replace(/^(\[package\][^[]*?^version\s*=\s*")[^"]*(")/ms, `$1${v}$2`),
  },
  "src-tauri/Cargo.lock": {
    read: (text) => text.match(/^name = "knot"\r?\nversion = "([^"]*)"/m)?.[1],
    write: (text, v) =>
      text.replace(/^(name = "knot"\r?\nversion = ")[^"]*(")/m, `$1${v}$2`),
  },
};

function current() {
  return Object.entries(files).map(([path, f]) => ({
    path,
    version: f.read(readFileSync(join(root, path), "utf8")) ?? "(missing)",
  }));
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.find((a) => !a.startsWith("--"));

if (wanted && !SEMVER.test(wanted)) {
  console.error(`"${wanted}" is not a version like 0.2.0 or 0.2.0-rc.1.`);
  process.exit(1);
}

if (check) {
  const found = current();
  for (const { path, version } of found) console.log(`${version}\t${path}`);
  const distinct = new Set(found.map((f) => f.version));
  if (distinct.size !== 1) {
    console.error("Versions differ. Run: pnpm version:set <version>");
    process.exit(1);
  }
  if (wanted && !distinct.has(wanted)) {
    console.error(`Expected ${wanted}. Run: pnpm version:set ${wanted}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!wanted) {
  console.error("Usage: pnpm version:set <version> | pnpm version:set --check [version]");
  process.exit(1);
}

// Prepare every change first so a failure leaves all files untouched.
const planned = Object.entries(files).map(([path, f]) => {
  const full = join(root, path);
  const before = readFileSync(full, "utf8");
  const after = f.write(before, wanted);
  if (f.read(after) !== wanted) {
    console.error(`Could not find the version in ${path}; no files were changed.`);
    process.exit(1);
  }
  return { path, full, before, after };
});
for (const { path, full, before, after } of planned) {
  if (after !== before) writeFileSync(full, after);
  console.log(`${wanted}\t${path}`);
}
