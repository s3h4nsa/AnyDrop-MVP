import { formatBytes, getDeviceType, getPlatform } from "./utils.js";
import { createReceiver } from "./receiver.js";
import { createTransferSender } from "./transfer.js";

const USER_COLORS = ['#b8ff57', '#5DCAA5', '#7F77DD', '#4da6ff', '#FAC775', '#F0997B'];
const MAX_FILES = 10;

const state = {
  socket: null,
  selfId: null,
  devices: [],
  selectedFiles: [],
  pendingRequest: null,
  peer: null,
  receiver: null,
  dataChannel: null,
  pendingIceCandidates: [],
  activePeerId: null,
  transferRole: null,
  retryCount: 0,
  lanReceiver: null,
  lanFallbackStarted: false,
  currentUser: null,
};

const els = {
  overlay: document.getElementById('welcome-overlay'),
  usernameInput: document.getElementById('username-field'),
  charCount: document.getElementById('char-count'),
  continueBtn: document.getElementById('continue-btn'),
  liveCount: document.getElementById('live-count'),
  navAvatar: document.getElementById('nav-avatar'),
  navUsername: document.getElementById('nav-username'),
  connectionStatus: document.getElementById('connectionStatus'),
  mainApp: document.getElementById('main-app'),
  usersGrid: document.getElementById('users-grid'),
  dropzone: document.getElementById('dropzone'),
  browseBtn: document.getElementById('browse-btn'),
  fileInput: document.getElementById('file-input'),
  fileStack: document.getElementById('file-stack'),
  sendBtn: document.getElementById('send-btn'),
  transferList: document.getElementById('transfer-list'),
  logEntries: document.getElementById('log-entries'),
  popup: document.getElementById('send-popup'),
  popupUsers: document.getElementById('popup-users-list'),
  popupFileCount: document.getElementById('popup-file-count'),
  closePopup: document.getElementById('close-popup'),
  cancelPopup: document.getElementById('cancel-popup'),
  confirmSend: document.getElementById('confirm-send'),
  requestDialog: document.getElementById('requestDialog'),
  requestTitle: document.getElementById('requestTitle'),
  requestBody: document.getElementById('requestBody'),
  acceptBtn: document.getElementById('acceptBtn'),
  declineBtn: document.getElementById('declineBtn'),
  requestCloseBtn: document.getElementById('requestCloseBtn'),
  peerCount: document.getElementById('peer-count'),
  progressBar: document.getElementById('progressBar'),
  progressLabel: document.getElementById('progressLabel'),
  progressPercent: document.getElementById('progressPercent'),
  progressDetail: document.getElementById('progressDetail'),
};

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function setStatus(label, kind = '') {
  els.connectionStatus.textContent = label;
  els.connectionStatus.className = `status ${kind}`.trim();
  const dot = document.querySelector('.status-dot');
  if (!dot) return;
  dot.className = 'status-dot';
  if (kind === 'online') dot.classList.add('online');
  if (kind === 'offline') dot.classList.add('offline');
  if (kind === 'connecting') dot.classList.add('connecting');
}

function setPeerCount(count) {
  if (!els.peerCount) return;
  els.peerCount.textContent = `${count} peer${count === 1 ? '' : 's'} online`;
}

function log(message) {
  const item = document.createElement('div');
  item.className = 'log-line';
  item.innerHTML = `<span class="log-ts">${new Date().toLocaleTimeString()}</span><span class="log-tag tag-system">LOG</span><span class="log-msg">${message}</span>`;
  els.logEntries.appendChild(item);
  els.logEntries.scrollTop = els.logEntries.scrollHeight;
}

function send(event, data = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify({ event, ...data }));
  return true;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  state.socket = socket;
  setStatus('Connecting', 'connecting');

  socket.addEventListener('open', () => {
    setStatus('Online', 'online');
    log('Connected to signaling server.');
    if (state.currentUser) registerDevice();
  });

  socket.addEventListener('close', () => {
    setStatus('Offline', 'offline');
    log('Disconnected from signaling server. Reconnecting...');
    setTimeout(connect, 1200);
  });

  socket.addEventListener('message', async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleSignal(message);
    } catch (error) {
      log('Malformed server message ignored.');
    }
  });
}

function registerDevice() {
  if (!state.currentUser) return;
  send('register-device', {
    name: state.currentUser.name,
    deviceType: getDeviceType(navigator.userAgent),
    platform: getPlatform(navigator.userAgent),
  });
}

function handleSignal(message) {
  switch (message.event) {
    case 'welcome':
      state.selfId = message.id;
      break;
    case 'registered':
      state.selfId = message.id;
      break;
    case 'device-list':
      state.devices = message.devices || [];
      renderUsersGrid();
      break;
    case 'transfer-request':
      // Only show transfer requests that are meant for this client
      if (message.targetId && message.targetId !== state.selfId) return;
      // Ignore incoming requests while user hasn't entered the network
      if (!state.currentUser) {
        log('Ignored transfer request while not joined.');
        return;
      }
      showRequest(message);
      break;
    case 'transfer-accepted':
      sendFileViaLan(message.senderId || message.targetId);
      break;
    case 'transfer-declined':
      log(`${message.senderName || 'Peer'} declined the transfer.`);
      resetPeer();
      break;
    case 'offer':
      handleOffer(message);
      break;
    case 'answer':
      if (state.peer) {
        state.peer.setRemoteDescription(message.answer).then(() => flushPendingIceCandidates());
        log('WebRTC answer received.');
      }
      break;
    case 'ice-candidate':
      addIceCandidate(message.candidate);
      break;
    case 'connection-retry':
      retrySenderPeer(message.senderId || message.targetId);
      break;
    case 'lan-fallback-request':
      sendFileViaLan(message.senderId || message.targetId);
      break;
    case 'lan-transfer-start':
      startLanReceive(message);
      break;
    case 'lan-transfer-chunk':
      receiveLanChunk(message);
      break;
    case 'lan-transfer-complete':
      completeLanReceive(message);
      break;
    case 'error':
      log(`${message.code || 'Error'}: ${message.message || 'Unknown error'}`);
      break;
    default:
      break;
  }
}

function renderUsersGrid() {
  els.usersGrid.textContent = '';
  const peers = state.devices.filter((device) => device.id !== state.selfId);

  if (!state.currentUser) {
    const placeholder = document.createElement('div');
    placeholder.className = 'empty';
    placeholder.textContent = 'Enter the network to see peers.';
    els.usersGrid.appendChild(placeholder);
    setPeerCount(0);
    return;
  }

  if (!peers.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'empty';
    placeholder.textContent = 'No peers online. Open this app on another device on the same network.';
    els.usersGrid.appendChild(placeholder);
    setPeerCount(0);
    updateSendBtn();
    return;
  }

  for (const peer of peers) {
    const card = document.createElement('div');
    card.className = 'user-pill visible';
    card.innerHTML = `
      <div class="user-av" style="background:${peer.color || USER_COLORS[hashString(peer.id) % USER_COLORS.length]};">${peer.name.slice(0, 2).toUpperCase()}</div>
      <div class="user-info">
        <span class="user-name">${peer.name}</span>
        <span class="user-status">${peer.deviceType || 'device'} · ${peer.platform || 'web'}</span>
      </div>
    `;
    els.usersGrid.appendChild(card);
  }

  setPeerCount(peers.length);
  updateSendBtn();
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function setProgress(label, percent, detail) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  els.progressLabel.textContent = label;
  els.progressPercent.textContent = `${safePercent}%`;
  els.progressDetail.textContent = detail;
  els.progressBar.style.width = `${safePercent}%`;
}

function addFiles(files) {
  const space = MAX_FILES - state.selectedFiles.length;
  files.slice(0, space).forEach((file) => {
    const id = `${Date.now()}-${Math.random()}`;
    state.selectedFiles.push({ id, file });
    renderFileItem({ id, file });
  });
  updateSendBtn();
}

function renderFileItem({ id, file }) {
  const fileType = getFileType(file.name);
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.fid = id;
  item.innerHTML = `
    <div class="file-type-icon ${fileType.cls}">${fileType.label}</div>
    <div class="file-meta">
      <div class="file-name">${file.name}</div>
      <div class="file-size">${formatBytes(file.size)}</div>
    </div>
    <button class="remove-btn" type="button" data-fid="${id}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  item.querySelector('.remove-btn').addEventListener('click', () => removeFile(id));
  els.fileStack.appendChild(item);
}

function removeFile(id) {
  state.selectedFiles = state.selectedFiles.filter((f) => f.id !== id);
  const element = els.fileStack.querySelector(`[data-fid="${id}"]`);
  if (element) {
    element.style.opacity = '0';
    element.style.transform = 'translateX(10px)';
    setTimeout(() => element.remove(), 180);
  }
  updateSendBtn();
}

function updateSendBtn() {
  const hasFiles = state.selectedFiles.length > 0;
  const hasPeers = state.devices.some((device) => device.id !== state.selfId);
  const connected = state.socket && state.socket.readyState === WebSocket.OPEN;
  if (hasFiles && hasPeers && connected) {
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add('active');
  } else {
    els.sendBtn.disabled = true;
    els.sendBtn.classList.remove('active');
  }
}

function openSendPopup() {
  const totalSize = state.selectedFiles.reduce((sum, item) => sum + item.file.size, 0);
  els.popupFileCount.textContent = `${state.selectedFiles.length} file${state.selectedFiles.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}`;
  els.popupUsers.innerHTML = '';

  const peers = state.devices.filter((device) => device.id !== state.selfId);
  if (!peers.length) {
    els.popupUsers.innerHTML = `<p style="color:var(--c-gray-dim);font-size:12px;font-family:var(--f-mono);padding:12px 0;">No peers online</p>`;
    els.popup.classList.add('open');
    return;
  }

  peers.forEach((peer) => {
    const pill = document.createElement('div');
    pill.className = 'user-pill';
    pill.innerHTML = `
      <div class="user-av" style="background:${peer.color || USER_COLORS[hashString(peer.id) % USER_COLORS.length]};">${peer.name.slice(0, 2).toUpperCase()}</div>
      <div class="user-info">
        <span class="user-name">${peer.name}</span>
        <span class="user-status">peer · online</span>
      </div>
      <div class="online-dot"></div>
      <input type="checkbox" data-uid="${peer.id}" />
    `;
    pill.addEventListener('click', (event) => {
      if (event.target.tagName.toLowerCase() === 'input') return;
      const checkbox = pill.querySelector('input');
      checkbox.checked = !checkbox.checked;
      pill.classList.toggle('selected', checkbox.checked);
      updateConfirmBtn();
    });
    pill.querySelector('input').addEventListener('change', () => {
      pill.classList.toggle('selected', pill.querySelector('input').checked);
      updateConfirmBtn();
    });
    els.popupUsers.appendChild(pill);
  });

  els.popup.classList.add('open');
  updateConfirmBtn();
}

function closeSendPopup() {
  els.popup.classList.remove('open');
}

function updateConfirmBtn() {
  const selected = els.popupUsers.querySelectorAll('input:checked').length;
  els.confirmSend.disabled = selected === 0;
  els.confirmSend.textContent = selected > 0 ? `Send to ${selected}` : 'Send';
}

function getSelectedPeerIds() {
  return Array.from(els.popupUsers.querySelectorAll('input:checked')).map((input) => input.dataset.uid);
}

function showRequest(request) {
  // Don't interrupt onboarding or when a dialog is already visible
  if (els.overlay && !els.overlay.classList.contains('hidden')) {
    log('Transfer request received before joining; ignoring.');
    return;
  }
  if (els.requestDialog && els.requestDialog.open) {
    log('Request dialog already open; ignoring additional request.');
    return;
  }

  state.pendingRequest = request;
  const fileCount = request.fileCount || 1;
  els.requestTitle.textContent = `${request.senderName || 'A device'} wants to send ${fileCount} file${fileCount === 1 ? '' : 's'}`;
  els.requestBody.textContent = `${request.fileName || 'Unknown file'} · ${formatBytes(request.fileSize || 0)}`;
  els.requestDialog.showModal();
}

function closeRequestDialog(reason) {
  // Idempotent close: capture and clear pending request first
  const req = state.pendingRequest;
  state.pendingRequest = null;
  try { els.requestDialog.close(); } catch (e) { /* ignore */ }

  if (!req) return;

  // If the user accepted the request, the accept handler already sent the event.
  if (reason === 'accepted') return;

  // Otherwise notify sender that we declined (backdrop/cancel/explicit decline)
  if (req.senderId) {
    send('transfer-declined', { targetId: req.senderId });
    log(`Declined ${req.fileName || 'incoming transfer'}${reason === 'backdrop' ? ' by closing the popup.' : '.'}`);
  }
}

function createPeer(targetId, role) {
  resetPeer(false);
  const peer = new RTCPeerConnection(rtcConfig);
  state.peer = peer;
  state.pendingIceCandidates = [];
  state.activePeerId = targetId;
  state.transferRole = role;

  peer.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      send('ice-candidate', { targetId, candidate: event.candidate });
    }
  });

  peer.addEventListener('connectionstatechange', () => {
    log(`Peer connection: ${peer.connectionState}.`);
    if (peer.connectionState === 'connected') {
      state.retryCount = 0;
    }
    if (peer.connectionState === 'failed') {
      handlePeerFailure();
    }
    if (peer.connectionState === 'closed') {
      resetPeer(false);
    }
  });

  return peer;
}

function handlePeerFailure() {
  const targetId = state.activePeerId;
  const role = state.transferRole;
  resetPeer(false);
  setProgress('Retrying', 0, 'Connection failed. Trying a fresh WebRTC offer.');

  if (!targetId) return;
  if (role === 'send') {
    log('WebRTC failed. Switching sender to LAN fallback.');
    sendFileViaLan(targetId);
  } else if (role === 'receive') {
    send('lan-fallback-request', { targetId });
    setProgress('LAN fallback', 0, 'Peer connection failed. Switching to local-network relay.');
    log('Connection failed. Asked sender to use LAN fallback.');
  }
}

async function retrySenderPeer(receiverId) {
  if (state.selectedFiles.length === 0) return;
  if (state.retryCount >= 2) {
    log('Retry limit reached. Switching to LAN fallback.');
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
  channel.binaryType = 'arraybuffer';

  channel.addEventListener('open', async () => {
    log('Data channel open.');
    if (mode === 'send' && state.selectedFiles.length > 0) {
      const sender = createTransferSender(channel, {
        onProgress: ({ sent, total, percent }) => {
          setProgress('Sending', percent, `${formatBytes(sent)} / ${formatBytes(total)}`);
        },
      });

      for (const fileItem of state.selectedFiles) {
        await sender.sendFile(fileItem.file);
      }

      setProgress('Complete', 100, 'Files sent directly to peer.');
      log(`Sent ${state.selectedFiles.length} file${state.selectedFiles.length === 1 ? '' : 's'}.`);
      cleanupTransferSession();
    }
  });

  channel.addEventListener('message', (event) => {
    state.receiver?.handleMessage(event.data);
  });

  channel.addEventListener('close', () => {
    log('Data channel closed.');
  });
}

async function startSenderPeer(receiverId, isRetry = false) {
  if (!state.selectedFiles.length) return;
  const peer = createPeer(receiverId, 'send');
  state.retryCount = isRetry ? state.retryCount : 0;
  const channel = peer.createDataChannel('droplink-file');
  state.receiver = createReceiver({ onProgress: updateReceiveProgress, onComplete: completeReceive });
  attachDataChannel(channel, 'send');
  const offer = await peer.createOffer({ iceRestart: isRetry });
  await peer.setLocalDescription(offer);
  send('offer', { targetId: receiverId, offer });
  log(isRetry ? 'Retry offer sent.' : 'Transfer accepted. WebRTC offer sent.');
}

async function handleOffer(message) {
  const senderId = message.senderId;
  const peer = createPeer(senderId, 'receive');
  state.receiver = createReceiver({ onProgress: updateReceiveProgress, onComplete: completeReceive });
  peer.addEventListener('datachannel', (event) => attachDataChannel(event.channel, 'receive'));
  await peer.setRemoteDescription(message.offer);
  await flushPendingIceCandidates();
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  send('answer', { targetId: senderId, answer });
  log('Offer received. WebRTC answer sent.');
}

function updateReceiveProgress({ received, total, percent, fileName }) {
  setProgress(`Receiving ${fileName}`, percent, `${formatBytes(received)} / ${formatBytes(total)}`);
}

function completeReceive({ blob, fileName }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setProgress('Complete', 100, `${fileName} downloaded.`);
  log(`Received ${fileName}.`);
  cleanupTransferSession();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
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
  if (!state.selectedFiles.length || !receiverId || state.lanFallbackStarted) return;
  state.lanFallbackStarted = true;
  resetPeer(false);

  const file = state.selectedFiles[0].file;
  const chunkSize = 128 * 1024;
  let offset = 0;

  setProgress('LAN transfer', 0, `Sending ${file.name} through local network.`);
  log('Starting local network transfer.');

  send('lan-transfer-start', {
    targetId: receiverId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
  });

  while (offset < file.size) {
    const buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
    offset += buffer.byteLength;
    send('lan-transfer-chunk', {
      targetId: receiverId,
      chunk: arrayBufferToBase64(buffer),
      offset,
      fileSize: file.size,
    });
    setProgress('LAN transfer', (offset / file.size) * 100, `${formatBytes(offset)} / ${formatBytes(file.size)}`);
  }

  send('lan-transfer-complete', { targetId: receiverId, fileName: file.name });
  setProgress('Complete', 100, 'File sent through local network.');
  log(`Local network transfer completed for ${file.name}.`);
  state.lanFallbackStarted = false;
}

function startLanReceive(message) {
  state.lanReceiver = {
    fileName: message.fileName || 'droplink-download',
    fileSize: Number(message.fileSize) || 0,
    mimeType: message.mimeType || 'application/octet-stream',
    chunks: [],
    received: 0,
  };
  resetPeer(false);
  setProgress('LAN fallback', 0, `Receiving ${state.lanReceiver.fileName} through local network.`);
  log(`LAN fallback receiving ${state.lanReceiver.fileName}.`);
}

function receiveLanChunk(message) {
  if (!state.lanReceiver || !message.chunk) return;
  const buffer = base64ToArrayBuffer(message.chunk);
  state.lanReceiver.chunks.push(buffer);
  state.lanReceiver.received += buffer.byteLength;
  const total = state.lanReceiver.fileSize || Number(message.fileSize) || state.lanReceiver.received;
  setProgress('LAN fallback', total ? (state.lanReceiver.received / total) * 100 : 0, `${formatBytes(state.lanReceiver.received)} / ${formatBytes(total)}`);
}

function completeLanReceive(message) {
  if (!state.lanReceiver) return;
  const blob = new Blob(state.lanReceiver.chunks, { type: state.lanReceiver.mimeType });
  completeReceive({ blob, fileName: message.fileName || state.lanReceiver.fileName });
  state.lanReceiver = null;
}

function cleanupTransferSession() {
  setTimeout(() => resetPeer(false), 900);
}

function resetPeer(clearProgress = true) {
  if (state.dataChannel && state.dataChannel.readyState !== 'closed') state.dataChannel.close();
  if (state.peer && state.peer.connectionState !== 'closed') state.peer.close();
  state.peer = null;
  state.dataChannel = null;
  state.receiver = null;
  state.pendingIceCandidates = [];
  state.activePeerId = null;
  state.transferRole = null;
  if (clearProgress) setProgress('Idle', 0, 'No active transfer.');
}

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    zip: { cls: 'ft-zip', label: 'ZIP' },
    rar: { cls: 'ft-zip', label: 'RAR' },
    '7z': { cls: 'ft-zip', label: '7Z' },
    tar: { cls: 'ft-zip', label: 'TAR' },
    gz: { cls: 'ft-zip', label: 'GZ' },
    jpg: { cls: 'ft-jpg', label: 'JPG' },
    jpeg: { cls: 'ft-jpg', label: 'JPG' },
    png: { cls: 'ft-jpg', label: 'PNG' },
    gif: { cls: 'ft-jpg', label: 'GIF' },
    webp: { cls: 'ft-jpg', label: 'WEBP' },
    svg: { cls: 'ft-jpg', label: 'SVG' },
    pdf: { cls: 'ft-pdf', label: 'PDF' },
    mp4: { cls: 'ft-mp4', label: 'MP4' },
    mov: { cls: 'ft-mp4', label: 'MOV' },
    avi: { cls: 'ft-mp4', label: 'AVI' },
    mkv: { cls: 'ft-mp4', label: 'MKV' },
    mp3: { cls: 'ft-mp3', label: 'MP3' },
    wav: { cls: 'ft-mp3', label: 'WAV' },
    flac: { cls: 'ft-mp3', label: 'FLAC' },
    doc: { cls: 'ft-doc', label: 'DOC' },
    docx: { cls: 'ft-doc', label: 'DOCX' },
    xls: { cls: 'ft-doc', label: 'XLS' },
    xlsx: { cls: 'ft-doc', label: 'XLSX' },
    ppt: { cls: 'ft-doc', label: 'PPT' },
    pptx: { cls: 'ft-doc', label: 'PPTX' },
    txt: { cls: 'ft-txt', label: 'TXT' },
    md: { cls: 'ft-txt', label: 'MD' },
    json: { cls: 'ft-txt', label: 'JSON' },
    csv: { cls: 'ft-txt', label: 'CSV' },
    exe: { cls: 'ft-exe', label: 'EXE' },
    dmg: { cls: 'ft-exe', label: 'DMG' },
    sh: { cls: 'ft-exe', label: 'SH' },
  };
  return map[ext] || { cls: 'ft-default', label: ext.toUpperCase().slice(0, 4) || 'FILE' };
}

function startTransferItem(user, filename, size, direction) {
  const id = `t_${Date.now()}_${Math.random()}`;
  const transfer = { id, user, filename, size, direction, progress: 0 };
  const card = renderTransferCard(transfer);
  els.transferList.appendChild(card);
  return transfer;
}

function renderTransferCard(transfer) {
  const card = document.createElement('div');
  card.className = 'transfer-card';
  card.dataset.tid = transfer.id;
  card.innerHTML = `
    <div class="transfer-header">
      <div class="transfer-av" style="background:${transfer.user.color};">${transfer.user.name.slice(0, 2).toUpperCase()}</div>
      <div class="transfer-meta">
        <div class="transfer-name">${transfer.user.name}</div>
        <div class="transfer-info">${transfer.filename} · ${formatBytes(transfer.size)}</div>
      </div>
      <span class="transfer-direction ${transfer.direction === 'sending' ? 'dir-sending' : 'dir-receiving'}">
        ${transfer.direction === 'sending' ? '↑ SENDING' : '↓ RECEIVING'}
      </span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width:0%; background:${transfer.direction === 'sending' ? 'var(--c-lime)' : 'var(--c-info)'};"></div>
    </div>
    <div class="progress-footer">
      <span class="progress-pct">0%</span>
      <button class="cancel-transfer-btn" type="button" data-tid="${transfer.id}">Cancel</button>
    </div>
  `;
  card.querySelector('.cancel-transfer-btn').addEventListener('click', () => cancelTransfer(transfer.id));
  return card;
}

function updateTransferProgress(id, percent) {
  const card = els.transferList.querySelector(`[data-tid="${id}"]`);
  if (!card) return;
  const fill = card.querySelector('.progress-bar-fill');
  const pct = card.querySelector('.progress-pct');
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  if (fill) fill.style.width = `${safePercent}%`;
  if (pct) pct.textContent = `${safePercent}%`;
}

function completeTransfer(id) {
  const card = els.transferList.querySelector(`[data-tid="${id}"]`);
  if (!card) return;
  card.style.borderColor = 'rgba(184,255,87,0.3)';
  card.style.background = 'rgba(184,255,87,0.04)';
  setTimeout(() => {
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    card.style.transition = 'all 0.4s ease';
    setTimeout(() => card.remove(), 400);
  }, 1200);
}

function cancelTransfer(id) {
  const card = els.transferList.querySelector(`[data-tid="${id}"]`);
  if (card) card.remove();
  log('Transfer cancelled.');
}

els.usernameInput.addEventListener('input', () => {
  const value = els.usernameInput.value.trim();
  const len = value.length;
  els.charCount.textContent = `${len}/20`;
  els.charCount.className = `char-count${len > 16 ? ' warn' : ''}${len > 20 ? ' over' : ''}`;
  els.continueBtn.disabled = !/^[a-zA-Z0-9_-]{3,20}$/.test(value);
});

els.usernameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !els.continueBtn.disabled) {
    event.preventDefault();
    launchApp();
  }
});

function launchApp() {
  const name = els.usernameInput.value.trim();
  if (!name) return;
  state.currentUser = { name, color: USER_COLORS[0] };
  els.navUsername.textContent = name;
  els.navAvatar.textContent = name.slice(0, 2).toUpperCase();
  els.overlay.classList.add('hidden');
  els.mainApp?.classList.add('visible');
  els.popup.classList.remove('open');
  registerDevice();
}

els.continueBtn.addEventListener('click', launchApp);
els.browseBtn.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  els.fileInput.value = '';
  els.fileInput.click();
});
els.fileInput.addEventListener('change', (event) => {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  addFiles(files);
  event.target.value = '';
});
els.dropzone.addEventListener('click', () => {
  els.fileInput.value = '';
  els.fileInput.click();
});
els.dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'))
els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  els.dropzone.classList.remove('dragover');
  addFiles(Array.from(event.dataTransfer.files));
});
els.sendBtn.addEventListener('click', () => {
  if (state.selectedFiles.length === 0) return;
  openSendPopup();
});
els.closePopup.addEventListener('click', closeSendPopup);
els.cancelPopup.addEventListener('click', closeSendPopup);
els.popup.addEventListener('click', (event) => {
  if (event.target === els.popup) closeSendPopup();
});
els.confirmSend.addEventListener('click', () => {
  const selectedIds = getSelectedPeerIds();
  if (!selectedIds.length) return;
  const targetId = selectedIds[0];
  if (selectedIds.length > 1) {
    log('Multiple recipients selected. Sending to the first one for now.');
  }
  const firstFile = state.selectedFiles[0]?.file;
  if (!firstFile) return;
  setProgress('Waiting', 0, 'Waiting for peer to accept the transfer.');
  send('transfer-request', {
    targetId,
    fileName: firstFile.name,
    fileSize: firstFile.size,
    mimeType: firstFile.type || 'application/octet-stream',
  });
  closeSendPopup();
  log(`Transfer request sent to ${selectedIds.length > 1 ? 'first selected peer' : 'peer'}.`);
});
els.acceptBtn.addEventListener('click', () => {
  if (!state.pendingRequest) return;
  send('transfer-accepted', { targetId: state.pendingRequest.senderId });
  log(`Accepted ${state.pendingRequest.fileName || 'incoming file'}.`);
  closeRequestDialog('accepted');
});

els.declineBtn.addEventListener('click', () => {
  closeRequestDialog('declined');
});

els.requestCloseBtn?.addEventListener('click', () => closeRequestDialog('declined'));

els.requestDialog.addEventListener('click', (event) => {
  if (event.target !== els.requestDialog) return;
  closeRequestDialog('backdrop');
});

els.requestDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeRequestDialog('declined');
});

els.requestDialog.addEventListener('close', () => {
  // ensure pendingRequest cleared if not already
  state.pendingRequest = null;
});

setStatus('Offline', 'offline');
connect();
setInterval(() => {
  const current = Number(els.liveCount.textContent) || 3;
  const next = Math.max(1, current + (Math.random() > 0.5 ? 1 : -1));
  els.liveCount.textContent = next;
}, 2200);
