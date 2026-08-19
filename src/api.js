// src/api.js

import {
    TURNSTILE_SESSION_COOKIE,
    TURNSTILE_SESSION_TTL_SECONDS,
    createTurnstileSession,
    hasValidTurnstileSession
} from "./security.js";

import {
    getRoom,
    setRoom,
    sanitize,
    generateRoomCode,
    resolveRps,
    nextAliveBearIndex,
    syncTeamParts
} from "./rooms.js";

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

    // 3. Створити кімнату
    if (url.pathname === "/api/create-room" && request.method === "POST") {
        try {
            const body = await request.json();
            const username = sanitize(body.username) || "Гравець 1";
            const mode = body.mode || "AI";
            const rpsChoice = body.rpsChoice || "rock";

            const roomId = mode === "AI" ? "AI-" + generateRoomCode().slice(3) : generateRoomCode();
            const hostToken = crypto.randomUUID();

            let firstTurn = "TEAM_A";
            let aiRpsChoice = null;
            let isRpsTie = false;

            if (mode === "AI") {
                const choices = ['rock', 'paper', 'scissors'];
                aiRpsChoice = choices[Math.floor(Math.random() * choices.length)];
                const rps = resolveRps(rpsChoice, aiRpsChoice);
                firstTurn = rps.winner;
                isRpsTie = rps.isTie;
            }

            const roomState = {
                roomId,
                mode,
                status: mode === "AI" ? "PLAYING" : "WAITING",
                teamA: { username, rpsChoice, score: 0, token: hostToken, bearParts: [10, 10, 10], bearPositions: [160, 300, 440], partsLeft: 30 },
                teamB: { username: mode === "AI" ? "Бот 🤖" : null, rpsChoice: aiRpsChoice, score: 0, token: mode === "AI" ? "BOT_TOKEN" : null, bearParts: [10, 10, 10], bearPositions: [960, 1100, 1240], partsLeft: 30 },
                activeTeam: firstTurn,
                activeBearIndex: { TEAM_A: 0, TEAM_B: 0 },
                pendingShot: null,
                rpsResult: { isTie: isRpsTie, winner: firstTurn },
                lastAction: null,
                createdAt: Date.now()
            };

            await setRoom(env, roomId, roomState);

            const clientState = JSON.parse(JSON.stringify(roomState));
            delete clientState.teamA.token;
            delete clientState.teamB.token;

            return new Response(JSON.stringify({ roomId, roomState: clientState, playerToken: hostToken }), {
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
            const roomState = await getRoom(env, roomId);

            if (!roomState) {
                return new Response(JSON.stringify({ error: "Кімнату не знайдено" }), { status: 404 });
            }

            if (roomState.status !== "WAITING") {
                return new Response(JSON.stringify({ error: "Кімната вже заповнена" }), { status: 400 });
            }

            const joinerToken = crypto.randomUUID();
            roomState.teamB.username = sanitize(username) || "Гравець 2";
            roomState.teamB.rpsChoice = rpsChoice || "rock";
            roomState.teamB.token = joinerToken;
            roomState.status = "PLAYING";

            const rps = resolveRps(roomState.teamA.rpsChoice, roomState.teamB.rpsChoice);
            roomState.activeTeam = rps.winner;
            roomState.rpsResult = { isTie: rps.isTie, winner: rps.winner };

            await setRoom(env, roomId, roomState);

            const clientState = JSON.parse(JSON.stringify(roomState));
            delete clientState.teamA.token;
            delete clientState.teamB.token;

            return new Response(JSON.stringify({ roomState: clientState, playerToken: joinerToken }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }

    // 5. Отримати стан кімнати
    if (url.pathname === "/api/room-state" && request.method === "GET") {
        try {
            const roomId = url.searchParams.get("roomId");
            const room = await getRoom(env, roomId);
            if (!room) {
                return new Response(JSON.stringify({ error: "Кімнату не знайдено" }), { status: 404 });
            }
            const clientState = JSON.parse(JSON.stringify(room));
            delete clientState.teamA.token;
            delete clientState.teamB.token;
            return new Response(JSON.stringify(clientState), { headers: { "Content-Type": "application/json" } });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }

    // 6. Ігрова дія
    if (url.pathname === "/api/game-action" && request.method === "POST") {
        try {
            const { roomId, playerToken, action, payload } = await request.json();
            const room = await getRoom(env, roomId);

            if (!room) {
                return new Response(JSON.stringify({ error: "Недійсна сесія" }), { status: 403 });
            }

            const isTeamA = playerToken === room.teamA.token;
            const isTeamB = playerToken === room.teamB.token || (room.mode === "AI" && playerToken === "BOT_TOKEN");

            if (!isTeamA && !isTeamB) {
                return new Response(JSON.stringify({ error: "Неавторизована дія (невірний токен)" }), { status: 401 });
            }

            const actingTeam = isTeamA ? "TEAM_A" : "TEAM_B";

            if (action === "SHOOT") {
                if (room.status !== "PLAYING") {
                    return new Response(JSON.stringify({ error: "Матч уже завершено або він ще не почався" }), { status: 409 });
                }
                if (room.pendingShot) {
                    return new Response(JSON.stringify({ error: "Дочекайтеся завершення попереднього пострілу" }), { status: 409 });
                }
                if (room.activeTeam !== actingTeam) {
                    return new Response(JSON.stringify({ error: "Зараз хід супротивника!" }), { status: 400 });
                }

                const actingState = actingTeam === "TEAM_A" ? room.teamA : room.teamB;
                const bearIndex = Number(payload?.bearIndex);
                if (!Number.isInteger(bearIndex) || bearIndex !== room.activeBearIndex[actingTeam] || actingState.bearParts[bearIndex] <= 0) {
                    return new Response(JSON.stringify({ error: "Недійсний активний ведмедик" }), { status: 400 });
                }
                const bearX = Number(payload?.bearX);
                const bearY = Number(payload?.bearY);
                if (!Number.isFinite(bearX) || !Number.isFinite(bearY)) {
                    return new Response(JSON.stringify({ error: "Некоректна позиція ведмедика" }), { status: 400 });
                }
                actingState.bearPositions[bearIndex] = bearX;

                room.lastAction = {
                    type: "SHOOT",
                    team: actingTeam,
                    bearIndex,
                    bearX,
                    bearY,
                    angle: payload.angle,
                    power: payload.power,
                    timestamp: Date.now()
                };

                actingState.bearParts[bearIndex]--;
                syncTeamParts(actingState);
                room.activeBearIndex[actingTeam] = nextAliveBearIndex(actingState.bearParts, bearIndex);
                room.activeTeam = actingTeam === "TEAM_A" ? "TEAM_B" : "TEAM_A";
                room.pendingShot = { id: crypto.randomUUID(), team: actingTeam, timestamp: room.lastAction.timestamp };

                if (room.teamA.partsLeft <= 0 || room.teamB.partsLeft <= 0) {
                    room.status = "FINISHED";
                    room.pendingShot = null;
                }
            } else if (action === "REPORT_DAMAGE") {
                const targetTeam = actingTeam === "TEAM_A" ? "TEAM_B" : "TEAM_A";
                const targetState = targetTeam === "TEAM_A" ? room.teamA : room.teamB;
                const damageByBear = payload?.damageByBear;
                if (!room.pendingShot || room.pendingShot.team !== actingTeam || payload?.shotId !== room.pendingShot.id || !Array.isArray(damageByBear) || damageByBear.length !== 3) {
                    return new Response(JSON.stringify({ error: "Недійсний звіт про влучання" }), { status: 400 });
                }
                if (!damageByBear.every(damage => Number.isInteger(damage) && damage >= 0 && damage <= 3)) {
                    return new Response(JSON.stringify({ error: "Некоректна шкода" }), { status: 400 });
                }

                targetState.bearParts = targetState.bearParts.map((parts, index) => Math.max(0, parts - damageByBear[index]));
                syncTeamParts(targetState);
                if (targetState.bearParts[room.activeBearIndex[targetTeam]] <= 0 && targetState.partsLeft > 0) {
                    room.activeBearIndex[targetTeam] = nextAliveBearIndex(targetState.bearParts, room.activeBearIndex[targetTeam]);
                }
                room.pendingShot = null;
                if (targetState.partsLeft <= 0) room.status = "FINISHED";
            } else if (action === "REPORT_FALL") {
                if (room.status !== "PLAYING") {
                    return new Response(JSON.stringify({ error: "Матч уже завершено або він ще не почався" }), { status: 409 });
                }

                const actingState = actingTeam === "TEAM_A" ? room.teamA : room.teamB;
                const bearIndex = Number(payload?.bearIndex);
                if (!Number.isInteger(bearIndex) || bearIndex < 0 || bearIndex >= actingState.bearParts.length || actingState.bearParts[bearIndex] <= 0) {
                    return new Response(JSON.stringify({ error: "Недійсний ведмедик для падіння" }), { status: 400 });
                }

                actingState.bearParts[bearIndex] = 0;
                syncTeamParts(actingState);
                if (actingState.partsLeft > 0 && room.activeBearIndex[actingTeam] === bearIndex) {
                    room.activeBearIndex[actingTeam] = nextAliveBearIndex(actingState.bearParts, bearIndex);
                }
                if (actingState.partsLeft <= 0) room.status = "FINISHED";
            } else {
                return new Response(JSON.stringify({ error: "Невідома ігрова дія" }), { status: 400 });
            }

            await setRoom(env, roomId, room);

            const clientState = JSON.parse(JSON.stringify(room));
            delete clientState.teamA.token;
            delete clientState.teamB.token;

            return new Response(JSON.stringify({ room: clientState }), {
                headers: { "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }

    return null; // Маршрут не відноситься до API
}
