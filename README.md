# 🍬 Gummy Bears: Candy Mayhem 3v3

[![CodeQL Analysis](https://github.com/rozumeyroman/Gummy-Bears-Candy-Mayhem/actions/workflows/codeql.yml/badge.svg)](https://github.com/rozumeyroman/Gummy-Bears-Candy-Mayhem/actions/workflows/codeql.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

**Gummy Bears: Candy Mayhem 3v3** — це покрокова 2D-артилерійська онлайн-гра у стилі *Worms* / *Scorched Earth*, побудована як єдиний безсерверний додаток (Serverless App) на базі **Cloudflare Workers**.

---

## 🎮 Ігрові особливості (Features)

- 🤖 **Одиночна гра проти AI:** Покрокова битва 3 на 3 проти бота.
- ⚔️ **Онлайн Мультиплеєр (1v1):** Можливість створювати кімнати за 6-значним кодом (наприклад, `RM-8F3K2A`) та грати з друзями в реальному часі.
- 🎲 **Міні-гра RPS & 3D Монетка:** Визначення першого ходу через "Камінь-Ножиці-Папір" з детермінованим 3D-підкиданням монетки при нічиїй.
- 🐻 **Деструктивна анатомія ведмедиків (10 частин):** Кожен ведмедик складається з 10 руйнівних частин (лапки, тулуб, голова тощо). Втрата лапок уповільнює пересування, а руйнування голови призводить до повної вибухової ліквідації.
- ⛰️ **Детермінований рельєф та вітер (Seeded RNG):** Ландшафт та вітер ґенеруються за ID кімнати, забезпечуючи 100% синхронізовану фізику для всіх гравців.
- 💥 **Анімації та ефекти:** Повноцінний фізичний рушій Canvas 2D із частинками вибухів, трусінням екрана (Screen Shake) та балістикою.

---

## 🛠️ Технологічний стек (Tech Stack)

- **Backend:** [Cloudflare Workers](https://workers.cloudflare.com/) (Serverless JavaScript Engine)
- **State Management:** In-Memory RAM Storage (`Map`) із автоматичним очищенням застарілих кімнат (TTL Cleanup) без використання зовнішніх сховищ.
- **Frontend:** HTML5 Canvas, Vanilla JavaScript (ES6+), Glassmorphism CSS UI, Google Fonts (Fredoka).
- **Security & CI/CD:** GitHub Actions з інтегрованим **CodeQL Static Analysis** (v4), CSP заголовки, захист від XSS та унікальні сесійні токени (`playerToken`).

---

## 🚀 Локальний запуск та розгортання

### 1. Передумови
- [Node.js](https://nodejs.org/) (версія 18 або новіша)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
```

### 2. Клонування репозиторію
```bash
git clone https://github.com/rozumeyroman/Gummy-Bears-Candy-Mayhem.git
cd Gummy-Bears-Candy-Mayhem
```

### 3. Локальний запуск розробки
```bash
npx wrangler dev
```
Відкрийте `http://localhost:8787` у браузері.

### 4. Деплой у Cloudflare Workers
```bash
npx wrangler deploy
```

---

## 📜 Історія версій (Changelog)

- **v2.3:** Оптимізація сесій у RAM, нове модальне вікно завершення гри, виправлено перший хід AI та репортування шкоди.
- **v2.2:** Токени сесії `playerToken`, серверна фіксація результатів, 3D монетка в RPS, збереження нікнейму у LocalStorage.
- **v2.1:** Синхронізація активного ведмедика, детермінований рельєф Seeded RNG.

---

## 📄 Ліцензія

MIT License © 2026 [Roman Rozumei](https://github.com/rozumeyroman)
