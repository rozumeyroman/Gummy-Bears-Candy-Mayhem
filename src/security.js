// src/security.js

// Константа для назви сесійного cookie Turnstile
export const TURNSTILE_SESSION_COOKIE = "gummy_turnstile_session";

// Константа для TTL (time-to-live) сесійного cookie Turnstile в секундах (1 година)
export const TURNSTILE_SESSION_TTL_SECONDS = 60 * 60;

// Функція для кодування масиву байтів у формат Base64 URL
export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Функція для декодування рядка з формату Base64 URL у масив байтів
export function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// Функція для отримання значення cookie з запиту за його назвою
export function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookie = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

// Функція для отримання ключа HMAC з використанням секретного ключа
export async function getTurnstileSessionKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// Функція для створення сесійного токена Turnstile
export async function createTurnstileSession(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + TURNSTILE_SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  const key = await getTurnstileSessionKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Функція для перевірки дійсності сесійного токена Turnstile в запиті
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