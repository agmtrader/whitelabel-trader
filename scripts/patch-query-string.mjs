import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Expo Router still consumes query-string 7's CommonJS API. Its fixed decoder
// is ESM, so adapt only that import until upstream updates the consumer.
const require = createRequire(import.meta.url);
const routerRequire = createRequire(require.resolve("expo-router/package.json"));
const filename = routerRequire.resolve("query-string");
const queryRequire = createRequire(filename);
assert.equal(queryRequire("query-string/package.json").version, "7.1.3");
assert.equal(typeof queryRequire("decode-uri-component").default, "function");

const original = "const decodeComponent = require('decode-uri-component');";
const patched = "const decodeComponent = require('decode-uri-component').default;";
const source = await readFile(filename, "utf8");
if (!source.includes(patched)) {
  assert.equal(
    source.split(original).length,
    2,
    "query-string source changed; review the URI decoder compatibility patch",
  );
  await writeFile(filename, source.replace(original, patched));
}
assert.equal(routerRequire("query-string").parse("value=%2B").value, "+");
console.log("Applied query-string 7.1.3 compatibility for decode-uri-component 0.5.0");
