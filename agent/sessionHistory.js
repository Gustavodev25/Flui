import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { sanitizeChatMessagesForInput } from './chatMessageSanitizer.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Janela deslizante: quantas mensagens de conversa manter por sessão.
// O system prompt é gerado dinamicamente e nunca é persistido.
const MAX_MESSAGES = 20;

/**
 * Recupera o histórico de conversa da sessão a partir do Supabase.
 * Retorna um array de mensagens prontas para ser passadas à API (sem o system prompt).
 *
 * @param {string} sessionId - Número de WhatsApp usado como chave da sessão.
 * @returns {Promise<Array>}
 */
export async function getHistory(sessionId) {
  const { data, error } = await supabase
    .from('agent_sessions')
    .select('messages')
    .eq('session_id', sessionId)
    .single();

  if (error || !data) return [];

  return sanitizeChatMessagesForInput(data.messages);
}

/**
 * Persiste o histórico no Supabase aplicando Sliding Window.
 *
 * Algoritmo:
 * 1. Descarta mensagens com role 'system' (são geradas a cada chamada).
 * 2. Se o total de mensagens restantes > MAX_MESSAGES, remove as mais antigas
 *    do início do array, preservando sempre as mais recentes.
 * 3. Faz upsert na tabela agent_sessions.
 *
 * @param {string} sessionId
 * @param {Array}  messages - Array completo de mensagens (pode conter system).
 */
/**
 * Detecta mensagens com conteúdo corrompido (artefatos internos do modelo).
 * Exemplos: "<｜tool▁sep｜>", "<｜tool▁call▁end｜>", etc. — vazamentos do DeepSeek.
 */
function isMalformed(msg) {
  if (typeof msg.content === 'string') {
    if (msg.content.includes('<｜tool') || msg.content.includes('tool▁')) return true;
    if (msg.content.includes('<tool_call>') || msg.content.includes('</tool_call>')) return true;
  }
  return false;
}

export async function saveHistory(sessionId, messages) {
  // Filtra system prompt — ele é reconstruído a cada turno
  const conversation = sanitizeChatMessagesForInput(
    messages.filter(m => m.role !== 'system')
  );

  // Remove mensagens corrompidas e os tool results órfãos correspondentes
  const orphanedToolIds = new Set();
  const sanitized = [];
  for (const msg of conversation) {
    if (isMalformed(msg)) {
      // Coleta os tool_call_ids para remover os resultados órfãos junto
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls.forEach(tc => orphanedToolIds.add(tc.id));
      }
      console.warn('[sessionHistory] Mensagem corrompida removida do histórico:', msg.content?.slice(0, 60));
      continue;
    }
    // Remove tool results cujo assistente foi descartado
    if (msg.role === 'tool' && orphanedToolIds.has(msg.tool_call_id)) {
      continue;
    }
    sanitized.push(msg);
  }

  // Sliding window: mantém apenas as N mensagens mais recentes
  const trimmed =
    sanitized.length > MAX_MESSAGES
      ? sanitized.slice(sanitized.length - MAX_MESSAGES)
      : sanitized;
  const cleanTrimmed = sanitizeChatMessagesForInput(trimmed);

  const { error } = await supabase
    .from('agent_sessions')
    .upsert(
      {
        session_id: sessionId,
        messages: cleanTrimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    );

  if (error) {
    console.error('[sessionHistory] Erro ao salvar histórico:', error.message);
  }
}

/**
 * Apaga o histórico de uma sessão (usado no logout ou re-autenticação).
 *
 * @param {string} sessionId
 */
export async function clearHistory(sessionId) {
  await supabase
    .from('agent_sessions')
    .delete()
    .eq('session_id', sessionId);
}
