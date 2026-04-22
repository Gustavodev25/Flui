const sessions = new Map();
const seenMessages = new Map();
const rateLimits = new Map();

const SESSION_TTL_SEC = 1800;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;

function cleanupExpired(map, now = Date.now()) {
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

export async function getSession(phone) {
  const session = sessions.get(phone);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(phone);
    return null;
  }
  return session.data;
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  sessions.set(phone, {
    data,
    expiresAt: Date.now() + ttl * 1000,
  });

  if (sessions.size > 500) cleanupExpired(sessions);
}

export async function deleteSession(phone) {
  sessions.delete(phone);
}

export async function checkAndMarkMessage(messageId) {
  if (!messageId) return true;

  const now = Date.now();
  const existing = seenMessages.get(messageId);
  if (existing && existing.expiresAt > now) return true;

  seenMessages.set(messageId, { expiresAt: now + DEDUP_TTL_MS });

  if (seenMessages.size > 1000) cleanupExpired(seenMessages, now);
  return false;
}

export async function checkRateLimit(phone, limitPerMinute = 10) {
  const now = Date.now();
  const current = rateLimits.get(phone);

  if (!current || current.resetAt <= now) {
    rateLimits.set(phone, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateLimits.size > 1000) cleanupExpiredRateLimits(now);
    return false;
  }

  current.count += 1;
  return current.count > limitPerMinute;
}

function cleanupExpiredRateLimits(now = Date.now()) {
  for (const [phone, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(phone);
  }
}
