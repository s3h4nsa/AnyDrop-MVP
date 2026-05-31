const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("discovery filters out the current browser", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/discovery.js"), "utf8");
  assert.match(source, /export function withoutSelf/);
  assert.match(source, /device\.id !== selfId/);
  assert.match(source, /export function findDevice/);
});
