const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("transfer chunk size is 64KB", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/transfer.js"), "utf8");
  assert.match(source, /CHUNK_SIZE\s*=\s*64\s*\*\s*1024/);
});

test("formatBytes returns readable units", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/utils.js"), "utf8");
  assert.match(source, /export function formatBytes/);
  assert.match(source, /\["B", "KB", "MB", "GB", "TB"\]/);
});

test("utils include device identity naming helpers", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/utils.js"), "utf8");
  assert.match(source, /export function getDeviceIdentity/);
  assert.match(source, /iPhone/);
  assert.match(source, /Windows PC/);
  assert.match(source, /MacBook \/ Mac/);
  assert.match(source, /export function createOwnerDeviceName/);
});
