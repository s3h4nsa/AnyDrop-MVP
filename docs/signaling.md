# AnyDrop Signaling Specification

Version: 0.1 MVP

---

# Purpose

The signaling server exists to help devices discover each other and establish WebRTC connections.

The signaling server does NOT:

* Store files
* Process files
* Relay file data
* Keep transfer history

The signaling server ONLY:

* Tracks connected devices
* Relays signaling messages
* Assists WebRTC negotiation

---

# Signaling Architecture

```text
Device A
    │
    │ Socket.IO
    ▼
Signaling Server
    ▲
    │ Socket.IO
    │
Device B
```

After negotiation:

```text
Device A
    │
    │ WebRTC DataChannel
    │
Device B
```

File transfer bypasses the server.

---

# Connection Flow

```text
Connect
    ↓
Register Device
    ↓
Receive Device List
    ↓
Choose Device
    ↓
Transfer Request
    ↓
Accept
    ↓
Offer
    ↓
Answer
    ↓
ICE Exchange
    ↓
DataChannel Open
```

---

# Device Registration

Client Event

```json
{
  "event": "register-device",
  "name": "Gaming-PC"
}
```

Purpose

Register a device after connection.

---

# Device List Broadcast

Server Event

```json
{
  "event": "device-list",
  "devices": [
    {
      "id": "socket-id",
      "name": "Gaming-PC"
    }
  ]
}
```

Purpose

Update all connected devices.

Triggered:

* Device joins
* Device disconnects
* Device name changes

---

# Transfer Request

Client Event

```json
{
  "event": "transfer-request",
  "targetId": "receiver-id",
  "senderName": "Gaming-PC",
  "fileName": "video.mp4",
  "fileSize": 104857600
}
```

Purpose

Ask another device for permission to send a file.

---

# Transfer Accepted

Receiver Event

```json
{
  "event": "transfer-accepted",
  "senderId": "sender-id"
}
```

Purpose

Approve incoming transfer.

---

# Transfer Declined

Receiver Event

```json
{
  "event": "transfer-declined",
  "senderId": "sender-id"
}
```

Purpose

Reject transfer request.

---

# Offer Event

Client Event

```json
{
  "event": "offer",
  "targetId": "receiver-id",
  "offer": {}
}
```

Purpose

Begin WebRTC negotiation.

Sender:

* Creates PeerConnection
* Creates DataChannel
* Creates Offer

Server:

* Relays offer

Receiver:

* Processes offer

---

# Answer Event

Client Event

```json
{
  "event": "answer",
  "targetId": "sender-id",
  "answer": {}
}
```

Purpose

Complete WebRTC negotiation.

Receiver:

* Creates Answer

Server:

* Relays answer

Sender:

* Applies answer

---

# ICE Candidate Event

Client Event

```json
{
  "event": "ice-candidate",
  "targetId": "peer-id",
  "candidate": {}
}
```

Purpose

Exchange network candidates.

Allows:

* Local network routing
* NAT traversal
* Best path selection

Multiple ICE candidates may be exchanged.

---

# Disconnect Event

Server Trigger

```text
Socket Disconnect
```

Actions

* Remove device
* Broadcast new device list

---

# Server Responsibilities

The server must:

* Maintain device registry
* Maintain socket mapping
* Relay signaling packets
* Remove disconnected devices

The server must not:

* Store files
* Inspect file contents
* Relay file chunks

---

# Example Session

Step 1

```text
Gaming-PC joins
```

Step 2

```text
Android Phone joins
```

Step 3

```text
Server broadcasts updated device list
```

Step 4

```text
Gaming-PC selects Android Phone
```

Step 5

```text
Transfer Request
```

Step 6

```text
Android accepts
```

Step 7

```text
Offer
```

Step 8

```text
Answer
```

Step 9

```text
ICE Exchange
```

Step 10

```text
DataChannel Open
```

Step 11

```text
Direct File Transfer
```

---

# Future Signaling Extensions

Version 0.2

* Transfer cancellation
* Transfer queue updates

Version 0.3

* Multi-file sessions

Version 0.4

* Folder transfer negotiation

Version 0.5

* Device capabilities

Example

```json
{
  "deviceType": "phone",
  "platform": "android"
}
```

Version 1.0

* Session codes
* QR pairing
* Device trust system
* Relay fallback

---

# Security Notes

Current MVP

* Local network focused
* No authentication
* No accounts

Future Versions

* Device verification
* Session tokens
* Signed signaling packets
* Trusted devices

---

# Design Goal

The signaling layer should remain lightweight.

Files must always transfer directly between devices whenever possible.

The signaling server should only help devices find each other and establish a connection.
