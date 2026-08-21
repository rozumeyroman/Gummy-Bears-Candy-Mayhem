// src/api.js

import {
    TURNSTILE_SESSION_COOKIE,
    TURNSTILE_SESSION_TTL_SECONDS,
    createTurnstileSession,
    hasValidTurnstileSession
} from "./security.js";

import { generateRoomCode } from "./rooms.js";

export async function handleApiRoutes(request, env, url) {
    // 1. Обмін токена Turnstile на сесійну куку
    if (url.pathname === "/api/verify-turnstile" && request.method === "POST") {
        if (!env.TURNSTILE_SECRET_KEY) {
            return new Response(JSON.stringify({ error: "Turnstile secret is not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        try {
            const { token } = await request.json();
            if (typeof token !== "string" || !token) {
                return new Response(JSON.stringify({ error: "Turnstile token is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
            }

            const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    secret: env.TURNSTILE_SECRET_KEY,
                    response: token,
                    remoteip: request.headers.get("CF-Connecting-IP") || undefined
                })
            });
            const outcome = await verification.json();
            if (!outcome.success) {
                return new Response(JSON.stringify({ error: "Turnstile verification failed" }), { status: 403, headers: { "Content-Type": "application/json" } });
            }

            const session = await createTurnstileSession(env.TURNSTILE_SECRET_KEY);
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                    "Set-Cookie": `${TURNSTILE_SESSION_COOKIE}=${session}; Max-Age=${TURNSTILE_SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`
                }
            });
        } catch {
            return new Response(JSON.stringify({ error: "Invalid Turnstile verification request" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
    }

    // 2. Перевірка статусу сесії Turnstile
    if (url.pathname === "/api/turnstile-status" && request.method === "GET") {
        const verified = await hasValidTurnstileSession(request, env.TURNSTILE_SECRET_KEY);
        return new Response(JSON.stringify({ verified }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    }

    // Захист усіх ігрових ендпоінтів
    if (url.pathname.startsWith("/api/") && !(await hasValidTurnstileSession(request, env.TURNSTILE_SECRET_KEY))) {
        return new Response(JSON.stringify({ error: "Turnstile verification required" }), {
            status: 403,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    }

    // 3. Створити кімнату (стан кімнати живе в GameRoom Durable Object)
    if (url.pathname === "/api/create-room" && request.method === "POST") {
        try {
            const body = await request.json();
            const mode = body.mode || "AI";
            const roomId = mode === "AI" ? "AI-" + generateRoomCode().slice(3) : generateRoomCode();

            const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
            const result = await stub.createRoom({
                roomId,
                username: body.username,
                mode,
                rpsChoice: body.rpsChoice
            });

            return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }

    // 4. Приєднатися до кімнати
    if (url.pathname === "/api/join-room" && request.method === "POST") {
        try {
            const { roomId, username, rpsChoice } = await request.json();
            const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
            const result = await stub.joinRoom({ username, rpsChoice });

            if (result.error) {
                return new Response(JSON.stringify({ error: result.error }), { status: result.status || 400 });
            }

            return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }

    return null; // Маршрут не відноситься до API
}
