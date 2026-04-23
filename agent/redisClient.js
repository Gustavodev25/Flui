import { Redis } from '@upstash/redis';
import { Redis as IORedis } from 'ioredis';

// ── Clientes ──────────────────────────────────────────────────

let _upstash = null;
let _bullMQDisabledReason = null;

function isBullMQExplicitlyEnabled() {
  return process.env.ENABLE_BULLMQ === 'true';
}

function isRedisQuotaError(error) {
  const message = error?.message ?? '';
  return (
    message.includes('max requests limit exceeded') ||
    message.includes('ERR max requests limit exceeded')
  );
}

function shouldFallbackToMemory(error) {
  if (!error) return false;
  return isRedisQuotaError(error);
}

function logRedisFallback(scope, error) {
  if (!shouldFallbackToMemory(error)) return;
  console.warn(`[Redis] ${scope} indisponivel; usando fallback em memoria: ${error.message}`);
}

export function disableBullMQ(reason) {
  if (_bullMQDisabledReason) return;
  _bullMQDisabledReason = reason || 'BullMQ desativado';
  console.warn(`[BullMQ] ${_bullMQDisabledReason}`);
}

export function isBullMQEnabled() {
  return !_bullMQDisabledReason;
}

function getUpstash() {
  if (_upstash) return _upstash;
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  _upstash = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
  return _upstash;
}

// Cria nova conexão IORedis para BullMQ (cada Queue/Worker precisa de sua própria)
export function createBullMQConnection() {
  if (!isBullMQEnabled()) return null;
  if (process.env.NODE_ENV !== 'production' && !isBullMQExplicitlyEnabled()) {
    disableBullMQ('BullMQ desativado fora de producao; usando processamento direto');
    return null;
  }
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: null, // Obrigatório pelo BullMQ
    enableReadyCheck: false,    // Upstash não suporta PING no connect
    tls: url.startsWith('rediss://') ? {} : undefined,
  });
}

// ── Fallback em memória (se Redis não configurado) ────────────

const _memSessions = new Map();
const _memDedup = new Map();
const _memPhoneLinkChallenges = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000;

// ── Sessions (usuários em fluxo de auth) ──────────────────────

const SESSION_TTL_SEC = 1800; // 30 min
const PHONE_LINK_CHALLENGE_TTL_SEC = 10 * 60; // 10 min

export async function getSession(phone) {
  const client = getUpstash();
  if (!client) return _memSessions.get(phone) ?? null;
  try {
    return await client.get(`auth:session:${phone}`);
  } catch (error) {
    logRedisFallback('getSession', error);
    return _memSessions.get(phone) ?? null;
  }
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  const client = getUpstash();
  if (!client) { _memSessions.set(phone, data); return; }
  try {
    await client.set(`auth:session:${phone}`, data, { ex: ttl });
  } catch (error) {
    logRedisFallback('setSession', error);
    _memSessions.set(phone, data);
  }
}

export async function deleteSession(phone) {
  const client = getUpstash();
  if (!client) { _memSessions.delete(phone); return; }
  try {
    await client.del(`auth:session:${phone}`);
  } catch (error) {
    logRedisFallback('deleteSession', error);
    _memSessions.delete(phone);
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

  const client = getUpstash();
  if (!client) {
    _memPhoneLinkChallenges.set(userId, data);
    return;
  }

  try {
    await client.set(getPhoneLinkChallengeKey(userId), data, { ex: ttl });
  } catch (error) {
    logRedisFallback('setPhoneLinkChallenge', error);
    _memPhoneLinkChallenges.set(userId, data);
  }
}

export async function deletePhoneLinkChallenge(userId) {
  if (!userId) return;

  const client = getUpstash();
  if (!client) {
    _memPhoneLinkChallenges.delete(userId);
    return;
  }

  try {
    await client.del(getPhoneLinkChallengeKey(userId));
  } catch (error) {
    logRedisFallback('deletePhoneLinkChallenge', error);
    _memPhoneLinkChallenges.delete(userId);
  }
}

// ── Deduplicação de mensagens ─────────────────────────────────

// Retorna true se a mensagem é duplicada (já foi vista antes).
// Usa SET NX para garantir atomicidade: só um processo marca como "visto".
export async function checkAndMarkMessage(messageId) {
  if (!messageId) return true;

  const client = getUpstash();
  if (!client) {
    if (_memDedup.has(messageId)) return true;
    _memDedup.set(messageId, Date.now());
    // Limpeza periódica do fallback em memória
    if (_memDedup.size > 200) {
      const now = Date.now();
      for (const [id, ts] of _memDedup) {
        if (now - ts > DEDUP_TTL_MS) _memDedup.delete(id);
      }
    }
    return false;
  }

  // SET NX retorna "OK" se gravou (nova), null se já existia (duplicata)
  try {
    const result = await client.set(`dedup:msg:${messageId}`, '1', { nx: true, ex: 300 });
    return result === null;
  } catch (error) {
    logRedisFallback('checkAndMarkMessage', error);
    if (_memDedup.has(messageId)) return true;
    _memDedup.set(messageId, Date.now());
    return false;
  }
}

// ── Rate Limiting ─────────────────────────────────────────────

// Retorna true se o usuário excedeu o limite (deve ser bloqueado).
export async function checkRateLimit(phone, limitPerMinute = 5, limitPerHour = 100) {
  const client = getUpstash();
  if (!client) return false;

  const keyMin = `rate:wpp:min:${phone}`;
  const keyHr = `rate:wpp:hr:${phone}`;
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
    return false;
  }
}

// Garante que a notificação de rate limit seja enviada apenas uma vez por minuto.
// Retorna true se JÁ foi notificado (não notificar de novo).
export async function checkAndMarkRateLimitNotify(phone) {
  const client = getUpstash();
  if (!client) return false;
  try {
    const result = await client.set(`rate:notify:${phone}`, '1', { nx: true, ex: 60 });
    return result === null; // null = chave já existia = já foi notificado
  } catch {
    return false;
  }
}
