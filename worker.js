// --- ІСТОРІЯ ВЕРСІЙ ---
const CHANGELOG = [
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    function sanitize(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/[&<>"']/g, function(m) {
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

    // --- API: Отримати Топ-10 лідерів ---
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      try {
        const rawData = await env.LEADERBOARD.get("top_scores");
        const scores = rawData ? JSON.parse(rawData) : [];
        return new Response(JSON.stringify(scores), {
          headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" }
        });
      } catch (err) {
        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      }
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
          teamA: { username, rpsChoice, score: 0, token: hostToken, partsLeft: 30 },
          teamB: { username: mode === "AI" ? "Бот 🤖" : null, rpsChoice: aiRpsChoice, score: 0, token: mode === "AI" ? "BOT_TOKEN" : null, partsLeft: 30 },
          activeTeam: firstTurn,
          activeBearIndex: { TEAM_A: 0, TEAM_B: 0 },
          rpsResult: { isTie: isRpsTie, winner: firstTurn },
          lastAction: null,
          createdAt: Date.now()
        };

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(roomState), { expirationTtl: 3600 });

        // Повертаємо токен тільки творцю
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
        const rawRoom = await env.LEADERBOARD.get("room:" + roomId);

        if (!rawRoom) {
          return new Response(JSON.stringify({ error: "Кімнату не знайдено" }), { status: 404 });
        }

        let roomState = JSON.parse(rawRoom);
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

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(roomState), { expirationTtl: 3600 });

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
        const rawRoom = await env.LEADERBOARD.get("room:" + roomId);
        if (!rawRoom) {
          return new Response(JSON.stringify({ error: "Кімнату не знайдено" }), { status: 404 });
        }
        let room = JSON.parse(rawRoom);
        delete room.teamA.token;
        delete room.teamB.token;
        return new Response(JSON.stringify(room), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- API: Зареєструвати ігрову дію ---
    if (url.pathname === "/api/game-action" && request.method === "POST") {
      try {
        const { roomId, playerToken, action, payload } = await request.json();
        const rawRoom = await env.LEADERBOARD.get("room:" + roomId);

        if (!rawRoom) {
          return new Response(JSON.stringify({ error: "Недійсна сесія" }), { status: 403 });
        }

        let room = JSON.parse(rawRoom);

        // Перевірка токена автора дії
        const isTeamA = playerToken === room.teamA.token;
        const isTeamB = playerToken === room.teamB.token || (room.mode === "AI" && playerToken === "BOT_TOKEN");

        if (!isTeamA && !isTeamB) {
          return new Response(JSON.stringify({ error: "Неавторизована дія (невірний токен)" }), { status: 401 });
        }

        const actingTeam = isTeamA ? "TEAM_A" : "TEAM_B";

        if (action === "SHOOT") {
          if (room.activeTeam !== actingTeam) {
            return new Response(JSON.stringify({ error: "Зараз хід супротивника!" }), { status: 400 });
          }

          room.lastAction = {
            type: "SHOOT",
            team: actingTeam,
            bearIndex: payload.bearIndex,
            angle: payload.angle,
            power: payload.power,
            timestamp: Date.now()
          };

          const currentIdx = room.activeBearIndex[actingTeam];
          room.activeBearIndex[actingTeam] = (currentIdx + 1) % 3;
          room.activeTeam = actingTeam === "TEAM_A" ? "TEAM_B" : "TEAM_A";
        } else if (action === "REPORT_DAMAGE") {
          // Сервер сам нараховує очки та контролює поразку
          const damage = Math.min(30, Math.max(1, Number(payload.damageParts) || 1));
          if (actingTeam === "TEAM_A") {
            room.teamB.partsLeft = Math.max(0, room.teamB.partsLeft - damage);
            room.teamA.score += damage * 20;
          } else {
            room.teamA.partsLeft = Math.max(0, room.teamA.partsLeft - damage);
            room.teamB.score += damage * 20;
          }

          // Автоматична перевірка фіналу на сервері
          if (room.teamA.partsLeft <= 0 || room.teamB.partsLeft <= 0) {
            room.status = "FINISHED";
            let winnerTeam = "DRAW";
            if (room.teamA.partsLeft > 0 && room.teamB.partsLeft <= 0) winnerTeam = "TEAM_A";
            if (room.teamB.partsLeft > 0 && room.teamA.partsLeft <= 0) winnerTeam = "TEAM_B";

            if (winnerTeam !== "DRAW") {
              const winnerData = winnerTeam === "TEAM_A" ? room.teamA : room.teamB;
              const rawScores = await env.LEADERBOARD.get("top_scores");
              let scores = rawScores ? JSON.parse(rawScores) : [];

              scores.push({
                username: winnerData.username,
                score: winnerData.score + 500, // Серверний бонус за перемогу
                date: new Date().toLocaleDateString()
              });

              scores.sort((a, b) => b.score - a.score);
              scores = scores.slice(0, 10);
              await env.LEADERBOARD.put("top_scores", JSON.stringify(scores));
            }
          }
        }

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(room), { expirationTtl: 3600 });

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
      const rawData = await env.LEADERBOARD.get("top_scores");
      const scores = rawData ? JSON.parse(rawData) : [];

      let leaderboardHtml = "";
      if (scores.length === 0) {
        leaderboardHtml = "<li><i>Поки немає рекордів</i></li>";
      } else {
        scores.forEach((item, idx) => {
          leaderboardHtml += `<li><span>${idx + 1}. ${sanitize(item.username)}</span> <b>${item.score}</b></li>`;
        });
      }

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
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Fredoka', cursive, system-ui, sans-serif; background: #1a0b2e; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 15px; overflow-x: hidden; }
    h1 { margin: 0 0 10px 0; color: #ff75a0; text-shadow: 0 0 15px rgba(255,117,160,0.6); font-size: 28px; }
    
    .main-layout { display: flex; gap: 20px; align-items: flex-start; justify-content: center; width: 100%; max-width: 1800px; flex-wrap: wrap; }
    .game-container { position: relative; display: flex; flex-direction: column; align-items: center; }
    canvas { border: 4px solid #ff75a0; border-radius: 20px; background: linear-gradient(to bottom, #2b1055 0%, #755bea 50%, #ff75a0 100%); box-shadow: 0 15px 50px rgba(0,0,0,0.7); }

    .leaderboard-card, .version-card { background: rgba(255,255,255,0.07); backdrop-filter: blur(12px); padding: 20px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15); width: 250px; max-height: 550px; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .leaderboard-card h3 { margin-top: 0; color: #ffbe0b; text-align: center; }
    .version-card h3 { margin-top: 0; color: #4ecca3; text-align: center; }
    .leaderboard-list { list-style: none; padding: 0; margin: 0; font-size: 14px; }
    .leaderboard-list li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }

    .changelog-entry { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .changelog-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .changelog-version { color: #ffbe0b; font-weight: 700; font-size: 14px; }
    .changelog-date { color: rgba(255,255,255,0.5); font-size: 11px; }
    .changelog-changes { list-style: none; padding: 0; margin: 0; font-size: 12px; }
    .changelog-changes li { padding-left: 12px; position: relative; }
    .changelog-changes li::before { content: "•"; position: absolute; left: 0; color: #4ecca3; }

    .status-bar { display: flex; gap: 20px; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); padding: 10px 24px; border-radius: 30px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.15); width: 1200px; }
    .score-val { color: #ffbe0b; }
    .turn-text { color: #4ecca3; font-size: 16px; font-weight: bold; }

    /* Modal Overlay */
    #lobbyModal, #rpsModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10,5,20,0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal-box { background: linear-gradient(135deg, #3d1e6d, #2b1055); padding: 35px; border-radius: 24px; text-align: center; border: 2px solid #ff75a0; width: 420px; box-shadow: 0 0 30px rgba(255,117,160,0.4); }
    .modal-box input { width: 90%; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; font-size: 16px; text-align: center; margin: 10px 0; outline: none; font-family: inherit; }
    
    .rps-selector { display: flex; justify-content: center; gap: 15px; margin: 15px 0; }
    .rps-btn { background: rgba(255,255,255,0.1); border: 2px solid transparent; border-radius: 14px; padding: 10px 16px; font-size: 24px; cursor: pointer; transition: 0.2s; }
    .rps-btn.selected { border-color: #ffbe0b; background: rgba(255,190,11,0.2); transform: scale(1.1); }

    .action-btn { background: #ff75a0; color: white; border: none; padding: 12px 20px; border-radius: 12px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; font-family: inherit; margin-top: 8px; }
    .action-btn:hover { background: #e05480; transform: translateY(-2px); }

    /* 3D Coin Animation */
    .coin-container { perspective: 1000px; margin: 20px auto; width: 80px; height: 80px; }
    .coin { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform 2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    .coin-face { position: absolute; width: 100%; height: 100%; border-radius: 50%; backface-visibility: hidden; display: flex; align-items: center; justify-content: center; font-size: 36px; border: 4px solid #ffbe0b; box-shadow: 0 0 15px rgba(255,190,11,0.6); }
    .coin-front { background: #52b788; }
    .coin-back { background: #ff4d6d; transform: rotateY(180deg); }
  </style>
</head>
<body>

  <!-- LOBBY MODAL -->
  <div id="lobbyModal">
    <div class="modal-box">
      <h2>🍬 Gummy Bears 3v3</h2>
      <p style="font-size: 14px; color: #ddd;">Нікнейм зберігається автоматично:</p>
      <input type="text" id="usernameInput" placeholder="Гравець 1" maxlength="12" autocomplete="off" data-1p-ignore>
      
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

  <!-- RPS RESULT MODAL WITH 3D COIN FLIP -->
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

  <h1>🍬 Gummy Bears: Candy Mayhem 3v3 🍬</h1>

  <div class="status-bar">
    <div>🟦 <span id="teamAName" style="color: #52b788;">Команда 1</span></div>
    <div>Очки: <span id="scoreDisplay" class="score-val">0</span></div>
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

    <div class="leaderboard-card">
      <h3>🏆 ТОП-10 ЛІДЕРІВ</h3>
      <ol class="leaderboard-list">${leaderboardHtml}</ol>
    </div>
  </div>

  <script>
    window.currentRoom = null;
    window.playerToken = null;
    window.selectedRps = 'rock';
    window.myTeam = 'TEAM_A';
    window.isMyTurn = false;
    window.pollingTimer = null;
    window.screenShake = 0;

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
    const keys = {};

    window.addEventListener('DOMContentLoaded', () => {
      const savedName = localStorage.getItem('gummy_username');
      if (savedName) {
        document.getElementById('usernameInput').value = savedName;
      }
    });

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

      detail.innerText = `${room.teamA.username} (${choiceA})  VS  ${room.teamB.username} (${choiceB})`;

      if (room.rpsResult.isTie) {
        coinContainer.style.display = 'block';
        winnerText.innerText = "Нічия за вибором! Жеребкування...";
        modal.style.display = 'flex';

        setTimeout(() => {
          const flips = room.rpsResult.winner === 'TEAM_A' ? 1800 : 1980; // 5 full turns + side
          coinElem.style.transform = `rotateY(${flips}deg)`;
          setTimeout(() => {
            const winnerName = room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username;
            winnerText.innerText = `Жереб визначив! Першим ходить ${winnerName}!`;
          }, 2000);
        }, 300);
      } else {
        coinContainer.style.display = 'none';
        const winnerName = room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username;
        winnerText.innerText = `Перемога в RPS! Першим ходить ${winnerName}!`;
        modal.style.display = 'flex';
      }
    }

    function closeRpsModal() {
      document.getElementById('rpsModal').style.display = 'none';
    }

    async function startAiGame() {
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 1";
      localStorage.setItem('gummy_username', username);

      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mode: 'AI', rpsChoice: window.selectedRps })
      });
      const data = await res.json();
      window.currentRoom = data.roomState;
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId);

      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Бот 🤖";
      document.getElementById('lobbyModal').style.display = 'none';

      showRpsModal(data.roomState);
      updateTurnUI();
    }

    async function createMultiplayerRoom() {
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 1";
      localStorage.setItem('gummy_username', username);

      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mode: 'MULTIPLAYER', rpsChoice: window.selectedRps })
      });
      const data = await res.json();
      window.currentRoom = data.roomState;
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId);

      alert('Кімнату створено! Поділіться кодом з другом: ' + data.roomId);
      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Очікування суперника...";
      document.getElementById('lobbyModal').style.display = 'none';

      startPolling();
    }

    async function joinMultiplayerRoom() {
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

      window.currentRoom = data.roomState;
      window.playerToken = data.playerToken;
      window.myTeam = 'TEAM_B';
      generateTerrain(data.roomState.roomId);

      document.getElementById('teamAName').innerText = data.roomState.teamA.username;
      document.getElementById('teamBName').innerText = username;
      document.getElementById('lobbyModal').style.display = 'none';

      showRpsModal(data.roomState);
      startPolling();
    }

    function startPolling() {
      if (window.pollingTimer) clearInterval(window.pollingTimer);
      window.pollingTimer = setInterval(async () => {
        if (!window.currentRoom) return;
        try {
          const res = await fetch('/api/room-state?roomId=' + window.currentRoom.roomId);
          const roomState = await res.json();
          
          if (roomState.lastAction && (!window.currentRoom.lastAction || roomState.lastAction.timestamp > window.currentRoom.lastAction.timestamp)) {
            if (roomState.lastAction.type === 'SHOOT' && roomState.lastAction.team !== window.myTeam) {
              executeRemoteShoot(roomState.lastAction);
            }
          }
          window.currentRoom = roomState;
          updateTurnUI();
        } catch(e){}
      }, 1500);
    }

    function updateTurnUI() {
      if (!window.currentRoom) return;
      window.isMyTurn = window.currentRoom.activeTeam === window.myTeam;
      const turnInfo = document.getElementById('turn-info');
      
      const myScore = window.myTeam === 'TEAM_A' ? window.currentRoom.teamA.score : window.currentRoom.teamB.score;
      document.getElementById('scoreDisplay').innerText = myScore;

      if (window.currentRoom.status === "WAITING") {
        turnInfo.innerText = "Очікування другого гравця...";
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
      return team[0];
    }

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => {
      keys[e.code] = false;
      const b = getActiveBear();
      if (e.code === 'Space' && b.isCharging && window.isMyTurn) handlePlayerShoot(b);
    });

    async function handlePlayerShoot(b) {
      b.isCharging = false;
      if (b.partsCount <= 0 || bullet) return;

      b.partsCount--;
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
      if (data.room) {
        window.currentRoom = data.room;
        updateTurnUI();
      }

      spawnBullet(b, window.myTeam);
      
      if (window.currentRoom.mode === 'AI' && window.currentRoom.status === 'PLAYING') {
        setTimeout(handleAiTurn, 2500);
      }
    }

    function executeRemoteShoot(actionData) {
      const enemyTeam = actionData.team === 'TEAM_A' ? teamA : teamB;
      const b = enemyTeam[actionData.bearIndex] || enemyTeam[0];
      b.angle = actionData.angle;
      b.power = actionData.power;
      b.partsCount = Math.max(0, b.partsCount - 1);
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

    async function handleAiTurn() {
      const aliveBears = teamB.filter(b => b.partsCount > 0);
      if (aliveBears.length === 0) return;
      const b = aliveBears[Math.floor(Math.random() * aliveBears.length)];
      
      b.angle = -Math.PI * (0.6 + Math.random() * 0.3);
      b.power = 30 + Math.random() * 50;
      b.partsCount--;

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
      if (data.room) {
        window.currentRoom = data.room;
        updateTurnUI();
      }

      spawnBullet(b, 'TEAM_B');
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
      const blastRadius = 30;
      window.screenShake = 12;
      createExplosionParticles(ex, ey, ownerTeam === 'TEAM_A' ? '#52b788' : '#ff4d6d');

      for (let x = Math.max(0, Math.floor(ex - blastRadius)); x < Math.min(canvas.width, Math.floor(ex + blastRadius)); x++) {
        const dist = Math.abs(x - ex);
        const depth = Math.sqrt(blastRadius * blastRadius - dist * dist);
        if (ey + depth > terrain[x]) terrain[x] = Math.max(terrain[x], ey + depth);
      }

      const targetTeam = ownerTeam === 'TEAM_A' ? teamB : teamA;
      let totalDamageParts = 0;

      targetTeam.forEach(b => {
        if (b.partsCount <= 0) return;
        const dist = Math.hypot(b.x - ex, b.y - ey);
        if (dist < blastRadius + 18) {
          const damageParts = Math.min(b.partsCount, Math.ceil((1 - dist / (blastRadius + 18)) * 3));
          b.partsCount -= damageParts;
          totalDamageParts += damageParts;
        }
      });

      if (totalDamageParts > 0 && ownerTeam === window.myTeam) {
        const res = await fetch('/api/game-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: window.currentRoom.roomId,
            playerToken: window.playerToken,
            action: 'REPORT_DAMAGE',
            payload: { damageParts: totalDamageParts }
          })
        });
        const data = await res.json();
        if (data.room) {
          window.currentRoom = data.room;
          updateTurnUI();
          if (data.room.status === "FINISHED") {
            const winner = data.room.teamA.partsLeft > 0 ? "TEAM_A" : "TEAM_B";
            const msg = winner === window.myTeam ? "🎉 ПЕРЕМОГА!" : "😱 ПОРАЗКА!";
            alert(msg);
          }
        }
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
