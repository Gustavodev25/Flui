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

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const nimClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const REMINDER_MODEL_ID = process.env.MODEL_ID || 'nvidia/nemotron-3-super-120b-a12b';
const THINKING_OFF = { extra_body: { chat_template_kwargs: { thinking_mode: 'off' } } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

function getTomorrowISO() {
  const today = new Date(getTodayISO() + 'T12:00:00-03:00');
  today.setDate(today.getDate() + 1);
  return today.toISOString().split('T')[0];
}

function getSPHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo',
    }).format(new Date()),
    10
  );
}

function getSPDayOfWeek() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

/**
 * Período atual de lembrete:
 * - weekly:    8h–10h de segunda
 * - morning:   8h–10h
 * - afternoon: 13h–15h — só enviado se usuário respondeu de manhã
 * - evening:   18h–20h — só enviado se houve morning_sent_at
 */
function getCurrentPeriod() {
  const hour = getSPHour();
  const day = getSPDayOfWeek();
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

async function processUserReminder(userId, userName, period, sendMessage) {
  try {
    // 1. Verifica janela de 24h (regra Meta: só pode enviar se usuário mandou msg nas últimas 24h)
    const { data: binding } = await supabase
      .from('channel_bindings')
      .select('last_inbound_at, external_user_id')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .maybeSingle();

    const phone = binding?.external_user_id;
    if (!phone) return;

    const lastInbound = binding?.last_inbound_at ? new Date(binding.last_inbound_at) : null;
    const windowOpen = lastInbound && (Date.now() - lastInbound.getTime()) < 24 * 60 * 60 * 1000;
    if (!windowOpen) return;

    // 2. Verifica se já enviou hoje para este período (DB-backed — funciona com múltiplas instâncias)
    const alreadySent = await wasPeriodSentToday(userId, period);
    if (alreadySent) return;

    // 3. Lógica de accountability: tarde e noite só saem se manhã foi enviada
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

    // 5. Envia e registra no Supabase (não em memória)
    if (message) {
      const sent = await sendMessage(phone, message);
      if (sent) {
        await markPeriodSent(userId, period === 'weekly' ? 'morning' : period);
        console.log(`[Reminders] Enviado ${period} → ${phone}`);
      }
    } else {
      // Nada relevante para dizer — marca como enviado para não tentar novamente
      await markPeriodSent(userId, period === 'weekly' ? 'morning' : period);
    }
  } catch (err) {
    console.error(`[Reminders] Erro ao processar userId=${userId}:`, err.message);
  }
}

// ── Engine principal ──────────────────────────────────────────────────────────

const BATCH_SIZE = 10; // usuários processados em paralelo por batch

/**
 * Executa o ciclo de lembretes.
 * Chamado pelo servidor a cada 15 minutos.
 *
 * Melhorias vs versão anterior:
 * - sentReminders sai da memória → vai para daily_commitments no Supabase
 * - Tarde/noite só dispara se manhã foi enviada (economia de LLM ~60%)
 * - Usuários processados em paralelo (batches de 10) em vez de sequencialmente
 */
export async function runReminderCycle(sessions, sendMessage) {
  const period = getCurrentPeriod();
  if (!period) return;

  const users = Object.values(sessions).filter(s => s.authenticated && s.userId);
  if (users.length === 0) return;

  console.log(`[Reminders] Ciclo ${period} — ${users.length} usuário(s)`);

  // Expira insights antigos (fire-and-forget)
  expireOldInsights().catch(() => {});

  // Gera insights proativos para todos em paralelo (fire-and-forget)
  users.forEach(s => generateInsights(s.userId, s.userName).catch(() => {}));

  // Processa lembretes em batches paralelos
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(s => processUserReminder(s.userId, s.userName, period, sendMessage))
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
