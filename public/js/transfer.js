export const CHUNK_SIZE = 64 * 1024;

function waitForBuffer(channel, lowWaterMark = CHUNK_SIZE * 8) {
  if (channel.bufferedAmount <= lowWaterMark) return Promise.resolve();
  return new Promise((resolve) => {
    const previous = channel.onbufferedamountlow;
    channel.bufferedAmountLowThreshold = lowWaterMark;
    channel.onbufferedamountlow = () => {
      channel.onbufferedamountlow = previous || null;
      resolve();
    };
  });
}

function sendJson(channel, payload) {
  channel.send(JSON.stringify(payload));
}

export function createTransferSender(channel, options = {}) {
  async function sendFile(file) {
    if (!file) {
      throw new Error("No file selected");
    }

    sendJson(channel, {
      type: "metadata",
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    });

    let offset = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await chunk.arrayBuffer();
      await waitForBuffer(channel);
      channel.send(buffer);
      offset += buffer.byteLength;
      options.onProgress?.({
        sent: offset,
        total: file.size,
        percent: file.size ? (offset / file.size) * 100 : 100,
      });
    }

    sendJson(channel, { type: "complete" });
    options.onComplete?.({ file });
  }

  return { sendFile };
}
