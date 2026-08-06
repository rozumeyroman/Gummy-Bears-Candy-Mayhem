// src/index.js

import { handleApiRoutes } from "./api.js";
import { renderHTML } from "./template.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // 1. Спроба обробити API-маршрут (/api/*)
        const apiResponse = await handleApiRoutes(request, env, url);
        if (apiResponse) {
            return apiResponse;
        }

        // 2. Рендеринг фронтенд-сторінки для звичайних GET запитів
        if (request.method === "GET") {
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