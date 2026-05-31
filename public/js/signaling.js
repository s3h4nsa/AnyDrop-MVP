export function createSignalingClient(url, handlers = {}) {
  let socket;

  function emit(event, data = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ event, ...data }));
    return true;
  }

  function connect() {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => handlers.open?.());
    socket.addEventListener("close", () => handlers.close?.());
    socket.addEventListener("error", (event) => handlers.error?.(event));
    socket.addEventListener("message", (event) => {
      try {
        handlers.message?.(JSON.parse(event.data));
      } catch {
        handlers.error?.(new Error("Malformed signaling message"));
      }
    });
    return socket;
  }

  return { connect, emit, get socket() { return socket; } };
}
