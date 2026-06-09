const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function createDeviceRegistry() {
  const clients = new Map();

  function listDevices() {
    return [...clients.values()].map(({ id, name, deviceType, platform, ipAddress, connectedAt }) => ({
      id,
      name,
      deviceType,
      platform,
      ipAddress,
      connectedAt,
    }));
  }

  function add(client) {
    clients.set(client.id, client);
    return client;
  }

  function update(id, patch) {
    const client = clients.get(id);
    if (!client) return null;
    Object.assign(client, patch);
    return client;
  }

  function remove(id) {
    return clients.delete(id);
  }

  function get(id) {
    return clients.get(id) || null;
  }

  function clear() {
    clients.clear();
  }

  return { add, clear, get, listDevices, remove, update };
}

function sanitizeName(value) {
  const fallback = "Anonymous Device";
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 48) || fallback;
}

function sanitizeToken(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9._ -]{1,32}$/.test(trimmed) ? trimmed : fallback;
}

function createFrame(payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const header =
    data.length < 126
      ? Buffer.from([0x81, data.length])
      : data.length <= 0xffff
        ? Buffer.from([0x81, 126, data.length >> 8, data.length & 0xff])
        : null;

  if (!header) {
    throw new Error("WebSocket frame too large");
  }

  return Buffer.concat([header, data]);
}

function readFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let length = byte2 & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      throw new Error("Large WebSocket frames are not supported by the MVP server");
    }

    const maskLength = masked ? 4 : 0;
    if (cursor + maskLength + length > buffer.length) break;

    let mask;
    if (masked) {
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (masked) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    offset = cursor + length;

    if (opcode === 0x8) {
      messages.push({ type: "close" });
    } else if (opcode === 0x1) {
      messages.push({ type: "text", data: payload.toString("utf8") });
    } else if (opcode === 0x9) {
      messages.push({ type: "ping" });
    }
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function createSignalingServer(registry = createDeviceRegistry()) {
  function send(client, event, data = {}) {
    if (!client || client.socket.destroyed) return false;
    client.socket.write(createFrame({ event, ...data }));
    return true;
  }

  function broadcastDeviceList() {
    const devices = registry.listDevices();
    for (const device of devices) {
      const client = registry.get(device.id);
      send(client, "device-list", { devices });
    }
  }

  function relay(source, event, payload, targetIdKey = "targetId") {
    const targetId = payload[targetIdKey];
    const target = registry.get(targetId);

    if (!target) {
      send(source, "error", {
        code: "DEVICE_OFFLINE",
        message: "Target device is no longer available.",
      });
      return false;
    }

    const sourceDevice = registry.get(source.id);
    send(target, event, {
      ...payload,
      senderId: source.id,
      senderName: sourceDevice?.name || "Unknown Device",
    });
    return true;
  }

  function handleMessage(client, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      send(client, "error", { code: "BAD_JSON", message: "Invalid JSON message." });
      return;
    }

    const event = message.event;
    if (!event) {
      send(client, "error", { code: "MISSING_EVENT", message: "Message is missing an event." });
      return;
    }

    if (event === "register-device") {
      registry.update(client.id, {
        name: sanitizeName(message.name),
        deviceType: sanitizeToken(message.deviceType, "desktop"),
        platform: sanitizeToken(message.platform, "web"),
      });
      send(client, "registered", { id: client.id });
      broadcastDeviceList();
      return;
    }

    if (event === "ping") {
      send(client, "pong", { at: Date.now() });
      return;
    }

    if (
      event === "transfer-request" ||
      event === "transfer-accepted" ||
      event === "transfer-declined" ||
      event === "transfer-cancelled" ||
      event === "connection-retry" ||
      event === "lan-fallback-request" ||
      event === "lan-transfer-start" ||
      event === "lan-transfer-chunk" ||
      event === "lan-transfer-complete" ||
      event === "offer" ||
      event === "answer" ||
      event === "ice-candidate"
    ) {
      relay(client, event, message);
      return;
    }

    send(client, "error", { code: "UNKNOWN_EVENT", message: `Unknown event: ${event}` });
  }

  function attach(server) {
    server.on("upgrade", (request, socket) => {
      const { pathname } = new URL(request.url, `http://${request.headers.host}`);
      if (pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const key = request.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }

      const accept = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");

      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "",
          "",
        ].join("\r\n"),
      );

      const client = {
        id: crypto.randomUUID(),
        name: "Anonymous Device",
        deviceType: "desktop",
        platform: "web",
        ipAddress: socket.remoteAddress?.replace(/^::ffff:/, "") || "unknown",
        connectedAt: new Date().toISOString(),
        socket,
      };
      let pending = Buffer.alloc(0);

      registry.add(client);
      send(client, "welcome", { id: client.id });
      broadcastDeviceList();

      socket.on("data", (chunk) => {
        try {
          const parsed = readFrames(Buffer.concat([pending, chunk]));
          pending = parsed.remaining;
          for (const frame of parsed.messages) {
            if (frame.type === "close") {
              socket.end();
            } else if (frame.type === "text") {
              handleMessage(client, frame.data);
            }
          }
        } catch (error) {
          send(client, "error", { code: "WS_FRAME_ERROR", message: error.message });
          socket.end();
        }
      });

      socket.on("close", () => {
        registry.remove(client.id);
        broadcastDeviceList();
      });

      socket.on("error", () => {
        registry.remove(client.id);
        broadcastDeviceList();
      });
    });
  }

  return { attach, broadcastDeviceList, handleMessage, registry, send };
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, normalized);
  return fullPath.startsWith(PUBLIC_DIR) ? fullPath : null;
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, name: "AnyDrop", version: "0.1.0" }));
    return;
  }

  const pathname = url.pathname === "/app" ? "/app.html" : url.pathname;
  const filePath = safeFilePath(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  });
}

function createServer() {
  const server = http.createServer(serveStatic);
  const signaling = createSignalingServer();
  signaling.attach(server);
  return { server, signaling };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`AnyDrop MVP running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/app on two devices on the same network.`);
  });
}

module.exports = {
  createDeviceRegistry,
  createFrame,
  createServer,
  createSignalingServer,
  readFrames,
  sanitizeName,
  sanitizeToken,
};
