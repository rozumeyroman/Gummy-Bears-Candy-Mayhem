// src/index.js

import { handleApiRoutes } from "./api.js";
import { renderHTML } from "./template.js";
import { hasValidTurnstileSession } from "./security.js";

export { GameRoom } from "./GameRoom.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // 0. WebSocket-з'єднання з кімнатою -> відповідний GameRoom Durable Object
        const wsMatch = url.pathname.match(/^\/ws\/room\/([^/]+)$/);
        if (wsMatch) {
            if (!(await hasValidTurnstileSession(request, env.TURNSTILE_SECRET_KEY))) {
                return new Response("Turnstile verification required", { status: 403 });
            }
            const roomId = decodeURIComponent(wsMatch[1]);
            const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
            return stub.fetch(request);
        }

        // 1. Обробити API-маршрути (/api/*)
        const apiResponse = await handleApiRoutes(request, env, url);
        if (apiResponse) {
            return apiResponse;
        }

        // 2. Рендеринг HTML для головної сторінки
        if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
            const html = renderHTML();
            return new Response(html, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "X-Content-Type-Options": "nosniff"
                }
            });
        }

        return new Response("Not Found", { status: 404 });
    }
};
