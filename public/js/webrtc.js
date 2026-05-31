export function createPeerConnection(targetId, signaling, config = {}) {
  const peer = new RTCPeerConnection(config);
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      signaling.emit("ice-candidate", { targetId, candidate: event.candidate });
    }
  });
  return peer;
}
