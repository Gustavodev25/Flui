import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// OpenAI client for proactive AI reminders
const nimClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const REMINDER_MODEL_ID = process.env.MODEL_ID || 'meta/llama-3.1-70b-instruct';

// ── Dicas de produtividade ────────────────────────────────────────────────────
const TIPS = [
  "*Dica:* Comece pela tarefa mais difícil — depois tudo flui melhor.",
  "*Dica:* Quebre tarefas grandes em passos menores. Progresso constante > perfeccionismo.",
  "*Dica:* 5 minutos de revisão no fim do dia = manhã seguinte mais produtiva.",
  "*Dica:* Pausar é produtivo. Não queime energia sem necessidade.",
  "*Dica:* Regra dos 3: defina no máximo 3 prioridades por dia.",
  "*Dica:* Se leva menos de 2 minutos, faça agora. Não empilhe.",
  "*Dica:* Agrupe tarefas parecidas — economiza troca de contexto.",
  "*Dica:* Celebre cada tarefa concluída. Reconhecimento próprio é combustível.",
  "*Dica:* Planeje a semana no domingo à noite. Segundas-feiras ficam mais leves.",
  "*Dica:* Diga não para o que não é prioridade. Foco é sobre o que você NÃO faz.",
  "*Dica:* Defina horários específicos para e-mails e mensagens. Multitasking é mito.",
  "*Dica:* Revise suas metas semanalmente. O que não é medido não é gerenciado.",
];

const GREETINGS_MORNING = [
  "Bom dia!", "Bom dia!", "Dia novo, energia nova!",
  "Bom dia! Bora fazer acontecer?", "Bom dia! Preparado pro dia?",
];
const GREETINGS_AFTERNOON = [
  "Boa tarde!", "Como tá indo o dia?", "Passando pra dar um toque",
  "Meio do dia! Como vai?",
];
const GREETINGS_EVENING = [
  "Boa noite!", "Antes de encerrar o dia…", "Passando pra te lembrar",
  "Finalizando o dia!",
];

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

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function humanizeDate(dateStr) {
  const todayISO = getTodayISO();
  const tomorrowISO = getTomorrowISO();

  if (dateStr === todayISO) return 'hoje';
  if (dateStr === tomorrowISO) return 'amanhã';

  // Atrasada
  if (dateStr < todayISO) {
    const spDate = new Date(todayISO + 'T12:00:00-03:00');
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const diffDays = Math.ceil((spDate - target) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'ontem';
    if (diffDays <= 7) return `${diffDays} dias atrás`;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(targetDate);
  const dayNum = targetDate.getDate();
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(targetDate);

  return `${weekday}, ${dayNum} de ${monthName}`;
}

const PRIORITY_EMOJI = { high: '', medium: '', low: '' };

function getGreeting() {
  const hour = getSPHour();
  if (hour < 12) return pickRandom(GREETINGS_MORNING);
  if (hour < 18) return pickRandom(GREETINGS_AFTERNOON);
  return pickRandom(GREETINGS_EVENING);
}

// ── Dados do usuário ──────────────────────────────────────────────────────────

async function getTasksForUser(userId) {
  const todayISO = getTodayISO();
  const tomorrowISO = getTomorrowISO();

  // Busca próximos 3 dias + atrasadas
  const threeDaysLater = new Date(todayISO + 'T12:00:00-03:00');
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);
  const threeDaysISO = threeDaysLater.toISOString().split('T')[0];

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('title, status, priority, due_date, timer_fired, timer_fired_at')
    .eq('user_id', userId)
    .in('status', ['todo', 'doing'])
    .not('due_date', 'is', null)
    .lte('due_date', threeDaysISO)
    .or('timer_at.is.null,timer_fired.eq.true')
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[Reminders] Erro ao buscar tarefas:', error.message);
    return { overdue: [], today: [], tomorrow: [], upcoming: [], recentlyFiredCount: 0 };
  }

  // Filtra tarefas cujo timer disparou nas últimas 12h — já foram notificadas, não repetir
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  function isRecentlyFired(task) {
    if (!task.timer_fired || !task.timer_fired_at) return false;
    return new Date(task.timer_fired_at) >= twelveHoursAgo;
  }

  const overdue = [];
  const today = [];
  const tomorrow = [];
  const upcoming = [];

  for (const task of (tasks || [])) {
    if (task.due_date < todayISO) overdue.push(task);
    else if (task.due_date === todayISO) today.push(task);
    else if (task.due_date === tomorrowISO) tomorrow.push(task);
    else upcoming.push(task);
  }

  const todayFiltered = today.filter(t => !isRecentlyFired(t));
  const overdueFiltered = overdue.filter(t => !isRecentlyFired(t));
  const recentlyFiredCount = (today.length - todayFiltered.length) + (overdue.length - overdueFiltered.length);

  return { overdue: overdueFiltered, today: todayFiltered, tomorrow, upcoming, recentlyFiredCount };
}

async function getProductivityStats(userId) {
  const todayISO = getTodayISO();

  // Tarefas concluídas nos últimos 7 dias
  const weekAgo = new Date(todayISO + 'T12:00:00-03:00');
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoISO = weekAgo.toISOString();

  const { data: recentDone } = await supabase
    .from('tasks')
    .select('updated_at')
    .eq('user_id', userId)
    .eq('status', 'done')
    .gte('updated_at', weekAgoISO);

  const doneThisWeek = (recentDone || []).length;

  // Streak: dias consecutivos com conclusão
  const doneDates = new Set();
  for (const t of (recentDone || [])) {
    if (t.updated_at) doneDates.add(t.updated_at.split('T')[0]);
  }

  let streak = 0;
  const checkDate = new Date(todayISO + 'T12:00:00-03:00');
  while (true) {
    const d = checkDate.toISOString().split('T')[0];
    if (doneDates.has(d)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Total geral
  const { count: totalPending } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['todo', 'doing']);

  return {
    doneThisWeek,
    streak,
    totalPending: totalPending || 0,
  };
}

// ── Mensagens ─────────────────────────────────────────────────────────────────

async function buildReminderMessage(userId, userName, period) {
  const { overdue, today, tomorrow, upcoming, recentlyFiredCount } = await getTasksForUser(userId);
  const stats = await getProductivityStats(userId);

  // Busca também tarefas sem prazo para dar contexto extra à IA
  // Exclui tarefas com timer ativo (timer_at definido e ainda não disparado)
  // — essas já terão sua própria notificação quando o timer expirar
  const { data: noDueRaw } = await supabase
    .from('tasks')
    .select('title, status, priority, description, timer_fired, timer_fired_at')
    .eq('user_id', userId)
    .in('status', ['todo', 'doing'])
    .is('due_date', null)
    .or('timer_at.is.null,timer_fired.eq.true')
    .limit(5);

  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const noDueTasks = (noDueRaw || []).filter(t => {
    if (!t.timer_fired || !t.timer_fired_at) return true;
    return new Date(t.timer_fired_at) < twelveHoursAgo;
  });

  const totalRelevant = overdue.length + today.length + tomorrow.length + upcoming.length + noDueTasks.length;

  // Se não tem absolutamente nada relevante (ou tudo foi notificado nas últimas 12h), não incomoda
  if (totalRelevant === 0) return null;

  // Monta contexto para a IA
  let taskContext = '';
  if (overdue.length > 0) {
    taskContext += `\nTAREFAS ATRASADAS (${overdue.length}): ${overdue.map(t => `"${t.title}" (prazo: ${t.due_date})`).join(', ')}`;
  }
  if (today.length > 0) {
    taskContext += `\nTAREFAS PRA HOJE (${today.length}): ${today.map(t => `"${t.title}"${t.description ? ` (notas: ${t.description.substring(0, 50)})` : ''}`).join(', ')}`;
  }
  if (tomorrow.length > 0) {
    taskContext += `\nTAREFAS PRA AMANHA (${tomorrow.length}): ${tomorrow.map(t => `"${t.title}"`).join(', ')}`;
  }
  if (noDueTasks && noDueTasks.length > 0) {
    taskContext += `\nTAREFAS SEM PRAZO (${noDueTasks.length}): ${noDueTasks.map(t => `"${t.title}"`).join(', ')}`;
  }

  const hour = getSPHour();
  let greeting = 'Bom dia';
  if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
  else if (hour >= 18) greeting = 'Boa noite';

  const systemPrompt = `Você é um assistente de produtividade inteligente e proativo via WhatsApp. Suas mensagens devem ser úteis, amigáveis e focadas em ajudar o usuário a organizar o dia.

Nome do usuário: ${userName || 'Companheiro(a)'}
Data/Hora: ${getTodayISO()} (SP Time)
Período: ${period} (${greeting})

ESTATÍSTICAS:
- Streak: ${stats.streak} dias
- Pendentes total: ${stats.totalPending}
- Concluídas esta semana: ${stats.doneThisWeek}

CONTEXTO DE TAREFAS:
${taskContext}

REGRAS:
1. Comece com uma saudação natural ("${greeting}, ${userName}!").
2. NÃO use emojis de forma alguma.
3. Seja breve e direto ao ponto (WhatsApp é rápido).
4. Destaque as tarefas ATRASADAS e de HOJE primeiro com senso de urgência amigável.
5. Se o usuário tem um streak bom, elogie brevemente no final.
6. Use "hoje", "amanhã", "ontem" em vez de datas ISO.
7. Termine com uma frase motivadora ou uma oferta de ajuda (ex: "Quer ajuda pra organizar o resto do dia?").
8. NUNCA mostre IDs, links ou JSON.
9. Linguagem natural e brasileira (pt-BR).
10. NUNCA se apresente, liste funcionalidades ou descreva o que você é. Vá direto às tarefas do usuário.${recentlyFiredCount > 0 ? `\n11. Há ${recentlyFiredCount} tarefa(s) que já foram notificadas por timer recentemente (últimas 12h) — NÃO as mencione de novo.` : ''}`;

  try {
    const response = await nimClient.chat.completions.create({
      model: REMINDER_MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Gere o lembrete para ${userName} com base exatamente nas tarefas listadas acima. Seja direto, fale só das tarefas, não se apresente.` }
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('[Reminders] AI Generation Error:', error.message);
    // Fallback básico se a IA falhar
    return `${greeting}${userName ? ` *${userName}*` : ''}! Passando pra te lembrar das tarefas de hoje. Você tem ${today.length} tarefas pendentes. Bora fazer acontecer?`;
  }
}

// ── Resumo semanal (envia segunda de manhã) ──────────────────────────────────

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
  const stats = await getProductivityStats(userId);

  const systemPrompt = `Você é um mentor de produtividade. Gere um "Resumo da Semana" inspirador para o WhatsApp.

Nome: ${userName || 'Companheiro(a)'}
Período: Últimos 7 dias

DADOS DA SEMANA:
- Tarefas concluídas: ${doneCount}
- Tarefas criadas: ${createdCount}
- Pendentes agora: ${pendingCount}
- Streak atual: ${stats.streak} dias
- Exemplo de conquistas: ${doneTasks.map(t => t.title).join(', ')}

REGRAS:
1. Comece com um título chamativo (ex: "Resumo da Semana — João").
2. Liste as estatísticas (criadas, concluídas, pendentes) de forma clara.
3. Mencione as principais conquistas da semana.
4. Adicione um comentário motivacional baseado no desempenho (se mandou bem, elogie; se foi devagar, incentive).
5. NÃO use emojis.
6. Seja breve.
7. Termine convidando o usuário a planejar a próxima semana com você.
8. NUNCA mostre IDs ou dados técnicos.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: REMINDER_MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere o resumo semanal agora.' }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('[Reminders] Weekly Summary AI Error:', error.message);
    return `Olá ${userName}! Aqui está seu resumo da semana: você completou ${doneCount} tarefas. Parabéns pelo esforço! Vamos planejar a próxima?`;
  }
}

// ── Engine principal ──────────────────────────────────────────────────────────

const sentReminders = new Map();

function reminderKey(phone, period) {
  return `${phone}:${period}:${getTodayISO()}`;
}

function alreadySent(phone, period) {
  return sentReminders.has(reminderKey(phone, period));
}

function markSent(phone, period) {
  const key = reminderKey(phone, period);
  sentReminders.set(key, true);

  // Limpa chaves de dias anteriores
  const todayPrefix = getTodayISO();
  for (const k of sentReminders.keys()) {
    if (!k.includes(todayPrefix)) sentReminders.delete(k);
  }
}

/**
 * Horários de lembrete:
 * - morning:   8h–10h (diário)
 * - afternoon: 13h–15h (diário)
 * - evening:   18h–20h (diário)
 * - weekly:    8h–10h de segunda (resumo semanal)
 */
function getCurrentPeriod() {
  const hour = getSPHour();
  const day = getSPDayOfWeek();

  // Segunda de manhã = resumo semanal (tem prioridade sobre morning)
  if (day === 'Mon' && hour >= 8 && hour < 10) return 'weekly';

  if (hour >= 8 && hour < 10) return 'morning';
  if (hour >= 13 && hour < 15) return 'afternoon';
  if (hour >= 18 && hour < 20) return 'evening';
  return null;
}

/**
 * Executa o ciclo de lembretes.
 * Chamado pelo servidor a cada 15 minutos.
 */
export async function runReminderCycle(sessions, sendMessage) {
  const period = getCurrentPeriod();
  if (!period) return;

  console.log(`[Reminders] Verificando lembretes (${period})...`);

  for (const [phone, session] of Object.entries(sessions)) {
    if (!session.authenticated || !session.userId) continue;
    if (alreadySent(phone, period)) continue;

    try {
      // Verificar janela de 24h antes de chamar a IA ou enviar mensagem
      const { data: binding } = await supabase
        .from('channel_bindings')
        .select('last_inbound_at')
        .eq('user_id', session.userId)
        .eq('channel', 'whatsapp')
        .maybeSingle();

      const lastInbound = binding?.last_inbound_at ? new Date(binding.last_inbound_at) : null;
      const windowOpen = lastInbound && (Date.now() - lastInbound.getTime()) < 24 * 60 * 60 * 1000;

      if (!windowOpen) {
        console.log(`[Reminders] Janela 24h fechada — skip ${period} para ${phone}`);
        markSent(phone, period); // marcar como enviado pra não tentar de novo nesse período
        continue;
      }

      let message;

      if (period === 'weekly') {
        message = await buildWeeklySummary(session.userId, session.userName);
      } else {
        message = await buildReminderMessage(session.userId, session.userName, period);
      }

      if (message) {
        console.log(`[Reminders] Enviando ${period} → ${phone}`);
        const sent = await sendMessage(phone, message);
        if (sent) markSent(phone, period);
      } else {
        markSent(phone, period);
      }
    } catch (err) {
      console.error(`[Reminders] Erro ${phone}:`, err.message);
    }
  }
}

export async function getReminderPreview(userId, userName = 'você') {
  const period = getCurrentPeriod() || 'manual';
  if (period === 'weekly') {
    return buildWeeklySummary(userId, userName);
  }
  return buildReminderMessage(userId, userName, period);
}
