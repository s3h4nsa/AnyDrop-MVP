# AnyDrop Protocol Specification

Version: 0.1 MVP

---

# Overview

AnyDrop is a browser-based peer-to-peer file sharing system inspired by AirDrop.

The signaling server is used only for:

* Device discovery
* Session negotiation
* Connection setup

Files are transferred directly between devices using WebRTC DataChannels.

---

# Architecture

```text
Device A
   │
   │ WebRTC DataChannel
   │
Device B

       ▲
       │
       │ Socket.IO
       │
 Signaling Server
```

The signaling server never stores file contents.

---

# Discovery Protocol

When a device joins:

```json
{
  "event": "register-device",
  "name": "Gaming-PC"
}
```

Server broadcasts:

```json
{
  "event": "device-list",
  "devices": [
    {
      "id": "abc123",
      "name": "Gaming-PC"
    }
  ]
}
```

---

# Transfer Request Protocol

Sender requests transfer:

```json
{
  "event": "transfer-request",
  "targetId": "receiver-id",
  "senderName": "Gaming-PC",
  "fileName": "video.mp4",
  "fileSize": 104857600
}
```

Receiver response:

Accepted

```json
{
  "event": "transfer-accepted",
  "senderId": "sender-id"
}
```

Declined

```json
{
  "event": "transfer-declined",
  "senderId": "sender-id"
}
```

---

# WebRTC Signaling

Offer

```json
{
  "event": "offer",
  "targetId": "receiver-id",
  "offer": {}
}
```

Answer

```json
{
  "event": "answer",
  "targetId": "sender-id",
  "answer": {}
}
```

ICE Candidate

```json
{
  "event": "ice-candidate",
  "targetId": "peer-id",
  "candidate": {}
}
```

---

# Data Channel

Channel Name

```text
fileTransfer
```

Purpose

* File metadata
* File chunks
* Completion messages

---

# Metadata Packet

Sent before file transfer begins.

```json
{
  "type": "metadata",
  "fileName": "video.mp4",
  "fileSize": 104857600,
  "mimeType": "video/mp4"
}
```

---

# Chunk Packet

Binary ArrayBuffer.

Chunk Size

```text
64 KB
```

Current Default

```text
65536 bytes
```

Transfer sequence:

```text
Chunk 1
Chunk 2
Chunk 3
...
Chunk N
```

---

# Completion Packet

Sent after final chunk.

```json
{
  "type": "complete"
}
```

---

# Receiver Reconstruction

Receiver stores chunks:

```text
receivedChunks[]
```

After completion:

```javascript
new Blob(receivedChunks)
```

File becomes downloadable.

---

# Download Protocol

Generate Blob URL

```javascript
URL.createObjectURL(blob)
```

Trigger browser download

```javascript
anchor.click()
```

---

# Error Conditions

## Connection Lost

Transfer aborted.

Future versions:

* Resume support
* Retry support

## Receiver Offline

Transfer request fails.

## DataChannel Closed

Transfer terminated.

---

# Security

Current MVP

* Local network only
* No account system
* No cloud storage
* No file persistence on server

Future versions

* End-to-end encrypted metadata
* Device verification
* QR pairing
* Transfer approval tokens

---

# Future Protocol Extensions

Version 0.2

* Multiple file transfer
* Progress synchronization

Version 0.3

* Folder transfer

Version 0.4

* Resume interrupted transfers

Version 1.0

* Cross-network transfers
* TURN relay fallback
* QR code pairing
* Device trust system

---

# Design Goal

AnyDrop aims to provide:

```text
Any Device
Any Browser
Any Operating System

Direct File Transfer
Without Installing Apps
```

