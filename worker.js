export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Допоміжна функція санітизації від XSS
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

    // --- API: Зберегти новий результат ---
    if (url.pathname === "/api/leaderboard" && request.method === "POST") {
      try {
        const body = await request.json();
        let { username, score, secretCheck } = body;

        username = sanitize(username);
        if (!username || username.length > 12) {
          username = "Анонім";
        }

        if (typeof score !== "number" || score < 0 || score > 10000) {
          return new Response(JSON.stringify({ error: "Некоректний рахунок" }), { status: 400 });
        }

        const expectedSecret = btoa(username + score + "candy_secret_key").slice(0, 16);
        if (secretCheck !== expectedSecret) {
          return new Response(JSON.stringify({ error: "Спроба фальсифікації запиту!" }), { status: 403 });
        }

        const rawData = await env.LEADERBOARD.get("top_scores");
        let scores = rawData ? JSON.parse(rawData) : [];

        scores.push({ 
          username: username, 
          score: Math.floor(score), 
          date: new Date().toLocaleDateString() 
        });

        scores.sort((a, b) => b.score - a.score);
        scores = scores.slice(0, 10);

        await env.LEADERBOARD.put("top_scores", JSON.stringify(scores));

        return new Response(JSON.stringify(scores), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // --- FRONTEND (HTML + CANVAS) ---
    if (request.method === "GET") {

      // 1. ВІДКРИТИЙ КЛІЄНТСЬКИЙ КОД ГРИ
      const rawGameScript = `
        let username = "Гравець";
        let score = 0;

        function safeHTML(str) {
          const div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        function startGame() {
          const val = document.getElementById('usernameInput').value.trim();
          if (val) username = val;
          document.getElementById('displayName').innerText = username;
          document.getElementById('nameModal').style.display = 'none';
          loadLeaderboard();
        }

        async function loadLeaderboard() {
          try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            const list = document.getElementById('leaderboardList');
            list.innerHTML = '';
            if (data.length === 0) {
              list.innerHTML = '<li><i>Поки немає рекордів</i></li>';
              return;
            }
            data.forEach((item, idx) => {
              list.innerHTML += \`<li><span>\${idx + 1}. \${safeHTML(item.username)}</span> <b>\${item.score}</b></li>\`;
            });
          } catch(e){}
        }

        async function saveScore(finalScore) {
          try {
            const secretCheck = btoa(username + finalScore + "candy_secret_key").slice(0, 16);
            await fetch('/api/leaderboard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                username: username, 
                score: finalScore,
                secretCheck: secretCheck
              })
            });
            loadLeaderboard();
          } catch(e){}
        }

        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');

        const BEAR_PARTS = [
          { dx: -8, dy: -20, r: 5 }, { dx: 8, dy: -20, r: 5 },
          { dx: -13, dy: -4, r: 5 }, { dx: 13, dy: -4, r: 5 },
          { dx: -8, dy: 13, r: 6 }, { dx: 8, dy: 13, r: 6 },
          { dx: 0, dy: 6, r: 9 }, { dx: 0, dy: -3, r: 8 },
          { dx: 0, dy: -11, r: 7 }, { dx: 0, dy: -15, r: 8 }
        ];

        const terrain = new Array(canvas.width);
        function generateTerrain() {
          const type = Math.floor(Math.random() * 4);
          const baseHeight = 220 + Math.random() * 80;
          const freq1 = 0.008 + Math.random() * 0.01;
          const freq2 = 0.02 + Math.random() * 0.02;

          for (let x = 0; x < canvas.width; x++) {
            let h = baseHeight;
            if (type === 0) h += Math.sin(x * freq1) * 60 + Math.cos(x * freq2) * 20;
            else if (type === 1) h += Math.sin(x * freq1) * 40 + (Math.abs(x - canvas.width / 2) < 150 ? 50 : -20);
            else if (type === 2) h += Math.sin(x * freq1) * 50 + Math.sin(x * 0.05) * 15;
            else h += Math.cos(x * freq1) * 70 + Math.sin(x * freq2) * 25;
            terrain[x] = Math.max(120, Math.min(380, h));
          }
        }
        generateTerrain();

        let wind = (Math.random() * 0.4 - 0.2);
        updateWindDisplay();

        function updateWindDisplay() {
          document.getElementById('windDisplay').innerText = wind > 0 ? '➡️ ' + Math.abs(wind*10).toFixed(1) : '⬅️ ' + Math.abs(wind*10).toFixed(1);
        }

        let turn = 'PLAYER';

        const player = { x: 100, y: 0, radius: 10, partsCount: 10, color: '#52b788', highlight: '#74c69d', angle: -Math.PI / 4, power: 0, isCharging: false };
        const enemy = { x: 650, y: 0, radius: 10, partsCount: 10, color: '#ff4d6d', highlight: '#ff758f', angle: -Math.PI * 0.75, power: 0, lastError: 0 };
        let bullet = null;
        const keys = {};

        function updateY(e) {
          const xIdx = Math.floor(e.x);
          if (xIdx >= 0 && xIdx < canvas.width) {
            e.y = terrain[xIdx] - 5;
          }
        }

        function checkOutOfBounds(b, name) {
          if (b.partsCount <= 0) return false;
          const isOffSides = b.x < -10 || b.x >= canvas.width + 10;
          const isFellBottom = b.y > canvas.height + 20;

          if (isOffSides || isFellBottom) {
            b.partsCount = 0;
            const msg = b === player ? '😱 ' + safeHTML(name) + ' випав за межі карти!' : '🎉 Ворог випав у прірву!';
            const partsId = b === player ? 'p1-parts' : 'p2-parts';
            document.getElementById(partsId).innerText = '0/10';
            alert(msg);
            return true;
          }
          return false;
        }

        window.addEventListener('keydown', e => keys[e.code] = true);
        window.addEventListener('keyup', e => {
          keys[e.code] = false;
          if (e.code === 'Space' && player.isCharging && turn === 'PLAYER') playerShoot();
        });

        function playerShoot() {
          player.isCharging = false;
          if (player.partsCount <= 0) return;
          player.partsCount--;
          score = Math.max(0, score - 10);
          document.getElementById('scoreDisplay').innerText = score;
          document.getElementById('p1-parts').innerText = player.partsCount + '/10';
          const lastPart = BEAR_PARTS[player.partsCount];
          bullet = {
            x: player.x + lastPart.dx, y: player.y + lastPart.dy,
            vx: Math.cos(player.angle) * (player.power / 4.5), vy: Math.sin(player.angle) * (player.power / 4.5),
            radius: lastPart.r, color: player.color, highlight: player.highlight, owner: 'PLAYER'
          };
          player.power = 0;
          turn = 'WAITING';
          document.getElementById('turn-info').innerText = 'Снаряд у польоті...';
        }

        function enemyTurn() {
          if (enemy.partsCount <= 0) return;
          document.getElementById('turn-info').innerText = 'Хід: Ворог думає... (🟥 Червоний)';
          setTimeout(() => {
            let bestPower = 50, bestAngle = -Math.PI * 0.72, minDist = 9999;
            for (let a = -Math.PI * 0.85; a <= -Math.PI * 0.55; a += 0.05) {
              for (let p = 20; p <= 100; p += 5) {
                let simX = enemy.x, simY = enemy.y - 10, simVx = Math.cos(a) * (p / 4.5), simVy = Math.sin(a) * (p / 4.5);
                for (let s = 0; s < 120; s++) {
                  simX += simVx; simY += simVy; simVy += 0.18; simVx += wind * 0.1;
                  const terY = terrain[Math.min(canvas.width - 1, Math.max(0, Math.floor(simX)))];
                  if (simY >= terY || simX <= 0 || simX >= canvas.width) {
                    const d = Math.hypot(simX - player.x, simY - player.y);
                    if (d < minDist) { minDist = d; bestPower = p; bestAngle = a; }
                    break;
                  }
                }
              }
            }
            enemy.angle = bestAngle + (Math.random() * 0.04 - 0.02);
            enemy.power = Math.min(100, Math.max(10, bestPower + enemy.lastError + (Math.random() * 4 - 2)));
            enemy.partsCount--;
            document.getElementById('p2-parts').innerText = enemy.partsCount + '/10';
            const lastPart = BEAR_PARTS[enemy.partsCount];
            bullet = {
              x: enemy.x + lastPart.dx, y: enemy.y + lastPart.dy,
              vx: Math.cos(enemy.angle) * (enemy.power / 4.5), vy: Math.sin(enemy.angle) * (enemy.power / 4.5),
              radius: lastPart.r, color: enemy.color, highlight: enemy.highlight, owner: 'ENEMY'
            };
          }, 1000);
        }

        function update() {
          updateY(player); updateY(enemy);
          if (turn === 'PLAYER' && player.partsCount > 0) {
            if (keys['KeyA'] && player.x > 5) player.x -= 1.8;
            if (keys['KeyD'] && player.x < canvas.width - 5) player.x += 1.8;
            if (keys['KeyW'] && player.angle > -Math.PI + 0.1) player.angle -= 0.03;
            if (keys['KeyS'] && player.angle < -0.1) player.angle += 0.03;
            if (keys['Space'] && !bullet) { player.isCharging = true; if (player.power < 100) player.power += 2.5; }
          }
          if (checkOutOfBounds(player, username) || checkOutOfBounds(enemy, 'Ворожий ведмедик')) { handleEndGame(); return; }
          if (bullet) {
            bullet.x += bullet.vx; bullet.y += bullet.vy; bullet.vy += 0.18; bullet.vx += wind * 0.1;
            const xIdx = Math.floor(bullet.x);
            const terrainY = (xIdx >= 0 && xIdx < canvas.width) ? terrain[xIdx] : 9999;
            if (bullet.x < -50 || bullet.x >= canvas.width + 50 || bullet.y >= terrainY) { explode(bullet.x, bullet.y, bullet.owner); bullet = null; }
          }
        }

        function explode(ex, ey, owner) {
          const blastRadius = 26;
          [player, enemy].forEach(b => {
            const dist = Math.hypot(b.x - ex, b.y - ey);
            if (dist < blastRadius + 20) {
              const angle = Math.atan2(b.y - ey, b.x - ex);
              const force = (1 - dist / (blastRadius + 20)) * 25;
              b.x += Math.cos(angle) * force; b.y += Math.sin(angle) * force;
            }
          });
          for (let x = Math.max(0, Math.floor(ex - blastRadius)); x < Math.min(canvas.width, Math.floor(ex + blastRadius)); x++) {
            const dist = Math.abs(x - ex); const depth = Math.sqrt(blastRadius * blastRadius - dist * dist);
            if (ey + depth > terrain[x]) terrain[x] = Math.max(terrain[x], ey + depth);
          }
          if (owner === 'ENEMY') enemy.lastError = ex < player.x ? 3 : -3;
          
          checkSegmentHits(player, 'p1-parts', ex, ey, blastRadius, owner);
          checkSegmentHits(enemy, 'p2-parts', ex, ey, blastRadius, owner);

          wind += (Math.random() * 0.1 - 0.05); wind = Math.max(-0.4, Math.min(0.4, wind)); updateWindDisplay();
          if (enemy.partsCount <= 0 || player.partsCount <= 0 || checkOutOfBounds(player, username) || checkOutOfBounds(enemy, 'Ворожий ведмедик')) { handleEndGame(); return; }
          if (owner === 'PLAYER') { turn = 'ENEMY'; enemyTurn(); }
          else { turn = 'PLAYER'; document.getElementById('turn-info').innerText = 'Хід: Ваш хід (🟩 Зелений)'; }
        }

        function checkSegmentHits(target, elementId, ex, ey, blastRadius, owner) {
          if (target.partsCount <= 0) return;
          let totalDamage = 0; let directHit = false;

          for (let i = 0; i < target.partsCount; i++) {
            const part = BEAR_PARTS[i];
            const partX = target.x + part.dx;
            const partY = target.y + part.dy;
            const dist = Math.hypot(partX - ex, partY - ey);
            
            if (dist < blastRadius + part.r) {
              const damage = (1 - dist / (blastRadius + part.r));
              totalDamage += damage;
              if (dist < part.r + 5) directHit = true;
            }
          }

          if (totalDamage > 0) {
            let partsToRemove = Math.ceil(totalDamage * 2);
            if (directHit) partsToRemove += 1;
            const finalPartsToRemove = Math.min(target.partsCount, partsToRemove);
            target.partsCount -= finalPartsToRemove;
            
            if (owner === 'PLAYER' && target === enemy) {
              score += finalPartsToRemove * 60;
              if (directHit) score += 50;
              document.getElementById('scoreDisplay').innerText = score;
            }
            document.getElementById(elementId).innerText = target.partsCount + '/10';
          }
        }

        function handleEndGame() {
          if (enemy.partsCount <= 0 && player.partsCount > 0) {
            score += player.partsCount * 50; document.getElementById('scoreDisplay').innerText = score;
            alert('🎉 ПЕРЕМОГА! Рахунок: ' + score); saveScore(score);
          } else { alert('😱 Поразка! Рахунок: ' + score); }
          resetGame();
        }

        function resetGame() {
          player.partsCount = 10; enemy.partsCount = 10; score = 0;
          document.getElementById('scoreDisplay').innerText = '0'; document.getElementById('p1-parts').innerText = '10/10'; document.getElementById('p2-parts').innerText = '10/10';
          turn = 'PLAYER'; document.getElementById('turn-info').innerText = 'Хід: Ваш хід (🟩 Зелений)'; generateTerrain(); player.x = 80 + Math.random()*60; enemy.x = 600 + Math.random()*80;
        }

        function draw() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffb5a7'; ctx.beginPath(); ctx.moveTo(0, canvas.height);
          for (let x = 0; x < canvas.width; x++) ctx.lineTo(x, terrain[x]);
          ctx.lineTo(canvas.width, canvas.height); ctx.fill();
          [player, enemy].forEach(b => {
            if (b.partsCount <= 0) return;
            ctx.save(); ctx.translate(b.x, b.y);
            for (let i = 0; i < b.partsCount; i++) {
              const p = BEAR_PARTS[i]; ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = b.highlight; ctx.beginPath(); ctx.arc(p.dx-p.r*0.3, p.dy-p.r*0.3, p.r*0.35, 0, Math.PI * 2); ctx.fill();
            }
            if (b === player && turn === 'PLAYER') {
              ctx.strokeStyle = '#ffbe0b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(Math.cos(b.angle)*35, -10+Math.sin(b.angle)*35); ctx.stroke();
            }
            ctx.restore();
          });
          if (player.isCharging && turn === 'PLAYER') { ctx.fillStyle = '#ffbe0b'; ctx.fillRect(player.x-25, player.y-45, player.power/2, 6); ctx.strokeStyle = '#fff'; ctx.strokeRect(player.x-25, player.y-45, 50, 6); }
          if (bullet) { ctx.fillStyle = bullet.color; ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2); ctx.fill(); }
        }
        function loop() { update(); draw(); requestAnimationFrame(loop); }
        loop();
      `;

      // 2. БЕЗПЕЧНА ДИНАМІЧНА ОБФУСКАЦІЯ (Unicode / Кирилиця)
      const uint8Array = new TextEncoder().encode(rawGameScript);
      let binaryStr = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binaryStr += String.fromCharCode(uint8Array[i]);
      }
      const encodedScript = btoa(binaryStr);

      // 3. LOADER З ДЕКОДУВАННЯМ UTF-8
      const obfuscatedLoader = `
        (function(_0x1a2b,_0x3c4d){
          var _0x5e6f = function(_0x7a8b){
            var bin = atob(_0x7a8b);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder().decode(bytes);
          };
          eval(_0x5e6f(_0x3c4d));
        })(window, "${encodedScript}");
      `;

      const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gummy Bears: Candy Mayhem</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #2b1055; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    h1 { margin-bottom: 2px; color: #ff75a0; text-shadow: 0 0 10px rgba(255,117,160,0.5); }
    .main-layout { display: flex; gap: 20px; align-items: flex-start; margin-top: 10px; }
    canvas { border: 4px solid #ff75a0; border-radius: 16px; background: linear-gradient(to bottom, #755bea, #ff75a0); box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
    
    .leaderboard-card { background: rgba(255,255,255,0.1); backdrop-filter: blur(8px); padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.2); width: 220px; }
    .leaderboard-card h3 { margin-top: 0; color: #ffbe0b; text-align: center; }
    .leaderboard-list { list-style: none; padding: 0; margin: 0; font-size: 14px; }
    .leaderboard-list li { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1); word-break: break-all; }
    
    .status-bar { display: flex; gap: 25px; font-size: 15px; font-weight: bold; background: rgba(0,0,0,0.35); padding: 8px 20px; border-radius: 20px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1); }
    .score-val { color: #ffbe0b; }
    .turn-text { color: #4ecca3; font-size: 14px; text-align: center; margin-bottom: 5px; height: 18px; }
    
    #nameModal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal-box { background: #3d1e6d; padding: 30px; border-radius: 16px; text-align: center; border: 2px solid #ff75a0; width: 320px; box-shadow: 0 0 20px rgba(255,117,160,0.4); }
    .modal-box input { width: 85%; padding: 10px; border-radius: 8px; border: none; font-size: 16px; text-align: center; margin: 15px 0; outline: none; }
    .modal-box button { background: #ff75a0; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .modal-box button:hover { background: #e05480; }
  </style>
</head>
<body>

  <div id="nameModal">
    <div class="modal-box">
      <h2>🍬 Ласкаво просимо!</h2>
      <p style="font-size: 14px; color: #ddd;">Введіть свій юзернейм для гри:</p>
      <input type="text" id="usernameInput" placeholder="Гравець 1" maxlength="12">
      <button onclick="startGame()">Розпочати гру</button>
    </div>
  </div>

  <h1>🍬 Gummy Bears: Candy Mayhem 🍬</h1>

  <div class="status-bar">
    <div>Гравець: <span id="displayName" style="color: #52b788;">—</span></div>
    <div>Очки: <span id="scoreDisplay" class="score-val">0</span></div>
    <div>🟩 Тіло: <span id="p1-parts">10/10</span></div>
    <div>🟥 Ворог: <span id="p2-parts">10/10</span></div>
    <div>🍃 Вітер: <span id="windDisplay">0</span></div>
  </div>

  <div id="turn-info" class="turn-text">Хід: Ваш хід (🟩 Зелений)</div>

  <div class="main-layout">
    <canvas id="gameCanvas" width="750" height="420"></canvas>

    <div class="leaderboard-card">
      <h3>🏆 ТОП-10 ЛІДЕРІВ</h3>
      <ol id="leaderboardList" class="leaderboard-list">
        <li>Завантаження...</li>
      </ol>
    </div>
  </div>

  <script>${obfuscatedLoader}</script>
</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }
};
