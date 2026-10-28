import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// GHSA-gcqx-w48m-w2h4 has no published fix. Reject __proto__ before
// either merge loop reads or assigns it, including null-prototype targets.
// Preserve the published version so dependency scanners remain honest.
const root = new URL("../", import.meta.url);
const lock = JSON.parse(
  await readFile(new URL("package-lock.json", root), "utf8"),
);
const entries = Object.entries(lock.packages).filter(([path]) =>
  /(^|\/)node_modules\/deepmerge$/.test(path),
);
assert.ok(
  entries.length > 0,
  "Review the deepmerge backport: dependency absent",
);
const files = {
  "index.js":
    "12440c84957c1990ea2d5e33dc0091722dc1dc1585c6d20e0c780e568ffa9d30",
  "dist/cjs.js":
    "2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d",
  "dist/umd.js":
    "f33e6596482d1fb5c7c427f8ef92f2aa849eea9223acd974176b2fb27ddbf73a",
};
const writes = [];

// Validate every installed copy and distribution before changing any file.
for (const [path, locked] of entries) {
  assert.equal(
    locked.version,
    "4.3.1",
    "Review the deepmerge backport after upgrading",
  );
  const directory = new URL(`${path}/`, root);
  const installed = JSON.parse(
    await readFile(new URL("package.json", directory), "utf8"),
  );
  assert.equal(
    installed.version,
    locked.version,
    "deepmerge differs from lockfile",
  );
  for (const [file, expectedHash] of Object.entries(files)) {
    const filename = new URL(file, directory);
    const source = await readFile(filename, "utf8");
    const indent = file === "dist/umd.js" ? "\t" : "";
    const replacements = ["target", "source"].map((name) => {
      const tabs = indent + (name === "target" ? "\t\t" : "\t");
      const original = `${tabs}getKeys(${name}).forEach(function(key) {`;
      return [
        original,
        `${original}\n${tabs}\tif (key === '__proto__') return`,
      ];
    });
    let pristine = source;
    for (const [original, patched] of replacements)
      pristine = pristine.replace(patched, original);
    assert.equal(
      createHash("sha256").update(pristine).digest("hex"),
      expectedHash,
      `deepmerge ${file} changed; review the security backport`,
    );
    let patchedSource = pristine;
    for (const [original, patched] of replacements) {
      assert.equal(
        pristine.split(original).length,
        2,
        "deepmerge merge loop changed",
      );
      patchedSource = patchedSource.replace(original, patched);
    }
    assert.ok(
      source === pristine || source === patchedSource,
      `deepmerge ${file} is only partially patched`,
    );
    if (source === pristine) writes.push([filename, patchedSource]);
  }
}

for (const [filename, source] of writes) await writeFile(filename, source);
console.log(
  `Applied deepmerge 4.3.1 prototype protection to ${entries.length} installed copy/copies`,
);
