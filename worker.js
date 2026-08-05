// --- ІСТОРІЯ ВЕРСІЙ ---
const CHANGELOG = [
  {
    version: "2.6",
    date: "2026-08-05",
    changes: [
      "Виправлено: Ротація ходів тепер переходить до наступного живого ведмедика (1 → 2 → 3 → 1)",
      "Виправлено: Сервер синхронізує окремий запас частин кожного ведмедика та коректно завершує матч",
      "Виправлено: Фінальне вікно гарантовано відкривається після знищення останнього ведмедика",
      "Стабільність: Заблоковано дублювання шкоди, постріли під час анімації та паралельні запити поллінгу"
    ]
  },
  {
    version: "2.5",
    date: "2026-08-03",
    changes: [
      "Виправлено: Реванш тепер повертає в лобі для нового вибору RPS (Камінь/Ножиці/Папір)",
      "Виправлено: Повністю скидається черга ходів ведмедиків (1 -> 2 -> 3) при повторних матчах",
      "UX: З фінального модального вікна прибрано некоректний блок з очками",
      "Виправлено: Гарантовано спрацьовує вікно перемоги/поразки після кожної зіграної партії"
    ]
  },
  {
    version: "2.4",
    date: "2026-08-03",
    changes: [
      "Виправлено: Фінальне модальне вікно перемоги/поразки тепер миттєво спрацьовує при знищенні останнього ведмедя",
      "Виправлено: Кнопка Реванш тепер повністю скидає стан частин ведмедиків (10/10) для нового матчу"
    ]
  },
  {
    version: "2.3",
    date: "2026-08-03",
    changes: [
      "Виправлено: AI тепер коректно робить перший хід, якщо виграє RPS",
      "Виправлено: Гра тепер завжди коректно завершується (damage від AI репортується на сервер)",
      "Видалено лідерборд та залежність від Cloudflare KV — стан кімнат зберігається в RAM",
      "Додано модальне вікно завершення гри з очками та кнопками Реванш/Меню"
    ]
  },
  {
    version: "2.2",
    date: "2026-08-03",
    changes: [
      "Безпека: Додано токени сесії (playerToken) для захисту від дій сторонніх осіб у кімнаті",
      "Безпека: Розрахунок очок і фіксація перемоги перенесені повністю на сервер (клієнт більше не відправляє finalScore)",
      "Безпека: Коди кімнат збільшено до 6 символів (наприклад, RM-8F3K2A) та додано HTTP-заголовки безпеки (CSP, nosniff)",
      "UX: Нікнейм тепер надійно зберігається в localStorage і модальне вікно не з'являється після кожного матчу",
      "Геймплей: Реалізовано анімоване 3D-підкидання монетки при однаковому виборі в RPS (Камінь/Ножиці/Папір)",
      "Геймплей: Додано модальне вікно з результатом RPS та жеребкування перед початком матчу"
    ]
  },
  {
    version: "2.1",
    date: "2026-08-03",
    changes: [
      "Виправлено критичний краш при старті через temporal dead zone змінної wind",
      "Синхронізовано activeTeam/activeBearIndex з відповіддю сервера",
      "Хід бота тепер репортується на сервер",
      "Виправлено обчислення bearIndex для команди B",
      "Додано лічильник очок (scoreDisplay)"
    ]
  },
  {
    version: "2.0",
    date: "2026-08-03",
    changes: [
      "Виправлено чергу ходів по колу (1 → 2 → 3)",
      "Детермінований генератор рельєфу та вітру за ID кімнати (Seeded RNG)",
      "Додано панель історії версій"
    ]
  }
];

function renderChangelogHtml(sanitize) {
  return CHANGELOG.map(entry => {
    const changesHtml = entry.changes.map(c => `<li>${sanitize(c)}</li>`).join("");
    return `
      <div class="changelog-entry">
        <div class="changelog-header">
          <span class="changelog-version">v${sanitize(entry.version)}</span>
          <span class="changelog-date">${sanitize(entry.date)}</span>
        </div>
        <ul class="changelog-changes">${changesHtml}</ul>
      </div>`;
  }).join("");
}

// --- ВНУТРІШНЄ СХОВИЩЕ КІМНАТ В ОПЕРАТИВНІЙ ПАМ'ЯТІ (RAM) ---
const activeRooms = new Map();
const TURNSTILE_SESSION_COOKIE = "gummy_turnstile_session";
const TURNSTILE_SESSION_TTL_SECONDS = 60 * 60;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookie = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

async function getTurnstileSessionKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createTurnstileSession(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + TURNSTILE_SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  const key = await getTurnstileSessionKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function hasValidTurnstileSession(request, secret) {
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

function cleanExpiredRooms() {
  const now = Date.now();
  const EXPIRATION_MS = 3600 * 1000;
  for (const [id, room] of activeRooms.entries()) {
    if (now - (room.createdAt || 0) > EXPIRATION_MS) {
      activeRooms.delete(id);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    function sanitize(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/[&<>"']/g, function (m) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        }[m];
      }).trim();
    }

    function generateRoomCode() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return "RM-" + code;
    }

    function resolveRps(choiceA, choiceB) {
      if (choiceA === choiceB) {
        const coinFlip = Math.random() < 0.5 ? 'TEAM_A' : 'TEAM_B';
        return { winner: coinFlip, isTie: true };
      }
      if (
        (choiceA === 'rock' && choiceB === 'scissors') ||
        (choiceA === 'scissors' && choiceB === 'paper') ||
        (choiceA === 'paper' && choiceB === 'rock')
      ) {
        return { winner: 'TEAM_A', isTie: false };
      }
      return { winner: 'TEAM_B', isTie: false };
    }

    function nextAliveBearIndex(bearParts, currentIndex) {
      for (let offset = 1; offset <= bearParts.length; offset++) {
        const index = (currentIndex + offset) % bearParts.length;
        if (bearParts[index] > 0) return index;
      }
      return 0;
    }

    function syncTeamParts(team) {
      team.partsLeft = team.bearParts.reduce((total, parts) => total + parts, 0);
    }

    // Turnstile token-и одноразові, тому обмінюємо їх на короткоживучу підписану cookie.
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

    // Lets the page reuse an unexpired HttpOnly session after a refresh without exposing its value.
    if (url.pathname === "/api/turnstile-status" && request.method === "GET") {
      const verified = await hasValidTurnstileSession(request, env.TURNSTILE_SECRET_KEY);
      return new Response(JSON.stringify({ verified }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // All game endpoints require a successfully completed Turnstile challenge.
    if (url.pathname.startsWith("/api/") && !(await hasValidTurnstileSession(request, env.TURNSTILE_SECRET_KEY))) {
      return new Response(JSON.stringify({ error: "Turnstile verification required" }), {
        status: 403,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // --- API: Створити кімнату ---
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
          teamA: { username, rpsChoice, score: 0, token: hostToken, bearParts: [10, 10, 10], partsLeft: 30 },
          teamB: { username: mode === "AI" ? "Бот 🤖" : null, rpsChoice: aiRpsChoice, score: 0, token: mode === "AI" ? "BOT_TOKEN" : null, bearParts: [10, 10, 10], partsLeft: 30 },
          activeTeam: firstTurn,
          activeBearIndex: { TEAM_A: 0, TEAM_B: 0 },
          pendingShot: null,
          rpsResult: { isTie: isRpsTie, winner: firstTurn },
          lastAction: null,
          createdAt: Date.now()
        };

        cleanExpiredRooms();
        activeRooms.set(roomId, roomState);

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

    // --- API: Приєднатися до кімнати ---
    if (url.pathname === "/api/join-room" && request.method === "POST") {
      try {
        const { roomId, username, rpsChoice } = await request.json();
        const roomState = activeRooms.get(roomId);

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

        activeRooms.set(roomId, roomState);

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

    // --- API: Стан кімнати ---
    if (url.pathname === "/api/room-state" && request.method === "GET") {
      try {
        const roomId = url.searchParams.get("roomId");
        const room = activeRooms.get(roomId);
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

    // --- API: Зареєструвати ігрову дію ---
    if (url.pathname === "/api/game-action" && request.method === "POST") {
      try {
        const { roomId, playerToken, action, payload } = await request.json();
        const room = activeRooms.get(roomId);

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

          room.lastAction = {
            type: "SHOOT",
            team: actingTeam,
            bearIndex,
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
        } else {
          return new Response(JSON.stringify({ error: "Невідома ігрова дія" }), { status: 400 });
        }

        activeRooms.set(roomId, room);

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

    // --- FRONTEND ---
    if (request.method === "GET") {
      const changelogHtml = renderChangelogHtml(sanitize);

      const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gummy Bears: Candy Mayhem 3v3</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Fredoka', cursive, system-ui, sans-serif; background: #1a0b2e; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 15px; overflow-x: hidden; }
    h1 { margin: 0 0 10px 0; color: #ff75a0; text-shadow: 0 0 15px rgba(255,117,160,0.6); font-size: 28px; }
    
    .main-layout { display: flex; gap: 20px; align-items: flex-start; justify-content: center; width: 100%; max-width: 1800px; flex-wrap: wrap; }
    .game-container { position: relative; display: flex; flex-direction: column; align-items: center; }
    canvas { border: 4px solid #ff75a0; border-radius: 20px; background: linear-gradient(to bottom, #2b1055 0%, #755bea 50%, #ff75a0 100%); box-shadow: 0 15px 50px rgba(0,0,0,0.7); }

    .version-card { background: rgba(255,255,255,0.07); backdrop-filter: blur(12px); padding: 20px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15); width: 250px; max-height: 550px; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .version-card h3 { margin-top: 0; color: #4ecca3; text-align: center; }

    .changelog-entry { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .changelog-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .changelog-version { color: #ffbe0b; font-weight: 700; font-size: 14px; }
    .changelog-date { color: rgba(255,255,255,0.5); font-size: 11px; }
    .changelog-changes { list-style: none; padding: 0; margin: 0; font-size: 12px; }
    .changelog-changes li { padding-left: 12px; position: relative; }
    .changelog-changes li::before { content: "•"; position: absolute; left: 0; color: #4ecca3; }

    .status-bar { display: flex; gap: 20px; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); padding: 10px 24px; border-radius: 30px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.15); width: 1200px; }
    .turn-text { color: #4ecca3; font-size: 16px; font-weight: bold; }

    #lobbyModal, #rpsModal, #gameOverModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10,5,20,0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .game-over-title { font-size: 32px; margin: 0 0 5px 0; }
    .game-over-subtitle { font-size: 15px; color: #ddd; margin-bottom: 18px; }
    .game-over-btns { display: flex; gap: 10px; margin-top: 18px; }
    .game-over-btns .action-btn { flex: 1; }
    .modal-box { background: linear-gradient(135deg, #3d1e6d, #2b1055); padding: 35px; border-radius: 24px; text-align: center; border: 2px solid #ff75a0; width: 420px; box-shadow: 0 0 30px rgba(255,117,160,0.4); }
    .modal-box input { width: 90%; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; font-size: 16px; text-align: center; margin: 10px 0; outline: none; font-family: inherit; }
    
    .rps-selector { display: flex; justify-content: center; gap: 15px; margin: 15px 0; }
    .rps-btn { background: rgba(255,255,255,0.1); border: 2px solid transparent; border-radius: 14px; padding: 10px 16px; font-size: 24px; cursor: pointer; transition: 0.2s; }
    .rps-btn.selected { border-color: #ffbe0b; background: rgba(255,190,11,0.2); transform: scale(1.1); }

    .action-btn { background: #ff75a0; color: white; border: none; padding: 12px 20px; border-radius: 12px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; font-family: inherit; margin-top: 8px; }
    .action-btn:hover { background: #e05480; transform: translateY(-2px); }

    .coin-container { perspective: 1000px; margin: 20px auto; width: 80px; height: 80px; }
    .coin { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform 2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    .coin-face { position: absolute; width: 100%; height: 100%; border-radius: 50%; backface-visibility: hidden; display: flex; align-items: center; justify-content: center; font-size: 36px; border: 4px solid #ffbe0b; box-shadow: 0 0 15px rgba(255,190,11,0.6); }
    .coin-front { background: #52b788; }
    .coin-back { background: #ff4d6d; transform: rotateY(180deg); }
  </style>
</head>
<body>

  <div id="lobbyModal">
    <div class="modal-box">
      <h2>🍬 Gummy Bears 3v3</h2>
      <p style="font-size: 14px; color: #ddd;">Нікнейм зберігається автоматично:</p>
      <input type="text" id="usernameInput" placeholder="Гравець 1" maxlength="12" autocomplete="off" data-1p-ignore>
      <div class="cf-turnstile" data-sitekey="0x4AAAAAAEHTYEicsQxe9QLA" data-callback="handleTurnstileSuccess"></div>
      <p id="turnstileStatus" style="font-size:13px; color:#ffbe0b; margin:0 0 8px;">Підтвердіть, що ви людина, щоб почати гру.</p>
      
      <div class="rps-selector">
        <button class="rps-btn selected" onclick="selectRps('rock')" id="rps-rock">🪨</button>
        <button class="rps-btn" onclick="selectRps('scissors')" id="rps-scissors">✂️</button>
        <button class="rps-btn" onclick="selectRps('paper')" id="rps-paper">📄</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="action-btn" onclick="startAiGame()">🤖 Грати проти AI</button>
        <button class="action-btn" style="background:rgba(255,255,255,0.15)" onclick="createMultiplayerRoom()">⚔️ Створити онлайн кімнату</button>
        <div style="display:flex; gap:8px;">
          <input type="text" id="roomCodeInput" placeholder="Код (напр. RM-8F3K2A)" style="margin:0; font-size:14px;">
          <button class="action-btn" onclick="joinMultiplayerRoom()" style="padding:10px 14px; font-size:14px; margin:0;">Приєднатися</button>
        </div>
      </div>
    </div>
  </div>

  <div id="rpsModal" style="display:none;">
    <div class="modal-box">
      <h2 id="rpsTitle">🎲 Результат RPS</h2>
      <p id="rpsDetail" style="font-size:15px; color:#ddd;"></p>
      
      <div class="coin-container" id="coinContainer" style="display:none;">
        <div class="coin" id="coinElem">
          <div class="coin-face coin-front">🟦</div>
          <div class="coin-face coin-back">🟥</div>
        </div>
      </div>

      <h3 id="rpsWinnerText" style="color:#ffbe0b; margin-top:15px;"></h3>
      <button class="action-btn" onclick="closeRpsModal()">В бій! ⚔️</button>
    </div>
  </div>

  <div id="gameOverModal" style="display:none;">
    <div class="modal-box">
      <h2 class="game-over-title" id="gameOverTitle">🎉 ПЕРЕМОГА!</h2>
      <p class="game-over-subtitle" id="gameOverSubtitle">Ви знищили усіх ведмедиків суперника!</p>
      <div class="game-over-btns">
        <button class="action-btn" onclick="rematch()">🔄 Реванш</button>
        <button class="action-btn" style="background:rgba(255,255,255,0.15)" onclick="backToMenu()">🏠 Меню</button>
      </div>
    </div>
  </div>

  <h1>🍬 Gummy Bears: Candy Mayhem 3v3 🍬</h1>

  <div class="status-bar">
    <div>🟦 <span id="teamAName" style="color: #52b788;">Команда 1</span></div>
    <div class="turn-text" id="turn-info">Очікування...</div>
    <div>🟥 <span id="teamBName" style="color: #ff4d6d;">Команда 2</span></div>
    <div>🍃 Вітер: <span id="windDisplay">0</span></div>
    <button style="background:none; border:none; cursor:pointer; font-size:16px;" onclick="openLobbyModal()">⚙️</button>
  </div>

  <div class="main-layout">
    <div class="version-card">
      <h3>🔄 Історія версій</h3>
      <div>${changelogHtml}</div>
    </div>

    <div class="game-container">
      <canvas id="gameCanvas" width="1200" height="550"></canvas>
    </div>
  </div>

  <script>
    window.currentRoom = null;
    window.playerToken = null;
    window.selectedRps = 'rock';
    window.turnstileVerified = false;
    window.myTeam = 'TEAM_A';
    window.isMyTurn = false;
    window.pollingTimer = null;
    window.screenShake = 0;

    window.handleTurnstileSuccess = async function(token) {
      const status = document.getElementById('turnstileStatus');
      status.innerText = 'Перевіряємо…';
      status.style.color = '#ffbe0b';
      try {
        const response = await fetch('/api/verify-turnstile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ token: token })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Verification failed');
        window.turnstileVerified = true;
        status.innerText = '✓ Перевірку пройдено — можна грати!';
        status.style.color = '#4ecca3';
      } catch (error) {
        window.turnstileVerified = false;
        status.innerText = 'Не вдалося підтвердити перевірку. Спробуйте ще раз.';
        status.style.color = '#ff758f';
        if (window.turnstile) window.turnstile.reset();
      }
    };

    function requireTurnstile() {
      if (window.turnstileVerified) return true;
      alert('Спочатку пройдіть перевірку Turnstile.');
      return false;
    }

    async function restoreTurnstileSession() {
      try {
        const response = await fetch('/api/turnstile-status', { credentials: 'same-origin' });
        const result = await response.json();
        if (!result.verified) return;
        window.turnstileVerified = true;
        const status = document.getElementById('turnstileStatus');
        status.innerText = '✓ Перевірку вже пройдено — можна грати!';
        status.style.color = '#4ecca3';
      } catch (error) {}
    }

    restoreTurnstileSession();

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const BEAR_PARTS = [
      { id: 'L_FOOT', dx: -8, dy: 13, r: 6 },
      { id: 'R_FOOT', dx: 8, dy: 13, r: 6 },
      { id: 'L_THIGH', dx: -13, dy: -4, r: 5 },
      { id: 'R_THIGH', dx: 13, dy: -4, r: 5 },
      { id: 'L_ARM', dx: -8, dy: -20, r: 5 },
      { id: 'R_ARM', dx: 8, dy: -20, r: 5 },
      { id: 'TAIL', dx: 0, dy: 6, r: 9 },
      { id: 'B_TORSO', dx: 0, dy: -3, r: 8 },
      { id: 'T_TORSO', dx: 0, dy: -11, r: 7 },
      { id: 'HEAD', dx: 0, dy: -15, r: 8 }
    ];

    function hashString(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      return Math.abs(h) || 1;
    }
    function seededRandom(seed) {
      let s = seed % 2147483647;
      if (s <= 0) s += 2147483646;
      return function() {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
    }

    const terrain = new Array(canvas.width);
    let wind = 0;
    function generateTerrain(roomId) {
      const rand = seededRandom(hashString(roomId || "default-seed"));
      const type = Math.floor(rand() * 4);
      const baseHeight = 320 + rand() * 60;
      const freq1 = 0.005 + rand() * 0.008;
      const freq2 = 0.015 + rand() * 0.015;

      for (let x = 0; x < canvas.width; x++) {
        let h = baseHeight;
        if (type === 0) h += Math.sin(x * freq1) * 80 + Math.cos(x * freq2) * 30;
        else if (type === 1) h += Math.sin(x * freq1) * 60 + (Math.abs(x - canvas.width / 2) < 250 ? 70 : -30);
        else if (type === 2) h += Math.sin(x * freq1) * 70 + Math.sin(x * 0.03) * 20;
        else h += Math.cos(x * freq1) * 90 + Math.sin(x * freq2) * 35;
        terrain[x] = Math.max(180, Math.min(480, h));
      }
      wind = rand() * 0.4 - 0.2;
    }
    generateTerrain();

    let particles = [];
    function createExplosionParticles(x, y, color) {
      for (let i = 0; i < 25; i++) {
        particles.push({
          x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
          radius: Math.random() * 4 + 2, color, alpha: 1.0, life: 0.03 + Math.random() * 0.03
        });
      }
    }

    const teamA = [
      { id: 'A1', x: 120, y: 0, partsCount: 10, color: '#52b788', highlight: '#74c69d', angle: -Math.PI/4, power: 0, isCharging: false },
      { id: 'A2', x: 240, y: 0, partsCount: 10, color: '#40916c', highlight: '#52b788', angle: -Math.PI/4, power: 0, isCharging: false },
      { id: 'A3', x: 360, y: 0, partsCount: 10, color: '#2d6a4f', highlight: '#40916c', angle: -Math.PI/4, power: 0, isCharging: false }
    ];

    const teamB = [
      { id: 'B1', x: 840, y: 0, partsCount: 10, color: '#ff4d6d', highlight: '#ff758f', angle: -Math.PI*0.75, power: 0, isCharging: false },
      { id: 'B2', x: 960, y: 0, partsCount: 10, color: '#c9184a', highlight: '#ff4d6d', angle: -Math.PI*0.75, power: 0, isCharging: false },
      { id: 'B3', x: 1080, y: 0, partsCount: 10, color: '#800f2f', highlight: '#c9184a', angle: -Math.PI*0.75, power: 0, isCharging: false }
    ];

    let bullet = null;
    let resolvingExplosion = false;
    let pollingInFlight = false;
    let aiMoving = false;
    const keys = {};

    window.addEventListener('DOMContentLoaded', () => {
      const savedName = localStorage.getItem('gummy_username');
      if (savedName) {
        document.getElementById('usernameInput').value = savedName;
      }
    });

    function resetBears() {
      bullet = null;
      resolvingExplosion = false;
      aiMoving = false;
      teamA.forEach((b, idx) => { b.partsCount = 10; b.x = 120 * (idx + 1); b.angle = -Math.PI/4; b.power = 0; b.isCharging = false; });
      teamB.forEach((b, idx) => { b.partsCount = 10; b.x = 720 + 120 * (idx + 1); b.angle = -Math.PI*0.75; b.power = 0; b.isCharging = false; });
    }

    function applyServerRoom(room) {
      window.currentRoom = room;
      if (Array.isArray(room.teamA.bearParts)) room.teamA.bearParts.forEach((parts, index) => { teamA[index].partsCount = parts; });
      if (Array.isArray(room.teamB.bearParts)) room.teamB.bearParts.forEach((parts, index) => { teamB[index].partsCount = parts; });
      updateTurnUI();
      if (room.status === 'FINISHED') showGameOverModal(room);
    }

    function selectRps(choice) {
      window.selectedRps = choice;
      document.querySelectorAll('.rps-btn').forEach(b => b.classList.remove('selected'));
      document.getElementById('rps-' + choice).classList.add('selected');
    }

    function openLobbyModal() { document.getElementById('lobbyModal').style.display = 'flex'; }

    function showRpsModal(room) {
      const modal = document.getElementById('rpsModal');
      const detail = document.getElementById('rpsDetail');
      const winnerText = document.getElementById('rpsWinnerText');
      const coinContainer = document.getElementById('coinContainer');
      const coinElem = document.getElementById('coinElem');

      const icons = { rock: '🪨', paper: '📄', scissors: '✂️' };
      const choiceA = icons[room.teamA.rpsChoice] || '🪨';
      const choiceB = icons[room.teamB.rpsChoice] || '🪨';

      detail.innerText = room.teamA.username + ' (' + choiceA + ') VS ' + room.teamB.username + ' (' + choiceB + ')';

      if (room.rpsResult.isTie) {
        coinContainer.style.display = 'block';
        winnerText.innerText = "Нічия за вибором! Жеребкування...";
        modal.style.display = 'flex';

        setTimeout(() => {
          const flips = room.rpsResult.winner === 'TEAM_A' ? 1800 : 1980;
          coinElem.style.transform = 'rotateY(' + flips + 'deg)';
          setTimeout(() => {
            const winnerName = room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username;
            winnerText.innerText = 'Жереб визначив! Першим ходить ' + winnerName + '!';
          }, 2000);
        }, 300);
      } else {
        coinContainer.style.display = 'none';
        const winnerName = room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username;
        winnerText.innerText = 'Перемога в RPS! Першим ходить ' + winnerName + '!';
        modal.style.display = 'flex';
      }
    }

    function closeRpsModal() {
      document.getElementById('rpsModal').style.display = 'none';
      if (window.currentRoom && window.currentRoom.mode === 'AI' && window.currentRoom.activeTeam === 'TEAM_B') {
        setTimeout(handleAiTurn, 1000);
      }
    }

    function showGameOverModal(room) {
      if (window.pollingTimer) { clearInterval(window.pollingTimer); window.pollingTimer = null; }

      const winner = room.teamA.partsLeft > 0 ? 'TEAM_A' : (room.teamB.partsLeft > 0 ? 'TEAM_B' : 'DRAW');
      const isWin = winner === window.myTeam;

      const titleEl = document.getElementById('gameOverTitle');
      const subtitleEl = document.getElementById('gameOverSubtitle');

      if (winner === 'DRAW') {
        titleEl.innerText = '🤝 НІЧИЯ!';
        subtitleEl.innerText = 'Обидві команди знищені одночасно!';
      } else if (isWin) {
        titleEl.innerText = '🎉 ПЕРЕМОГА!';
        subtitleEl.innerText = 'Ви знищили усіх ведмедиків суперника!';
      } else {
        titleEl.innerText = '😱 ПОРАЗКА!';
        subtitleEl.innerText = 'Ваших ведмедиків знищено...';
      }

      document.getElementById('gameOverModal').style.display = 'flex';
    }

    function rematch() {
      document.getElementById('gameOverModal').style.display = 'none';
      if (window.pollingTimer) { clearInterval(window.pollingTimer); window.pollingTimer = null; }
      window.currentRoom = null;
      window.playerToken = null;
      resetBears();
      document.getElementById('lobbyModal').style.display = 'flex';
    }

    function backToMenu() {
      document.getElementById('gameOverModal').style.display = 'none';
      window.currentRoom = null;
      window.playerToken = null;
      resetBears();
      if (window.pollingTimer) { clearInterval(window.pollingTimer); window.pollingTimer = null; }
      document.getElementById('lobbyModal').style.display = 'flex';
    }

    async function startAiGame() {
      if (!requireTurnstile()) return;
      resetBears();
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 1";
      localStorage.setItem('gummy_username', username);

      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mode: 'AI', rpsChoice: window.selectedRps })
      });
      const data = await res.json();
      applyServerRoom(data.roomState);
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId);
      updateTurnUI();

      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Бот 🤖";
      document.getElementById('lobbyModal').style.display = 'none';

      showRpsModal(data.roomState);
      updateTurnUI();
    }

    async function createMultiplayerRoom() {
      if (!requireTurnstile()) return;
      resetBears();
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 1";
      localStorage.setItem('gummy_username', username);

      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mode: 'MULTIPLAYER', rpsChoice: window.selectedRps })
      });
      const data = await res.json();
      applyServerRoom(data.roomState);
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId);
      updateTurnUI();

      alert('Кімнату створено! Поділіться кодом з другом: ' + data.roomId);
      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Очікування суперника...";
      document.getElementById('lobbyModal').style.display = 'none';

      startPolling();
    }

    async function joinMultiplayerRoom() {
      if (!requireTurnstile()) return;
      resetBears();
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 2";
      localStorage.setItem('gummy_username', username);
      const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
      if (!roomCode) { alert('Введіть код кімнати!'); return; }

      const res = await fetch('/api/join-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: roomCode, username, rpsChoice: window.selectedRps })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }

      applyServerRoom(data.roomState);
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_B';
      generateTerrain(data.roomState.roomId);
      updateTurnUI();

      document.getElementById('teamAName').innerText = data.roomState.teamA.username;
      document.getElementById('teamBName').innerText = username;
      document.getElementById('lobbyModal').style.display = 'none';

      showRpsModal(data.roomState);
      startPolling();
    }

    function startPolling() {
      if (window.pollingTimer) clearInterval(window.pollingTimer);
      window.pollingTimer = setInterval(async () => {
        if (!window.currentRoom || pollingInFlight) return;
        pollingInFlight = true;
        try {
          const res = await fetch('/api/room-state?roomId=' + window.currentRoom.roomId);
          const roomState = await res.json();
          if (!res.ok) return;
          
          if (roomState.lastAction && (!window.currentRoom.lastAction || roomState.lastAction.timestamp > window.currentRoom.lastAction.timestamp)) {
            if (roomState.lastAction.type === 'SHOOT' && roomState.lastAction.team !== window.myTeam) {
              executeRemoteShoot(roomState.lastAction);
            }
          }
          applyServerRoom(roomState);
        } catch(e) {
        } finally {
          pollingInFlight = false;
        }
      }, 1500);
    }

    function updateTurnUI() {
      if (!window.currentRoom) return;
      window.isMyTurn = window.currentRoom.status === 'PLAYING' && window.currentRoom.activeTeam === window.myTeam && !window.currentRoom.pendingShot && !bullet && !resolvingExplosion;
      const turnInfo = document.getElementById('turn-info');

      if (window.currentRoom.status === "WAITING") {
        turnInfo.innerText = "Очікування другого гравця...";
      } else if (window.currentRoom.status === "FINISHED") {
        turnInfo.innerText = "Матч завершено";
      } else if (window.currentRoom.pendingShot || bullet || resolvingExplosion) {
        turnInfo.innerText = "Постріл у польоті...";
      } else if (window.isMyTurn) {
        turnInfo.innerText = "Хід: Ваш хід! 🟩";
      } else {
        turnInfo.innerText = "Хід: Ходить суперник... 🟥";
      }
      document.getElementById('windDisplay').innerText = wind > 0 ? '➡️ ' + Math.abs(wind*10).toFixed(1) : '⬅️ ' + Math.abs(wind*10).toFixed(1);
    }

    function getActiveBear() {
      if (!window.currentRoom) return teamA[0];
      const team = window.currentRoom.activeTeam === 'TEAM_A' ? teamA : teamB;
      const idx = window.currentRoom.activeBearIndex[window.currentRoom.activeTeam];
      for (let i = 0; i < team.length; i++) {
        const bearIndex = (idx + i) % team.length;
        if (team[bearIndex].partsCount > 0) return team[bearIndex];
      }
      return null;
    }

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => {
      keys[e.code] = false;
      const b = getActiveBear();
      if (e.code === 'Space' && b.isCharging && window.isMyTurn) handlePlayerShoot(b);
    });

    async function handlePlayerShoot(b) {
      b.isCharging = false;
      if (b.partsCount <= 0 || bullet || resolvingExplosion || !window.isMyTurn) return;

      const myTeamArr = window.myTeam === 'TEAM_A' ? teamA : teamB;

      const res = await fetch('/api/game-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: window.currentRoom.roomId,
          playerToken: window.playerToken,
          action: 'SHOOT',
          payload: { bearIndex: myTeamArr.indexOf(b), angle: b.angle, power: b.power }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.room) return;
      applyServerRoom(data.room);
      if (data.room.status === 'FINISHED') return;

      spawnBullet(b, window.myTeam);
    }

    function executeRemoteShoot(actionData) {
      const enemyTeam = actionData.team === 'TEAM_A' ? teamA : teamB;
      const b = enemyTeam[actionData.bearIndex] || enemyTeam[0];
      b.angle = actionData.angle;
      b.power = actionData.power;
      spawnBullet(b, actionData.team);
    }

    function spawnBullet(b, ownerTeam) {
      const lastPart = BEAR_PARTS[b.partsCount];
      const spawnOffset = 18;
      bullet = {
        x: b.x + lastPart.dx + Math.cos(b.angle) * spawnOffset,
        y: b.y + lastPart.dy + Math.sin(b.angle) * spawnOffset,
        vx: Math.cos(b.angle) * (b.power / 6.0),
        vy: Math.sin(b.angle) * (b.power / 6.0),
        radius: lastPart.r,
        color: b.color,
        ownerTeam: ownerTeam
      };
      b.power = 0;
    }

    function chooseAiMoveTarget(bear) {
      const minX = 50;
      const maxX = canvas.width - 50;
      const x = Math.round(bear.x);
      const lookAhead = 70;
      const groundAt = (position) => terrain[Math.max(0, Math.min(canvas.width - 1, Math.round(position)))];
      const currentGround = groundAt(x);
      const leftGround = groundAt(x - lookAhead);
      const rightGround = groundAt(x + lookAhead);
      let direction;

      // Біля краю або на дні вирви бот обирає напрямок до безпечнішої ділянки.
      if (bear.x < 120) direction = 1;
      else if (bear.x > canvas.width - 120) direction = -1;
      else if (currentGround > Math.min(leftGround, rightGround) + 25) direction = leftGround <= rightGround ? -1 : 1;
      else direction = Math.random() < 0.5 ? -1 : 1;

      const distance = 20 + Math.random() * 60;
      return Math.max(minX, Math.min(maxX, bear.x + direction * distance));
    }

    function animateAiMovement(bear, targetX) {
      return new Promise(resolve => {
        // За втрати обох ніг бот не може маневрувати.
        if (bear.partsCount <= 8 || Math.abs(targetX - bear.x) < 1) {
          resolve();
          return;
        }

        const speed = bear.partsCount <= 9 ? 0.9 : 1.8;
        const direction = targetX > bear.x ? 1 : -1;
        function step() {
          const distanceLeft = Math.abs(targetX - bear.x);
          if (distanceLeft <= speed) {
            bear.x = targetX;
            updateY(bear);
            resolve();
            return;
          }
          bear.x += direction * speed;
          updateY(bear);
          requestAnimationFrame(step);
        }
        step();
      });
    }

    async function handleAiTurn() {
      if (!window.currentRoom || window.currentRoom.mode !== 'AI' || window.currentRoom.status !== 'PLAYING' || window.currentRoom.activeTeam !== 'TEAM_B' || window.currentRoom.pendingShot || bullet || resolvingExplosion || aiMoving) return;
      const b = getActiveBear();
      if (!b || b.partsCount <= 0) return;
      aiMoving = true;
      updateTurnUI();
      try {
        await animateAiMovement(b, chooseAiMoveTarget(b));
        if (!window.currentRoom || window.currentRoom.status !== 'PLAYING' || window.currentRoom.activeTeam !== 'TEAM_B' || window.currentRoom.pendingShot) return;

        b.angle = -Math.PI * (0.6 + Math.random() * 0.3);
        b.power = 30 + Math.random() * 50;

        const res = await fetch('/api/game-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: window.currentRoom.roomId,
            playerToken: "BOT_TOKEN",
            action: 'SHOOT',
            payload: { bearIndex: teamB.indexOf(b), angle: b.angle, power: b.power }
          })
        });
        const data = await res.json();
        if (!res.ok || !data.room) return;
        applyServerRoom(data.room);
        if (data.room.status === 'FINISHED') return;

        spawnBullet(b, 'TEAM_B');
      } finally {
        aiMoving = false;
        updateTurnUI();
      }
    }

    function updateY(b) {
      const xIdx = Math.floor(b.x);
      if (xIdx >= 0 && xIdx < canvas.width) b.y = terrain[xIdx] - 5;
    }

    function update() {
      const activeBear = getActiveBear();

      if (window.isMyTurn && activeBear && activeBear.partsCount > 0) {
        let speed = 1.8;
        if (activeBear.partsCount <= 9) speed = 0.9;
        if (activeBear.partsCount <= 8) speed = 0;

        if (keys['KeyA'] && activeBear.x > 10 && speed > 0) activeBear.x -= speed;
        if (keys['KeyD'] && activeBear.x < canvas.width - 10 && speed > 0) activeBear.x += speed;
        if (keys['KeyW'] && activeBear.angle > -Math.PI + 0.1) activeBear.angle -= 0.02;
        if (keys['KeyS'] && activeBear.angle < -0.1) activeBear.angle += 0.02;
        
        if (keys['Space'] && !bullet) { 
          activeBear.isCharging = true; 
          if (activeBear.power < 100) activeBear.power += 1.0; 
        }
      }

      [...teamA, ...teamB].forEach(updateY);

      if (bullet) {
        bullet.x += bullet.vx; bullet.y += bullet.vy; bullet.vy += 0.16; bullet.vx += wind * 0.08;
        const xIdx = Math.floor(bullet.x);
        const terrainY = (xIdx >= 0 && xIdx < canvas.width) ? terrain[xIdx] : 9999;
        
        if (bullet.x < -50 || bullet.x >= canvas.width + 50 || bullet.y >= terrainY) { 
          explode(bullet.x, bullet.y, bullet.ownerTeam); 
          bullet = null; 
        }
      }

      particles.forEach((p, idx) => {
        p.x += p.vx; p.y += p.vy; p.alpha -= p.life;
        if (p.alpha <= 0) particles.splice(idx, 1);
      });
    }

    async function explode(ex, ey, ownerTeam) {
      if (resolvingExplosion) return;
      resolvingExplosion = true;
      const blastRadius = 30;
      window.screenShake = 12;
      createExplosionParticles(ex, ey, ownerTeam === 'TEAM_A' ? '#52b788' : '#ff4d6d');

      for (let x = Math.max(0, Math.floor(ex - blastRadius)); x < Math.min(canvas.width, Math.floor(ex + blastRadius)); x++) {
        const dist = Math.abs(x - ex);
        const depth = Math.sqrt(blastRadius * blastRadius - dist * dist);
        if (ey + depth > terrain[x]) terrain[x] = Math.max(terrain[x], ey + depth);
      }

      const targetTeam = ownerTeam === 'TEAM_A' ? teamB : teamA;
      const damageByBear = [0, 0, 0];

      targetTeam.forEach((b, index) => {
        if (b.partsCount <= 0) return;
        const dist = Math.hypot(b.x - ex, b.y - ey);
        if (dist < blastRadius + 18) {
          const damageParts = Math.min(b.partsCount, Math.ceil((1 - dist / (blastRadius + 18)) * 3));
          b.partsCount -= damageParts;
          damageByBear[index] = damageParts;
        }
      });

      // Лише клієнт, який виконав постріл, фіксує його результат на сервері.
      // Це не дозволяє обом клієнтам мультиплеєра застосувати ту саму шкоду двічі.
      const isAiShot = window.currentRoom.mode === 'AI' && ownerTeam === 'TEAM_B';
      const isLocalShot = ownerTeam === window.myTeam || isAiShot;
      if (isLocalShot) {
        const token = isAiShot ? 'BOT_TOKEN' : window.playerToken;
        try {
        const res = await fetch('/api/game-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: window.currentRoom.roomId,
            playerToken: token,
            action: 'REPORT_DAMAGE',
            payload: { shotId: window.currentRoom.pendingShot.id, damageByBear: damageByBear }
          })
        });
        const data = await res.json();
        
        if (res.ok && data.room) applyServerRoom(data.room);
        } catch (error) {
          // Наступний polling синхронізує стан, якщо мережа тимчасово недоступна.
        }
      }
      resolvingExplosion = false;
      updateTurnUI();

      if (window.currentRoom && window.currentRoom.mode === 'AI' && window.currentRoom.status === 'PLAYING' && window.currentRoom.activeTeam === 'TEAM_B' && !window.currentRoom.pendingShot) {
        setTimeout(handleAiTurn, 700);
      }
    }

    function draw() {
      ctx.save();
      
      if (window.screenShake > 0) {
        const dx = (Math.random() - 0.5) * window.screenShake;
        const dy = (Math.random() - 0.5) * window.screenShake;
        ctx.translate(dx, dy);
        window.screenShake *= 0.85;
        if (window.screenShake < 0.5) window.screenShake = 0;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#1e0c3e'; ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ff75a0';
      ctx.beginPath(); ctx.moveTo(0, canvas.height);
      for (let x = 0; x < canvas.width; x++) ctx.lineTo(x, terrain[x]);
      ctx.lineTo(canvas.width, canvas.height); ctx.fill();

      ctx.strokeStyle = '#ffb5a7'; ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x++) ctx.lineTo(x, terrain[x]);
      ctx.stroke();

      [...teamA, ...teamB].forEach(b => {
        if (b.partsCount <= 0) return;
        ctx.save(); ctx.translate(b.x, b.y);

        for (let i = 0; i < b.partsCount; i++) {
          const p = BEAR_PARTS[i];
          ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(p.dx - p.r*0.3, p.dy - p.r*0.3, p.r*0.3, 0, Math.PI * 2); ctx.fill();
        }

        if (b.partsCount >= 10) {
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.arc(-3, -17, 1.5, 0, Math.PI*2); ctx.arc(3, -17, 1.5, 0, Math.PI*2); ctx.fill();
        }

        if (b === getActiveBear() && window.isMyTurn) {
          ctx.strokeStyle = '#ffbe0b'; ctx.lineWidth = 3; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(0, -10);
          ctx.lineTo(Math.cos(b.angle)*45, -10 + Math.sin(b.angle)*45);
          ctx.stroke(); ctx.setLineDash([]);
        }

        ctx.restore();
      });

      const activeBear = getActiveBear();
      if (activeBear && activeBear.isCharging) {
        ctx.fillStyle = '#ffbe0b';
        ctx.fillRect(activeBear.x - 25, activeBear.y - 50, activeBear.power / 2, 7);
        ctx.strokeStyle = '#fff'; ctx.strokeRect(activeBear.x - 25, activeBear.y - 50, 50, 7);
      }

      if (bullet) {
        ctx.fillStyle = bullet.color; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2); ctx.fill();
      }

      particles.forEach(p => {
        ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      ctx.restore();
    }

    function loop() { update(); draw(); requestAnimationFrame(loop); }
    loop();
  </script>
</body>
</html>`;
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
  }
};
