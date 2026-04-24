import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const SESSION_TTL_SEC = 1800;
const PHONE_LINK_CHALLENGE_TTL_SEC = 10 * 60;
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

const memorySessions = new Map();
const memorySessionExpires = new Map();
const phoneLinkChallenges = new Map();
const memoryDedupMessages = new Map();
const counters = new Map();
const rateLimitNotifications = new Map();

let dbTablesReady = null;
let dbWarningLogged = false;
let cleanupStarted = false;

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

function isMissingTableError(error) {
  if (!error) return false;
  return /does not exist|relation .* does not exist|Could not find the table/i.test(error.message || '');
}

function logDbFallback(scope, error) {
  if (dbWarningLogged) return;
  console.warn(`[WhatsAppState] Supabase indisponivel para ${scope}; usando fallback em memoria: ${error?.message || 'sem cliente configurado'}`);
  dbWarningLogged = true;
}

async function hasWhatsAppStateTables() {
  if (!supabaseAdmin) return false;
  if (dbTablesReady !== null) return dbTablesReady;

  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('phone')
      .limit(1);

    if (error) {
      if (isMissingTableError(error)) dbTablesReady = false;
      logDbFallback('whatsapp_sessions', error);
      return false;
    }

    dbTablesReady = true;
    dbWarningLogged = false;
    return true;
  } catch (error) {
    logDbFallback('whatsapp_sessions', error);
    return false;
  }
}

function rememberSession(key, session, ttl = SESSION_TTL_SEC) {
  const normalized = normalizeSession(session);
  if (!normalized) return;

  memorySessions.set(key, normalized);
  if (ttl > 0 && !normalized.authenticated) {
    memorySessionExpires.set(key, Date.now() + ttl * 1000);
  } else {
    memorySessionExpires.delete(key);
  }
}

function getMemorySession(key) {
  const expiresAt = memorySessionExpires.get(key);
  if (expiresAt && Date.now() > expiresAt) {
    memorySessions.delete(key);
    memorySessionExpires.delete(key);
    return null;
  }

  return normalizeSession(memorySessions.get(key)) ?? null;
}

function forgetMemorySession(key) {
  memorySessions.delete(key);
  memorySessionExpires.delete(key);
}

function toExpiresAt(ttl, session) {
  const normalized = normalizeSession(session);
  if (!ttl || ttl <= 0 || normalized?.authenticated) return null;
  return new Date(Date.now() + ttl * 1000).toISOString();
}

export async function getSession(phone) {
  const key = normalizeKey(phone);

  if (await hasWhatsAppStateTables()) {
    try {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('session, expires_at')
        .eq('phone', key)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
        await deleteSession(key);
        return null;
      }

      const session = normalizeSession(data.session);
      if (session) {
        const ttl = data.expires_at
          ? Math.max(1, Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / 1000))
          : 0;
        rememberSession(key, session, ttl);
      }
      return session;
    } catch (error) {
      logDbFallback('getSession', error);
    }
  }

  return getMemorySession(key);
}

export async function setSession(phone, data, ttl = SESSION_TTL_SEC) {
  const key = normalizeKey(phone);
  const session = normalizeSession(data);
  if (!session) return;

  rememberSession(key, session, ttl);

  if (!(await hasWhatsAppStateTables())) return;

  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .upsert({
        phone: key,
        session,
        expires_at: toExpiresAt(ttl, session),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'phone' });

    if (error) throw error;
  } catch (error) {
    logDbFallback('setSession', error);
  }
}

export async function deleteSession(phone) {
  const key = normalizeKey(phone);
  forgetMemorySession(key);

  if (!(await hasWhatsAppStateTables())) return;

  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .delete()
      .eq('phone', key);

    if (error) throw error;
  } catch (error) {
    logDbFallback('deleteSession', error);
  }
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

function checkAndMarkMessageInMemory(messageId) {
  const now = Date.now();
  if (memoryDedupMessages.has(messageId)) return true;

  memoryDedupMessages.set(messageId, now);
  if (memoryDedupMessages.size > 1000) {
    for (const [id, timestamp] of memoryDedupMessages) {
      if (now - timestamp > DEDUP_TTL_MS) memoryDedupMessages.delete(id);
    }
  }

  return false;
}

async function cleanupExpiredDedupMessages() {
  if (cleanupStarted || Math.random() > 0.01 || !(await hasWhatsAppStateTables())) return;
  cleanupStarted = true;

  try {
    await supabaseAdmin
      .from('whatsapp_processed_messages')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch {
    // Limpeza oportunista; falha aqui nao deve afetar o webhook.
  } finally {
    cleanupStarted = false;
  }
}

export async function checkAndMarkMessage(messageId) {
  if (!messageId) return true;

  if (await hasWhatsAppStateTables()) {
    try {
      const { error } = await supabaseAdmin
        .from('whatsapp_processed_messages')
        .insert({
          message_id: String(messageId),
          channel: 'whatsapp',
          expires_at: new Date(Date.now() + DEDUP_TTL_MS).toISOString(),
        });

      if (!error) {
        void cleanupExpiredDedupMessages();
        return false;
      }

      if (error.code === '23505') return true;
      throw error;
    } catch (error) {
      logDbFallback('checkAndMarkMessage', error);
    }
  }

  return checkAndMarkMessageInMemory(String(messageId));
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
