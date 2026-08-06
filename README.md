# 🍬 Gummy Bears: Candy Mayhem 3v3

[![CodeQL Analysis](https://github.com/rozumeyroman/Gummy-Bears-Candy-Mayhem/actions/workflows/codeql.yml/badge.svg)](https://github.com/rozumeyroman/Gummy-Bears-Candy-Mayhem/actions/workflows/codeql.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

**Gummy Bears: Candy Mayhem 3v3** — це покрокова 2D-артилерійська онлайн-гра у стилі *Worms* / *Scorched Earth*, побудована як безсерверний додаток (Serverless App) на базі **Cloudflare Workers**.

---

## 🎮 Ігрові особливості (Features)

- 🤖 **Анімований та розумний AI:** Покрокова битва 3 на 3 проти бота, який вміє маневрувати по рельєфу, ухилятися від вибухових вирв та обирати вигідні позиції перед пострілом.
- ⚔️ **Онлайн Мультиплеєр (1v1):** Можливість створювати кімнати за 6-значним кодом (наприклад, `RM-8F3K2A`) та грати з друзями в реальному часі.
- 🎲 **Міні-гра RPS & 3D Монетка:** Визначення першого ходу через "Камінь-Ножиці-Папір" з детермінованим 3D-підкиданням монетки при нічиїй.
- 🐻 **Деструктивна анатомія ведмедиків (10 частин):** Кожен ведмедик складається з 10 руйнівних частин (лапки, тулуб, голова тощо). Втрата лапок уповільнює чи блокує пересування, а руйнування всіх частин знищує ведмедя.
- ⛰️ **Детермінований рельєф та вітер (Seeded RNG):** Ландшафт та вітер ґенеруються за ID кімнати, забезпечуючи 100% синхронізовану фізику для всіх гравців.
- 💥 **Анімації та ефекти:** Повноцінний фізичний рушій Canvas 2D із частинками вибухів, трусінням екрана (Screen Shake) та балістикою.

---

## 🛠️ Технологічний стек (Tech Stack)

- **Backend:** [Cloudflare Workers](https://workers.cloudflare.com/) (Serverless JavaScript Engine) із модульною ES-структурою (`src/`).
- **State Management:** In-Memory RAM Storage (`Map`) із автоматичним очищенням застарілих кімнат (TTL Cleanup) без використання зовнішніх сховищ.
- **Frontend:** HTML5 Canvas, Vanilla JavaScript (ES6+), Glassmorphism CSS UI, Google Fonts (Fredoka).
- **Security & Infrastructure:** Cloudflare Turnstile CAPTCHA із зашифрованими HMAC-сесіями в `HttpOnly` cookie, CSP заголовки, захист від XSS, унікальні сесійні токени (`playerToken`) та статичний аналіз **CodeQL** (v4).

---

## 📁 Структура проєкту

```text
├── wrangler.json         # Конфігурація розгортання Cloudflare Workers
├── README.md             # Документація проєкту
└── src/
    ├── index.js          # Головна точка входу (Fetch Handler)
    ├── api.js            # Маршрутизація серверних API-ендпоінтів (/api/*)
    ├── security.js       # Логіка сесій, HMAC-підписи та перевірка Cloudflare Turnstile
    ├── rooms.js          # Управління кімнатами, ротація ходів та механіка RPS
    ├── changelog.js      # Історія версій додатку
    └── template.js       # Рендеринг HTML/CSS/JS фронтенд-шаблону


---

## 📄 Ліцензія

GNU General Public License v3.0 (GPLv3) © 2026 [Roman Rozumei](https://github.com/rozumeyroman)

