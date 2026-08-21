// src/rooms.js
// Чисті допоміжні функції ігрової логіки, що не залежать від сховища.
// Стан кімнати тепер живе в GameRoom (Durable Object + SQLite), не тут.

// Функція для санітизації рядка, щоб уникнути XSS атак
export function sanitize(str) {
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

// Функція для генерації унікального коду кімнати
export function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return "RM-" + code;
}

// Функція для вирішення гри в камінь-ножиці-папір між двома командами
export function resolveRps(choiceA, choiceB) {
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

// Функція для знаходження наступного активного індексу частини медведя
export function nextAliveBearIndex(bearParts, currentIndex) {
    for (let offset = 1; offset <= bearParts.length; offset++) {
        const index = (currentIndex + offset) % bearParts.length;
        if (bearParts[index] > 0) return index;
    }
    return 0;
}

// Функція для синхронізації кількості частин медведя для команди
export function syncTeamParts(team) {
    team.partsLeft = team.bearParts.reduce((total, parts) => total + parts, 0);
}
