// --- ІСТОРІЯ ВЕРСІЙ ---
// Відлік ведеться від 2.0. При кожній новій зміні коду ДОДАВАЙ новий запис
// НА ПОЧАТОК цього масиву (найновіша версія — перша), не видаляючи попередні.
const CHANGELOG = [
  {
    version: "2.1",
    date: "2026-08-03",
    changes: [
      "Виправлено критичний краш при старті: змінна `wind` використовувалась до свого оголошення (temporal dead zone), через що скрипт падав і кнопка «Грати проти AI» не реагувала",
      "Довершено фікс черги ходів: після пострілу клієнт тепер синхронізує activeTeam/activeBearIndex з відповіддю сервера (раніше відповідь ігнорувалась, тому хід у межах команди не рухався далі першого ведмедика)",
      "Хід бота тепер теж репортується на сервер (раніше був повністю локальним і 'губив' стан ходу)",
      "Виправлено помилку bearIndex: індекс ведмедика рахувався від команди A навіть коли стріляла команда B",
      "Додано робочий лічильник очок (scoreDisplay), який раніше ніколи не оновлювався і завжди показував 0"
    ]
  },
  {
    version: "2.0",
    date: "2026-08-03",
    changes: [
      "Виправлено чергу ходів: раніше активний ведмедик не змінювався і стріляв, поки не гине; тепер хід коректно переходить по колу (1 → 2 → 3)",
      "Виправлено розсинхрон карти в мультиплеєрі: рельєф і вітер генерувалися окремо Math.random() у кожного гравця; тепер вони детерміновано обчислюються з ID кімнати, тож обидва бачать однакову карту",
      "Додано панель історії версій зліва від ігрового поля"
    ]
  }
];

function renderChangelogHtml(sanitize) {
  return CHANGELOG.map(entry => {
    const changesHtml = entry.changes
      .map(c => `<li>${sanitize(c)}</li>`)
      .join("");
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

    // Хелпер для вирахування переможця RPS (Камінь, Ножиці, Папір)
    function getRpsWinner(choiceA, choiceB) {
      if (choiceA === choiceB) return 'DRAW';
      if (
        (choiceA === 'rock' && choiceB === 'scissors') ||
        (choiceA === 'scissors' && choiceB === 'paper') ||
        (choiceA === 'paper' && choiceB === 'rock')
      ) {
        return 'TEAM_A';
      }
      return 'TEAM_B';
    }

    // --- API: Отримати Топ-10 лідерів ---
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      try {
        const rawData = await env.LEADERBOARD.get("top_scores");
        const scores = rawData ? JSON.parse(rawData) : [];
        return new Response(JSON.stringify(scores), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      }
    }

    // --- API: Створити кімнату (Для AI або Мультиплеєра) ---
    if (url.pathname === "/api/create-room" && request.method === "POST") {
      try {
        const body = await request.json();
        const username = sanitize(body.username) || "Гравець 1";
        const mode = body.mode || "AI"; // "AI" або "MULTIPLAYER"
        const rpsChoice = body.rpsChoice || "rock";

        const roomId = mode === "AI" 
          ? "AI-" + crypto.randomUUID().slice(0, 6).toUpperCase()
          : "ROOM-" + Math.floor(1000 + Math.random() * 9000);

        let firstTurn = "TEAM_A";
        let aiRpsChoice = null;

        if (mode === "AI") {
          const choices = ['rock', 'paper', 'scissors'];
          aiRpsChoice = choices[Math.floor(Math.random() * choices.length)];
          const rpsResult = getRpsWinner(rpsChoice, aiRpsChoice);
          firstTurn = rpsResult === 'TEAM_B' ? 'TEAM_B' : 'TEAM_A';
        }

        const roomState = {
          roomId,
          mode,
          status: mode === "AI" ? "PLAYING" : "WAITING", // WAITING, PLAYING, FINISHED
          teamA: { username, rpsChoice, score: 0 },
          teamB: { username: mode === "AI" ? "Бот 🤖" : null, rpsChoice: aiRpsChoice, score: 0 },
          activeTeam: firstTurn,
          activeBearIndex: { TEAM_A: 0, TEAM_B: 0 },
          lastAction: null,
          createdAt: Date.now()
        };

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(roomState), { expirationTtl: 3600 });

        return new Response(JSON.stringify({ roomId, roomState }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- API: Приєднатися до кімнати (Мультиплеєр) ---
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

        roomState.teamB.username = sanitize(username) || "Гравець 2";
        roomState.teamB.rpsChoice = rpsChoice || "rock";
        roomState.status = "PLAYING";

        const rpsResult = getRpsWinner(roomState.teamA.rpsChoice, roomState.teamB.rpsChoice);
        roomState.activeTeam = rpsResult === 'TEAM_B' ? 'TEAM_B' : 'TEAM_A';

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(roomState), { expirationTtl: 3600 });

        return new Response(JSON.stringify({ roomState }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- API: Отримати стан кімнати (Polling) ---
    if (url.pathname === "/api/room-state" && request.method === "GET") {
      try {
        const roomId = url.searchParams.get("roomId");
        const rawRoom = await env.LEADERBOARD.get("room:" + roomId);
        if (!rawRoom) {
          return new Response(JSON.stringify({ error: "Кімнату не знайдено" }), { status: 404 });
        }
        return new Response(rawRoom, { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- API: Зареєструвати ігрову дію (Постріл / Перемога) ---
    if (url.pathname === "/api/game-action" && request.method === "POST") {
      try {
        const { roomId, action, payload } = await request.json();
        const rawRoom = await env.LEADERBOARD.get("room:" + roomId);

        if (!rawRoom) {
          return new Response(JSON.stringify({ error: "Недійсна сесія кімнати" }), { status: 403 });
        }

        let room = JSON.parse(rawRoom);

        if (action === "SHOOT") {
          room.lastAction = {
            type: "SHOOT",
            team: payload.team,
            bearIndex: payload.bearIndex,
            angle: payload.angle,
            power: payload.power,
            timestamp: Date.now()
          };
          // Ротація на наступного ведмедика в межах команди (фікс: раніше індекс ніколи не змінювався)
          const currentIdx = room.activeBearIndex[payload.team];
          room.activeBearIndex[payload.team] = (currentIdx + 1) % 3;

          // Перемикаємо хід на іншу команду
          room.activeTeam = payload.team === "TEAM_A" ? "TEAM_B" : "TEAM_A";
        } else if (action === "GAME_OVER") {
          room.status = "FINISHED";
          const winnerTeam = payload.winnerTeam; // "TEAM_A", "TEAM_B", або "DRAW"

          if (winnerTeam !== "DRAW") {
            const winnerData = winnerTeam === "TEAM_A" ? room.teamA : room.teamB;
            const finalScore = payload.finalScore || 500;

            const rawScores = await env.LEADERBOARD.get("top_scores");
            let scores = rawScores ? JSON.parse(rawScores) : [];

            scores.push({
              username: winnerData.username,
              score: finalScore,
              date: new Date().toLocaleDateString()
            });

            scores.sort((a, b) => b.score - a.score);
            scores = scores.slice(0, 10);

            await env.LEADERBOARD.put("top_scores", JSON.stringify(scores));
          }
        }

        await env.LEADERBOARD.put("room:" + roomId, JSON.stringify(room), { expirationTtl: 3600 });

        return new Response(JSON.stringify({ room }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- FRONTEND (HTML + JS ENGINE) ---
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
    h1 { margin: 0 0 10px 0; color: #ff75a0; text-shadow: 0 0 15px rgba(255,117,160,0.6); font-size: 28px; letter-spacing: 1px; }
    
    .main-layout { display: flex; gap: 20px; align-items: flex-start; justify-content: center; width: 100%; max-width: 1800px; flex-wrap: wrap; }
    
    .game-container { position: relative; display: flex; flex-direction: column; align-items: center; }
    canvas { border: 4px solid #ff75a0; border-radius: 20px; background: linear-gradient(to bottom, #2b1055 0%, #755bea 50%, #ff75a0 100%); box-shadow: 0 15px 50px rgba(0,0,0,0.7); }

    .leaderboard-card { background: rgba(255,255,255,0.07); backdrop-filter: blur(12px); padding: 20px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15); width: 250px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .leaderboard-card h3 { margin-top: 0; color: #ffbe0b; text-align: center; font-size: 20px; text-shadow: 0 0 8px rgba(255,190,11,0.4); }
    .leaderboard-list { list-style: none; padding: 0; margin: 0; font-size: 14px; }
    .leaderboard-list li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1); word-break: break-all; }

    .version-card { background: rgba(255,255,255,0.07); backdrop-filter: blur(12px); padding: 20px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.15); width: 250px; max-height: 550px; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .version-card h3 { margin-top: 0; color: #4ecca3; text-align: center; font-size: 18px; text-shadow: 0 0 8px rgba(78,204,163,0.4); }
    .version-card::-webkit-scrollbar { width: 6px; }
    .version-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
    .changelog-entry { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .changelog-entry:last-child { border-bottom: none; margin-bottom: 0; }
    .changelog-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
    .changelog-version { color: #ffbe0b; font-weight: 700; font-size: 15px; }
    .changelog-date { color: rgba(255,255,255,0.5); font-size: 11px; }
    .changelog-changes { list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.85); }
    .changelog-changes li { padding: 3px 0 3px 14px; position: relative; }
    .changelog-changes li::before { content: "•"; position: absolute; left: 0; color: #4ecca3; }

    .status-bar { display: flex; gap: 20px; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); padding: 10px 24px; border-radius: 30px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.15); width: 1200px; }
    .team-badge { display: flex; align-items: center; gap: 8px; }
    .score-val { color: #ffbe0b; }
    .turn-text { color: #4ecca3; font-size: 16px; text-align: center; font-weight: bold; height: 22px; text-shadow: 0 0 10px rgba(78,204,163,0.5); }

    .edit-btn { background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.8; transition: 0.2s; }
    .edit-btn:hover { opacity: 1; transform: scale(1.1); }

    /* Modal Overlay */
    #lobbyModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10,5,20,0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal-box { background: linear-gradient(135deg, #3d1e6d, #2b1055); padding: 35px; border-radius: 24px; text-align: center; border: 2px solid #ff75a0; width: 420px; box-shadow: 0 0 30px rgba(255,117,160,0.4); }
    .modal-box h2 { margin-top: 0; color: #ffbe0b; }
    .modal-box input { width: 90%; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; font-size: 16px; text-align: center; margin: 10px 0; outline: none; font-family: inherit; }
    
    .rps-selector { display: flex; justify-content: center; gap: 15px; margin: 15px 0; }
    .rps-btn { background: rgba(255,255,255,0.1); border: 2px solid transparent; border-radius: 14px; padding: 10px 16px; font-size: 24px; cursor: pointer; transition: 0.2s; }
    .rps-btn.selected { border-color: #ffbe0b; background: rgba(255,190,11,0.2); transform: scale(1.1); }

    .mode-buttons { display: flex; flex-direction: column; gap: 12px; margin-top: 15px; }
    .action-btn { background: #ff75a0; color: white; border: none; padding: 12px 20px; border-radius: 12px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; font-family: inherit; }
    .action-btn:hover { background: #e05480; transform: translateY(-2px); }
    .secondary-btn { background: rgba(255,255,255,0.15); }
    .secondary-btn:hover { background: rgba(255,255,255,0.25); }
  </style>
</head>
<body>

  <!-- LOBBY / SETTINGS MODAL -->
  <div id="lobbyModal">
    <div class="modal-box">
      <h2>🍬 Gummy Bears 3v3</h2>
      <p style="font-size: 14px; color: #ddd;">Введіть юзернейм та оберіть Камінь/Ножиці/Папір:</p>
      <input type="text" id="usernameInput" placeholder="Гравець 1" maxlength="12" autocomplete="off" name="no-autofill" data-1p-ignore>
      
      <div class="rps-selector">
        <button class="rps-btn selected" onclick="selectRps('rock')" id="rps-rock">🪨</button>
        <button class="rps-btn" onclick="selectRps('scissors')" id="rps-scissors">✂️</button>
        <button class="rps-btn" onclick="selectRps('paper')" id="rps-paper">📄</button>
      </div>

      <div class="mode-buttons">
        <button class="action-btn" onclick="startAiGame()">🤖 Грати проти AI</button>
        <button class="action-btn secondary-btn" onclick="createMultiplayerRoom()">⚔️ Створити онлайн кімнату</button>
        <div style="display:flex; gap:8px;">
          <input type="text" id="roomCodeInput" placeholder="Код кімнати (напр. ROOM-1234)" style="margin:0; font-size:14px;">
          <button class="action-btn" onclick="joinMultiplayerRoom()" style="padding:10px 14px; font-size:14px;">Приєднатися</button>
        </div>
      </div>
    </div>
  </div>

  <h1>🍬 Gummy Bears: Candy Mayhem 3v3 🍬</h1>

  <div class="status-bar">
    <div class="team-badge">🟦 <span id="teamAName" style="color: #52b788;">Команда 1</span></div>
    <div>Очки: <span id="scoreDisplay" class="score-val">0</span></div>
    <div class="turn-text" id="turn-info">Очікування старту...</div>
    <div class="team-badge">🟥 <span id="teamBName" style="color: #ff4d6d;">Команда 2</span></div>
    <div>🍃 Вітер: <span id="windDisplay">0</span></div>
    <button class="edit-btn" onclick="openLobbyModal()" title="Змінити налаштування">⚙️</button>
  </div>

  <div class="main-layout">
    <div class="version-card">
      <h3>🔄 Історія версій</h3>
      <div id="changelogList">
        ${changelogHtml}
      </div>
    </div>

    <div class="game-container">
      <canvas id="gameCanvas" width="1200" height="550"></canvas>
    </div>

    <div class="leaderboard-card">
      <h3>🏆 ТОП-10 ЛІДЕРІВ</h3>
      <ol id="leaderboardList" class="leaderboard-list">
        ${leaderboardHtml}
      </ol>
    </div>
  </div>

  <script>
    // --- ГЛОБАЛЬНІ ЗМІННІ СТАНУ ---
    window.currentRoom = null;
    window.selectedRps = 'rock';
    window.myTeam = 'TEAM_A'; // 'TEAM_A' або 'TEAM_B'
    window.isMyTurn = false;
    window.pollingTimer = null;
    window.screenShake = 0;
    window.myScore = 0; // Фікс: раніше не існувало ніякого live-рахунку — scoreDisplay завжди показував 0

    function updateScoreDisplay() {
      const el = document.getElementById('scoreDisplay');
      if (el) el.innerText = window.myScore;
    }

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // Деталі ведмедика та порядок їх кидання (Черговість снарядів)
    const BEAR_PARTS = [
      { id: 'L_FOOT', dx: -8, dy: 13, r: 6 },  // 1. Ліва стопа (Сповільнення)
      { id: 'R_FOOT', dx: 8, dy: 13, r: 6 },   // 2. Права стопа (Блок руху)
      { id: 'L_THIGH', dx: -13, dy: -4, r: 5 },// 3. Ліве стегно
      { id: 'R_THIGH', dx: 13, dy: -4, r: 5 }, // 4. Праве стегно
      { id: 'L_ARM', dx: -8, dy: -20, r: 5 },  // 5. Ліва рука
      { id: 'R_ARM', dx: 8, dy: -20, r: 5 },   // 6. Права рука
      { id: 'TAIL', dx: 0, dy: 6, r: 9 },      // 7. Хвіст
      { id: 'B_TORSO', dx: 0, dy: -3, r: 8 },  // 8. Нижній тулуб
      { id: 'T_TORSO', dx: 0, dy: -11, r: 7 }, // 9. Верхній тулуб
      { id: 'HEAD', dx: 0, dy: -15, r: 8 }     // 10. Голова (Останній постріл)
    ];

    // --- SEEDED RNG (фікс: раніше Math.random() давав різний рельєф/вітер у кожного гравця) ---
    // Детермінований генератор чисел, засіяний ID кімнати — обидва клієнти,
    // знаючи один і той самий roomId, отримають ідентичний результат.
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

    // Оновлена розмірність ландшафту (1200px)
    const terrain = new Array(canvas.width);
    let wind = 0; // Оголошено ДО generateTerrain(), інакше — ReferenceError (TDZ) і скрипт падає повністю
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
      // Вітер теж має бути однаковим для обох гравців — генеруємо тим самим seed'ом
      wind = rand() * 0.4 - 0.2;
    }
    generateTerrain(); // початковий фоновий рельєф до старту гри (перегенерується з roomId при старті)

    // Партикли та візуальні ефекти
    let particles = [];
    function createExplosionParticles(x, y, color) {
      for (let i = 0; i < 25; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          radius: Math.random() * 4 + 2,
          color,
          alpha: 1.0,
          life: 0.03 + Math.random() * 0.03
        });
      }
    }

    // Команди з 3-х ведмедиків під універсальну архітектуру
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

    function selectRps(choice) {
      window.selectedRps = choice;
      document.querySelectorAll('.rps-btn').forEach(b => b.classList.remove('selected'));
      document.getElementById('rps-' + choice).classList.add('selected');
    }

    function openLobbyModal() {
      document.getElementById('lobbyModal').style.display = 'flex';
    }

    // --- СТАРТ ІГРОВИХ РЕЖИМІВ ---
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
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId); // фікс: детермінований рельєф/вітер за roomId

      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Бот 🤖";
      document.getElementById('lobbyModal').style.display = 'none';

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
      window.myTeam = 'TEAM_A';
      generateTerrain(data.roomId); // фікс: детермінований рельєф/вітер за roomId

      alert('Кімнату створено! Поділіться кодом з другом: ' + data.roomId);
      document.getElementById('teamAName').innerText = username;
      document.getElementById('teamBName').innerText = "Очікування суперника...";
      document.getElementById('lobbyModal').style.display = 'none';

      startPolling();
    }

    async function joinMultiplayerRoom() {
      const username = document.getElementById('usernameInput').value.trim() || "Гравець 2";
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
      window.myTeam = 'TEAM_B';
      generateTerrain(data.roomState.roomId); // фікс: той самий seed, що й у творця кімнати

      document.getElementById('teamAName').innerText = data.roomState.teamA.username;
      document.getElementById('teamBName').innerText = username;
      document.getElementById('lobbyModal').style.display = 'none';

      startPolling();
    }

    function startPolling() {
      if (window.pollingTimer) clearInterval(window.pollingTimer);
      window.pollingTimer = setInterval(async () => {
        if (!window.currentRoom) return;
        try {
          const res = await fetch('/api/room-state?roomId=' + window.currentRoom.roomId);
          const roomState = await res.json();
          
          // Оновлюємо стан кімнати та перевіряємо хід супротивника
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
      
      if (window.currentRoom.status === "WAITING") {
        turnInfo.innerText = "Очікування другого гравця...";
      } else if (window.isMyTurn) {
        turnInfo.innerText = "Хід: Ваш хід! 🟩 (Оберіть кут та силу)";
      } else {
        turnInfo.innerText = "Хід: Ходить суперник... 🟥";
      }
      document.getElementById('windDisplay').innerText = wind > 0 ? '➡️ ' + Math.abs(wind*10).toFixed(1) : '⬅️ ' + Math.abs(wind*10).toFixed(1);
    }

    // --- ФІЗИКА ТА КЕРУВАННЯ ---
    function getActiveBear() {
      if (!window.currentRoom) return teamA[0];
      const team = window.currentRoom.activeTeam === 'TEAM_A' ? teamA : teamB;
      const idx = window.currentRoom.activeBearIndex[window.currentRoom.activeTeam];
      // Шукаємо першого живого ведмедика у своїй команді
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

      // Надсилаємо вектор пострілу на сервер і ЧЕКАЄМО оновлений стан кімнати —
      // раніше відповідь ігнорувалась, тому activeTeam/activeBearIndex ніколи
      // не оновлювались локально, і хід не переходив далі
      const res = await fetch('/api/game-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: window.currentRoom.roomId,
          action: 'SHOOT',
          payload: { team: window.myTeam, bearIndex: myTeamArr.indexOf(b), angle: b.angle, power: b.power }
        })
      });
      const data = await res.json();
      if (data.room) {
        window.currentRoom = data.room;
        updateTurnUI();
      }

      spawnBullet(b, window.myTeam);
      
      // Якщо це гра з AI — бот робить хід у відповідь
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
      // Arm Distance: виліт трохи далі від тулуба для усунення самовибуху про ландшафт
      const spawnOffset = 18;
      bullet = {
        x: b.x + lastPart.dx + Math.cos(b.angle) * spawnOffset,
        y: b.y + lastPart.dy + Math.sin(b.angle) * spawnOffset,
        vx: Math.cos(b.angle) * (b.power / 6.0), // Оптимізована плавна швидкість
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

      // Фікс: раніше хід бота ніде не повідомлявся серверу, тому activeTeam/activeBearIndex
      // для TEAM_B ніколи не оновлювались — гра "забувала", що бот вже походив
      const res = await fetch('/api/game-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: window.currentRoom.roomId,
          action: 'SHOOT',
          payload: { team: 'TEAM_B', bearIndex: teamB.indexOf(b), angle: b.angle, power: b.power }
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

      // Оновлення фізики руху активного ведмедика
      if (window.isMyTurn && activeBear && activeBear.partsCount > 0) {
        // Дебафи від втрати стоп та стегон
        let speed = 1.8;
        if (activeBear.partsCount <= 9) speed = 0.9; // Сповільнення від втрати лівої стопи
        if (activeBear.partsCount <= 8) speed = 0;   // Блок руху від втрати обох стоп

        if (keys['KeyA'] && activeBear.x > 10 && speed > 0) activeBear.x -= speed;
        if (keys['KeyD'] && activeBear.x < canvas.width - 10 && speed > 0) activeBear.x += speed;
        if (keys['KeyW'] && activeBear.angle > -Math.PI + 0.1) activeBear.angle -= 0.02;
        if (keys['KeyS'] && activeBear.angle < -0.1) activeBear.angle += 0.02;
        
        // Плавний набір сили (зменшено у 2.5 рази)
        if (keys['Space'] && !bullet) { 
          activeBear.isCharging = true; 
          if (activeBear.power < 100) activeBear.power += 1.0; 
        }
      }

      [...teamA, ...teamB].forEach(updateY);

      // Оновлення снаряда
      if (bullet) {
        bullet.x += bullet.vx; bullet.y += bullet.vy; bullet.vy += 0.16; bullet.vx += wind * 0.08;
        const xIdx = Math.floor(bullet.x);
        const terrainY = (xIdx >= 0 && xIdx < canvas.width) ? terrain[xIdx] : 9999;
        
        if (bullet.x < -50 || bullet.x >= canvas.width + 50 || bullet.y >= terrainY) { 
          explode(bullet.x, bullet.y, bullet.ownerTeam); 
          bullet = null; 
        }
      }

      // Оновлення партиклів
      particles.forEach((p, idx) => {
        p.x += p.vx; p.y += p.vy; p.alpha -= p.life;
        if (p.alpha <= 0) particles.splice(idx, 1);
      });
    }

    function explode(ex, ey, ownerTeam) {
      const blastRadius = 30; // AoE x5 від базового розміру снаряда
      window.screenShake = 12; // Screen Shake ефект
      createExplosionParticles(ex, ey, ownerTeam === 'TEAM_A' ? '#52b788' : '#ff4d6d');

      // Руйнування рельєфу
      for (let x = Math.max(0, Math.floor(ex - blastRadius)); x < Math.min(canvas.width, Math.floor(ex + blastRadius)); x++) {
        const dist = Math.abs(x - ex);
        const depth = Math.sqrt(blastRadius * blastRadius - dist * dist);
        if (ey + depth > terrain[x]) terrain[x] = Math.max(terrain[x], ey + depth);
      }

      // No Friendly Fire: шкода наноситься лише ВОРОЖІЙ команді
      const targetTeam = ownerTeam === 'TEAM_A' ? teamB : teamA;
      targetTeam.forEach(b => {
        if (b.partsCount <= 0) return;
        const dist = Math.hypot(b.x - ex, b.y - ey);
        if (dist < blastRadius + 18) {
          const damageParts = Math.min(b.partsCount, Math.ceil((1 - dist / (blastRadius + 18)) * 3));
          b.partsCount -= damageParts;

          // Фікс: нараховуємо очки за влучання лише за постріли МОЄЇ команди,
          // щоб scoreDisplay нарешті показував реальний прогрес
          if (ownerTeam === window.myTeam) {
            window.myScore += damageParts * 10;
            updateScoreDisplay();
          }
        }
      });

      checkWinConditions();
    }

    async function checkWinConditions() {
      const teamAAlive = teamA.some(b => b.partsCount > 0);
      const teamBAlive = teamB.some(b => b.partsCount > 0);

      if (!teamAAlive || !teamBAlive) {
        let winnerTeam = "DRAW";
        if (teamAAlive && !teamBAlive) winnerTeam = "TEAM_A";
        if (!teamAAlive && teamBAlive) winnerTeam = "TEAM_B";

        const msg = winnerTeam === "DRAW" ? "🤝 НІЧИЯ!" : (winnerTeam === window.myTeam ? "🎉 ПЕРЕМОГА!" : "😱 ПОРАЗКА!");
        alert(msg);

        await fetch('/api/game-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: window.currentRoom.roomId,
            action: 'GAME_OVER',
            payload: { winnerTeam, finalScore: 750 }
          })
        });

        location.reload();
      }
    }

    // --- МАЛЮВАННЯ (GLASSMORPHISM + ADVANCED CANVAS ART) ---
    function draw() {
      ctx.save();
      
      // Screen Shake
      if (window.screenShake > 0) {
        const dx = (Math.random() - 0.5) * window.screenShake;
        const dy = (Math.random() - 0.5) * window.screenShake;
        ctx.translate(dx, dy);
        window.screenShake *= 0.85;
        if (window.screenShake < 0.5) window.screenShake = 0;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Задній шар: Мерехтливе зоряне небо та цукрові гори
      ctx.fillStyle = '#1e0c3e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Передній шар рельєфу з цукровою пудрою
      ctx.fillStyle = '#ff75a0';
      ctx.beginPath(); ctx.moveTo(0, canvas.height);
      for (let x = 0; x < canvas.width; x++) ctx.lineTo(x, terrain[x]);
      ctx.lineTo(canvas.width, canvas.height); ctx.fill();

      // Шар трави/пудри поверх землі
      ctx.strokeStyle = '#ffb5a7'; ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x++) ctx.lineTo(x, terrain[x]);
      ctx.stroke();

      // 3. Малювання ведмедиків (Глянцевий желейний стиль)
      [...teamA, ...teamB].forEach(b => {
        if (b.partsCount <= 0) return;
        ctx.save(); ctx.translate(b.x, b.y);

        for (let i = 0; i < b.partsCount; i++) {
          const p = BEAR_PARTS[i];
          // Тіло
          ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r, 0, Math.PI * 2); ctx.fill();
          // Глянцевий блік
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(p.dx - p.r*0.3, p.dy - p.r*0.3, p.r*0.3, 0, Math.PI * 2); ctx.fill();
        }

        // Очки-намистинки та милі емоції на голові (якщо вона є)
        if (b.partsCount >= 10) {
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.arc(-3, -17, 1.5, 0, Math.PI*2); ctx.arc(3, -17, 1.5, 0, Math.PI*2); ctx.fill();
        }

        // Вказівник прицілювання (дуга початкового вектора)
        if (b === getActiveBear() && window.isMyTurn) {
          ctx.strokeStyle = '#ffbe0b'; ctx.lineWidth = 3; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(0, -10);
          ctx.lineTo(Math.cos(b.angle)*45, -10 + Math.sin(b.angle)*45);
          ctx.stroke(); ctx.setLineDash([]);
        }

        ctx.restore();
      });

      // Power Bar
      const activeBear = getActiveBear();
      if (activeBear && activeBear.isCharging) {
        ctx.fillStyle = '#ffbe0b';
        ctx.fillRect(activeBear.x - 25, activeBear.y - 50, activeBear.power / 2, 7);
        ctx.strokeStyle = '#fff'; ctx.strokeRect(activeBear.x - 25, activeBear.y - 50, 50, 7);
      }

      // 4. Снаряд та димний слід (Trail)
      if (bullet) {
        ctx.fillStyle = bullet.color; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2); ctx.fill();
      }

      // 5. Партикли
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
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }
};
