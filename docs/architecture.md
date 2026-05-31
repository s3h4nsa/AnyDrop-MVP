# AnyDrop Architecture

Version: 0.1 MVP

---

# What is AnyDrop?

AnyDrop is a browser-based peer-to-peer file sharing platform inspired by AirDrop.

Its goal is simple:

```text
Send files between any devices using only a web browser.
```

Supported platforms:

* Windows
* Linux
* macOS
* Android
* iPhone
* Tablets
* Future Smart TV support

No installation required.

No accounts required.

No cloud storage required.

---

# Core Design Philosophy

AnyDrop follows four principles:

### 1. Browser First

Everything should work inside a modern browser.

### 2. Peer-to-Peer

Files should move directly between devices.

### 3. Cross Platform

Operating system should not matter.

### 4. Privacy First

Servers should never store user files.

---

# High-Level Architecture

```text
 ┌─────────────┐
 │ Device A    │
 │ Browser     │
 └──────┬──────┘
        │
        │ WebRTC DataChannel
        │
 ┌──────▼──────┐
 │ Device B    │
 │ Browser     │
 └─────────────┘


       Discovery
          &
      Signaling

            │
            ▼

 ┌───────────────────┐
 │ Signaling Server  │
 │ Socket.IO         │
 └───────────────────┘
```

The server assists connection setup.

The file itself never passes through the server.

---

# System Components

AnyDrop consists of five major systems.

```text
UI Layer
    ↓
Discovery Layer
    ↓
Signaling Layer
    ↓
WebRTC Layer
    ↓
Transfer Layer
```

---

# UI Layer

Responsible for:

* Device list
* Radar interface
* File picker
* Progress display
* Transfer requests

Files:

```text
ui.js
radar.js
devices.js
progress.js
```

---

# Discovery Layer

Responsible for:

* Finding devices
* Showing online devices
* Updating device list

Uses:

```text
Socket.IO
```

Flow:

```text
Connect
    ↓
Register Device
    ↓
Broadcast Device List
    ↓
Display Devices
```

Files:

```text
discovery.js
```

---

# Signaling Layer

Responsible for:

* Offer exchange
* Answer exchange
* ICE exchange

Purpose:

Establish WebRTC connection.

Files:

```text
signaling.js
server.js
```

Flow:

```text
Transfer Request
      ↓
Accept
      ↓
Offer
      ↓
Answer
      ↓
ICE Exchange
```

---

# WebRTC Layer

Responsible for:

* PeerConnection creation
* DataChannel creation
* Direct communication

Files:

```text
webrtc.js
```

Flow:

```text
Create PeerConnection
        ↓
Create Offer
        ↓
Create Answer
        ↓
Exchange ICE
        ↓
Open DataChannel
```

---

# Transfer Layer

Responsible for:

* Metadata exchange
* Chunk transmission
* Progress tracking

Files:

```text
transfer.js
receiver.js
download.js
```

Flow:

```text
File Selected
      ↓
Metadata
      ↓
Chunk Transfer
      ↓
Completion
      ↓
Rebuild File
```

---

# Network Architecture

## Local Network Mode

MVP Version

```text
Laptop
   │
   │ WiFi
   │
Router
   │
   │ WiFi
   │
Phone
```

Both devices use the same network.

---

## Direct Internet Mode

Future

```text
Laptop
     │
Internet
     │
Phone
```

WebRTC attempts direct connection.

---

## TURN Relay Mode

Future

```text
Laptop
    │
TURN Server
    │
Phone
```

Used only if direct connection fails.

---

# Data Flow

Step 1

```text
Device Discovery
```

Step 2

```text
Transfer Request
```

Step 3

```text
Receiver Accepts
```

Step 4

```text
WebRTC Negotiation
```

Step 5

```text
DataChannel Opens
```

Step 6

```text
Metadata Sent
```

Step 7

```text
Chunks Sent
```

Step 8

```text
Receiver Rebuilds File
```

Step 9

```text
Download Starts
```

---

# File Transfer Model

Metadata

```json
{
  "type": "metadata",
  "fileName": "video.mp4",
  "fileSize": 104857600,
  "mimeType": "video/mp4"
}
```

Chunks

```text
64KB
64KB
64KB
64KB
...
```

Completion

```json
{
  "type": "complete"
}
```

---

# Frontend Structure

```text
public/
│
├── index.html
│
├── css/
│   ├── main.css
│   ├── radar.css
│   ├── devices.css
│   └── transfer.css
│
├── js/
│   ├── main.js
│   ├── discovery.js
│   ├── signaling.js
│   ├── webrtc.js
│   ├── transfer.js
│   ├── receiver.js
│   ├── download.js
│   ├── ui.js
│   └── utils.js
```

---

# Backend Structure

```text
server.js
```

Responsibilities:

* Device registry
* Socket mapping
* Signaling relay
* Connection management

The backend should never:

* Store files
* Scan files
* Process file contents

---

# Security Model

Current MVP

```text
Local Network
No Accounts
No Persistence
```

Future

```text
Device Verification
QR Pairing
Trusted Devices
End-to-End Encryption
```

---

# Scalability Plan

Version 0.1

```text
Single File Transfer
```

Version 0.2

```text
Multiple Files
```

Version 0.3

```text
Folder Transfer
```

Version 0.4

```text
Transfer Resume
```

Version 0.5

```text
Cross-Network Transfer
```

Version 1.0

```text
Universal Browser File Sharing
```

---

# Technology Stack

Frontend

* HTML5
* CSS3
* JavaScript

Networking

* Socket.IO
* WebRTC
* DataChannel

Backend

* Node.js
* Express

Future

* TURN (coturn)
* QR Pairing
* Electron
* Mobile Applications

---

# Design Goal

AnyDrop should feel as simple as AirDrop while remaining open, browser-based, and available on every major operating system.

Users should be able to open a webpage, discover nearby devices, and transfer files directly without creating an account or installing software.
