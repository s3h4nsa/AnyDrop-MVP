const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeviceRegistry, sanitizeName, sanitizeToken } = require("../server");

test("device registry adds, updates, lists, and removes devices", () => {
  const registry = createDeviceRegistry();
  registry.add({
    id: "abc",
    name: "Laptop",
    deviceType: "desktop",
    platform: "Windows",
    ipAddress: "192.168.1.25",
    connectedAt: "2026-05-31T00:00:00.000Z",
    socket: {},
  });

  assert.equal(registry.listDevices().length, 1);
  assert.equal(registry.get("abc").name, "Laptop");
  assert.equal(registry.listDevices()[0].ipAddress, "192.168.1.25");

  registry.update("abc", { name: "Desk PC" });
  assert.equal(registry.get("abc").name, "Desk PC");

  registry.remove("abc");
  assert.equal(registry.listDevices().length, 0);
});

test("registration values are sanitized", () => {
  assert.equal(sanitizeName("  My   Phone  "), "My Phone");
  assert.equal(sanitizeName(""), "Anonymous Device");
  assert.equal(sanitizeToken("Windows 11"), "windows 11");
  assert.equal(sanitizeToken("<script>"), "unknown");
});
