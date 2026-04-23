import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const memoryStore = {
  bindings: new Map(),
  threads: new Map(),
  messages: new Map(),
  jobs: new Map(),
};

let dbTablesReady = null;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizePhone(value) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : value;
}

function isMissingTableError(error) {
  if (!error) return false;
  return /does not exist|relation .* does not exist|Could not find the table/i.test(error.message || '');
}

async function hasConversationTables() {
  if (dbTablesReady !== null) return dbTablesReady;

  try {
    const { error } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .limit(1);

    dbTablesReady = !error || !isMissingTableError(error);
    return dbTablesReady;
  } catch {
    // Erro de rede/transiente: não cacheia, tenta novamente na próxima chamada
    return false;
  }
}

function getMemoryBindingKey(channel, externalUserId) {
  return `${channel}:${externalUserId}`;
}

function toBindingRecord(record) {
  return {
    id: record.id,
    user_id: record.user_id,
    channel: record.channel,
    external_user_id: record.external_user_id,
    display_name: record.display_name || null,
    authenticated: record.authenticated !== false,
    metadata: record.metadata || {},
    last_seen_at: record.last_seen_at || nowIso(),
    created_at: record.created_at || nowIso(),
    updated_at: record.updated_at || nowIso(),
  };
}

function toThreadRecord(record) {
  return {
    id: record.id,
    user_id: record.user_id,
    channel: record.channel,
    channel_binding_id: record.channel_binding_id || null,
    title: record.title || 'Conversa',
    unread_count: record.unread_count || 0,
    metadata: record.metadata || {},
    created_at: record.created_at || nowIso(),
    updated_at: record.updated_at || nowIso(),
    last_message_at: record.last_message_at || nowIso(),
    last_read_at: record.last_read_at || null,
  };
}

function toMessageRecord(record) {
  return {
    id: record.id,
    thread_id: record.thread_id,
    user_id: record.user_id,
    channel: record.channel,
    direction: record.direction,
    role: record.role,
    message_type: record.message_type,
    content: record.content,
    status: record.status || 'sent',
    external_message_id: record.external_message_id || null,
    metadata: record.metadata || {},
    provider: record.provider || null,
    model: record.model || null,
    latency_ms: record.latency_ms || null,
    fallback_used: record.fallback_used || false,
    tool_count: record.tool_count || 0,
    error_class: record.error_class || null,
    artifact_recovery: record.artifact_recovery || false,
    created_at: record.created_at || nowIso(),
    updated_at: record.updated_at || nowIso(),
  };
}

function compareByCreatedAt(a, b) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function getMemoryMessagesForThread(threadId) {
  return [...memoryStore.messages.values()]
    .filter((item) => item.thread_id === threadId)
    .sort(compareByCreatedAt);
}

async function dbSelectSingle(table, filters = []) {
  let query = supabaseAdmin.from(table).select('*');
  for (const filter of filters) {
    query = query[filter.op](filter.column, filter.value);
  }
  return query.limit(1).maybeSingle();
}

export async function upsertChannelBinding({
  userId,
  channel = 'whatsapp',
  externalUserId,
  displayName,
  authenticated = true,
  metadata = {},
}) {
  const externalId = channel === 'whatsapp' ? normalizePhone(externalUserId) : externalUserId;
  const payload = {
    user_id: userId,
    channel,
    external_user_id: externalId,
    display_name: displayName || null,
    authenticated,
    metadata,
    last_seen_at: nowIso(),
    updated_at: nowIso(),
  };

  if (await hasConversationTables()) {
    const { data: existing, error: fetchError } = await dbSelectSingle('channel_bindings', [
      { op: 'eq', column: 'channel', value: channel },
      { op: 'eq', column: 'external_user_id', value: externalId },
    ]);

    if (fetchError && !isMissingTableError(fetchError)) throw fetchError;

    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from('channel_bindings')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return toBindingRecord(data);
    }

    const { data, error } = await supabaseAdmin
      .from('channel_bindings')
      .insert({ ...payload, created_at: nowIso() })
      .select('*')
      .single();

    if (error) throw error;
    return toBindingRecord(data);
  }

  const key = getMemoryBindingKey(channel, externalId);
  const existing = memoryStore.bindings.get(key);
  const record = toBindingRecord({
    ...existing,
    ...payload,
    id: existing?.id || makeId('binding'),
    created_at: existing?.created_at || nowIso(),
  });
  memoryStore.bindings.set(key, record);
  return record;
}

export async function findBindingByExternalUserId(channel, externalUserId) {
  const externalId = channel === 'whatsapp' ? normalizePhone(externalUserId) : externalUserId;

  if (await hasConversationTables()) {
    const { data, error } = await dbSelectSingle('channel_bindings', [
      { op: 'eq', column: 'channel', value: channel },
      { op: 'eq', column: 'external_user_id', value: externalId },
    ]);

    if (error && !isMissingTableError(error)) throw error;
    return data ? toBindingRecord(data) : null;
  }

  return memoryStore.bindings.get(getMemoryBindingKey(channel, externalId)) || null;
}

export async function deleteChannelBinding(channel, externalUserId) {
  const externalId = channel === 'whatsapp' ? normalizePhone(externalUserId) : externalUserId;

  if (await hasConversationTables()) {
    const { error } = await supabaseAdmin
      .from('channel_bindings')
      .delete()
      .eq('channel', channel)
      .eq('external_user_id', externalId);

    if (error && !isMissingTableError(error)) throw error;
    return true;
  }

  const key = getMemoryBindingKey(channel, externalId);
  memoryStore.bindings.delete(key);
  return true;
}

export async function findBindingByUserId(userId, channel = 'whatsapp') {
  if (await hasConversationTables()) {
    const { data, error } = await dbSelectSingle('channel_bindings', [
      { op: 'eq', column: 'user_id', value: userId },
      { op: 'eq', column: 'channel', value: channel },
      { op: 'eq', column: 'authenticated', value: true },
    ]);

    if (error && !isMissingTableError(error)) throw error;
    return data ? toBindingRecord(data) : null;
  }

  return [...memoryStore.bindings.values()].find(
    (binding) => binding.user_id === userId && binding.channel === channel && binding.authenticated
  ) || null;
}

export async function listBindingsByChannel(channel = 'whatsapp') {
  if (await hasConversationTables()) {
    const { data, error } = await supabaseAdmin
      .from('channel_bindings')
      .select('*')
      .eq('channel', channel)
      .eq('authenticated', true);

    if (error && !isMissingTableError(error)) throw error;
    return (data || []).map(toBindingRecord);
  }

  return [...memoryStore.bindings.values()].filter(
    (binding) => binding.channel === channel && binding.authenticated
  );
}

export async function getOrCreateThread({
  userId,
  channel = 'whatsapp',
  externalUserId,
  title,
  metadata = {},
}) {
  const binding = externalUserId
    ? await upsertChannelBinding({
        userId,
        channel,
        externalUserId,
        displayName: title,
        authenticated: true,
        metadata,
      })
    : await findBindingByUserId(userId, channel);

  if (await hasConversationTables()) {
    const query = supabaseAdmin
      .from('conversation_threads')
      .select('*')
      .eq('user_id', userId)
      .eq('channel', channel)
      .order('last_message_at', { ascending: false })
      .limit(1);

    const { data: existing, error: fetchError } = binding?.id
      ? await query.eq('channel_binding_id', binding.id).maybeSingle()
      : await query.maybeSingle();

    if (fetchError && !isMissingTableError(fetchError)) throw fetchError;

    if (existing?.id) return toThreadRecord(existing);

    const record = {
      user_id: userId,
      channel,
      channel_binding_id: binding?.id || null,
      title: title || binding?.display_name || 'Conversa',
      unread_count: 0,
      metadata: {
        ...metadata,
        phone: binding?.external_user_id || externalUserId || null,
      },
      created_at: nowIso(),
      updated_at: nowIso(),
      last_message_at: nowIso(),
    };

    const { data, error } = await supabaseAdmin
      .from('conversation_threads')
      .insert(record)
      .select('*')
      .single();

    if (error) throw error;
    return toThreadRecord(data);
  }

  const existing = [...memoryStore.threads.values()].find((thread) => {
    const sameUser = thread.user_id === userId && thread.channel === channel;
    if (!sameUser) return false;
    if (binding?.id) return thread.channel_binding_id === binding.id;
    return true;
  });

  if (existing) return existing;

  const record = toThreadRecord({
    id: makeId('thread'),
    user_id: userId,
    channel,
    channel_binding_id: binding?.id || null,
    title: title || binding?.display_name || 'Conversa',
    metadata: {
      ...metadata,
      phone: binding?.external_user_id || externalUserId || null,
    },
  });
  memoryStore.threads.set(record.id, record);
  return record;
}

export async function getThreadForUser(userId, threadId) {
  if (await hasConversationTables()) {
    const { data, error } = await dbSelectSingle('conversation_threads', [
      { op: 'eq', column: 'id', value: threadId },
      { op: 'eq', column: 'user_id', value: userId },
    ]);

    if (error && !isMissingTableError(error)) throw error;
    return data ? toThreadRecord(data) : null;
  }

  const record = memoryStore.threads.get(threadId);
  return record?.user_id === userId ? record : null;
}

export async function listThreadsForUser(userId) {
  if (await hasConversationTables()) {
    const { data: threads, error } = await supabaseAdmin
      .from('conversation_threads')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (error && !isMissingTableError(error)) throw error;

    const normalized = (threads || []).map(toThreadRecord);
    const threadIds = normalized.map((thread) => thread.id);

    if (!threadIds.length) return [];

    const { data: messages } = await supabaseAdmin
      .from('conversation_messages')
      .select('id, thread_id, content, role, status, message_type, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false });

    const lastMessageByThread = new Map();
    for (const message of messages || []) {
      if (!lastMessageByThread.has(message.thread_id)) {
        lastMessageByThread.set(message.thread_id, message);
      }
    }

    return normalized.map((thread) => ({
      ...thread,
      last_message: lastMessageByThread.get(thread.id) || null,
    }));
  }

  const threads = [...memoryStore.threads.values()]
    .filter((thread) => thread.user_id === userId)
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  return threads.map((thread) => {
    const messages = getMemoryMessagesForThread(thread.id);
    return {
      ...thread,
      last_message: messages[messages.length - 1] || null,
    };
  });
}

export async function appendConversationMessage({
  threadId,
  userId,
  channel,
  direction,
  role,
  messageType,
  content,
  status = 'sent',
  externalMessageId = null,
  metadata = {},
  telemetry = {},
}) {
  const payload = {
    thread_id: threadId,
    user_id: userId,
    channel,
    direction,
    role,
    message_type: messageType,
    content,
    status,
    external_message_id: externalMessageId,
    metadata,
    provider: telemetry.provider || null,
    model: telemetry.model || null,
    latency_ms: telemetry.latency_ms || null,
    fallback_used: telemetry.fallback_used || false,
    tool_count: telemetry.tool_count || 0,
    error_class: telemetry.error_class || null,
    artifact_recovery: telemetry.artifact_recovery || false,
    updated_at: nowIso(),
  };

  if (await hasConversationTables()) {
    if (externalMessageId) {
      const { data: existing } = await dbSelectSingle('conversation_messages', [
        { op: 'eq', column: 'channel', value: channel },
        { op: 'eq', column: 'external_message_id', value: externalMessageId },
      ]);

      if (existing?.id) return toMessageRecord(existing);
    }

    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .insert({ ...payload, created_at: nowIso() })
      .select('*')
      .single();

    if (error) throw error;

    await touchThread(threadId, {
      last_message_at: data.created_at,
      updated_at: nowIso(),
    });

    return toMessageRecord(data);
  }

  const record = toMessageRecord({
    ...payload,
    id: makeId('msg'),
    created_at: nowIso(),
  });
  memoryStore.messages.set(record.id, record);
  await touchThread(threadId, {
    last_message_at: record.created_at,
    updated_at: nowIso(),
  });
  return record;
}

export async function listMessagesForThread(threadId, { cursor = null, limit = 100 } = {}) {
  if (await hasConversationTables()) {
    let query = supabaseAdmin
      .from('conversation_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (cursor) query = query.gt('created_at', cursor);

    const { data, error } = await query;
    if (error && !isMissingTableError(error)) throw error;
    return (data || []).map(toMessageRecord);
  }

  const messages = getMemoryMessagesForThread(threadId);
  return cursor
    ? messages.filter((message) => message.created_at > cursor).slice(-limit)
    : messages.slice(-limit);
}

export async function markThreadRead(threadId) {
  const patch = {
    unread_count: 0,
    last_read_at: nowIso(),
    updated_at: nowIso(),
  };
  return touchThread(threadId, patch);
}

export async function touchThread(threadId, patch) {
  if (await hasConversationTables()) {
    const { data, error } = await supabaseAdmin
      .from('conversation_threads')
      .update(patch)
      .eq('id', threadId)
      .select('*')
      .maybeSingle();

    if (error && !isMissingTableError(error)) throw error;
    return data ? toThreadRecord(data) : null;
  }

  const existing = memoryStore.threads.get(threadId);
  if (!existing) return null;
  const next = toThreadRecord({ ...existing, ...patch });
  memoryStore.threads.set(threadId, next);
  return next;
}

export async function queueOutboundJob({
  threadId,
  messageId,
  userId,
  channel,
  target,
  payload,
}) {
  const baseRecord = {
    thread_id: threadId,
    message_id: messageId,
    user_id: userId,
    channel,
    target,
    payload,
    status: 'queued',
    attempts: 0,
    next_attempt_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (await hasConversationTables()) {
    const { data, error } = await supabaseAdmin
      .from('outbound_message_jobs')
      .insert(baseRecord)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  const record = { ...baseRecord, id: makeId('job') };
  memoryStore.jobs.set(record.id, record);
  return record;
}

export async function claimDueJobs({ workerId, limit = 10, leaseMs = 30_000 }) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  if (await hasConversationTables()) {
    const nowIsoValue = now.toISOString();
    const { data: candidates, error } = await supabaseAdmin
      .from('outbound_message_jobs')
      .select('*')
      .in('status', ['queued', 'retrying'])
      .lte('next_attempt_at', nowIsoValue)
      .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIsoValue}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error && !isMissingTableError(error)) throw error;

    const claimed = [];

    for (const candidate of candidates || []) {
      const { data: updated } = await supabaseAdmin
        .from('outbound_message_jobs')
        .update({
          status: 'processing',
          lease_owner: workerId,
          lease_expires_at: leaseExpiresAt,
          updated_at: nowIso(),
        })
        .eq('id', candidate.id)
        .in('status', ['queued', 'retrying'])
        .select('*')
        .maybeSingle();

      if (updated?.id) claimed.push(updated);
    }

    return claimed;
  }

  const jobs = [...memoryStore.jobs.values()]
    .filter((job) => ['queued', 'retrying'].includes(job.status))
    .filter((job) => !job.next_attempt_at || new Date(job.next_attempt_at) <= now)
    .filter((job) => !job.lease_expires_at || new Date(job.lease_expires_at) <= now)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, limit)
    .map((job) => {
      const claimed = {
        ...job,
        status: 'processing',
        lease_owner: workerId,
        lease_expires_at: leaseExpiresAt,
        updated_at: nowIso(),
      };
      memoryStore.jobs.set(job.id, claimed);
      return claimed;
    });

  return jobs;
}

export async function completeOutboundJob(jobId, patch = {}) {
  const nextPatch = {
    ...patch,
    status: 'sent',
    updated_at: nowIso(),
    lease_owner: null,
    lease_expires_at: null,
  };

  if (await hasConversationTables()) {
    await supabaseAdmin
      .from('outbound_message_jobs')
      .update(nextPatch)
      .eq('id', jobId);
    return;
  }

  const existing = memoryStore.jobs.get(jobId);
  if (existing) memoryStore.jobs.set(jobId, { ...existing, ...nextPatch });
}

export async function failOutboundJob(jobId, errorMessage, retryable = true) {
  const existing = await getOutboundJob(jobId);
  if (!existing) return;

  const attempts = (existing.attempts || 0) + 1;
  const MAX_ATTEMPTS = 3;
  const isDead = attempts >= MAX_ATTEMPTS;
  const finalStatus = !retryable || isDead ? 'dead' : 'retrying';

  const patch = {
    attempts,
    last_error: errorMessage,
    updated_at: nowIso(),
    lease_owner: null,
    lease_expires_at: null,
    status: finalStatus,
    next_attempt_at: finalStatus === 'retrying'
      ? new Date(Date.now() + Math.min(attempts * 15_000, 5 * 60_000)).toISOString()
      : existing.next_attempt_at,
  };

  if (isDead && retryable) {
    console.warn(`[OutboundJobs] Job ${jobId} movido para dead-letter após ${attempts} tentativas. Último erro: ${errorMessage}`);
  }

  if (await hasConversationTables()) {
    await supabaseAdmin
      .from('outbound_message_jobs')
      .update(patch)
      .eq('id', jobId);
    return;
  }

  memoryStore.jobs.set(jobId, { ...existing, ...patch });
}

export async function getOutboundJob(jobId) {
  if (await hasConversationTables()) {
    const { data, error } = await dbSelectSingle('outbound_message_jobs', [
      { op: 'eq', column: 'id', value: jobId },
    ]);

    if (error && !isMissingTableError(error)) throw error;
    return data || null;
  }

  return memoryStore.jobs.get(jobId) || null;
}

export async function updateMessageTransport(messageId, patch) {
  if (await hasConversationTables()) {
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', messageId)
      .select('*')
      .maybeSingle();

    if (error && !isMissingTableError(error)) throw error;
    return data ? toMessageRecord(data) : null;
  }

  const existing = memoryStore.messages.get(messageId);
  if (!existing) return null;
  const next = toMessageRecord({ ...existing, ...patch, updated_at: nowIso() });
  memoryStore.messages.set(messageId, next);
  return next;
}

export async function updateMessageStatusByExternalId(channel, externalMessageId, status, metadata = {}) {
  const externalId = channel === 'whatsapp' ? externalMessageId : externalMessageId;

  if (await hasConversationTables()) {
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .update({
        status,
        metadata,
        updated_at: nowIso(),
      })
      .eq('channel', channel)
      .eq('external_message_id', externalId)
      .select('*')
      .maybeSingle();

    if (error && !isMissingTableError(error)) throw error;
    return data ? toMessageRecord(data) : null;
  }

  const existing = [...memoryStore.messages.values()].find(
    (message) => message.channel === channel && message.external_message_id === externalId
  );

  if (!existing) return null;

  const next = toMessageRecord({
    ...existing,
    status,
    metadata,
    updated_at: nowIso(),
  });
  memoryStore.messages.set(existing.id, next);
  return next;
}

export async function getThreadMessagesForUser(userId, channel = 'whatsapp') {
  const threads = await listThreadsForUser(userId);
  const thread = threads.find((item) => item.channel === channel) || threads[0];
  if (!thread) return { thread: null, messages: [] };

  const messages = await listMessagesForThread(thread.id);
  return { thread, messages };
}

export function getConversationStoreMode() {
  return dbTablesReady ? 'supabase' : 'memory';
}
