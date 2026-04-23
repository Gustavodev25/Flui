import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE_PATH = path.resolve(__dirname, '..', 'whatsapp_sessions.json');

const SESSION_TTL_SEC = 1800;
const PHONE_LINK_CHALLENGE_TTL_SEC = 10 * 60;
const DEDUP_TTL_MS = 5 * 60 * 1000;

const sessions = new Map();
const sessionExpires = new Map();
const phoneLinkChallenges = new Map();
const dedupMessages = new Map();
const counters = new Map();
const rateLimitNotifications = new Map();

let sessionFileLoaded = false;

function normalizeKey(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  return normalized || String(value || '');
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;

  if (session.authenticated) {
    return {
      ...session,
      authenticated: true,
      step: null,
    };
  }

  return session;
}

function loadSessionFile() {
  if (sessionFileLoaded) return;
  sessionFileLoaded = true;

  try {
    if (!fs.existsSync(SESSION_FILE_PATH)) return;

    const raw = fs.readFileSync(SESSION_FILE_PATH, 'utf8').trim();
    if (!raw) return;

    const storedSessions = JSON.parse(raw);
    if (!storedSessions || typeof storedSessions !== 'object') return;

    for (const [phone, session] of Object.entries(storedSessions)) {
      const normalized = normalizeSession(session);
      if (normalized) sessions.set(normalizeKey(phone), normalized);
    }
  } catch (error) {
    console.warn(`[WhatsAppState] Nao foi possivel carregar sessoes locais: ${error.message}`);
  }
}

function persistSessionFile() {
  try {
    const storedSessions = Object.fromEntries(sessions);
    fs.writeFileSync(SESSION_FILE_PATH, `${JSON.stringify(storedSessions, null, 2)}\n`);
  } catch (error) {
    console.warn(`[WhatsAppState] Nao foi possivel salvar sessoes locais: ${error.message}`);
  }
}

export async function getSession(phone) {
  loadSessionFile();

  const key = normalizeKey(phone);
  const expiresAt = sessionExpires.get(key);
  if (expiresAt && Date.now() > expiresAt) {
    sessions.delete(key);
    sessionExpires.delete(key);
    persistSessionFile();
    return null;
  }

  return normalizeSession(sessions.get(key)) ?? null;
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  loadSessionFile();

  const key = normalizeKey(phone);
  const normalized = normalizeSession(data);
  if (!normalized) return;

  sessions.set(key, normalized);
  if (ttl > 0 && !normalized.authenticated) {
    sessionExpires.set(key, Date.now() + ttl * 1000);
  } else {
    sessionExpires.delete(key);
  }

  persistSessionFile();
}

export async function deleteSession(phone) {
  loadSessionFile();

  const key = normalizeKey(phone);
  sessions.delete(key);
  sessionExpires.delete(key);
  persistSessionFile();
}

function getPhoneLinkChallengeKey(userId) {
  return String(userId || '');
}

export async function getPhoneLinkChallenge(userId) {
  if (!userId) return null;

  const key = getPhoneLinkChallengeKey(userId);
  const entry = phoneLinkChallenges.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    phoneLinkChallenges.delete(key);
    return null;
  }

  return entry.data;
}

export async function setPhoneLinkChallenge(userId, data, ttl = PHONE_LINK_CHALLENGE_TTL_SEC) {
  if (!userId) return;

  phoneLinkChallenges.set(getPhoneLinkChallengeKey(userId), {
    data,
    expiresAt: Date.now() + ttl * 1000,
  });
}

export async function deletePhoneLinkChallenge(userId) {
  if (!userId) return;
  phoneLinkChallenges.delete(getPhoneLinkChallengeKey(userId));
}

export async function checkAndMarkMessage(messageId) {
  if (!messageId) return true;

  const now = Date.now();
  if (dedupMessages.has(messageId)) return true;

  dedupMessages.set(messageId, now);
  if (dedupMessages.size > 500) {
    for (const [id, timestamp] of dedupMessages) {
      if (now - timestamp > DEDUP_TTL_MS) dedupMessages.delete(id);
    }
  }

  return false;
}

function incrementCounter(key, ttlMs) {
  const now = Date.now();
  const current = counters.get(key);
  const next = current && current.expiresAt > now
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + ttlMs };

  counters.set(key, next);

  if (counters.size > 1000) {
    for (const [counterKey, value] of counters) {
      if (value.expiresAt <= now) counters.delete(counterKey);
    }
  }

  return next.count;
}

export async function checkRateLimit(phone, limitPerMinute = 20, limitPerHour = 300) {
  const key = normalizeKey(phone);
  const countMin = incrementCounter(`rate:wpp:min:${key}`, 60 * 1000);
  const countHr = incrementCounter(`rate:wpp:hr:${key}`, 60 * 60 * 1000);
  return countMin > limitPerMinute || countHr > limitPerHour;
}

export async function checkAndMarkRateLimitNotify(phone) {
  const key = normalizeKey(phone);
  const now = Date.now();
  const expiresAt = rateLimitNotifications.get(key);
  if (expiresAt && expiresAt > now) return true;

  rateLimitNotifications.set(key, now + 60 * 1000);
  return false;
}
