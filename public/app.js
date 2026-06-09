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
  selectedIds: new Set(),
  selectedFiles: [],
  pendingRequest: null,
  outboundTransfers: new Map(),
  inboundTransfers: new Map(),
  transferStatuses: new Map(),
  cancelledTransfers: new Set(),
  activeInboundSenderId: null,
  activeInboundTransferId: null,
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
  cancelTransferBtn: document.querySelector("#cancelTransferBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  connectionStatus: document.querySelector("#connectionStatus"),
  declineBtn: document.querySelector("#declineBtn"),
  deviceForm: document.querySelector("#deviceForm"),
  deviceId: document.querySelector("#deviceId"),
  deviceList: document.querySelector("#deviceList"),
  deviceName: document.querySelector("#deviceName"),
  dropzone: document.querySelector("#dropzone"),
  dropTarget: document.querySelector("#dropTarget"),
  fileInput: document.querySelector("#fileInput"),
  fileMeta: document.querySelector("#fileMeta"),
  fileName: document.querySelector("#fileName"),
  fileTemplate: document.querySelector("#fileTemplate"),
  log: document.querySelector("#log"),
  progressBar: document.querySelector("#progressBar"),
  progressDetail: document.querySelector("#progressDetail"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  refreshBtn: document.querySelector("#refreshBtn"),
  requestBody: document.querySelector("#requestBody"),
  requestDialog: document.querySelector("#requestDialog"),
  requestTitle: document.querySelector("#requestTitle"),
  selectedFilesList: document.querySelector("#selectedFilesList"),
  sendBtn: document.querySelector("#sendBtn"),
  template: document.querySelector("#deviceTemplate"),
  transferStatusList: document.querySelector("#transferStatusList"),
  centerSendBtn: document.querySelector("#centerSendBtn"),
  radarCanvas: document.querySelector("#radarCanvas"),
  radarEmpty: document.querySelector("#radarEmpty"),
};

const radar = {
  angle: 0,
  pulses: [],
  lastSeen: new Map(),
};

function hideEmptyAsset(image) {
  const update = () => {
    image.hidden = !image.naturalWidth;
  };
  image.addEventListener("load", update);
  image.addEventListener("error", () => {
    image.hidden = true;
  });
  if (image.complete) update();
}

document.querySelectorAll(".logo-icon img").forEach(hideEmptyAsset);

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
      upsertTransferStatus(message.transferId, {
        name: message.senderName || "Peer",
        state: "sending",
        detail: `${message.senderName || "Peer"} accepted. Sending files.`,
        percent: 0,
      });
      await startLanTransfer(message.transferId, message.senderId || message.targetId);
      break;
    case "transfer-declined":
      log(`${message.senderName || "Peer"} declined the transfer.`);
      upsertTransferStatus(message.transferId, {
        name: message.senderName || "Peer",
        state: "declined",
        detail: `${message.senderName || "Peer"} declined the request.`,
        percent: 0,
      });
      finishOutboundTransfer(message.transferId);
      resetPeer(false);
      updateCancelVisibility();
      maybeClearSentFiles();
      break;
    case "transfer-cancelled":
      handleTransferCancelled(message);
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
    state.selectedIds.clear();
    updateSendState();
    return;
  }

  for (const peer of peers) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = peer.id;
    node.classList.toggle("selected", state.selectedIds.has(peer.id));
    const avatar = node.querySelector(".avatar");
    const avatarImg = avatar.querySelector("img");
    const avatarFallback = avatar.querySelector("span");
    avatarImg.hidden = true;
    avatarImg.src = deviceIconPath(peer.deviceType);
    avatarImg.addEventListener("load", () => {
      if (!avatarImg.naturalWidth) return;
      avatarImg.hidden = false;
      avatarFallback.hidden = true;
    });
    avatarImg.addEventListener("error", () => {
      avatarImg.hidden = true;
      avatarFallback.hidden = false;
    });
    avatarFallback.textContent = (peer.name || "?").slice(0, 1).toUpperCase();
    node.querySelector("strong").textContent = peer.name;
    node.querySelector("small").textContent = [
      peer.deviceType || "device",
      peer.platform || "web",
      peer.ipAddress && peer.ipAddress !== "unknown" ? peer.ipAddress : shortId(peer.id),
    ].join(" - ");
    node.addEventListener("click", () => {
      if (state.selectedIds.has(peer.id)) {
        state.selectedIds.delete(peer.id);
        log(`Unselected ${peer.name}.`);
      } else {
        state.selectedIds.add(peer.id);
        log(`Selected ${peer.name}.`);
      }
      renderDevices();
      updateSendState();
    });
    els.deviceList.append(node);
  }

  for (const id of [...state.selectedIds]) {
    if (!peers.some((peer) => peer.id === id)) state.selectedIds.delete(id);
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

function deviceIconPath(deviceType) {
  const type = String(deviceType || "").toLowerCase();
  if (type.includes("phone")) return "/assets/icons/phone.svg";
  if (type.includes("tablet")) return "/assets/icons/tablet.svg";
  if (type.includes("desktop")) return "/assets/icons/desktop.svg";
  if (type.includes("laptop")) return "/assets/icons/laptop.svg";
  if (type.includes("tv")) return "/assets/icons/tv.svg";
  return "/assets/icons/unknown.svg";
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
  els.sendBtn.disabled =
    !state.selectedIds.size || !state.selectedFiles.length || state.socket?.readyState !== WebSocket.OPEN;
}

function createTransferId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasActiveTransfer() {
  return Boolean(
    state.pendingRequest ||
      state.outboundTransfers.size ||
      state.inboundTransfers.size ||
      state.activeInboundTransferId,
  );
}

function updateCancelVisibility() {
  els.cancelTransferBtn.classList.toggle("hidden", !hasActiveTransfer());
}

function transferStateLabel(stateName) {
  const labels = {
    waiting: "Waiting",
    sending: "Sending",
    receiving: "Receiving",
    complete: "Complete",
    declined: "Declined",
    cancelled: "Cancelled",
  };
  return labels[stateName] || "Pending";
}

function upsertTransferStatus(transferId, patch) {
  if (!transferId) return;
  const previous = state.transferStatuses.get(transferId) || {
    name: "Peer",
    detail: "Waiting",
    state: "waiting",
    percent: 0,
    completedFiles: 0,
    totalFiles: 1,
  };
  state.transferStatuses.set(transferId, { ...previous, ...patch });
  renderTransferStatuses();
}

function renderTransferStatuses() {
  els.transferStatusList.textContent = "";

  for (const [transferId, item] of state.transferStatuses) {
    const percent = Math.max(0, Math.min(100, Math.round(item.percent || 0)));
    const row = document.createElement("article");
    row.className = "transfer-status-item";
    row.dataset.transferId = transferId;

    const main = document.createElement("div");
    main.className = "transfer-status-main";

    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.name || "Peer";
    const detail = document.createElement("small");
    detail.textContent = item.detail || "Waiting";
    copy.append(name, detail);

    const pill = document.createElement("span");
    pill.className = `transfer-state-pill ${item.state || "waiting"}`;
    pill.textContent = transferStateLabel(item.state);

    const meter = document.createElement("div");
    meter.className = "mini-meter";
    const fill = document.createElement("div");
    fill.style.width = `${percent}%`;
    meter.append(fill);

    main.append(copy, pill);
    row.append(main, meter);
    els.transferStatusList.append(row);
  }
}

function finishOutboundTransfer(transferId) {
  if (transferId) {
    state.outboundTransfers.delete(transferId);
    state.cancelledTransfers.delete(transferId);
  }
}

function maybeClearSentFiles() {
  if (!state.outboundTransfers.size) setFiles([]);
}

function fileTypeLabel(file) {
  const parts = (file?.name || "").split(".");
  if (parts.length < 2) return "FILE";
  return parts.pop().toUpperCase().slice(0, 4);
}

function totalSelectedSize() {
  return state.selectedFiles.reduce((total, file) => total + file.size, 0);
}

function renderSelectedFiles() {
  els.selectedFilesList.textContent = "";
  els.selectedFilesList.classList.toggle("hidden", state.selectedFiles.length === 0);

  for (const [index, file] of state.selectedFiles.entries()) {
    const node = els.fileTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".file-type-badge").textContent = fileTypeLabel(file);
    node.querySelector("strong").textContent = file.name;
    node.querySelector("small").textContent = `${formatBytes(file.size)} - ${file.type || "Unknown type"}`;
    node.querySelector(".file-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedFiles.splice(index, 1);
      renderSelectedFiles();
      updateFileDropCopy();
      updateSendState();
    });
    els.selectedFilesList.append(node);
  }
}

function updateFileDropCopy() {
  if (!state.selectedFiles.length) {
    els.fileInput.value = "";
    els.fileName.textContent = "Drop files here or browse";
    els.fileMeta.textContent = "Select one or more files up to 1GB each";
  } else {
    const fileLabel = state.selectedFiles.length === 1 ? "1 file ready" : `${state.selectedFiles.length} files ready`;
    els.fileName.textContent = fileLabel;
    els.fileMeta.textContent = `${formatBytes(totalSelectedSize())} selected - choose one or more devices`;
  }
}

function setFiles(files) {
  state.selectedFiles = [...(files || [])].filter(Boolean);
  renderSelectedFiles();
  updateFileDropCopy();
  updateSendState();
}

function showRequest(request) {
  state.pendingRequest = request;
  const files = Array.isArray(request.files) ? request.files : [];
  const fileCount = files.length || 1;
  const totalSize = files.length
    ? files.reduce((total, file) => total + Number(file.size || 0), 0)
    : Number(request.fileSize || 0);
  upsertTransferStatus(request.transferId, {
    name: request.senderName || "Peer",
    state: "waiting",
    detail: `Waiting for you to accept or decline ${fileCount} file${fileCount === 1 ? "" : "s"}.`,
    percent: 0,
    totalFiles: fileCount,
    completedFiles: 0,
  });
  els.requestTitle.textContent = `${request.senderName || "A device"} wants to send ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  els.requestBody.textContent =
    fileCount === 1
      ? `${request.fileName || files[0]?.name || "File"} (${formatBytes(totalSize || 0)})`
      : `${fileCount} files (${formatBytes(totalSize || 0)})`;
  updateCancelVisibility();
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
  if (!state.selectedFiles.length) return;
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
    if (mode === "send" && state.selectedFiles[0]) {
      const file = state.selectedFiles[0];
      const sender = createTransferSender(channel, {
        onProgress: ({ sent, total, percent }) => {
          setProgress("Sending", percent, `${formatBytes(sent)} / ${formatBytes(total)}`);
        },
      });
      await sender.sendFile(file);
      setProgress("Complete", 100, "File sent directly to peer.");
      log(`Sent ${file.name}.`);
      cleanupTransferSession();
    }
  });

  channel.addEventListener("message", (event) => {
    state.receiver?.handleMessage(event.data);
  });

  channel.addEventListener("close", () => log("DataChannel closed."));
}

async function startSenderPeer(receiverId, isRetry = false) {
  if (!state.selectedFiles.length) return;
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

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function completeReceive({ blob, fileName }) {
  downloadBlob(blob, fileName);
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
  const transferId = createTransferId();
  const files = state.selectedFiles.slice();
  if (!files.length) return;
  state.outboundTransfers.set(transferId, { targetId: receiverId, files, cancelled: false });
  await startLanTransfer(transferId, receiverId);
}

async function startLanTransfer(transferId, receiverId) {
  const transfer = state.outboundTransfers.get(transferId);
  if (!transfer || !receiverId || transfer.cancelled || state.cancelledTransfers.has(transferId)) return;

  const target = state.devices.find((device) => device.id === receiverId);
  const files = transfer.files || [];
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const chunkSize = 32 * 1024;
  let sentBytes = 0;

  resetPeer(false);
  updateCancelVisibility();
  setProgress("Sending", 0, `Sending ${files.length} file${files.length === 1 ? "" : "s"} to ${target?.name || "peer"}.`);
  upsertTransferStatus(transferId, {
    name: target?.name || "Peer",
    state: "sending",
    detail: `Sending ${files.length} file${files.length === 1 ? "" : "s"}.`,
    percent: 0,
    totalFiles: files.length,
    completedFiles: 0,
  });
  log(`Local transfer started for ${target?.name || "peer"}.`);

  for (const [fileIndex, file] of files.entries()) {
    if (transfer.cancelled || state.cancelledTransfers.has(transferId)) break;
    const fileId = `${transferId}-${fileIndex}`;
    let offset = 0;

    send("lan-transfer-start", {
      targetId: receiverId,
      transferId,
      fileId,
      fileIndex,
      totalFiles: files.length,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    });

    while (offset < file.size) {
      if (transfer.cancelled || state.cancelledTransfers.has(transferId)) break;
      const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
      offset += buffer.byteLength;
      sentBytes += buffer.byteLength;
      send("lan-transfer-chunk", {
        targetId: receiverId,
        transferId,
        fileId,
        chunk: arrayBufferToBase64(buffer),
        offset,
        fileSize: file.size,
      });
      const percent = totalBytes ? (sentBytes / totalBytes) * 100 : 100;
      setProgress("Sending", percent, `${file.name} - ${formatBytes(sentBytes)} / ${formatBytes(totalBytes)}`);
      upsertTransferStatus(transferId, {
        state: "sending",
        detail: `${file.name} - ${formatBytes(sentBytes)} / ${formatBytes(totalBytes)}`,
        percent,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (transfer.cancelled || state.cancelledTransfers.has(transferId)) break;
    send("lan-transfer-complete", { targetId: receiverId, transferId, fileId, fileName: file.name });
  }

  if (transfer.cancelled || state.cancelledTransfers.has(transferId)) {
    setProgress("Cancelled", 0, "Transfer cancelled.");
    upsertTransferStatus(transferId, {
      state: "cancelled",
      detail: "Transfer cancelled.",
      percent: 0,
    });
    log("Local transfer cancelled.");
  } else {
    setProgress("Complete", 100, "Files sent on the local network.");
    upsertTransferStatus(transferId, {
      state: "complete",
      detail: `Sent ${files.length} file${files.length === 1 ? "" : "s"}.`,
      percent: 100,
      completedFiles: files.length,
    });
    log(`Sent ${files.length} file${files.length === 1 ? "" : "s"} to ${target?.name || "peer"}.`);
  }

  finishOutboundTransfer(transferId);
  updateCancelVisibility();
  maybeClearSentFiles();
}

function startLanReceive(message) {
  const transferId = message.transferId || createTransferId();
  const fileId = message.fileId || `${transferId}-0`;
  const totalFiles = Number(message.totalFiles) || 1;
  const previousStatus = state.transferStatuses.get(transferId) || {};
  state.activeInboundSenderId = message.senderId;
  state.activeInboundTransferId = transferId;
  state.inboundTransfers.set(fileId, {
    transferId,
    totalFiles,
    fileName: message.fileName || "anydrop-download",
    fileSize: Number(message.fileSize) || 0,
    mimeType: message.mimeType || "application/octet-stream",
    chunks: [],
    received: 0,
  });
  resetPeer(false);
  updateCancelVisibility();
  setProgress("Receiving", 0, `Receiving ${message.fileName || "file"} on the local network.`);
  upsertTransferStatus(transferId, {
    name: message.senderName || previousStatus.name || "Peer",
    state: "receiving",
    detail: `Receiving ${message.fileName || "file"} (${Number(message.fileIndex || 0) + 1}/${totalFiles}).`,
    percent: previousStatus.percent || 0,
    totalFiles,
    completedFiles: previousStatus.completedFiles || 0,
  });
  log(`Receiving ${message.fileName || "file"} on the local network.`);
}

function receiveLanChunk(message) {
  if (!message.chunk || state.cancelledTransfers.has(message.transferId)) return;
  const fileId = message.fileId || `${message.transferId || "transfer"}-0`;
  const receiver = state.inboundTransfers.get(fileId);
  if (!receiver) return;
  const buffer = base64ToArrayBuffer(message.chunk);
  receiver.chunks.push(buffer);
  receiver.received += buffer.byteLength;
  const total = receiver.fileSize || Number(message.fileSize) || receiver.received;
  setProgress(
    "Receiving",
    total ? (receiver.received / total) * 100 : 0,
    `${receiver.fileName} - ${formatBytes(receiver.received)} / ${formatBytes(total)}`,
  );
  const status = state.transferStatuses.get(receiver.transferId) || {};
  const completedBytesWeight = Number(status.completedFiles || 0) / Number(receiver.totalFiles || 1);
  const currentFileWeight = total ? (receiver.received / total) / Number(receiver.totalFiles || 1) : 0;
  upsertTransferStatus(receiver.transferId, {
    state: "receiving",
    detail: `${receiver.fileName} - ${formatBytes(receiver.received)} / ${formatBytes(total)}`,
    percent: (completedBytesWeight + currentFileWeight) * 100,
  });
}

function completeLanReceive(message) {
  const fileId = message.fileId || `${message.transferId || "transfer"}-0`;
  const receiver = state.inboundTransfers.get(fileId);
  if (!receiver || state.cancelledTransfers.has(receiver.transferId)) return;
  const blob = new Blob(receiver.chunks, { type: receiver.mimeType });
  const fileName = message.fileName || receiver.fileName;
  downloadBlob(blob, fileName);
  setProgress("Receiving", 100, `${fileName} downloaded.`);
  log(`Received ${fileName}.`);
  state.inboundTransfers.delete(fileId);
  const status = state.transferStatuses.get(receiver.transferId) || {};
  const totalFiles = Number(receiver.totalFiles || status.totalFiles || 1);
  const completedFiles = Math.min(totalFiles, Number(status.completedFiles || 0) + 1);
  const isComplete = completedFiles >= totalFiles;
  upsertTransferStatus(receiver.transferId, {
    state: isComplete ? "complete" : "receiving",
    detail: isComplete
      ? `Received ${totalFiles} file${totalFiles === 1 ? "" : "s"}.`
      : `Received ${completedFiles}/${totalFiles} files.`,
    percent: isComplete ? 100 : (completedFiles / totalFiles) * 100,
    completedFiles,
    totalFiles,
  });
  if (!state.inboundTransfers.size) {
    state.activeInboundSenderId = null;
    state.activeInboundTransferId = null;
  }
  updateCancelVisibility();
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

function cancelCurrentTransfers() {
  if (state.pendingRequest) {
    upsertTransferStatus(state.pendingRequest.transferId, {
      name: state.pendingRequest.senderName || "Peer",
      state: "cancelled",
      detail: "You cancelled the incoming request.",
      percent: 0,
    });
    send("transfer-cancelled", {
      targetId: state.pendingRequest.senderId,
      transferId: state.pendingRequest.transferId,
    });
    log("Incoming transfer cancelled.");
    state.pendingRequest = null;
    if (els.requestDialog.open) els.requestDialog.close();
  }

  for (const [transferId, transfer] of state.outboundTransfers) {
    transfer.cancelled = true;
    state.cancelledTransfers.add(transferId);
    upsertTransferStatus(transferId, {
      state: "cancelled",
      detail: "You cancelled this transfer.",
      percent: 0,
    });
    send("transfer-cancelled", {
      targetId: transfer.targetId,
      transferId,
    });
  }

  if (state.activeInboundTransferId && state.activeInboundSenderId) {
    state.cancelledTransfers.add(state.activeInboundTransferId);
    upsertTransferStatus(state.activeInboundTransferId, {
      state: "cancelled",
      detail: "You cancelled this download.",
      percent: 0,
    });
    send("transfer-cancelled", {
      targetId: state.activeInboundSenderId,
      transferId: state.activeInboundTransferId,
    });
  }

  state.inboundTransfers.clear();
  state.activeInboundSenderId = null;
  state.activeInboundTransferId = null;
  state.outboundTransfers.clear();
  state.lanFallbackStarted = false;
  setFiles([]);
  setProgress("Cancelled", 0, "Transfer cancelled.");
  updateCancelVisibility();
}

function handleTransferCancelled(message) {
  const transferId = message.transferId;
  if (transferId) {
    state.cancelledTransfers.add(transferId);
    const outbound = state.outboundTransfers.get(transferId);
    if (outbound) outbound.cancelled = true;
    upsertTransferStatus(transferId, {
      name: message.senderName || state.transferStatuses.get(transferId)?.name || "Peer",
      state: "cancelled",
      detail: `${message.senderName || "Peer"} cancelled the transfer.`,
      percent: 0,
    });
    state.outboundTransfers.delete(transferId);
  }

  for (const [fileId, receiver] of state.inboundTransfers) {
    if (!transferId || receiver.transferId === transferId) state.inboundTransfers.delete(fileId);
  }

  if (!transferId || state.pendingRequest?.transferId === transferId) {
    state.pendingRequest = null;
    if (els.requestDialog.open) els.requestDialog.close();
  }

  if (!transferId || state.activeInboundTransferId === transferId) {
    state.activeInboundSenderId = null;
    state.activeInboundTransferId = null;
  }

  setProgress("Cancelled", 0, "Peer cancelled the transfer.");
  log("Peer cancelled the transfer.");
  updateCancelVisibility();
  maybeClearSentFiles();
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

els.cancelTransferBtn.addEventListener("click", () => {
  cancelCurrentTransfers();
});

els.fileInput.addEventListener("change", () => {
  setFiles(els.fileInput.files);
});

els.centerSendBtn?.addEventListener("click", () => {
  els.fileInput.click();
});

els.dropTarget.addEventListener("click", () => {
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
  setFiles(event.dataTransfer.files);
});

els.sendBtn.addEventListener("click", () => {
  const targets = state.devices.filter((device) => state.selectedIds.has(device.id));
  if (!targets.length || !state.selectedFiles.length) return;
  const files = state.selectedFiles.slice();
  const fileSummary = files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type,
  }));
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  setProgress("Waiting", 0, `Waiting for ${targets.length} device${targets.length === 1 ? "" : "s"} to accept.`);

  for (const target of targets) {
    const transferId = createTransferId();
    state.outboundTransfers.set(transferId, {
      targetId: target.id,
      files,
      cancelled: false,
    });
    upsertTransferStatus(transferId, {
      name: target.name,
      state: "waiting",
      detail: `Waiting for ${target.name} to accept or decline.`,
      percent: 0,
      totalFiles: files.length,
      completedFiles: 0,
    });
    send("transfer-request", {
      targetId: target.id,
      transferId,
      files: fileSummary,
      fileName: files.length === 1 ? files[0].name : `${files.length} files`,
      fileSize: totalSize,
      mimeType: files.length === 1 ? files[0].type : "application/octet-stream",
    });
    log(`Transfer request sent to ${target.name}.`);
  }
  state.lanFallbackStarted = false;
  updateCancelVisibility();
});

els.acceptBtn.addEventListener("click", () => {
  if (!state.pendingRequest) return;
  upsertTransferStatus(state.pendingRequest.transferId, {
    name: state.pendingRequest.senderName || "Peer",
    state: "receiving",
    detail: "Accepted. Waiting for files to arrive.",
    percent: 0,
  });
  send("transfer-accepted", {
    targetId: state.pendingRequest.senderId,
    transferId: state.pendingRequest.transferId,
  });
  log(`Accepted ${state.pendingRequest.fileName || "incoming files"}.`);
});

els.declineBtn.addEventListener("click", () => {
  if (!state.pendingRequest) return;
  upsertTransferStatus(state.pendingRequest.transferId, {
    name: state.pendingRequest.senderName || "Peer",
    state: "declined",
    detail: "You declined this request.",
    percent: 0,
  });
  send("transfer-declined", {
    targetId: state.pendingRequest.senderId,
    transferId: state.pendingRequest.transferId,
  });
  log(`Declined ${state.pendingRequest.fileName || "incoming files"}.`);
  state.pendingRequest = null;
  updateCancelVisibility();
});

els.requestDialog.addEventListener("close", () => {
  state.pendingRequest = null;
  updateCancelVisibility();
});

requestAnimationFrame(drawRadar);
connect();
