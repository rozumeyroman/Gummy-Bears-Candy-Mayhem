// src/security.js

export const TURNSTILE_SESSION_COOKIE = "gummy_turnstile_session";
export const TURNSTILE_SESSION_TTL_SECONDS = 60 * 60;

export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookie = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

export async function getTurnstileSessionKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createTurnstileSession(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + TURNSTILE_SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  const key = await getTurnstileSessionKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function hasValidTurnstileSession(request, secret) {
  const session = getCookie(request, TURNSTILE_SESSION_COOKIE);
  if (!session || !secret) return false;

  const [version, expiresAtText, signature] = session.split(".");
  const expiresAt = Number(expiresAtText);
  if (version !== "v1" || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !signature) {
    return false;
  }

  const payload = `${version}.${expiresAt}`;
  try {
    const key = await getTurnstileSessionKey(secret);
    return crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}