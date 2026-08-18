// src/index.js

import { handleApiRoutes } from "./api.js";
import { renderHTML } from "./template.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

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