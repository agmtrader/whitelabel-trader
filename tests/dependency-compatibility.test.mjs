import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

test("Expo Router query strings retain Unicode, spaces, arrays and literal plus signs", () => {
  const query = require("query-string");
  const params = {
    symbol: "BRK.B",
    search: "acción + ETF",
    tags: ["S&P 500", "日本"],
  };
  assert.deepEqual({ ...query.parse(query.stringify(params)) }, params);
  assert.deepEqual({ ...query.parse("search=S%26P+500&plus=%2B&empty=&flag") }, {
    search: "S&P 500",
    plus: "+",
    empty: "",
    flag: null,
  });
});

test("routing malformed percent-encoded query values finishes within a bounded process", () => {
  // The previous decoder times out on this input. Isolate it so a regression
  // cannot hang the test runner's event loop indefinitely.
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const assert = require('node:assert/strict');
       const query = require('query-string');
       const value = '%EA'.repeat(2000);
       assert.equal(query.parse('search=' + value).search, value);
       assert.equal(query.parse('search=%C3%A5%80%C3%A5').search, 'å%80å');`,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 3000,
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("Xcode project identifiers retain the required 24-character uppercase hexadecimal shape", () => {
  const project = require("xcode").project("unused.pbxproj");
  project.hash = { project: { objects: {} } };
  const ids = Array.from({ length: 100 }, () => project.generateUuid());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
});
