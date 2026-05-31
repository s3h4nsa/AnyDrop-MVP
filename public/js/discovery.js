export function withoutSelf(devices, selfId) {
  return (devices || []).filter((device) => device.id !== selfId);
}

export function findDevice(devices, id) {
  return (devices || []).find((device) => device.id === id) || null;
}
