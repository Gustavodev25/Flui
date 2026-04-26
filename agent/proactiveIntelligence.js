import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getProfile } from './behavioralProfile.js';
import { PRIMARY_MODEL_ID } from './llmClient.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const nimClient = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://flui.ia.br', 'X-Title': 'Flui' },
  })
  : null;

const MODEL_ID = process.env.PROACTIVE_MODEL_ID || PRIMARY_MODEL_ID;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

function getSPHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo',
    }).format(new Date()),
    10
  );
}

// ── Detecção de padrões e geração de insights ────────────────────────────────

/**
 * Analisa a situação atual do usuário e gera insights proativos.
 * Retorna array de insights pendentes para entrega.
 */
export async function generateInsights(userId, userName) {
  try {
    const profile = await getProfile(userId);
    const todayISO = getTodayISO();

    // Busca contexto das tarefas
    const [tasksResult, recentDoneResult, rescheduleResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, created_at, updated_at, tags')
        .eq('user_id', userId)
        .in('status', ['todo', 'doing'])
        .order('due_date', { ascending: true }),
      supabase
        .from('tasks')
        .select('id, title, updated_at')
        .eq('user_id', userId)
        .eq('status', 'done')
        .gte('updated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('updated_at', { ascending: false }),
      supabase
        .from('behavioral_events')
        .select('event_data, occurred_at')
        .eq('user_id', userId)
        .eq('event_type', 'task_rescheduled')
        .gte('occurred_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const tasks = tasksResult.data || [];
    const recentDone = recentDoneResult.data || [];
    const reschedules = rescheduleResult.data || [];

    const insights = [];

    // ── 1. Detecção de procrastinação ─────────────────────────────────────
    const procrastinationInsight = detectProcrastination(tasks, reschedules, userName);
    if (procrastinationInsight) insights.push(procrastinationInsight);

    // ── 2. Alerta de sobrecarga ───────────────────────────────────────────
    const overloadInsight = detectOverload(tasks, profile, userName, todayISO);
    if (overloadInsight) insights.push(overloadInsight);

    // ── 3. Momentum / streak ──────────────────────────────────────────────
    const momentumInsight = detectMomentum(recentDone, profile, userName);
    if (momentumInsight) insights.push(momentumInsight);

    // ── 4. Sugestão de reorganização ──────────────────────────────────────
    const reorgInsight = suggestReorganization(tasks, profile, userName, todayISO);
    if (reorgInsight) insights.push(reorgInsight);

    // ── 5. Observação de padrão ───────────────────────────────────────────
    const patternInsight = observePattern(profile, tasks, userName);
    if (patternInsight) insights.push(patternInsight);

    // Salva insights gerados (evita duplicatas do mesmo tipo nas últimas 12h)
    const savedInsights = [];
    for (const insight of insights) {
      const isDuplicate = await checkDuplicateInsight(userId, insight.insight_type, 12);
      if (!isDuplicate) {
        const { data } = await supabase
          .from('proactive_insights')
          .insert({
            user_id: userId,
            ...insight,
            status: 'pending',
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          })
          .select('*')
          .single();
        if (data) savedInsights.push(data);
      }
    }

    return savedInsights;
  } catch (err) {
    console.error('[ProactiveIntelligence] Erro ao gerar insights:', err.message);
    return [];
  }
}

/**
 * Busca insights pendentes para um usuário (para incluir no lembrete ou resposta).
 */
export async function getPendingInsights(userId, limit = 2) {
  try {
    const { data } = await supabase
      .from('proactive_insights')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    return data || [];
  } catch {
    return [];
  }
}

/**
 * Marca insight como entregue.
 */
export async function markInsightDelivered(insightId) {
  await supabase
    .from('proactive_insights')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', insightId);
}

/**
 * Gera mensagem proativa inteligente combinando insights + contexto comportamental.
 * Substituição direta do buildReminderMessage padrão quando há insights.
 */
export async function buildSmartProactiveMessage(userId, userName, period) {
  const profile = await getProfile(userId);
  const insights = await getPendingInsights(userId, 2);
  const todayISO = getTodayISO();

  // Busca tarefas relevantes
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, status, priority, due_date')
    .eq('user_id', userId)
    .in('status', ['todo', 'doing'])
    .not('due_date', 'is', null)
    .lte('due_date', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('due_date', { ascending: true })
    .limit(8);

  const pendingTasks = tasks || [];

  // Busca stats rápidas
  const { data: recentDone } = await supabase
    .from('tasks')
    .select('updated_at')
    .eq('user_id', userId)
    .eq('status', 'done')
    .gte('updated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const doneThisWeek = (recentDone || []).length;

  // Calcula streak atual
  const doneDates = new Set((recentDone || []).map(t => t.updated_at?.split('T')[0]).filter(Boolean));
  let streak = 0;
  const checkDate = new Date(todayISO + 'T12:00:00-03:00');
  while (doneDates.has(checkDate.toISOString().split('T')[0])) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Se não há tarefas nem insights, não incomoda
  if (pendingTasks.length === 0 && insights.length === 0) return null;

  // Monta contexto para IA
  const hour = getSPHour();
  let greeting = 'Bom dia';
  if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
  else if (hour >= 18) greeting = 'Boa noite';

  let insightContext = '';
  if (insights.length > 0) {
    insightContext = '\n\nINSIGHTS PROATIVOS PARA INCLUIR NA MENSAGEM:\n';
    for (const ins of insights) {
      insightContext += `- [${ins.insight_type}] ${ins.content}\n`;
    }
    insightContext += '\nINCLUA pelo menos 1 desses insights de forma NATURAL na mensagem. Não liste como tópicos — integre na conversa.';
  }

  let profileContext = '';
  if (profile) {
    profileContext = `\n\nPERFIL COMPORTAMENTAL:`;
    if (profile.communication_style === 'concise') {
      profileContext += '\n- Usuario prefere mensagens CURTAS e diretas. Max 2-3 frases.';
    } else if (profile.communication_style === 'detailed') {
      profileContext += '\n- Usuario aceita detalhes, mas entregue a ideia principal primeiro e mantenha curto.';
    }
    if (profile.action_triggers?.includes('streak') && streak > 0) {
      profileContext += `\n- MOTIVADOR: Usuario responde bem a streak! Streak atual: ${streak} dias.`;
    }
    if (profile.action_triggers?.includes('urgency')) {
      profileContext += '\n- MOTIVADOR: Usuario age melhor com senso de urgência gentil.';
    }
    if (profile.action_triggers?.includes('small_wins')) {
      profileContext += '\n- MOTIVADOR: Usuario gosta de celebrar pequenas conquistas.';
    }
    if (profile.action_triggers?.includes('progress')) {
      profileContext += `\n- MOTIVADOR: Mostre progresso! Concluiu ${doneThisWeek} esta semana.`;
    }
  }

  const overdue = pendingTasks.filter(t => t.due_date < todayISO);
  const today = pendingTasks.filter(t => t.due_date === todayISO);
  const upcoming = pendingTasks.filter(t => t.due_date > todayISO);

  // Tarefa principal: a mais urgente
  const allSorted = [...overdue, ...today, ...upcoming];
  const mainTask = allSorted[0] || null;
  const othersCount = Math.max(0, allSorted.length - 1);

  const mainTaskContext = mainTask
    ? `\nTAREFA PRINCIPAL (mencione só esta): "${mainTask.title}"${mainTask.due_date < todayISO ? ' — atrasada' : mainTask.due_date === todayISO ? ' — pra hoje' : ' — próximos dias'}`
    : '\nNenhuma tarefa próxima.';

  const othersContext = othersCount > 0
    ? `\nOUTRAS TAREFAS: ${othersCount} (não liste — mencione só a quantidade se relevante)`
    : '';

  const systemPrompt = `Voce e um assistente de produtividade inteligente e PROATIVO via WhatsApp. Voce CONHECE este usuario — seus padroes, seus pontos fortes e fracos.

Nome: ${userName || 'Companheiro(a)'}
Data: ${todayISO} | Periodo: ${period} (${greeting})
Streak atual: ${streak} dias | Concluidas esta semana: ${doneThisWeek}
${mainTaskContext}${othersContext}
${profileContext}${insightContext}

REGRAS — SIGA À RISCA:
1. Comece com saudacao natural ("${greeting}, ${userName}!").
2. NAO use emojis.
3. Seja breve — maximo 3 frases (WhatsApp).
4. Se tem tarefa principal, mencione APENAS ela pelo nome. NUNCA liste multiplas tarefas.
5. Se ha outras tarefas alem da principal, mencione so a quantidade e pergunte se quer ver: "voce tem mais X coisas, quer ver?"
6. Integre o insight de forma NATURAL — como se voce tivesse percebido algo sobre o usuario.
7. Se tem streak ou progresso bom, RECONHECA genuinamente mas em poucas palavras.
8. Se detectou procrastinacao, aborde com carinho — nunca julgue.
9. Use "hoje", "amanha" em vez de datas ISO.
10. NUNCA se apresente ou liste funcionalidades.
11. Tom: como um amigo inteligente que te conhece bem, mandando mensagem rapida.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Gere a mensagem proativa para ${userName}. Integre os insights naturalmente.` },
      ],
      temperature: 0.75,
      max_tokens: 400,
    });

    const message = response.choices?.[0]?.message?.content?.trim();

    // Marca insights como entregues
    for (const ins of insights) {
      await markInsightDelivered(ins.id);
    }

    return message || null;
  } catch (error) {
    console.error('[ProactiveIntelligence] AI Error:', error.message);
    return null;
  }
}

// ── Detectores de padrões ────────────────────────────────────────────────────

function detectProcrastination(tasks, reschedules, userName) {
  // Identifica tarefas que foram adiadas 3+ vezes
  const rescheduleCount = new Map();
  for (const ev of reschedules) {
    const taskId = ev.event_data?.task_id;
    if (taskId) rescheduleCount.set(taskId, (rescheduleCount.get(taskId) || 0) + 1);
  }

  const chronic = [...rescheduleCount.entries()]
    .filter(([, count]) => count >= 3)
    .map(([taskId]) => taskId);

  if (chronic.length === 0) {
    // Verifica tarefas overdue há mais de 5 dias
    const todayISO = getTodayISO();
    const stuckTasks = tasks.filter(t => {
      if (!t.due_date || t.due_date >= todayISO) return false;
      const daysOverdue = Math.ceil(
        (new Date(todayISO) - new Date(t.due_date)) / (1000 * 60 * 60 * 24)
      );
      return daysOverdue >= 5;
    });

    if (stuckTasks.length === 0) return null;

    const taskTitles = stuckTasks.slice(0, 2).map(t => `"${t.title}"`).join(' e ');
    return {
      insight_type: 'procrastination_alert',
      content: `${userName} tem ${stuckTasks.length} tarefa(s) atrasada(s) ha mais de 5 dias (${taskTitles}). Sugira quebrar em passos menores ou redefinir o prazo.`,
      priority: 'high',
      context: { task_ids: stuckTasks.map(t => t.id), days_overdue: 5 },
    };
  }

  const affectedTasks = tasks.filter(t => chronic.includes(t.id));
  const titles = affectedTasks.slice(0, 2).map(t => `"${t.title}"`).join(' e ');

  return {
    insight_type: 'procrastination_alert',
    content: `${userName} adiou ${titles} pelo menos 3 vezes. Sugira uma abordagem diferente: quebrar em micro-tarefas, mudar o horario, ou reavaliar se ainda faz sentido.`,
    priority: 'high',
    context: { task_ids: chronic, reschedule_count: chronic.length },
  };
}

function detectOverload(tasks, profile, userName, todayISO) {
  // Verifica se amanhã está muito pesado
  const tomorrow = new Date(todayISO + 'T12:00:00-03:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split('T')[0];

  const tomorrowTasks = tasks.filter(t => t.due_date === tomorrowISO);
  const avgDaily = profile?.avg_daily_completions || 2;

  if (tomorrowTasks.length <= avgDaily * 1.3) return null;

  return {
    insight_type: 'overload_warning',
    content: `${userName} tem ${tomorrowTasks.length} tarefas pra amanha, mas historicamente completa ~${Math.round(avgDaily)} por dia. Sugira mover ${tomorrowTasks.length - Math.round(avgDaily)} tarefas pra outro dia.`,
    priority: 'medium',
    context: {
      tomorrow_count: tomorrowTasks.length,
      avg_daily: avgDaily,
      excess: tomorrowTasks.length - Math.round(avgDaily),
    },
  };
}

function detectMomentum(recentDone, profile, userName) {
  if (recentDone.length < 3) return null;

  // Calcula streak atual
  const doneDates = new Set(recentDone.map(t => t.updated_at?.split('T')[0]).filter(Boolean));
  const todayISO = getTodayISO();
  let streak = 0;
  const checkDate = new Date(todayISO + 'T12:00:00-03:00');
  while (doneDates.has(checkDate.toISOString().split('T')[0])) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  const maxStreak = profile?.max_streak || 0;

  // Celebra streak novo recorde
  if (streak >= 5 && streak > maxStreak) {
    return {
      insight_type: 'streak_celebration',
      content: `${userName} bateu um novo recorde: ${streak} dias consecutivos completando tarefas! Celebre essa conquista e incentive a manter.`,
      priority: 'medium',
      context: { streak, previous_max: maxStreak },
    };
  }

  // Momentum alto (muitas conclusões nos últimos 3 dias)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const recentCount = recentDone.filter(t => t.updated_at >= threeDaysAgo).length;

  if (recentCount >= 8) {
    return {
      insight_type: 'momentum_praise',
      content: `${userName} completou ${recentCount} tarefas nos ultimos 3 dias — esta numa sequencia forte! Reconheca o esforco e sugira manter o ritmo.`,
      priority: 'low',
      context: { recent_completions: recentCount, period_days: 3 },
    };
  }

  return null;
}

function suggestReorganization(tasks, profile, userName, todayISO) {
  // Verifica se o dia de hoje está vazio mas amanhã está cheio
  const tomorrow = new Date(todayISO + 'T12:00:00-03:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split('T')[0];

  const todayTasks = tasks.filter(t => t.due_date === todayISO);
  const tomorrowTasks = tasks.filter(t => t.due_date === tomorrowISO);

  if (todayTasks.length <= 1 && tomorrowTasks.length >= 4) {
    return {
      insight_type: 'reorganization_suggestion',
      content: `Hoje esta leve (${todayTasks.length} tarefa) mas amanha esta carregado (${tomorrowTasks.length} tarefas). Sugira adiantar 1-2 tarefas de amanha pra hoje.`,
      priority: 'medium',
      context: { today_count: todayTasks.length, tomorrow_count: tomorrowTasks.length },
    };
  }

  // Verifica conflito: muitas tarefas high priority no mesmo dia
  const highPriorityByDay = new Map();
  for (const t of tasks) {
    if (t.priority === 'high' && t.due_date) {
      const list = highPriorityByDay.get(t.due_date) || [];
      list.push(t);
      highPriorityByDay.set(t.due_date, list);
    }
  }

  for (const [date, dayTasks] of highPriorityByDay) {
    if (dayTasks.length >= 3 && date >= todayISO) {
      return {
        insight_type: 'reorganization_suggestion',
        content: `${userName} tem ${dayTasks.length} tarefas de alta prioridade marcadas pro mesmo dia (${date === todayISO ? 'hoje' : date === tomorrowISO ? 'amanha' : date}). Sugira priorizar as top 2 e mover o resto.`,
        priority: 'high',
        context: { date, high_priority_count: dayTasks.length },
      };
    }
  }

  return null;
}

function observePattern(profile, tasks, userName) {
  if (!profile) return null;

  const hour = getSPHour();
  const currentPeriod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  // Se é o período de maior energia e tem tarefas difíceis
  const energyPatterns = profile.energy_patterns || {};
  const bestPeriod = Object.entries(energyPatterns).sort((a, b) => b[1] - a[1])[0];

  if (bestPeriod && bestPeriod[0] === currentPeriod && bestPeriod[1] >= 0.6) {
    const hardTasks = tasks.filter(t => t.priority === 'high' && t.status === 'todo');
    if (hardTasks.length > 0) {
      const periodName = { morning: 'manha', afternoon: 'tarde', evening: 'noite' }[currentPeriod];
      return {
        insight_type: 'pattern_observation',
        content: `Agora e o periodo de maior energia de ${userName} (${periodName}). Sugira atacar a tarefa mais dificil: "${hardTasks[0].title}".`,
        priority: 'low',
        context: { period: currentPeriod, energy_score: bestPeriod[1], suggested_task: hardTasks[0].title },
      };
    }
  }

  return null;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

async function checkDuplicateInsight(userId, insightType, hoursWindow) {
  const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('proactive_insights')
    .select('id')
    .eq('user_id', userId)
    .eq('insight_type', insightType)
    .gte('created_at', cutoff)
    .limit(1);

  return (data?.length || 0) > 0;
}

/**
 * Expira insights antigos que não foram entregues.
 */
export async function expireOldInsights() {
  try {
    await supabase
      .from('proactive_insights')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());
  } catch (err) {
    console.error('[ProactiveIntelligence] Erro ao expirar insights:', err.message);
  }
}
