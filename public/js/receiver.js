import { parseJson } from "./utils.js";

export function createReceiver(options = {}) {
  let metadata = null;
  let received = 0;
  let chunks = [];

  function reset() {
    metadata = null;
    received = 0;
    chunks = [];
  }

  function handleControl(message) {
    if (message.type === "metadata") {
      metadata = {
        fileName: message.fileName || "anydrop-download",
        fileSize: Number(message.fileSize) || 0,
        mimeType: message.mimeType || "application/octet-stream",
      };
      received = 0;
      chunks = [];
      options.onMetadata?.(metadata);
      options.onProgress?.({
        fileName: metadata.fileName,
        received,
        total: metadata.fileSize,
        percent: 0,
      });
      return;
    }

    if (message.type === "complete" && metadata) {
      const blob = new Blob(chunks, { type: metadata.mimeType });
      options.onComplete?.({ blob, fileName: metadata.fileName, metadata });
      reset();
    }
  }

  function handleMessage(data) {
    if (typeof data === "string") {
      const control = parseJson(data);
      if (control) handleControl(control);
      return;
    }

    if (!metadata) return;
    chunks.push(data);
    received += data.byteLength || data.size || 0;
    options.onProgress?.({
      fileName: metadata.fileName,
      received,
      total: metadata.fileSize,
      percent: metadata.fileSize ? (received / metadata.fileSize) * 100 : 100,
    });
  }

  return { handleMessage, reset };
}
