export function percent(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

export function createProgressState() {
  return {
    label: "Idle",
    detail: "No active transfer.",
    percent: 0,
  };
}
