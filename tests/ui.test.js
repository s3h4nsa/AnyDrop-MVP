const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("device initials are stable", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/devices.js"), "utf8");
  assert.match(source, /export function initials/);
  assert.match(source, /toUpperCase/);
});
