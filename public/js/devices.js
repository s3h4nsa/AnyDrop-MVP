export function initials(name) {
  const value = String(name || "?").trim();
  return value.slice(0, 1).toUpperCase() || "?";
}
