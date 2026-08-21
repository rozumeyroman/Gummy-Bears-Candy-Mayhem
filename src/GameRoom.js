// src/GameRoom.js
// SQLite-backed Durable Object: owns a single room's authoritative state,
// persists it via this.ctx.storage.sql, and pushes updates to connected
// clients over hibernatable WebSockets.

import { DurableObject } from "cloudflare:workers";
import {
    sanitize,
    generateRoomCode,
    resolveRps,
    nextAliveBearIndex,
    syncTeamParts
} from "./rooms.js";

function clientView(room) {
    const view = JSON.parse(JSON.stringify(room));
    delete view.teamA.token;
    delete view.teamB.token;
    return view;
}

export class GameRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.roomState = null;

        this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT)`);
        const row = [...this.ctx.storage.sql.exec(`SELECT data FROM rooms LIMIT 1`)][0];
        if (row) this.roomState = JSON.parse(row.data);
    }

    persist() {
        if (!this.roomState) return;
        this.ctx.storage.sql.exec(
            `INSERT INTO rooms (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
            this.roomState.roomId,
            JSON.stringify(this.roomState)
        );
    }

    broadcast(message, exceptWs = null) {
        const payload = JSON.stringify(message);
        for (const ws of this.ctx.getWebSockets()) {
            if (ws === exceptWs) continue;
            try { ws.send(payload); } catch (_) {}
        }
    }

    // --- RPC methods, invoked directly on the DO stub from the Worker ---

    async createRoom({ roomId, username, mode, rpsChoice }) {
        username = sanitize(username) || "Гравець 1";
        mode = mode || "AI";
        rpsChoice = rpsChoice || "rock";

        let firstTurn = "TEAM_A", aiRpsChoice = null, isRpsTie = false;
        if (mode === "AI") {
            const choices = ["rock", "paper", "scissors"];
            aiRpsChoice = choices[Math.floor(Math.random() * choices.length)];
            const rps = resolveRps(rpsChoice, aiRpsChoice);
            firstTurn = rps.winner;
            isRpsTie = rps.isTie;
        }

        const hostToken = crypto.randomUUID();
        this.roomState = {
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
        this.persist();

        return { roomId, roomState: clientView(this.roomState), playerToken: hostToken };
    }

    async joinRoom({ username, rpsChoice }) {
        if (!this.roomState) return { error: "Кімнату не знайдено", status: 404 };
        if (this.roomState.status !== "WAITING") return { error: "Кімната вже заповнена", status: 400 };

        const joinerToken = crypto.randomUUID();
        this.roomState.teamB.username = sanitize(username) || "Гравець 2";
        this.roomState.teamB.rpsChoice = rpsChoice || "rock";
        this.roomState.teamB.token = joinerToken;
        this.roomState.status = "PLAYING";

        const rps = resolveRps(this.roomState.teamA.rpsChoice, this.roomState.teamB.rpsChoice);
        this.roomState.activeTeam = rps.winner;
        this.roomState.rpsResult = { isTie: rps.isTie, winner: rps.winner };

        this.persist();
        this.broadcast({ type: "ROOM_UPDATED", roomState: clientView(this.roomState) });

        return { roomState: clientView(this.roomState), playerToken: joinerToken };
    }

    // Shared validation/mutation logic for SHOOT / REPORT_DAMAGE / REPORT_FALL
    applyGameAction(playerToken, action, payload) {
        const room = this.roomState;
        if (!room) return { error: "Недійсна сесія", status: 403 };

        const isTeamA = playerToken === room.teamA.token;
        const isTeamB = playerToken === room.teamB.token || (room.mode === "AI" && playerToken === "BOT_TOKEN");
        if (!isTeamA && !isTeamB) return { error: "Неавторизована дія (невірний токен)", status: 401 };

        const actingTeam = isTeamA ? "TEAM_A" : "TEAM_B";

        if (action === "SHOOT") {
            if (room.status !== "PLAYING") return { error: "Матч уже завершено або він ще не почався", status: 409 };
            if (room.pendingShot) return { error: "Дочекайтеся завершення попереднього пострілу", status: 409 };
            if (room.activeTeam !== actingTeam) return { error: "Зараз хід супротивника!", status: 400 };

            const actingState = actingTeam === "TEAM_A" ? room.teamA : room.teamB;
            const bearIndex = Number(payload?.bearIndex);
            if (!Number.isInteger(bearIndex) || bearIndex !== room.activeBearIndex[actingTeam] || actingState.bearParts[bearIndex] <= 0) {
                return { error: "Недійсний активний ведмедик", status: 400 };
            }
            const bearX = Number(payload?.bearX);
            const bearY = Number(payload?.bearY);
            if (!Number.isFinite(bearX) || !Number.isFinite(bearY)) {
                return { error: "Некоректна позиція ведмедика", status: 400 };
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
                return { error: "Недійсний звіт про влучання", status: 400 };
            }
            if (!damageByBear.every(damage => Number.isInteger(damage) && damage >= 0 && damage <= 3)) {
                return { error: "Некоректна шкода", status: 400 };
            }

            targetState.bearParts = targetState.bearParts.map((parts, index) => Math.max(0, parts - damageByBear[index]));
            syncTeamParts(targetState);
            if (targetState.bearParts[room.activeBearIndex[targetTeam]] <= 0 && targetState.partsLeft > 0) {
                room.activeBearIndex[targetTeam] = nextAliveBearIndex(targetState.bearParts, room.activeBearIndex[targetTeam]);
            }
            room.pendingShot = null;
            if (targetState.partsLeft <= 0) room.status = "FINISHED";
        } else if (action === "REPORT_FALL") {
            if (room.status !== "PLAYING") return { error: "Матч уже завершено або він ще не почався", status: 409 };

            const actingState = actingTeam === "TEAM_A" ? room.teamA : room.teamB;
            const bearIndex = Number(payload?.bearIndex);
            if (!Number.isInteger(bearIndex) || bearIndex < 0 || bearIndex >= actingState.bearParts.length || actingState.bearParts[bearIndex] <= 0) {
                return { error: "Недійсний ведмедик для падіння", status: 400 };
            }

            actingState.bearParts[bearIndex] = 0;
            syncTeamParts(actingState);
            if (actingState.partsLeft > 0 && room.activeBearIndex[actingTeam] === bearIndex) {
                room.activeBearIndex[actingTeam] = nextAliveBearIndex(actingState.bearParts, bearIndex);
            }
            if (actingState.partsLeft <= 0) room.status = "FINISHED";
        } else {
            return { error: "Невідома ігрова дія", status: 400 };
        }

        this.persist();
        return { room: clientView(room) };
    }

    // --- WebSocket transport (Hibernation API) ---

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket", { status: 426 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);

        if (this.roomState) {
            server.send(JSON.stringify({ type: "SYNC_STATE", roomState: clientView(this.roomState) }));
        }

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, message) {
        let parsed;
        try { parsed = JSON.parse(message); } catch (_) { return; }
        if (parsed.type !== "GAME_ACTION") return;

        const result = this.applyGameAction(parsed.playerToken, parsed.action, parsed.payload);

        ws.send(JSON.stringify({
            type: "ACTION_RESULT",
            requestId: parsed.requestId,
            error: result.error || null,
            room: result.room || null
        }));

        if (!result.error) {
            this.broadcast({ type: "ROOM_UPDATED", roomState: result.room }, ws);
        }
    }

    async webSocketClose(ws, code, reason, wasClean) {
        try { ws.close(code, reason); } catch (_) {}
    }
}
