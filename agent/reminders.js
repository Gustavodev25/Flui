import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  buildMorningMessage,
  buildAfternoonCheckIn,
  buildEveningSummary,
  getTodayCommitment,
  markPeriodSent,
  wasPeriodSentToday,
} from './accountabilityLoop.js';
import { generateInsights, expireOldInsights } from './proactiveIntelligence.js';
import { PRIMARY_MODEL_ID } from './llmClient.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const nimClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const REMINDER_MODEL_ID = process.env.REMINDER_MODEL_ID || PRIMARY_MODEL_ID;
const THINKING_OFF = { extra_body: { chat_template_kwargs: { thinking_mode: 'off' } } };

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_TZ = 'America/Sao_Paulo';

function getTodayISO(tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: tz,
  }).format(new Date());
}

function getTomorrowISO(tz = DEFAULT_TZ) {
  const today = new Date(getTodayISO(tz) + 'T12:00:00Z');
  today.setDate(today.getDate() + 1);
  return today.toISOString().split('T')[0];
}

function getUserHour(tz = DEFAULT_TZ) {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: tz,
    }).format(new Date()),
    10
  );
}

function getUserDayOfWeek(tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', timeZone: tz,
  }).format(new Date());
}

// Retorna o período de lembrete ativo para o timezone do usuário (ou null se fora da janela).
function getCurrentPeriodForUser(tz = DEFAULT_TZ) {
  const hour = getUserHour(tz);
  const day = getUserDayOfWeek(tz);
  if (day === 'Mon' && hour >= 8 && hour < 10) return 'weekly';
  if (hour >= 8 && hour < 10) return 'morning';
  if (hour >= 13 && hour < 15) return 'afternoon';
  if (hour >= 18 && hour < 20) return 'evening';
  return null;
}

// ── Resumo semanal (segunda de manhã) ────────────────────────────────────────

async function buildWeeklySummary(userId, userName) {
  const todayISO = getTodayISO();
  const weekAgo = new Date(todayISO + 'T12:00:00-03:00');
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoISO = weekAgo.toISOString();

  const [doneResult, createdResult, pendingResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('title')
      .eq('user_id', userId)
      .eq('status', 'done')
      .gte('updated_at', weekAgoISO),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', weekAgoISO),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['todo', 'doing']),
  ]);

  const doneCount = (doneResult.data || []).length;
  const createdCount = createdResult.count || 0;
  const pendingCount = pendingResult.count || 0;
  const doneTasks = (doneResult.data || []).slice(0, 10);

  const systemPrompt = `Você é um mentor de produtividade. Gere um "Resumo da Semana" inspirador para o WhatsApp.

Nome: ${userName}
Período: Últimos 7 dias

DADOS DA SEMANA:
- Tarefas concluídas: ${doneCount}
- Tarefas criadas: ${createdCount}
- Pendentes agora: ${pendingCount}
- Conquistas: ${doneTasks.map(t => t.title).join(', ') || 'Nenhuma'}

REGRAS:
1. Comece com título chamativo (ex: "Resumo da Semana — João").
2. Liste estatísticas de forma clara.
3. Comente o desempenho genuinamente (elogie se foi bem, incentive se foi devagar).
4. NÃO use emojis. Seja breve.
5. Convide o usuário a planejar a próxima semana com você.
6. NUNCA mostre IDs ou dados técnicos.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: REMINDER_MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere o resumo semanal agora.' },
      ],
      temperature: 0.7,
      max_tokens: 500,
      ...THINKING_OFF,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[Reminders] Weekly Summary error:', err.message);
    return `Olá ${userName}! Aqui está seu resumo da semana: você completou ${doneCount} tarefas. Parabéns pelo esforço! Vamos planejar a próxima?`;
  }
}

// ── Processa um único usuário ─────────────────────────────────────────────────
// phone, userId e timezone vêm do binding — sem re-fetch de channel_bindings

async function processUserReminder(userId, userName, phone, timezone, sendMessage) {
  try {
    // 1. Computa período com base no timezone do usuário
    const period = getCurrentPeriodForUser(timezone);
    if (!period) return; // fora da janela para este usuário

    // 2. Verifica se já enviou hoje para este período (DB-backed)
    const alreadySent = await wasPeriodSentToday(userId, period);
    if (alreadySent) return;

    // 3. Tarde e noite só saem se manhã foi enviada
    if (period === 'afternoon' || period === 'evening') {
      const commitment = await getTodayCommitment(userId);
      if (!commitment?.morning_sent_at) return;
    }

    // 4. Gera mensagem conforme período
    let message = null;
    if (period === 'weekly') {
      message = await buildWeeklySummary(userId, userName);
    } else if (period === 'morning') {
      message = await buildMorningMessage(userId, userName);
    } else if (period === 'afternoon') {
      message = await buildAfternoonCheckIn(userId, userName);
    } else if (period === 'evening') {
      message = await buildEveningSummary(userId, userName);
    }

    // 5. Envia e registra no Supabase
    if (message) {
      const sent = await sendMessage(userId, phone, message);
      if (sent) {
        await markPeriodSent(userId, period);
        console.log(`[Reminders] Enviado ${period} → ${phone} (tz=${timezone})`);
      }
    } else {
      await markPeriodSent(userId, period);
    }
  } catch (err) {
    console.error(`[Reminders] Erro ao processar userId=${userId}:`, err.message);
  }
}

// ── Engine principal ──────────────────────────────────────────────────────────

const BATCH_SIZE = 10;

/**
 * Executa o ciclo de lembretes.
 * Chamado pelo servidor a cada 15 minutos.
 *
 * Plano B: busca usuários elegíveis direto no Supabase com filtro de janela 24h
 * (regra Meta) — não depende de sessões WebSocket ativas nem de buildReminderSessions.
 * Elimina o re-fetch de channel_bindings por usuário que existia antes.
 */
export async function runReminderCycle(sendMessage) {
  const windowCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: bindings, error } = await supabase
    .from('channel_bindings')
    .select('user_id, external_user_id, display_name, metadata')
    .eq('channel', 'whatsapp')
    .eq('authenticated', true)
    .gte('last_inbound_at', windowCutoff);

  if (error) {
    console.error('[Reminders] Erro ao buscar bindings:', error.message);
    return;
  }
  if (!bindings?.length) return;

  // Filtra usuários com reminders desativados
  const eligible = bindings.filter(b => b.metadata?.reminders_enabled !== false);
  if (!eligible.length) return;

  console.log(`[Reminders] Ciclo — ${eligible.length} usuário(s) elegíveis`);

  expireOldInsights().catch(() => {});
  eligible.forEach(b => generateInsights(b.user_id, b.display_name || 'você').catch(() => {}));

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(b => processUserReminder(
        b.user_id,
        b.display_name || 'você',
        b.external_user_id,
        b.metadata?.timezone || DEFAULT_TZ,
        sendMessage
      ))
    );
  }
}

export async function getReminderPreview(userId, userName = 'você') {
  const period = getCurrentPeriod() || 'morning';
  if (period === 'weekly') return buildWeeklySummary(userId, userName);
  if (period === 'morning') return buildMorningMessage(userId, userName);
  if (period === 'afternoon') return buildAfternoonCheckIn(userId, userName);
  return buildEveningSummary(userId, userName);
}
