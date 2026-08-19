import { renderChangelogHtml } from './changelog.js';
import { sanitize } from './rooms.js';

export function renderHTML() {
  const changelogHtml = renderChangelogHtml(sanitize);
  return `<!DOCTYPE html>
<html lang="uk"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gummy Bears: Candy Mayhem 3v3</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles.css">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body>
  <div id="lobbyModal"><div class="modal-box"><h2>🍬 Gummy Bears 3v3</h2><p style="font-size:14px;color:#ddd;">Нікнейм зберігається автоматично:</p><input type="text" id="usernameInput" placeholder="Гравець 1" maxlength="12" autocomplete="off" data-1p-ignore><div class="cf-turnstile" data-sitekey="0x4AAAAAAEHTYEicsQxe9QLA" data-callback="handleTurnstileSuccess"></div><p id="turnstileStatus" style="font-size:13px;color:#ffbe0b;margin:0 0 8px;">Підтвердіть, що ви людина, щоб почати гру.</p><div class="rps-selector"><button class="rps-btn selected" onclick="selectRps('rock')" id="rps-rock">🪨</button><button class="rps-btn" onclick="selectRps('scissors')" id="rps-scissors">✂️</button><button class="rps-btn" onclick="selectRps('paper')" id="rps-paper">📄</button></div><div id="lobbyActions" style="display:flex;flex-direction:column;gap:10px;"><button class="action-btn" id="aiGameButton" onclick="startAiGame()">🤖 Грати проти AI</button><button class="action-btn" id="createRoomButton" style="background:rgba(255,255,255,.15)" onclick="createMultiplayerRoom()">⚔️ Створити онлайн кімнату</button><div style="display:flex;gap:8px;"><input type="text" id="roomCodeInput" placeholder="Код (напр. RM-8F3K2A)" style="margin:0;font-size:14px;"><button class="action-btn" onclick="joinMultiplayerRoom()" style="padding:10px 14px;font-size:14px;margin:0;">Приєднатися</button></div></div><details class="changelog-details"><summary style="cursor:pointer;color:#4ecca3;font-weight:bold;margin-top:10px;">📜 Історія версій</summary><div class="changelog-content">${changelogHtml}</div></details></div></div>
  <div id="createdRoomModal" style="display:none;"><div class="modal-box"><h2>🎮 Кімнату створено!</h2><div id="createdRoomCode" class="room-code">RM-8F3K2A</div><button class="action-btn" onclick="copyRoomInvite()">📋 Скопіювати посилання</button><p id="copyRoomStatus" class="copy-status"></p><p>Чекаємо на приєднання другого гравця... ⏳</p></div></div>
  <div id="rpsModal" style="display:none;"><div class="modal-box"><h2 id="rpsTitle">🎲 Результат RPS</h2><p id="rpsDetail" style="font-size:15px;color:#ddd;"></p><div class="coin-container" id="coinContainer" style="display:none;"><div class="coin" id="coinElem"><div class="coin-face coin-front">🟦</div><div class="coin-face coin-back">🟥</div></div></div><h3 id="rpsWinnerText" style="color:#ffbe0b;margin-top:15px;"></h3><button class="action-btn" onclick="closeRpsModal()">В бій! ⚔️</button></div></div>
  <div id="gameOverModal" style="display:none;"><div class="modal-box"><h2 class="game-over-title" id="gameOverTitle">🎉 ПЕРЕМОГА!</h2><p class="game-over-subtitle" id="gameOverSubtitle">Ви знищили усіх ведмедиків суперника!</p><div class="game-over-btns"><button class="action-btn" onclick="rematch()">🔄 Реванш</button><button class="action-btn" style="background:rgba(255,255,255,.15)" onclick="backToMenu()">🏠 Меню</button></div></div></div>
  <h1>🍬 Gummy Bears: Candy Mayhem 3v3 🍬</h1>
  <div class="status-bar"><div>🟦 <span id="teamAName" style="color:#52b788;">Команда 1</span></div><div class="turn-text" id="turn-info">Очікування...</div><div>🟥 <span id="teamBName" style="color:#ff4d6d;">Команда 2</span></div><div>🍃 Вітер: <span id="windDisplay">0</span></div><button style="background:none;border:none;cursor:pointer;font-size:16px;" onclick="openLobbyModal()">⚙️</button></div>
  <div class="main-layout"><div class="game-container"><canvas id="gameCanvas" width="1400" height="550"></canvas></div></div>
  <script src="/network.js"></script><script src="/game.js"></script>
</body></html>`;
}
