export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function shortId(id) {
  return String(id || "").slice(0, 8);
}

export function getPlatform(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("mac os")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  return "Web";
}

export function getDeviceType(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("mobi") || ua.includes("iphone") || ua.includes("android")) return "phone";
  return "desktop";
}

export function getDeviceIdentity(userAgent, platformInfo = navigator.userAgentData) {
  const ua = String(userAgent || "").toLowerCase();
  const platform = getPlatform(userAgent);

  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android") && ua.includes("mobile")) return "Android Phone";
  if (ua.includes("android")) return "Android Tablet";
  if (ua.includes("mac os")) return "MacBook / Mac";
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("linux")) return "Linux PC";

  const brands = platformInfo?.brands?.map((brand) => brand.brand).filter(Boolean).join(" / ");
  return brands ? `${platform} ${brands}` : `${platform} Device`;
}

export function createOwnerDeviceName(userAgent, storedName) {
  if (storedName) return storedName;

  const identity = getDeviceIdentity(userAgent);
  const owner = localStorage.getItem("anydrop.ownerName")?.trim();
  if (owner) return `${owner}'s ${identity}`;

  return identity;
}

export function parseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
