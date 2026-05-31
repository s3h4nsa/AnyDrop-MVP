# AnyDrop Transfer Specification

Version: 0.1 MVP

---

# Purpose

This document defines how files are transferred between devices after a WebRTC DataChannel connection has been established.

The transfer system is responsible for:

* File metadata exchange
* Chunk transmission
* Progress tracking
* File reconstruction
* Download generation

---

# Transfer Architecture

```text
Sender
   │
   │ WebRTC DataChannel
   │
Receiver
```

The signaling server is not involved in file transfer.

---

# Transfer Flow

```text
Choose File
    ↓
Read Metadata
    ↓
Send Metadata
    ↓
Send Chunks
    ↓
Receive Chunks
    ↓
Send Completion Signal
    ↓
Rebuild File
    ↓
Download
```

---

# File Metadata

Before any file data is sent, metadata must be transmitted.

Example:

```json
{
  "type": "metadata",
  "fileName": "video.mp4",
  "fileSize": 104857600,
  "mimeType": "video/mp4"
}
```

Fields:

| Field    | Description        |
| -------- | ------------------ |
| fileName | Original file name |
| fileSize | File size in bytes |
| mimeType | Browser MIME type  |

Purpose:

Allows the receiver to prepare storage and calculate progress.

---

# Chunk Transfer

Files are split into smaller pieces.

Default Chunk Size

```text
64 KB
```

Equivalent

```text
65536 bytes
```

Example

```text
File
 │
 ├─ Chunk 1
 ├─ Chunk 2
 ├─ Chunk 3
 ├─ Chunk 4
 └─ Chunk N
```

Benefits:

* Lower memory usage
* Better stability
* Easier progress tracking
* Reduced browser crashes

---

# Sender Workflow

Step 1

User selects file.

Step 2

Metadata packet is sent.

Step 3

FileReader reads chunk.

Step 4

Chunk transmitted through DataChannel.

Step 5

Progress updated.

Step 6

Repeat until complete.

Step 7

Send completion packet.

---

# Completion Packet

After final chunk:

```json
{
  "type": "complete"
}
```

Purpose:

Inform receiver that transfer has ended.

---

# Receiver Workflow

Step 1

Receive metadata.

Step 2

Create transfer session.

Step 3

Store incoming chunks.

Step 4

Track received size.

Step 5

Wait for completion packet.

Step 6

Reconstruct file.

Step 7

Generate download.

---

# Progress Calculation

Sender

```text
Progress =
Sent Bytes
──────────
Total Bytes
```

Receiver

```text
Progress =
Received Bytes
──────────────
Total Bytes
```

Example

```text
50 MB / 100 MB

Progress = 50%
```

---

# Transfer Speed

Future Feature

Formula

```text
Bytes Received
──────────────
Elapsed Time
```

Example

```text
14.5 MB/s
```

---

# ETA Calculation

Future Feature

Formula

```text
Remaining Bytes
───────────────
Transfer Speed
```

Example

```text
12 seconds remaining
```

---

# File Reconstruction

After all chunks arrive:

```javascript
new Blob(receivedChunks)
```

Purpose:

Rebuild original file.

Example

```text
Chunk1
Chunk2
Chunk3
Chunk4
```

becomes

```text
Original File
```

---

# Download Generation

Create Blob URL

```javascript
URL.createObjectURL(blob)
```

Generate temporary link

```javascript
a.href = blobUrl
```

Trigger browser download

```javascript
a.click()
```

Result

```text
File Saved To Device
```

---

# Memory Management

After download:

* Clear chunk array
* Clear metadata
* Revoke Blob URL

Example

```javascript
URL.revokeObjectURL(url)
```

Purpose:

Prevent memory leaks.

---

# Error Conditions

## Receiver Disconnects

Result

```text
Transfer Failed
```

Action

```text
Abort Session
```

---

## Sender Disconnects

Result

```text
Transfer Incomplete
```

Action

```text
Discard Partial Data
```

---

## DataChannel Closes

Result

```text
Transfer Interrupted
```

Action

```text
Cancel Transfer
```

---

## Corrupted Transfer

Future Feature

Use checksum validation.

Example

```text
SHA-256
```

Verify file integrity.

---

# Future Improvements

Version 0.2

* Transfer speed display
* ETA display
* Transfer cancellation

Version 0.3

* Multiple file transfer

Version 0.4

* Folder transfer

Version 0.5

* Resume interrupted transfers

Version 0.6

* Integrity verification

Version 0.7

* Compression support

Version 1.0

* Adaptive chunk sizing
* Smart routing
* Background transfers

---

# Design Goals

The transfer layer should be:

* Fast
* Reliable
* Memory efficient
* Browser compatible
* Independent of operating system

Files should always travel directly between devices whenever possible.

No file data should pass through the AnyDrop server.
