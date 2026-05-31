export function createRadarPoint(index, total) {
  const angle = (Math.PI * 2 * index) / Math.max(1, total);
  return { x: Math.cos(angle), y: Math.sin(angle), angle };
}
