export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gummy Bears: Smart AI Edition</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #2b1055; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    h1 { margin-bottom: 2px; color: #ff75a0; text-shadow: 0 0 10px rgba(255,117,160,0.5); }
    p { margin-top: 0; color: #fceade; font-size: 14px; }
    canvas { border: 4px solid #ff75a0; border-radius: 16px; background: linear-gradient(to bottom, #755bea, #ff75a0); box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
    .controls { margin-top: 15px; background: rgba(255,255,255,0.1); backdrop-filter: blur(5px); padding: 12px 24px; border-radius: 12px; font-size: 14px; line-height: 1.6; text-align: center; border: 1px solid rgba(255,255,255,0.2); }
    .highlight { color: #ffbe0b; font-weight: bold; }
    .status-bar { display: flex; gap: 40px; margin-bottom: 10px; font-size: 18px; font-weight: bold; }
    .bear-green { color: #52b788; }
    .bear-red { color: #ff4d6d; }
    .turn-indicator { margin-top: 5px; font-weight: bold; font-size: 16px; color: #ffbe0b; height: 24px; }
    .wind-indicator { margin-top: 4px; font-size: 14px; color: #8d99ae; }
  </style>
</head>
<body>
  <h1>🍬 Gummy Bears: Smart AI 🍬</h1>
  <p>Ворожий ведмедик тепер має розрахунок траєкторії та пам'ять пристрілки!</p>

  <div class="status-bar">
    <div class="bear-green">🟩 Ваш Ведмедик: <span id="p1-parts">10/10</span> шматків</div>
    <div class="bear-red">🟥 Ворог (Smart AI): <span id="p2-parts">10/10</span> шматків</div>
  </div>

  <canvas id="gameCanvas" width="800" height="450"></canvas>
  <div id="turn-text" class="turn-indicator">Хід: Ваш хід (🟩 Зелений)</div>
  <div id="wind-text" class="wind-indicator">Вітер: 0</div>

  <div class="controls">
    <span class="highlight">A / D</span> — Рух | 
    <span class="highlight">W / S</span> — Приціл | 
    <span class="highlight">ПРОБІЛ (утримувати)</span> — Постріл
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const BEAR_PARTS = [
      { name: 'Лiве вушко', dx: -8, dy: -20, r: 5 },
      { name: 'Праве вушко', dx: 8, dy: -20, r: 5 },
      { name: 'Ліва лапка', dx: -13, dy: -4, r: 5 },
      { name: 'Права лапка', dx: 13, dy: -4, r: 5 },
      { name: 'Ліва ніжка', dx: -8, dy: 13, r: 6 },
      { name: 'Права ніжка', dx: 8, dy: 13, r: 6 },
      { name: 'Животик', dx: 0, dy: 6, r: 9 },
      { name: 'Грудка', dx: 0, dy: -3, r: 8 },
      { name: 'Мордочка', dx: 0, dy: -11, r: 7 },
      { name: 'Голова', dx: 0, dy: -15, r: 8 }
    ];

    const terrain = new Array(canvas.width);
    function generateTerrain() {
      let height = 300;
      for (let x = 0; x < canvas.width; x++) {
        height += Math.sin(x * 0.012) * 1.8 + (Math.random() * 1.5 - 0.75);
        terrain[x] = Math.max(180, Math.min(380, height));
      }
    }
    generateTerrain();

    let wind = (Math.random() * 0.4 - 0.2); // Початковий вітер
    updateWindUI();

    function updateWindUI() {
      const windText = wind > 0 ? '➡️ Східний ' + Math.abs(wind * 10).toFixed(1) : '⬅️ Західний ' + Math.abs(wind * 10).toFixed(1);
      document.getElementById('wind-text').innerText = 'Вітер: ' + windText;
    }

    let turn = 'PLAYER';

    const player = {
      x: 120, y: 0, radius: 10,
      partsCount: 10,
      color: '#52b788', highlight: '#74c69d',
      angle: -Math.PI / 4, power: 0, isCharging: false
    };

    const enemy = {
      x: 680, y: 0, radius: 10,
      partsCount: 10,
      color: '#ff4d6d', highlight: '#ff758f',
      angle: -Math.PI * 3 / 4, power: 0,
      lastShotError: 0 // Пам'ять для корекції пристрілки
    };

    let bullet = null;
    const keys = {};

    function updateY(entity) {
      entity.y = terrain[Math.floor(entity.x)] - 5;
    }

    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => {
      keys[e.code] = false;
      if (e.code === 'Space' && player.isCharging && turn === 'PLAYER') {
        playerShoot();
      }
    });

    function playerShoot() {
      player.isCharging = false;
      if (player.partsCount <= 0) return;

      player.partsCount--;
      document.getElementById('p1-parts').innerText = player.partsCount + '/10';
      const lastPart = BEAR_PARTS[player.partsCount];

      bullet = {
        x: player.x + lastPart.dx,
        y: player.y + lastPart.dy,
        vx: Math.cos(player.angle) * (player.power / 4.5),
        vy: Math.sin(player.angle) * (player.power / 4.5),
        radius: lastPart.r,
        color: player.color,
        highlight: player.highlight,
        owner: 'PLAYER'
      };

      player.power = 0;
      turn = 'WAITING';
      document.getElementById('turn-text').innerText = 'Снаряд у польоті...';

      if (player.partsCount === 0) {
        setTimeout(() => {
          alert('😱 Ваш ведмедик повністю розчиняється! Поразка!');
          resetGame();
        }, 600);
      }
    }

    // 🤖 Розумний AI з симуляцією траєкторії та коригуванням похибки
    function enemyTurn() {
      if (enemy.partsCount <= 0) return;

      document.getElementById('turn-text').innerText = 'Хід: Ворог оцінює вітер та дистанцію...';

      setTimeout(() => {
        // AI розраховує найкращий кут та силу за допомогою віртуальної симуляції
        let bestPower = 50;
        let bestAngle = -Math.PI * 0.72;
        let minDistanceToPlayer = 9999;

        // Тестуємо кілька варіантів кутів і сили в "умі" AI
        for (let a = -Math.PI * 0.85; a <= -Math.PI * 0.55; a += 0.05) {
          for (let p = 20; p <= 100; p += 5) {
            let simX = enemy.x;
            let simY = enemy.y - 10;
            let simVx = Math.cos(a) * (p / 4.5);
            let simVy = Math.sin(a) * (p / 4.5);

            // Швидка симуляція польоту
            for (let step = 0; step < 120; step++) {
              simX += simVx;
              simY += simVy;
              simVy += 0.18; // Гравітація
              simVx += wind * 0.1; // Вплив вітру

              const terY = terrain[Math.min(canvas.width - 1, Math.max(0, Math.floor(simX)))];
              if (simY >= terY || simX <= 0 || simX >= canvas.width) {
                const distToPlayer = Math.hypot(simX - player.x, simY - player.y);
                if (distToPlayer < minDistanceToPlayer) {
                  minDistanceToPlayer = distToPlayer;
                  bestPower = p;
                  bestAngle = a;
                }
                break;
              }
            }
          }
        }

        // Застосовуємо корекцію з минулого ходу (пристрілка) + легкий людський шум
        enemy.angle = bestAngle + (Math.random() * 0.04 - 0.02);
        enemy.power = Math.min(100, Math.max(10, bestPower + enemy.lastShotError + (Math.random() * 4 - 2)));

        enemy.partsCount--;
        document.getElementById('p2-parts').innerText = enemy.partsCount + '/10';
        const lastPart = BEAR_PARTS[enemy.partsCount];

        bullet = {
          x: enemy.x + lastPart.dx,
          y: enemy.y + lastPart.dy,
          vx: Math.cos(enemy.angle) * (enemy.power / 4.5),
          vy: Math.sin(enemy.angle) * (enemy.power / 4.5),
          radius: lastPart.r,
          color: enemy.color,
          highlight: enemy.highlight,
          owner: 'ENEMY'
        };

        if (enemy.partsCount === 0) {
          setTimeout(() => {
            alert('🎉 ПЕРЕМОГА! Ворожий ведмедик змарнував останній шматок і розлетівся!');
            resetGame();
          }, 600);
        }
      }, 1000);
    }

    function update() {
      updateY(player);
      updateY(enemy);

      if (turn === 'PLAYER' && player.partsCount > 0) {
        if (keys['KeyA'] && player.x > 30) player.x -= 1.5;
        if (keys['KeyD'] && player.x < canvas.width - 30) player.x += 1.5;
        if (keys['KeyW'] && player.angle > -Math.PI + 0.1) player.angle -= 0.03;
        if (keys['KeyS'] && player.angle < -0.1) player.angle += 0.03;

        if (keys['Space'] && !bullet) {
          player.isCharging = true;
          if (player.power < 100) player.power += 2.5;
        }
      }

      if (bullet) {
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
        bullet.vy += 0.18; 
        bullet.vx += wind * 0.1; // Вітер впливає на кулю в польоті

        const terrainY = terrain[Math.floor(bullet.x)];
        if (bullet.x < 0 || bullet.x >= canvas.width || bullet.y >= terrainY) {
          explode(bullet.x, bullet.y, bullet.owner);
          bullet = null;
        }
      }
    }

    function explode(ex, ey, owner) {
      const blastRadius = 28;
      for (let x = Math.max(0, Math.floor(ex - blastRadius)); x < Math.min(canvas.width, Math.floor(ex + blastRadius)); x++) {
        const dist = Math.abs(x - ex);
        const depth = Math.sqrt(blastRadius * blastRadius - dist * dist);
        if (ey + depth > terrain[x]) {
          terrain[x] = Math.max(terrain[x], ey + depth);
        }
      }

      // Запом'ятовуємо недоліт чи переліт для AI
      if (owner === 'ENEMY') {
        if (ex < player.x) {
          enemy.lastShotError = 3; // Недоліт — наступного разу стріляти трохи сильніше
        } else if (ex > player.x) {
          enemy.lastShotError = -3; // Переліт — трохи слабше
        }
      }

      checkHit(player, 'p1-parts', ex, ey, blastRadius);
      checkHit(enemy, 'p2-parts', ex, ey, blastRadius);

      // Зміна вітру між ходами
      wind += (Math.random() * 0.1 - 0.05);
      wind = Math.max(-0.4, Math.min(0.4, wind));
      updateWindUI();

      if (owner === 'PLAYER') {
        turn = 'ENEMY';
        enemyTurn();
      } else {
        turn = 'PLAYER';
        document.getElementById('turn-text').innerText = 'Хід: Ваш хід (🟩 Зелений)';
      }
    }

    function checkHit(target, elementId, ex, ey, blastRadius) {
      const dist = Math.hypot(target.x - ex, target.y - ey);
      if (dist < blastRadius + target.radius) {
        const damageParts = Math.min(target.partsCount, Math.ceil((1 - dist / (blastRadius + target.radius)) * 3));
        target.partsCount -= damageParts;
        document.getElementById(elementId).innerText = target.partsCount + '/10';

        if (target.partsCount <= 0) {
          setTimeout(() => {
            if (target === player) {
              alert('😱 Ваш ведмедик розлетівся від вибуху! Поразка!');
            } else {
              alert('🎉 ПЕРЕМОГА! Ви повністю знищили ворожого ведмедика!');
            }
            resetGame();
          }, 300);
        }
      }
    }

    function resetGame() {
      player.partsCount = 10;
      enemy.partsCount = 10;
      enemy.lastShotError = 0;
      document.getElementById('p1-parts').innerText = '10/10';
      document.getElementById('p2-parts').innerText = '10/10';
      turn = 'PLAYER';
      document.getElementById('turn-text').innerText = 'Хід: Ваш хід (🟩 Зелений)';
      generateTerrain();
      player.x = 120;
      enemy.x = 600 + Math.random() * 100;
    }

    function drawBear(bear) {
      if (bear.partsCount <= 0) return;

      ctx.save();
      ctx.translate(bear.x, bear.y);

      for (let i = 0; i < bear.partsCount; i++) {
        const part = BEAR_PARTS[i];
        ctx.fillStyle = bear.color;
        ctx.beginPath();
        ctx.arc(part.dx, part.dy, part.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = bear.highlight;
        ctx.beginPath();
        ctx.arc(part.dx - part.r * 0.3, part.dy - part.r * 0.3, part.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      if (bear.partsCount >= 10) {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(-3, -16, 1.5, 0, Math.PI * 2);
        ctx.arc(3, -16, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (bear === player && turn === 'PLAYER') {
        ctx.strokeStyle = '#ffbe0b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(Math.cos(bear.angle) * 35, -10 + Math.sin(bear.angle) * 35);
        ctx.stroke();
      }

      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffb5a7';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let x = 0; x < canvas.width; x++) {
        ctx.lineTo(x, terrain[x]);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.fill();

      ctx.strokeStyle = '#fcd5ce';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, terrain[0]);
      for (let x = 1; x < canvas.width; x++) {
        ctx.lineTo(x, terrain[x]);
      }
      ctx.stroke();

      drawBear(player);
      drawBear(enemy);

      if (player.isCharging && turn === 'PLAYER') {
        ctx.fillStyle = '#ffbe0b';
        ctx.fillRect(player.x - 25, player.y - 45, player.power / 2, 6);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(player.x - 25, player.y - 45, 50, 6);
      }

      if (bullet) {
        ctx.fillStyle = bullet.color;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = bullet.highlight;
        ctx.beginPath();
        ctx.arc(bullet.x - 2, bullet.y - 2, bullet.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      update();
      draw();
      requestAnimationFrame(loop);
    }
    loop();
  </script>
</body>
</html>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }
};
