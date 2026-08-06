// src/rooms.js

export const activeRooms = new Map();

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

export function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return "RM-" + code;
}

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

export function nextAliveBearIndex(bearParts, currentIndex) {
    for (let offset = 1; offset <= bearParts.length; offset++) {
        const index = (currentIndex + offset) % bearParts.length;
        if (bearParts[index] > 0) return index;
    }
    return 0;
}

export function syncTeamParts(team) {
    team.partsLeft = team.bearParts.reduce((total, parts) => total + parts, 0);
}

export function cleanExpiredRooms() {
    const now = Date.now();
    const EXPIRATION_MS = 3600 * 1000;
    for (const [id, room] of activeRooms.entries()) {
        if (now - (room.createdAt || 0) > EXPIRATION_MS) {
            activeRooms.delete(id);
        }
    }
}