# AnyDrop API Reference

Version: 0.1 MVP

---

# Overview

This document defines all public events used by AnyDrop.

Transport:

```text
Socket.IO
```

Purpose:

* Device discovery
* Transfer requests
* WebRTC signaling
* Connection management

Files are not transferred through the API.

Files are transferred through WebRTC DataChannels.

---

# Event Categories

```text
Discovery
Transfer Requests
WebRTC Signaling
Connection Management
```

---

# Discovery Events

## register-device

Direction

```text
Client → Server
```

Purpose

Register a device after connecting.

Payload

```json
{
  "name": "Gaming-PC"
}
```

Example

```javascript
socket.emit("register-device", {
  name: "Gaming-PC"
});
```

---

## device-list

Direction

```text
Server → Client
```

Purpose

Update online devices.

Payload

```json
{
  "devices": [
    {
      "id": "socket-id",
      "name": "Gaming-PC"
    },
    {
      "id": "socket-id-2",
      "name": "Android Phone"
    }
  ]
}
```

Example

```javascript
socket.on("device-list", data => {
  console.log(data.devices);
});
```

---

# Transfer Request Events

## transfer-request

Direction

```text
Client → Server → Receiver
```

Purpose

Request permission to send a file.

Payload

```json
{
  "targetId": "receiver-id",
  "senderId": "sender-id",
  "senderName": "Gaming-PC",
  "fileName": "video.mp4",
  "fileSize": 104857600
}
```

---

## transfer-accepted

Direction

```text
Receiver → Server → Sender
```

Purpose

Approve transfer.

Payload

```json
{
  "receiverId": "receiver-id"
}
```

---

## transfer-declined

Direction

```text
Receiver → Server → Sender
```

Purpose

Reject transfer.

Payload

```json
{
  "receiverId": "receiver-id"
}
```

---

# WebRTC Signaling Events

## offer

Direction

```text
Sender → Server → Receiver
```

Purpose

Start WebRTC negotiation.

Payload

```json
{
  "targetId": "receiver-id",
  "offer": {}
}
```

---

## answer

Direction

```text
Receiver → Server → Sender
```

Purpose

Complete WebRTC negotiation.

Payload

```json
{
  "targetId": "sender-id",
  "answer": {}
}
```

---

## ice-candidate

Direction

```text
Peer ↔ Server ↔ Peer
```

Purpose

Exchange ICE candidates.

Payload

```json
{
  "targetId": "peer-id",
  "candidate": {}
}
```

---

# Connection Events

## connect

Direction

```text
Socket.IO Internal
```

Purpose

Client successfully connects.

Example

```javascript
socket.on("connect", () => {
  console.log("Connected");
});
```

---

## disconnect

Direction

```text
Socket.IO Internal
```

Purpose

Client disconnects.

Example

```javascript
socket.on("disconnect", () => {
  console.log("Disconnected");
});
```

---

# DataChannel Messages

After WebRTC is established:

```text
Browser ↔ Browser
```

No server involvement.

---

## Metadata Packet

Purpose

Describe file before transfer.

Payload

```json
{
  "type": "metadata",
  "fileName": "video.mp4",
  "fileSize": 104857600,
  "mimeType": "video/mp4"
}
```

---

## Binary Chunk

Purpose

Transfer file data.

Type

```text
ArrayBuffer
```

Default Chunk Size

```text
65536 bytes
```

---

## Completion Packet

Purpose

Signal end of transfer.

Payload

```json
{
  "type": "complete"
}
```

---

# Error Responses

Future Version

Standardized errors.

Example

```json
{
  "error": true,
  "code": "DEVICE_OFFLINE",
  "message": "Target device unavailable"
}
```

---

# Future Events

## transfer-cancel

```json
{
  "transferId": "abc123"
}
```

Purpose

Cancel active transfer.

---

## transfer-progress

```json
{
  "percent": 65
}
```

Purpose

Synchronize progress.

---

## folder-transfer

```json
{
  "folderName": "Projects"
}
```

Purpose

Transfer directory structures.

---

## qr-pair

```json
{
  "sessionCode": "ABCD1234"
}
```

Purpose

Remote pairing.

---

# Server Event Map

```text
register-device
        ↓
device-list

transfer-request
        ↓
transfer-accepted
        ↓
offer
        ↓
answer
        ↓
ice-candidate
        ↓
WebRTC Connected
```

---

# WebRTC Event Map

```text
Metadata
    ↓
Chunk 1
    ↓
Chunk 2
    ↓
Chunk 3
    ↓
...
    ↓
Complete
```

---

# Version Compatibility

v0.1

Supported:

* Device discovery
* Transfer requests
* WebRTC signaling
* Single file transfer

Not Supported:

* Multiple files
* Folder transfer
* Resume
* Cross-network relay

---

# Design Rule

The API should remain lightweight.

The server's responsibility ends once the WebRTC DataChannel has been established.

All file data should flow directly between devices whenever possible.
