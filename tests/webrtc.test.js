const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrame, readFrames } = require("../server");

test("websocket text frames round-trip JSON payloads", () => {
  const frame = createFrame({ event: "device-list", devices: [] });
  const { messages, remaining } = readFrames(frame);

  assert.equal(remaining.length, 0);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0].data), { event: "device-list", devices: [] });
});
