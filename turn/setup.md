# TURN Server Setup Guide

Version: 0.1

---

# Purpose

A TURN server acts as a relay when direct peer-to-peer communication is not possible.

AnyDrop should always attempt:

```text
Direct P2P
```

first.

Only use TURN when necessary.

---

# Connection Priority

```text
Direct Local Connection
          ↓
Direct Internet Connection
          ↓
TURN Relay Fallback
```

Preferred order:

1. Same Network
2. Direct WebRTC
3. TURN Relay

---

# Why TURN Exists

Some networks block direct WebRTC connections.

Examples:

* Strict NAT
* Carrier NAT
* Corporate Networks
* University Networks
* Hotel WiFi

Without TURN:

```text
Connection Failed
```

With TURN:

```text
Connection Successful
```

through relay.

---

# Recommended Software

AnyDrop uses:

```text
coturn
```

Advantages:

* Open source
* Industry standard
* Lightweight
* Well maintained

---

# Installation

Ubuntu

```bash
sudo apt update
sudo apt install coturn
```

Verify

```bash
turnserver --version
```

---

# Enable Service

Edit:

```text
/etc/default/coturn
```

Set:

```text
TURNSERVER_ENABLED=1
```

---

# Configuration File

Location:

```text
/etc/turnserver.conf
```

or

```text
/etc/coturn/turnserver.conf
```

---

# Basic Configuration

Example

```conf
listening-port=3478

fingerprint

lt-cred-mech

realm=anydrop.app

user=anydrop:StrongPassword123

total-quota=100

stale-nonce

no-multicast-peers
```

---

# Start Service

```bash
sudo systemctl restart coturn
```

Enable Startup

```bash
sudo systemctl enable coturn
```

Check Status

```bash
sudo systemctl status coturn
```

---

# Firewall

Allow:

```text
3478 UDP
3478 TCP
```

Example

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
```

---

# DNS

Example

```text
turn.anydrop.app
```

Recommended records:

```text
A Record
AAAA Record
```

---

# WebRTC Configuration

Example

```javascript
const rtcConfig = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302"
      ]
    },
    {
      urls: [
        "turn:turn.anydrop.app:3478"
      ],
      username: "anydrop",
      credential: "StrongPassword123"
    }
  ]
};
```

---

# STUN vs TURN

STUN

```text
Find Path
```

TURN

```text
Relay Data
```

STUN is preferred because it is faster.

TURN is a fallback.

---

# Performance Considerations

Direct Connection

```text
Device A
     ↔
Device B
```

Best speed.

TURN Relay

```text
Device A
     ↔
TURN Server
     ↔
Device B
```

Slower because data passes through server.

---

# Cost Considerations

TURN traffic consumes:

* Bandwidth
* CPU
* RAM

Example

```text
5 GB file
```

TURN must handle:

```text
5 GB Upload
+
5 GB Download
=
10 GB Traffic
```

per transfer.

---

# Security

Recommended:

* Strong passwords
* TLS support
* Firewall restrictions
* Rate limiting

Future AnyDrop versions should use:

```text
Temporary TURN Credentials
```

instead of static passwords.

---

# Monitoring

Useful commands

```bash
journalctl -u coturn
```

```bash
sudo systemctl status coturn
```

```bash
netstat -tulpn
```

---

# AnyDrop Usage Policy

Preferred:

```text
Local Network
```

Fallback:

```text
Direct WebRTC
```

Last Resort:

```text
TURN Relay
```

Files should only pass through TURN when no direct connection can be established.

---

# Future Improvements

Version 0.5

* Automatic TURN detection

Version 0.6

* Dynamic TURN credentials

Version 0.7

* Multi-region TURN servers

Version 1.0

* Automatic relay selection
* Global relay network
* Load balancing
* Geo routing

---

# Design Goal

TURN should be invisible to users.

AnyDrop should automatically choose the best available route while maximizing speed and minimizing relay usage.
