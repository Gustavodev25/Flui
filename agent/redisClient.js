import { Redis } from '@upstash/redis';
import { Redis as IORedis } from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE_PATH = path.resolve(__dirname, '..', 'whatsapp_sessions.json');
const DEFAULT_REDIS_QUOTA_RETRY_MS = 60 * 60 * 1000;

let _upstash = null;
let _bullMQDisabledReason = null;
let _redisUnavailableUntil = 0;
let _redisFallbackLogged = false;
let _sessionFileLoaded = false;

function isBullMQExplicitlyEnabled() {
  return process.env.ENABLE_BULLMQ === 'true';
}

function getRedisQuotaRetryMs() {
  const configured = Number(process.env.REDIS_QUOTA_RETRY_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_REDIS_QUOTA_RETRY_MS;
}

function isRedisQuotaMessage(message = '') {
  return (
    message.includes('max requests limit exceeded') ||
    message.includes('ERR max requests limit exceeded')
  );
}

function isRedisQuotaError(error) {
  return isRedisQuotaMessage(error?.message ?? '');
}

function markRedisUnavailable(scope, error) {
  if (!isRedisQuotaError(error)) return;

  const retryMs = getRedisQuotaRetryMs();
  _redisUnavailableUntil = Math.max(_redisUnavailableUntil, Date.now() + retryMs);

  if (!_redisFallbackLogged) {
    const minutes = Math.max(1, Math.round(retryMs / 60000));
    console.warn(`[Redis] ${scope} indisponivel; usando fallback local por ${minutes} min: ${error.message}`);
    _redisFallbackLogged = true;
  }
}

function logRedisFallback(scope, error) {
  markRedisUnavailable(scope, error);
}

function isRedisUnavailable() {
  if (!_redisUnavailableUntil) return false;
  if (Date.now() < _redisUnavailableUntil) return true;

  _redisUnavailableUntil = 0;
  _redisFallbackLogged = false;
  return false;
}

export function disableBullMQ(reason) {
  if (_bullMQDisabledReason) return;

  _bullMQDisabledReason = reason || 'BullMQ desativado';
  if (isRedisQuotaMessage(_bullMQDisabledReason)) {
    markRedisUnavailable('BullMQ', new Error(_bullMQDisabledReason));
  }
  console.warn(`[BullMQ] ${_bullMQDisabledReason}`);
}

export function isBullMQEnabled() {
  return !_bullMQDisabledReason;
}

function getUpstash() {
  if (isRedisUnavailable()) return null;
  if (_upstash) return _upstash;

  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;

  _upstash = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
  return _upstash;
}

export function createBullMQConnection() {
  if (!isBullMQEnabled() || isRedisUnavailable()) return null;

  if (process.env.NODE_ENV !== 'production' && !isBullMQExplicitlyEnabled()) {
    disableBullMQ('BullMQ desativado fora de producao; usando processamento direto');
    return null;
  }

  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) return null;

  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });
}

const _memSessions = new Map();
const _memSessionExpires = new Map();
const _memDedup = new Map();
const _memPhoneLinkChallenges = new Map();
const _memCounters = new Map();
const _memRateNotify = new Map();

const DEDUP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SEC = 1800;
const PHONE_LINK_CHALLENGE_TTL_SEC = 10 * 60;

function normalizeSessionKey(phone) {
  const normalized = String(phone || '').replace(/\D/g, '');
  return normalized || String(phone || '');
}

function loadSessionFileFallback() {
  if (_sessionFileLoaded) return;
  _sessionFileLoaded = true;

  try {
    if (!fs.existsSync(SESSION_FILE_PATH)) return;

    const raw = fs.readFileSync(SESSION_FILE_PATH, 'utf8').trim();
    if (!raw) return;

    const sessions = JSON.parse(raw);
    if (!sessions || typeof sessions !== 'object') return;

    for (const [phone, session] of Object.entries(sessions)) {
      if (session && typeof session === 'object') {
        _memSessions.set(normalizeSessionKey(phone), session);
      }
    }
  } catch (error) {
    console.warn(`[Redis] Nao foi possivel carregar ${SESSION_FILE_PATH}: ${error.message}`);
  }
}

function persistSessionFileFallback() {
  if (process.env.WHATSAPP_SESSION_FILE_FALLBACK === 'false') return;

  try {
    const sessions = Object.fromEntries(_memSessions);
    fs.writeFileSync(SESSION_FILE_PATH, `${JSON.stringify(sessions, null, 2)}\n`);
  } catch (error) {
    console.warn(`[Redis] Nao foi possivel salvar ${SESSION_FILE_PATH}: ${error.message}`);
  }
}

function getMemorySession(phone) {
  loadSessionFileFallback();

  const key = normalizeSessionKey(phone);
  const expiresAt = _memSessionExpires.get(key);
  if (expiresAt && Date.now() > expiresAt) {
    _memSessions.delete(key);
    _memSessionExpires.delete(key);
    persistSessionFileFallback();
    return null;
  }

  return _memSessions.get(key) ?? null;
}

function setMemorySession(phone, data, ttl = SESSION_TTL_SEC) {
  loadSessionFileFallback();

  const key = normalizeSessionKey(phone);
  _memSessions.set(key, data);
  if (ttl > 0) {
    _memSessionExpires.set(key, Date.now() + ttl * 1000);
  } else {
    _memSessionExpires.delete(key);
  }
  persistSessionFileFallback();
}

function deleteMemorySession(phone) {
  loadSessionFileFallback();

  const key = normalizeSessionKey(phone);
  _memSessions.delete(key);
  _memSessionExpires.delete(key);
  persistSessionFileFallback();
}

export async function getSession(phone) {
  const key = normalizeSessionKey(phone);
  const client = getUpstash();

  if (!client) return getMemorySession(key);

  try {
    const session = await client.get(`auth:session:${key}`);
    return session ?? getMemorySession(key);
  } catch (error) {
    logRedisFallback('getSession', error);
    return getMemorySession(key);
  }
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  const key = normalizeSessionKey(phone);
  setMemorySession(key, data, ttl);

  const client = getUpstash();
  if (!client) return;

  try {
    await client.set(`auth:session:${key}`, data, { ex: ttl });
  } catch (error) {
    logRedisFallback('setSession', error);
  }
}

export async function deleteSession(phone) {
  const key = normalizeSessionKey(phone);
  deleteMemorySession(key);

  const client = getUpstash();
  if (!client) return;

  try {
    await client.del(`auth:session:${key}`);
  } catch (error) {
    logRedisFallback('deleteSession', error);
  }
}

function getPhoneLinkChallengeKey(userId) {
  return `wa:link:user:${userId}`;
}

export async function getPhoneLinkChallenge(userId) {
  if (!userId) return null;

  const client = getUpstash();
  if (!client) return _memPhoneLinkChallenges.get(userId) ?? null;

  try {
    return await client.get(getPhoneLinkChallengeKey(userId));
  } catch (error) {
    logRedisFallback('getPhoneLinkChallenge', error);
    return _memPhoneLinkChallenges.get(userId) ?? null;
  }
}

export async function setPhoneLinkChallenge(userId, data, ttl = PHONE_LINK_CHALLENGE_TTL_SEC) {
  if (!userId) return;

  _memPhoneLinkChallenges.set(userId, data);

  const client = getUpstash();
  if (!client) return;

  try {
    await client.set(getPhoneLinkChallengeKey(userId), data, { ex: ttl });
  } catch (error) {
    logRedisFallback('setPhoneLinkChallenge', error);
  }
}

export async function deletePhoneLinkChallenge(userId) {
  if (!userId) return;

  _memPhoneLinkChallenges.delete(userId);

  const client = getUpstash();
  if (!client) return;

  try {
    await client.del(getPhoneLinkChallengeKey(userId));
  } catch (error) {
    logRedisFallback('deletePhoneLinkChallenge', error);
  }
}

function checkAndMarkMessageInMemory(messageId) {
  if (_memDedup.has(messageId)) return true;
  _memDedup.set(messageId, Date.now());

  if (_memDedup.size > 200) {
    const now = Date.now();
    for (const [id, ts] of _memDedup) {
      if (now - ts > DEDUP_TTL_MS) _memDedup.delete(id);
    }
  }

  return false;
}

export async function checkAndMarkMessage(messageId) {
  if (!messageId) return true;

  const client = getUpstash();
  if (!client) return checkAndMarkMessageInMemory(messageId);

  try {
    const result = await client.set(`dedup:msg:${messageId}`, '1', { nx: true, ex: 300 });
    return result === null;
  } catch (error) {
    logRedisFallback('checkAndMarkMessage', error);
    return checkAndMarkMessageInMemory(messageId);
  }
}

function incrementMemoryCounter(key, ttlMs) {
  const now = Date.now();
  const current = _memCounters.get(key);
  const next = current && current.expiresAt > now
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + ttlMs };

  _memCounters.set(key, next);

  if (_memCounters.size > 500) {
    for (const [counterKey, value] of _memCounters) {
      if (value.expiresAt <= now) _memCounters.delete(counterKey);
    }
  }

  return next.count;
}

function checkRateLimitInMemory(phone, limitPerMinute, limitPerHour) {
  const normalizedPhone = normalizeSessionKey(phone);
  const countMin = incrementMemoryCounter(`rate:wpp:min:${normalizedPhone}`, 60 * 1000);
  const countHr = incrementMemoryCounter(`rate:wpp:hr:${normalizedPhone}`, 60 * 60 * 1000);
  return countMin > limitPerMinute || countHr > limitPerHour;
}

export async function checkRateLimit(phone, limitPerMinute = 5, limitPerHour = 100) {
  const normalizedPhone = normalizeSessionKey(phone);
  const client = getUpstash();
  if (!client) return checkRateLimitInMemory(normalizedPhone, limitPerMinute, limitPerHour);

  const keyMin = `rate:wpp:min:${normalizedPhone}`;
  const keyHr = `rate:wpp:hr:${normalizedPhone}`;

  try {
    const [countMin, countHr] = await Promise.all([
      client.incr(keyMin),
      client.incr(keyHr),
    ]);
    if (countMin === 1) await client.expire(keyMin, 60);
    if (countHr === 1) await client.expire(keyHr, 3600);
    return countMin > limitPerMinute || countHr > limitPerHour;
  } catch (error) {
    logRedisFallback('checkRateLimit', error);
    return checkRateLimitInMemory(normalizedPhone, limitPerMinute, limitPerHour);
  }
}

function checkAndMarkRateLimitNotifyInMemory(phone) {
  const key = normalizeSessionKey(phone);
  const now = Date.now();
  const expiresAt = _memRateNotify.get(key);
  if (expiresAt && expiresAt > now) return true;

  _memRateNotify.set(key, now + 60 * 1000);
  return false;
}

export async function checkAndMarkRateLimitNotify(phone) {
  const normalizedPhone = normalizeSessionKey(phone);
  const client = getUpstash();
  if (!client) return checkAndMarkRateLimitNotifyInMemory(normalizedPhone);

  try {
    const result = await client.set(`rate:notify:${normalizedPhone}`, '1', { nx: true, ex: 60 });
    return result === null;
  } catch (error) {
    logRedisFallback('checkAndMarkRateLimitNotify', error);
    return checkAndMarkRateLimitNotifyInMemory(normalizedPhone);
  }
}
