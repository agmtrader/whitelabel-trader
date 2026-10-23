import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Backport the nested DigestAlgorithm check from digitalbazaar/forge#1152
// for GHSA-86w9-cpqp-85rv until a patched release is available, and reject
// nonempty NULL parameters that would otherwise carry unconsumed data. Keep the
// published version honest: version-based audit tools will still report it.
const root = new URL("../", import.meta.url);
const lock = JSON.parse(
  await readFile(new URL("package-lock.json", root), "utf8"),
);
const entries = Object.entries(lock.packages).filter(([path]) =>
  /(^|\/)node_modules\/node-forge$/.test(path),
);
assert.ok(
  entries.length > 0,
  "Review the Forge backport: dependency is absent",
);

const original = "            obj.value.length !== 2) {";
const patched = `            obj.value.length !== 2 ||
            obj.value[0].value.length !==
              (("parameters" in capture) ? 2 : 1) ||
            (("parameters" in capture) && capture.parameters !== '')) {`;
const sha256 = (source) => createHash("sha256").update(source).digest("hex");
const upstreamHash =
  "fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50";
const writes = [];

// Check every installed copy before changing any. Fail installation on drift
// rather than silently leaving an unexpected implementation unprotected.
for (const [path, locked] of entries) {
  const directory = new URL(`${path}/`, root);
  const installed = JSON.parse(
    await readFile(new URL("package.json", directory), "utf8"),
  );
  assert.equal(
    locked.version,
    "1.4.0",
    "Review the Forge backport after upgrading",
  );
  assert.equal(
    installed.version,
    locked.version,
    "Forge installation differs from lockfile",
  );
  const filename = new URL("lib/rsa.js", directory);
  const source = await readFile(filename, "utf8");
  const unpatched = source.replace(patched, original);
  assert.equal(
    sha256(unpatched),
    upstreamHash,
    "Forge RSA source changed; review the security backport",
  );
  assert.equal(
    unpatched.split(original).length,
    2,
    "Forge validation boundary changed",
  );
  if (source === unpatched)
    writes.push([filename, source.replace(original, patched)]);
}

for (const [filename, source] of writes) await writeFile(filename, source);
console.log(
  `Applied Forge 1.4.0 nested DigestAlgorithm validation to ${entries.length} installed copy/copies`,
);
