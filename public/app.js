import { createOwnerDeviceName, formatBytes, getDeviceType, getPlatform, shortId } from "./js/utils.js";
import { createReceiver } from "./js/receiver.js";
import { createTransferSender } from "./js/transfer.js";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const state = {
  socket: null,
  selfId: null,
  devices: [],
  selectedId: null,
  selectedFile: null,
  pendingRequest: null,
  peer: null,
  dataChannel: null,
  receiver: null,
  pendingIceCandidates: [],
  activePeerId: null,
  transferRole: null,
  retryCount: 0,
  lanReceiver: null,
  lanFallbackStarted: false,
};

const els = {
  acceptBtn: document.querySelector("#acceptBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  connectionStatus: document.querySelector("#connectionStatus"),
  declineBtn: document.querySelector("#declineBtn"),
  deviceForm: document.querySelector("#deviceForm"),
  deviceId: document.querySelector("#deviceId"),
  deviceList: document.querySelector("#deviceList"),
  deviceName: document.querySelector("#deviceName"),
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#fileInput"),
  fileMeta: document.querySelector("#fileMeta"),
  fileName: document.querySelector("#fileName"),
  log: document.querySelector("#log"),
  progressBar: document.querySelector("#progressBar"),
  progressDetail: document.querySelector("#progressDetail"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  refreshBtn: document.querySelector("#refreshBtn"),
  requestBody: document.querySelector("#requestBody"),
  requestDialog: document.querySelector("#requestDialog"),
  requestTitle: document.querySelector("#requestTitle"),
  sendBtn: document.querySelector("#sendBtn"),
  template: document.querySelector("#deviceTemplate"),
  centerSendBtn: document.querySelector("#centerSendBtn"),
  radarCanvas: document.querySelector("#radarCanvas"),
  radarEmpty: document.querySelector("#radarEmpty"),
};

const radar = {
  angle: 0,
  pulses: [],
  lastSeen: new Map(),
};

function defaultDeviceName() {
  const saved = localStorage.getItem("anydrop.deviceName");
  return createOwnerDeviceName(navigator.userAgent, saved);
}

function setStatus(label, kind) {
  els.connectionStatus.textContent = label;
  els.connectionStatus.className = `status ${kind || ""}`.trim();
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  els.log.prepend(item);
}

function send(event, data = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify({ event, ...data }));
  return true;
}

function registerDevice() {
  const name = els.deviceName.value.trim() || defaultDeviceName();
  localStorage.setItem("anydrop.deviceName", name);
  send("register-device", {
    name,
    deviceType: getDeviceType(navigator.userAgent),
    platform: getPlatform(navigator.userAgent),
  });
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  state.socket = socket;
  setStatus("Connecting", "");

  socket.addEventListener("open", () => {
    setStatus("Online", "online");
    registerDevice();
    log("Connected to signaling server.");
  });

  socket.addEventListener("close", () => {
    setStatus("Offline", "offline");
    log("Disconnected. Reconnecting soon.");
    setTimeout(connect, 1200);
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      log("Ignored malformed server message.");
      return;
    }
    await handleSignal(message);
  });
}

async function handleSignal(message) {
  switch (message.event) {
    case "welcome":
      state.selfId = message.id;
      els.deviceId.textContent = `Session ${shortId(message.id)}`;
      break;
    case "registered":
      state.selfId = message.id;
      els.deviceId.textContent = `Session ${shortId(message.id)}`;
      break;
    case "device-list":
      state.devices = message.devices || [];
      renderDevices();
      break;
    case "transfer-request":
      showRequest(message);
      break;
    case "transfer-accepted":
      await startSenderPeer(message.senderId || message.targetId, false);
      break;
    case "transfer-declined":
      log(`${message.senderName || "Peer"} declined the transfer.`);
      resetPeer();
      break;
    case "offer":
      await handleOffer(message);
      break;
    case "answer":
      if (state.peer) {
        await state.peer.setRemoteDescription(message.answer);
        await flushPendingIceCandidates();
        log("WebRTC answer received.");
      }
      break;
    case "ice-candidate":
      await addIceCandidate(message.candidate);
      break;
    case "connection-retry":
      await retrySenderPeer(message.senderId || message.targetId);
      break;
    case "lan-fallback-request":
      await sendFileViaLan(message.senderId || message.targetId);
      break;
    case "lan-transfer-start":
      startLanReceive(message);
      break;
    case "lan-transfer-chunk":
      receiveLanChunk(message);
      break;
    case "lan-transfer-complete":
      completeLanReceive(message);
      break;
    case "error":
      log(`${message.code || "Error"}: ${message.message || "Unknown error"}`);
      break;
    default:
      break;
  }
}

function renderDevices() {
  const peers = state.devices.filter((device) => device.id !== state.selfId);
  const label = peers.length === 1 ? "1 nearby" : `${peers.length} nearby`;
  if (state.socket?.readyState === WebSocket.OPEN) setStatus(label, "online");
  els.radarEmpty?.classList.toggle("hidden", peers.length > 0);
  els.deviceList.textContent = "";

  if (!peers.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No other devices online yet. Open /app on another browser or device.";
    els.deviceList.append(empty);
    state.selectedId = null;
    updateSendState();
    return;
  }

  for (const peer of peers) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = peer.id;
    node.classList.toggle("selected", peer.id === state.selectedId);
    node.querySelector(".avatar").textContent = (peer.name || "?").slice(0, 1).toUpperCase();
    node.querySelector("strong").textContent = peer.name;
    node.querySelector("small").textContent = [
      peer.deviceType || "device",
      peer.platform || "web",
      peer.ipAddress && peer.ipAddress !== "unknown" ? peer.ipAddress : shortId(peer.id),
    ].join(" - ");
    node.addEventListener("click", () => {
      state.selectedId = peer.id;
      renderDevices();
      updateSendState();
      log(`Selected ${peer.name}.`);
    });
    els.deviceList.append(node);
  }

  if (state.selectedId && !peers.some((peer) => peer.id === state.selectedId)) {
    state.selectedId = null;
  }
  updateSendState();
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function radarColor(device) {
  const type = String(device.deviceType || "").toLowerCase();
  if (type.includes("phone")) return "#ff9f0a";
  if (type.includes("tablet")) return "#bf5af2";
  if (type.includes("desktop")) return "#30d158";
  return "#0a84ff";
}

function radarPosition(device, radius) {
  const seed = hashString(device.id || device.name || "device");
  const angle = ((seed % 360) / 180) * Math.PI;
  const distance = radius * (0.34 + ((seed >> 4) % 48) / 100);
  return {
    angle,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    distance,
  };
}

function drawRadar() {
  const canvas = els.radarCanvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const size = Math.min(rect.width, rect.height);
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const radius = size * 0.48;
  const innerClear = 48;
  const peers = state.devices.filter((device) => device.id !== state.selfId);

  ctx.clearRect(0, 0, rect.width, rect.height);

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  bg.addColorStop(0, "rgba(232, 243, 255, 0.98)");
  bg.addColorStop(0.62, "rgba(232, 243, 255, 0.46)");
  bg.addColorStop(1, "rgba(10, 132, 255, 0.04)");
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();

  for (const factor of [0.32, 0.55, 0.78, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(10, 132, 255, ${0.08 + factor * 0.06})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(10, 132, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * innerClear, cy + Math.sin(a) * innerClear);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }

  radar.angle = (radar.angle + 0.026) % (Math.PI * 2);

  for (let i = 0; i < 44; i += 1) {
    const alpha = (i / 44) * 0.22;
    const a = radar.angle - (1 - i / 44) * 1.08;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, a, a + 0.045);
    ctx.closePath();
    ctx.fillStyle = `rgba(10, 132, 255, ${alpha})`;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(radar.angle) * radius, cy + Math.sin(radar.angle) * radius);
  ctx.strokeStyle = "rgba(10, 132, 255, 0.68)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const peer of peers) {
    const pos = radarPosition(peer, radius);
    const x = cx + pos.x;
    const y = cy + pos.y;
    const sweepDelta = (radar.angle - pos.angle + Math.PI * 2) % (Math.PI * 2);
    const seenKey = peer.id;

    if (sweepDelta < 0.052 && performance.now() - (radar.lastSeen.get(seenKey) || 0) > 1400) {
      radar.lastSeen.set(seenKey, performance.now());
      radar.pulses.push({ x, y, radius: 4, alpha: 0.85, color: radarColor(peer) });
    }

    const color = radarColor(peer);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 24);
    glow.addColorStop(0, `${color}44`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    const label = peer.name || "Device";
    const right = x >= cx;
    ctx.font = "700 11px DM Sans, system-ui, sans-serif";
    ctx.textAlign = right ? "left" : "right";
    ctx.fillStyle = "rgba(28, 28, 30, 0.7)";
    ctx.fillText(label.slice(0, 17), x + (right ? 11 : -11), y + 4);
  }

  for (let i = radar.pulses.length - 1; i >= 0; i -= 1) {
    const pulse = radar.pulses[i];
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
    ctx.strokeStyle = pulse.color + Math.floor(pulse.alpha * 255).toString(16).padStart(2, "0");
    ctx.lineWidth = 1.7;
    ctx.stroke();
    pulse.radius += 1.25;
    pulse.alpha -= 0.022;
    if (pulse.alpha <= 0) radar.pulses.splice(i, 1);
  }

  ctx.beginPath();
  ctx.arc(cx, cy, innerClear, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  ctx.fill();

  requestAnimationFrame(drawRadar);
}

function updateSendState() {
  els.sendBtn.disabled = !state.selectedId || !state.selectedFile || state.socket?.readyState !== WebSocket.OPEN;
}

function setFile(file) {
  state.selectedFile = file || null;
  if (!file) {
    els.fileName.textContent = "Choose a file";
    els.fileMeta.textContent = "Drag and drop also works.";
  } else {
    els.fileName.textContent = file.name;
    els.fileMeta.textContent = `${formatBytes(file.size)} - ${file.type || "Unknown type"}`;
  }
  updateSendState();
}

function showRequest(request) {
  state.pendingRequest = request;
  els.requestTitle.textContent = `${request.senderName || "A device"} wants to send a file`;
  els.requestBody.textContent = `${request.fileName} (${formatBytes(request.fileSize || 0)})`;
  els.requestDialog.showModal();
}

function createPeer(targetId, role) {
  resetPeer();
  const peer = new RTCPeerConnection(rtcConfig);
  state.peer = peer;
  state.pendingIceCandidates = [];
  state.activePeerId = targetId;
  state.transferRole = role;

  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      send("ice-candidate", { targetId, candidate: event.candidate });
    }
  });

  peer.addEventListener("connectionstatechange", () => {
    log(`Peer connection: ${peer.connectionState}.`);
    if (peer.connectionState === "connected") {
      state.retryCount = 0;
    }

    if (peer.connectionState === "failed") {
      handlePeerFailure();
    }

    if (peer.connectionState === "closed") {
      resetPeer(false);
    }
  });

  return peer;
}

function handlePeerFailure() {
  const targetId = state.activePeerId;
  const role = state.transferRole;
  resetPeer(false);
  setProgress("Retrying", 0, "Connection failed. Trying a fresh WebRTC offer.");

  if (!targetId) return;

  if (role === "send") {
    log("WebRTC failed. Switching sender to LAN fallback.");
    sendFileViaLan(targetId);
  } else if (role === "receive") {
    send("lan-fallback-request", { targetId });
    setProgress("LAN fallback", 0, "Peer connection failed. Switching to local-network relay.");
    log("Connection failed. Asked sender to use LAN fallback.");
  }
}

async function retrySenderPeer(receiverId) {
  if (!state.selectedFile) return;
  if (state.retryCount >= 2) {
    log("Retry limit reached. Switching to LAN fallback.");
    await sendFileViaLan(receiverId);
    return;
  }

  state.retryCount += 1;
  log(`Retrying WebRTC connection (${state.retryCount}/2).`);
  await startSenderPeer(receiverId, true);
}

async function addIceCandidate(candidate) {
  if (!candidate || !state.peer) return;

  if (!state.peer.remoteDescription) {
    state.pendingIceCandidates.push(candidate);
    return;
  }

  try {
    await state.peer.addIceCandidate(candidate);
  } catch (error) {
    log(`ICE candidate skipped: ${error.message}`);
  }
}

async function flushPendingIceCandidates() {
  if (!state.peer || !state.peer.remoteDescription) return;
  const candidates = state.pendingIceCandidates.splice(0);
  for (const candidate of candidates) {
    await addIceCandidate(candidate);
  }
}

function attachDataChannel(channel, mode) {
  state.dataChannel = channel;
  channel.binaryType = "arraybuffer";

  channel.addEventListener("open", async () => {
    log("DataChannel open.");
    if (mode === "send" && state.selectedFile) {
      const sender = createTransferSender(channel, {
        onProgress: ({ sent, total, percent }) => {
          setProgress("Sending", percent, `${formatBytes(sent)} / ${formatBytes(total)}`);
        },
      });
      await sender.sendFile(state.selectedFile);
      setProgress("Complete", 100, "File sent directly to peer.");
      log(`Sent ${state.selectedFile.name}.`);
      cleanupTransferSession();
    }
  });

  channel.addEventListener("message", (event) => {
    state.receiver?.handleMessage(event.data);
  });

  channel.addEventListener("close", () => log("DataChannel closed."));
}

async function startSenderPeer(receiverId, isRetry = false) {
  if (!state.selectedFile) return;
  const previousRetryCount = state.retryCount;
  const peer = createPeer(receiverId, "send");
  state.retryCount = isRetry ? previousRetryCount : 0;
  const channel = peer.createDataChannel("anydrop-file");
  state.receiver = createReceiver({ onProgress: updateReceiveProgress, onComplete: completeReceive });
  attachDataChannel(channel, "send");
  const offer = await peer.createOffer({ iceRestart: isRetry });
  await peer.setLocalDescription(offer);
  send("offer", { targetId: receiverId, offer });
  log(isRetry ? "Retry offer sent." : "Transfer accepted. WebRTC offer sent.");
}

async function handleOffer(message) {
  const senderId = message.senderId;
  const peer = createPeer(senderId, "receive");
  state.receiver = createReceiver({ onProgress: updateReceiveProgress, onComplete: completeReceive });
  peer.addEventListener("datachannel", (event) => {
    attachDataChannel(event.channel, "receive");
  });
  await peer.setRemoteDescription(message.offer);
  await flushPendingIceCandidates();
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  send("answer", { targetId: senderId, answer });
  log("Offer received. WebRTC answer sent.");
}

function updateReceiveProgress({ received, total, percent, fileName }) {
  setProgress(`Receiving ${fileName}`, percent, `${formatBytes(received)} / ${formatBytes(total)}`);
}

function completeReceive({ blob, fileName }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  setProgress("Complete", 100, `${fileName} downloaded.`);
  log(`Received ${fileName}.`);
  cleanupTransferSession();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const batchSize = 0x8000;
  for (let i = 0; i < bytes.length; i += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + batchSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function sendFileViaLan(receiverId) {
  if (!state.selectedFile || !receiverId || state.lanFallbackStarted) return;
  state.lanFallbackStarted = true;
  resetPeer(false);

  const file = state.selectedFile;
  const chunkSize = 32 * 1024;
  let offset = 0;

  setProgress("LAN fallback", 0, `Sending ${file.name} through local network server.`);
  log("Using LAN fallback transfer.");

  send("lan-transfer-start", {
    targetId: receiverId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  });

  while (offset < file.size) {
    const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
    offset += buffer.byteLength;
    send("lan-transfer-chunk", {
      targetId: receiverId,
      chunk: arrayBufferToBase64(buffer),
      offset,
      fileSize: file.size,
    });
    setProgress("LAN fallback", (offset / file.size) * 100, `${formatBytes(offset)} / ${formatBytes(file.size)}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  send("lan-transfer-complete", { targetId: receiverId, fileName: file.name });
  setProgress("Complete", 100, "File sent through local network fallback.");
  log(`LAN fallback sent ${file.name}.`);
  state.lanFallbackStarted = false;
}

function startLanReceive(message) {
  state.lanReceiver = {
    fileName: message.fileName || "anydrop-download",
    fileSize: Number(message.fileSize) || 0,
    mimeType: message.mimeType || "application/octet-stream",
    chunks: [],
    received: 0,
  };
  resetPeer(false);
  setProgress("LAN fallback", 0, `Receiving ${state.lanReceiver.fileName} through local network.`);
  log(`LAN fallback receiving ${state.lanReceiver.fileName}.`);
}

function receiveLanChunk(message) {
  if (!state.lanReceiver || !message.chunk) return;
  const buffer = base64ToArrayBuffer(message.chunk);
  state.lanReceiver.chunks.push(buffer);
  state.lanReceiver.received += buffer.byteLength;
  const total = state.lanReceiver.fileSize || Number(message.fileSize) || state.lanReceiver.received;
  setProgress(
    "LAN fallback",
    total ? (state.lanReceiver.received / total) * 100 : 0,
    `${formatBytes(state.lanReceiver.received)} / ${formatBytes(total)}`,
  );
}

function completeLanReceive(message) {
  if (!state.lanReceiver) return;
  const blob = new Blob(state.lanReceiver.chunks, { type: state.lanReceiver.mimeType });
  completeReceive({ blob, fileName: message.fileName || state.lanReceiver.fileName });
  state.lanReceiver = null;
}

function cleanupTransferSession() {
  setTimeout(() => {
    resetPeer(false);
  }, 900);
}

function setProgress(label, percent, detail) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  els.progressLabel.textContent = label;
  els.progressPercent.textContent = `${safePercent}%`;
  els.progressDetail.textContent = detail;
  els.progressBar.style.width = `${safePercent}%`;
}

function resetPeer(clearProgress = true) {
  if (state.dataChannel && state.dataChannel.readyState !== "closed") state.dataChannel.close();
  if (state.peer && state.peer.connectionState !== "closed") state.peer.close();
  state.peer = null;
  state.dataChannel = null;
  state.receiver = null;
  state.pendingIceCandidates = [];
  state.activePeerId = null;
  state.transferRole = null;
  if (clearProgress) setProgress("Idle", 0, "No active transfer.");
}

els.deviceName.value = defaultDeviceName();
els.deviceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  registerDevice();
  log("Device name updated.");
});

els.refreshBtn.addEventListener("click", () => registerDevice());
els.clearLogBtn.addEventListener("click", () => {
  els.log.textContent = "";
});

els.fileInput.addEventListener("change", () => {
  setFile(els.fileInput.files[0]);
});

els.centerSendBtn?.addEventListener("click", () => {
  els.fileInput.click();
});

els.dropzone.addEventListener("click", () => {
  els.fileInput.click();
});

els.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropzone.classList.add("dragging");
});

els.dropzone.addEventListener("dragleave", () => {
  els.dropzone.classList.remove("dragging");
});

els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropzone.classList.remove("dragging");
  setFile(event.dataTransfer.files[0]);
});

els.sendBtn.addEventListener("click", () => {
  const target = state.devices.find((device) => device.id === state.selectedId);
  if (!target || !state.selectedFile) return;
  setProgress("Waiting", 0, `Waiting for ${target.name} to accept.`);
  send("transfer-request", {
    targetId: target.id,
    fileName: state.selectedFile.name,
    fileSize: state.selectedFile.size,
    mimeType: state.selectedFile.type,
  });
  state.lanFallbackStarted = false;
  log(`Transfer request sent to ${target.name}.`);
});

els.acceptBtn.addEventListener("click", () => {
  if (!state.pendingRequest) return;
  send("transfer-accepted", { targetId: state.pendingRequest.senderId });
  log(`Accepted ${state.pendingRequest.fileName}.`);
});

els.declineBtn.addEventListener("click", () => {
  if (!state.pendingRequest) return;
  send("transfer-declined", { targetId: state.pendingRequest.senderId });
  log(`Declined ${state.pendingRequest.fileName}.`);
  state.pendingRequest = null;
});

els.requestDialog.addEventListener("close", () => {
  state.pendingRequest = null;
});

requestAnimationFrame(drawRadar);
connect();
