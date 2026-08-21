window.currentRoom = null;
window.playerToken = null;
window.selectedRps = 'rock';
window.turnstileVerified = false;
window.myTeam = 'TEAM_A';
window.isMyTurn = false;
window.wsConnection = null;
window.screenShake = 0;
const wsPendingRequests = new Map();
let wsRequestCounter = 0;
// Явний прапорець "RPS-модалка вже показана для поточної гри" — надійніший за перевірку
// поточного display createdRoomModal, який залежить від порядку подій і не мав би бути
// єдиним джерелом істини для того, чи вже стартувала гра
let rpsModalTriggered = false;

window.handleTurnstileSuccess = async (token) => {
  const status = document.getElementById('turnstileStatus');
  status.innerText = 'Перевіряємо…'; 
  status.style.color = '#ffbe0b';
  try {
    const response = await fetch('/api/verify-turnstile', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      credentials: 'same-origin', 
      body: JSON.stringify({ token }) 
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Verification failed');
    window.turnstileVerified = true; 
    status.innerText = '✓ Перевірку пройдено — можна грати!'; 
    status.style.color = '#4ecca3';
  } catch (_) { 
    window.turnstileVerified = false; 
    status.innerText = 'Не вдалося підтвердити перевірку. Спробуйте ще раз.'; 
    status.style.color = '#ff758f'; 
    if (window.turnstile) window.turnstile.reset(); 
  }
};

async function restoreTurnstileSession() { 
  try { 
    const response = await fetch('/api/turnstile-status', { credentials: 'same-origin' }); 
    const result = await response.json(); 
    if (!result.verified) return; 
    window.turnstileVerified = true; 
    const status = document.getElementById('turnstileStatus'); 
    status.innerText = '✓ Перевірку вже пройдено — можна грати!'; 
    status.style.color = '#4ecca3'; 
  } catch (_) {} 
}
restoreTurnstileSession();

function requireTurnstile() { 
  if (window.turnstileVerified) return true; 
  alert('Спочатку пройдіть перевірку Turnstile.'); 
  return false; 
}

window.selectRps = (choice) => { 
  window.selectedRps = choice; 
  document.querySelectorAll('.rps-btn').forEach((button) => button.classList.remove('selected')); 
  document.getElementById(`rps-${choice}`).classList.add('selected'); 
};

window.openLobbyModal = () => { 
  document.getElementById('lobbyModal').style.display = 'flex'; 
};

function showCreatedRoomModal(roomId) { 
  document.getElementById('createdRoomCode').innerText = roomId; 
  document.getElementById('copyRoomStatus').innerText = ''; 
  document.getElementById('createdRoomModal').style.display = 'flex'; 
}

window.copyRoomInvite = async () => { 
  const roomId = document.getElementById('createdRoomCode').innerText; 
  const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`; 
  const status = document.getElementById('copyRoomStatus'); 
  try { 
    await navigator.clipboard.writeText(inviteUrl); 
    status.innerText = 'Скопійовано!'; 
  } catch (_) { 
    status.innerText = 'Не вдалося скопіювати посилання.'; 
  } 
};

function applyRpsWinner(room) {
  if (window.currentRoom) window.currentRoom.activeTeam = room.rpsResult.winner;
  window.game.updateTurnUI();
}

function showRpsModal(room) {
  rpsModalTriggered = true;
  document.getElementById('createdRoomModal').style.display = 'none';
  const modal = document.getElementById('rpsModal'),
        detail = document.getElementById('rpsDetail'),
        winnerText = document.getElementById('rpsWinnerText'),
        coinContainer = document.getElementById('coinContainer'),
        coinElem = document.getElementById('coinElem');
  const icons = { rock: '🪨', paper: '📄', scissors: '✂️' };
  detail.innerText = `${room.teamA.username} (${icons[room.teamA.rpsChoice] || '🪨'}) VS ${room.teamB.username} (${icons[room.teamB.rpsChoice] || '🪨'})`;
  if (room.rpsResult.isTie) {
    coinContainer.style.display = 'block';
    winnerText.innerText = 'Нічия за вибором! Жеребкування...';
    modal.style.display = 'flex';
    setTimeout(() => {
      coinElem.style.transform = `rotateY(${room.rpsResult.winner === 'TEAM_A' ? 1800 : 1980}deg)`;
      setTimeout(() => {
        winnerText.innerText = `Жереб визначив! Першим ходить ${room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username}!`;
        applyRpsWinner(room);
      }, 2000);
    }, 300);
  } else {
    coinContainer.style.display = 'none';
    winnerText.innerText = `Перемога в RPS! Першим ходить ${room.rpsResult.winner === 'TEAM_A' ? room.teamA.username : room.teamB.username}!`;
    modal.style.display = 'flex';
    applyRpsWinner(room);
  }
}

window.closeRpsModal = () => {
  document.getElementById('rpsModal').style.display = 'none';
  document.getElementById('createdRoomModal').style.display = 'none';
  window.game.updateTurnUI();
  if (window.currentRoom?.mode === 'AI' && window.currentRoom.activeTeam === 'TEAM_B') {
    setTimeout(() => window.game.handleAiTurn(), 1000);
  }
};

function showGameOverModal(room) {
  closeRoomSocket();
  const winner = room.teamA.partsLeft > 0 ? 'TEAM_A' : room.teamB.partsLeft > 0 ? 'TEAM_B' : 'DRAW'; 
  const isWin = winner === window.myTeam; 
  document.getElementById('gameOverTitle').innerText = winner === 'DRAW' ? '🤝 НІЧИЯ!' : isWin ? '🎉 ПЕРЕМОГА!' : '😱 ПОРАЗКА!'; 
  document.getElementById('gameOverSubtitle').innerText = winner === 'DRAW' ? 'Обидві команди знищені одночасно!' : isWin ? 'Ви знищили усіх ведмедиків суперника!' : 'Ваших ведмедиків знищено...'; 
  document.getElementById('gameOverModal').style.display = 'flex'; 
}

window.rematch = () => {
  document.getElementById('gameOverModal').style.display = 'none';
  closeRoomSocket();
  rpsModalTriggered = false;
  window.currentRoom = null;
  window.playerToken = null; 
  sessionStorage.removeItem('gummy_player_token'); 
  sessionStorage.removeItem('gummy_my_team'); 
  window.game.resetBears(); 
  window.openLobbyModal(); 
};
window.backToMenu = window.rematch;

function saveUsername(fallback) { 
  const username = document.getElementById('usernameInput').value.trim() || fallback; 
  localStorage.setItem('gummy_username', username); 
  return username; 
}

async function createRoom(mode, username) { 
  const res = await fetch('/api/create-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, mode, rpsChoice: window.selectedRps })
  }); 
  const data = await res.json(); 
  if (!res.ok || data.error) throw new Error(data.error || 'Не вдалося створити кімнату'); 
  return data; 
}

window.startAiGame = async () => {
  if (!requireTurnstile()) return;
  window.game.resetBears();
  rpsModalTriggered = false;
  try {
    const username = saveUsername('Гравець 1'); 
    const data = await createRoom('AI', username); 
    window.playerToken = data.playerToken; 
    window.myTeam = 'TEAM_A'; 
    sessionStorage.setItem('gummy_player_token', data.playerToken); 
    sessionStorage.setItem('gummy_my_team', 'TEAM_A'); 
    window.game.loadRoom(data.roomState);
    document.getElementById('teamAName').innerText = username;
    document.getElementById('teamBName').innerText = 'Бот 🤖';
    document.getElementById('lobbyModal').style.display = 'none';
    showRpsModal(data.roomState);
    connectRoomSocket(data.roomId);
  } catch (error) {
    alert(error.message);
  }
};

window.createMultiplayerRoom = async () => {
  if (!requireTurnstile()) return;
  window.game.resetBears();
  rpsModalTriggered = false;
  try {
    const username = saveUsername('Гравець 1'); 
    const data = await createRoom('MULTIPLAYER', username); 
    window.playerToken = data.playerToken; 
    window.myTeam = 'TEAM_A'; 
    sessionStorage.setItem('gummy_player_token', data.playerToken); 
    sessionStorage.setItem('gummy_my_team', 'TEAM_A'); 
    window.game.loadRoom(data.roomState); 
    document.getElementById('teamAName').innerText = username; 
    document.getElementById('teamBName').innerText = 'Очікування суперника...'; 
    document.getElementById('lobbyModal').style.display = 'none';
    showCreatedRoomModal(data.roomId);
    connectRoomSocket(data.roomId);
  } catch (error) {
    alert(error.message);
  }
};

window.joinMultiplayerRoom = async () => { 
  if (!requireTurnstile()) return; 
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase().match(/RM-[A-Z0-9]{6}/)?.[0] || ''; 
  if (!roomId) return alert('Введіть коректний код кімнати у форматі RM-XXXXXX.'); 
  document.getElementById('roomCodeInput').value = roomId;
  window.game.resetBears();
  rpsModalTriggered = false;
  try {
    const username = saveUsername('Гравець 2'); 
    const res = await fetch('/api/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomId, username, rpsChoice: window.selectedRps })
    }); 
    const data = await res.json(); 
    if (res.status === 404) {
      history.replaceState({}, document.title, window.location.pathname);
      document.getElementById('aiGameButton').style.display = '';
      document.getElementById('createRoomButton').style.display = '';
      document.getElementById('roomCodeInput').value = '';
      alert(`Кімнату ${roomId} не знайдено або її термін дії закінчився. Створіть нову кімнату.`);
      return;
    } 
    if (!res.ok || data.error) throw new Error(data.error || 'Не вдалося приєднатися'); 
    window.playerToken = data.playerToken; 
    window.myTeam = 'TEAM_B'; 
    sessionStorage.setItem('gummy_player_token', data.playerToken); 
    sessionStorage.setItem('gummy_my_team', 'TEAM_B'); 
    window.game.loadRoom(data.roomState); 
    document.getElementById('teamAName').innerText = data.roomState.teamA.username; 
    document.getElementById('teamBName').innerText = username; 
    document.getElementById('lobbyModal').style.display = 'none';
    showRpsModal(data.roomState);
    connectRoomSocket(roomId);
  } catch (error) {
    alert(error.message);
  }
};

function handleIncomingRoomState(room) {
  window.game.receiveRoomState(room);
  // Fail-safe: щойно кімната переходить у PLAYING, createdRoomModal ЗАВЖДИ ховається,
  // незалежно від того, чи ми вже його ховали раніше — це не покладається на поточний
  // display, який може бути неточним джерелом істини через порядок SYNC_STATE/ROOM_UPDATED
  if (room.status === 'PLAYING') {
    document.getElementById('createdRoomModal').style.display = 'none';
    if (!rpsModalTriggered) showRpsModal(room);
  }
}

let wsRoomId = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;

function closeRoomSocket() {
  wsRoomId = null;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  wsReconnectAttempts = 0;
  if (window.wsConnection) {
    const ws = window.wsConnection;
    window.wsConnection = null;
    ws.onclose = null;
    try { ws.close(); } catch (_) {}
  }
  wsPendingRequests.forEach((pending) => pending.resolve({ error: 'З’єднання закрито' }));
  wsPendingRequests.clear();
}

function connectRoomSocket(roomId) {
  wsRoomId = roomId;
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (window.wsConnection) {
    const previous = window.wsConnection;
    window.wsConnection = null;
    previous.onclose = null;
    try { previous.close(); } catch (_) {}
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/room/${encodeURIComponent(roomId)}`);
  window.wsConnection = ws;

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
  });

  ws.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    console.log('WS message received:', message);

    if (message.type === 'SYNC_STATE' || message.type === 'ROOM_UPDATED') {
      handleIncomingRoomState(message.roomState);
    } else if (message.type === 'ACTION_RESULT') {
      const pending = wsPendingRequests.get(message.requestId);
      if (!pending) return;
      wsPendingRequests.delete(message.requestId);
      pending.resolve({ error: message.error, room: message.room });
    }
  });

  ws.addEventListener('close', () => {
    if (window.wsConnection !== ws) return;
    window.wsConnection = null;
    if (!wsRoomId || window.currentRoom?.status === 'FINISHED') return;
    const delay = Math.min(5000, 500 * 2 ** wsReconnectAttempts);
    wsReconnectAttempts++;
    console.log(`WS closed, reconnecting to ${wsRoomId} in ${delay}ms`);
    wsReconnectTimer = setTimeout(() => connectRoomSocket(wsRoomId), delay);
  });

  ws.addEventListener('error', (event) => {
    console.log('WS error:', event);
  });
}

// Чекає, поки WS відкриється (він може ще підключатись одразу після старту гри — реальний
// мережевий handshake, на відміну від localhost, займає помітний час), з таймаутом
function waitForOpenSocket(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = window.wsConnection;
    if (ws && ws.readyState === WebSocket.OPEN) { resolve(ws); return; }
    if (!ws || ws.readyState !== WebSocket.CONNECTING) { resolve(null); return; }
    const onOpen = () => { cleanup(); resolve(ws); };
    const onClose = () => { cleanup(); resolve(null); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('close', onClose);
    }
    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
  });
}

async function sendGameAction(action, payload, token) {
  const ws = await waitForOpenSocket();
  if (!ws) return { error: 'Немає з’єднання із сервером' };
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${++wsRequestCounter}`;
    wsPendingRequests.set(requestId, { resolve });
    ws.send(JSON.stringify({ type: 'GAME_ACTION', playerToken: token, action, payload, requestId }));
  });
}

window.network = { showGameOverModal, sendGameAction };

// Мультиплеєр тимчасово вимкнено в UI — старе запрошення (?room=...) більше нікуди не веде,
// тож нічого не прифілюємо і не ховаємо кнопку гри проти AI
function prepareInviteJoin(roomId) {}

window.addEventListener('DOMContentLoaded', () => { 
  const savedName = localStorage.getItem('gummy_username'); 
  if (savedName) document.getElementById('usernameInput').value = savedName; 
  
  window.playerToken = sessionStorage.getItem('gummy_player_token');
  window.myTeam = sessionStorage.getItem('gummy_my_team') || 'TEAM_A';

  const roomId = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase(); 
  if (roomId) prepareInviteJoin(roomId); 
});