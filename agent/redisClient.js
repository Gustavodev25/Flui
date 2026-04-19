import { Redis } from '@upstash/redis';
import { Redis as IORedis } from 'ioredis';

// ── Clientes ──────────────────────────────────────────────────

let _upstash = null;

function getUpstash() {
  if (_upstash) return _upstash;
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  _upstash = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
  return _upstash;
}

// Cria nova conexão IORedis para BullMQ (cada Queue/Worker precisa de sua própria)
export function createBullMQConnection() {
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
const DEDUP_TTL_MS = 5 * 60 * 1000;

// ── Sessions (usuários em fluxo de auth) ──────────────────────

const SESSION_TTL_SEC = 1800; // 30 min

export async function getSession(phone) {
  const client = getUpstash();
  if (!client) return _memSessions.get(phone) ?? null;
  return client.get(`auth:session:${phone}`);
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  const client = getUpstash();
  if (!client) { _memSessions.set(phone, data); return; }
  await client.set(`auth:session:${phone}`, data, { ex: ttl });
}

export async function deleteSession(phone) {
  const client = getUpstash();
  if (!client) { _memSessions.delete(phone); return; }
  await client.del(`auth:session:${phone}`);
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
  const result = await client.set(`dedup:msg:${messageId}`, '1', { nx: true, ex: 300 });
  return result === null;
}

// ── Rate Limiting ─────────────────────────────────────────────

// Retorna true se o usuário excedeu o limite (deve ser bloqueado).
export async function checkRateLimit(phone, limitPerMinute = 10) {
  const client = getUpstash();
  if (!client) return false; // Sem Redis = sem rate limit

  const key = `rate:wpp:${phone}`;
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, 60);
  return count > limitPerMinute;
}
