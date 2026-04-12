import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSPHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo',
    }).format(new Date()),
    10
  );
}

function getSPPeriod() {
  const hour = getSPHour();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

// ── Registro de eventos comportamentais ──────────────────────────────────────

export async function trackEvent(userId, eventType, eventData = {}) {
  try {
    await supabase.from('behavioral_events').insert({
      user_id: userId,
      event_type: eventType,
      event_data: {
        ...eventData,
        hour: getSPHour(),
        period: getSPPeriod(),
        day_of_week: new Date().getDay(),
      },
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BehavioralProfile] Erro ao registrar evento:', err.message);
  }
}

// ── Análise e atualização do perfil ──────────────────────────────────────────

/**
 * Analisa os eventos dos últimos 30 dias e atualiza o perfil comportamental.
 * Roda periodicamente (1x por dia ou a cada N interações).
 */
export async function analyzeAndUpdateProfile(userId) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Busca eventos recentes
    const { data: events, error } = await supabase
      .from('behavioral_events')
      .select('event_type, event_data, occurred_at')
      .eq('user_id', userId)
      .gte('occurred_at', thirtyDaysAgo)
      .order('occurred_at', { ascending: true });

    if (error || !events?.length) return null;

    // ── Calcula peak hours ──────────────────────────────────────────────
    const completionsByHour = new Map();
    const completionEvents = events.filter(e => e.event_type === 'task_completed');

    for (const ev of completionEvents) {
      const hour = ev.event_data?.hour ?? new Date(ev.occurred_at).getHours();
      completionsByHour.set(hour, (completionsByHour.get(hour) || 0) + 1);
    }

    const peakHours = [...completionsByHour.entries()]
      .map(([hour, completions]) => ({ hour, completions }))
      .sort((a, b) => b.completions - a.completions)
      .slice(0, 5);

    // ── Calcula energy patterns por período ─────────────────────────────
    const tasksByPeriod = { morning: 0, afternoon: 0, evening: 0 };
    const totalByPeriod = { morning: 0, afternoon: 0, evening: 0 };

    for (const ev of events) {
      const period = ev.event_data?.period;
      if (!period || !totalByPeriod.hasOwnProperty(period)) continue;

      if (ev.event_type === 'task_completed') tasksByPeriod[period]++;
      if (['task_completed', 'task_created', 'message_sent'].includes(ev.event_type)) {
        totalByPeriod[period]++;
      }
    }

    const energyPatterns = {};
    for (const period of ['morning', 'afternoon', 'evening']) {
      const total = totalByPeriod[period];
      energyPatterns[period] = total > 0
        ? Math.min(1, tasksByPeriod[period] / Math.max(total * 0.3, 1))
        : 0;
    }

    // ── Dias mais produtivos ────────────────────────────────────────────
    const completionsByDay = new Map();
    const activityByDay = new Map();

    for (const ev of completionEvents) {
      const day = ev.event_data?.day_of_week ?? new Date(ev.occurred_at).getDay();
      completionsByDay.set(day, (completionsByDay.get(day) || 0) + 1);
    }

    for (const ev of events) {
      const day = ev.event_data?.day_of_week ?? new Date(ev.occurred_at).getDay();
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    }

    const productiveDays = [...completionsByDay.entries()]
      .map(([day, count]) => ({
        day,
        rate: Math.min(1, count / Math.max(activityByDay.get(day) * 0.3 || 1, 1)),
      }))
      .sort((a, b) => b.rate - a.rate);

    // ── Taxa média de conclusão diária ──────────────────────────────────
    const uniqueDays = new Set(
      completionEvents.map(e => e.occurred_at.split('T')[0])
    );
    const avgDailyCompletions = uniqueDays.size > 0
      ? completionEvents.length / uniqueDays.size
      : 0;

    // ── Padrões de procrastinação ───────────────────────────────────────
    const rescheduleEvents = events.filter(e => e.event_type === 'task_rescheduled');
    const overdueEvents = events.filter(e => e.event_type === 'task_overdue');

    const procrastinationPatterns = {
      avg_reschedules: rescheduleEvents.length / Math.max(completionEvents.length, 1),
      total_reschedules_30d: rescheduleEvents.length,
      total_overdue_30d: overdueEvents.length,
      common_postpone_days: calculateCommonPostponeDays(rescheduleEvents),
    };

    // ── Estilo de comunicação ───────────────────────────────────────────
    const messageEvents = events.filter(e => e.event_type === 'message_sent');
    const avgMessageLength = messageEvents.length > 0
      ? messageEvents.reduce((sum, e) => sum + (e.event_data?.message_length || 0), 0) / messageEvents.length
      : 50;

    let communicationStyle = 'balanced';
    if (avgMessageLength < 30) communicationStyle = 'concise';
    else if (avgMessageLength > 80) communicationStyle = 'detailed';

    // ── Tempo médio de resposta ─────────────────────────────────────────
    const responseEvents = events.filter(e => e.event_type === 'message_response');
    const avgResponseTime = responseEvents.length > 0
      ? responseEvents.reduce((sum, e) => sum + (e.event_data?.response_time_ms || 0), 0)
        / responseEvents.length / 60000
      : null;

    // ── Gatilhos de ação ────────────────────────────────────────────────
    const actionTriggers = detectActionTriggers(events, completionEvents);

    // ── Horários preferidos de lembrete ──────────────────────────────────
    const engagedReminders = events.filter(e => e.event_type === 'reminder_engaged');
    const preferredReminderHours = detectPreferredReminderHours(engagedReminders);

    // ── Streak máximo ───────────────────────────────────────────────────
    const maxStreak = calculateMaxStreak(completionEvents);

    // ── Cadência ideal ──────────────────────────────────────────────────
    const idealCadence = calculateIdealCadence(events);

    // ── Persiste o perfil ───────────────────────────────────────────────
    const profile = {
      user_id: userId,
      peak_hours: peakHours,
      energy_patterns: energyPatterns,
      communication_style: communicationStyle,
      ideal_cadence_minutes: idealCadence,
      avg_daily_completions: Math.round(avgDailyCompletions * 10) / 10,
      productive_days: productiveDays,
      action_triggers: actionTriggers,
      procrastination_patterns: procrastinationPatterns,
      avg_response_time_minutes: avgResponseTime ? Math.round(avgResponseTime) : null,
      preferred_reminder_hours: preferredReminderHours,
      max_streak: maxStreak,
      last_analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('behavioral_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('behavioral_profiles')
        .update(profile)
        .eq('user_id', userId);
    } else {
      await supabase
        .from('behavioral_profiles')
        .insert({ ...profile, created_at: new Date().toISOString() });
    }

    console.log(`[BehavioralProfile] Perfil atualizado para ${userId}`);
    return profile;
  } catch (err) {
    console.error('[BehavioralProfile] Erro na análise:', err.message);
    return null;
  }
}

// ── Busca o perfil do usuário ────────────────────────────────────────────────

export async function getProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('behavioral_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Retorna um resumo textual do perfil para inclusão no system prompt.
 */
export async function getProfileContext(userId) {
  const profile = await getProfile(userId);
  if (!profile) return '';

  const lines = [];
  lines.push('═══ PERFIL COMPORTAMENTAL DO USUARIO ═══');

  // Horários de pico
  if (profile.peak_hours?.length > 0) {
    const top3 = profile.peak_hours.slice(0, 3);
    const hoursStr = top3.map(h => `${h.hour}h`).join(', ');
    lines.push(`Horarios mais produtivos: ${hoursStr}`);
  }

  // Energia por período
  if (profile.energy_patterns) {
    const ep = profile.energy_patterns;
    const best = Object.entries(ep).sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const periodNames = { morning: 'manha', afternoon: 'tarde', evening: 'noite' };
      lines.push(`Periodo de maior energia: ${periodNames[best[0]]} (${Math.round(best[1] * 100)}% de eficiencia)`);
    }
  }

  // Taxa diária
  if (profile.avg_daily_completions > 0) {
    lines.push(`Media de conclusoes por dia: ${profile.avg_daily_completions}`);
  }

  // Dias mais produtivos
  if (profile.productive_days?.length > 0) {
    const dayNames = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
    const top2 = profile.productive_days.slice(0, 2);
    lines.push(`Dias mais produtivos: ${top2.map(d => dayNames[d.day]).join(', ')}`);
  }

  // Estilo de comunicação
  const styleMap = { concise: 'direto e breve', detailed: 'detalhado', balanced: 'equilibrado' };
  lines.push(`Estilo de comunicacao: ${styleMap[profile.communication_style] || 'equilibrado'}`);

  // Procrastinação
  if (profile.procrastination_patterns?.avg_reschedules > 0.5) {
    lines.push(`Tendencia a adiar: ${Math.round(profile.procrastination_patterns.avg_reschedules * 100)}% das tarefas sao reagendadas`);
  }

  // Gatilhos
  if (profile.action_triggers?.length > 0) {
    const triggerNames = {
      urgency: 'urgencia/deadline',
      streak: 'manter sequencia',
      progress: 'ver progresso',
      small_wins: 'pequenas vitorias',
      accountability: 'compromisso social',
    };
    const triggers = profile.action_triggers
      .map(t => triggerNames[t] || t)
      .join(', ');
    lines.push(`O que motiva este usuario: ${triggers}`);
  }

  // Streak
  if (profile.max_streak > 3) {
    lines.push(`Recorde de streak: ${profile.max_streak} dias consecutivos`);
  }

  lines.push('');
  lines.push('COMO USAR ESSE PERFIL:');
  lines.push('- Adapte seu tom ao estilo de comunicacao do usuario');
  lines.push('- Mencione progresso/streak se "streak" ou "progress" sao gatilhos');
  lines.push('- Sugira tarefas nos horarios de pico quando relevante');
  lines.push('- Se o usuario tende a adiar, seja gentilmente proativo sobre prazos');
  lines.push('- Respeite a cadencia ideal — nao bombardeie com mensagens');

  return lines.join('\n');
}

// ── Funções auxiliares internas ──────────────────────────────────────────────

function calculateCommonPostponeDays(rescheduleEvents) {
  if (rescheduleEvents.length === 0) return 0;
  const delays = rescheduleEvents
    .map(e => e.event_data?.postpone_days || 0)
    .filter(d => d > 0);
  if (delays.length === 0) return 0;
  return Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
}

function detectActionTriggers(allEvents, completionEvents) {
  const triggers = [];

  // Se completa mais quando tem deadline próximo → urgency
  const urgentCompletions = completionEvents.filter(e =>
    e.event_data?.was_overdue || e.event_data?.days_until_due <= 1
  );
  if (urgentCompletions.length > completionEvents.length * 0.4) {
    triggers.push('urgency');
  }

  // Se mantém streaks longos → streak motivation
  const streakDays = new Set(completionEvents.map(e => e.occurred_at.split('T')[0]));
  let maxConsecutive = 0, current = 0;
  const sortedDays = [...streakDays].sort();
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0) { current = 1; continue; }
    const prev = new Date(sortedDays[i - 1]);
    const curr = new Date(sortedDays[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) { current++; maxConsecutive = Math.max(maxConsecutive, current); }
    else { current = 1; }
  }
  if (maxConsecutive >= 5) triggers.push('streak');

  // Se completa várias por dia → small wins
  const completionsPerDay = new Map();
  for (const e of completionEvents) {
    const day = e.occurred_at.split('T')[0];
    completionsPerDay.set(day, (completionsPerDay.get(day) || 0) + 1);
  }
  const avgPerDay = completionsPerDay.size > 0
    ? [...completionsPerDay.values()].reduce((a, b) => a + b, 0) / completionsPerDay.size
    : 0;
  if (avgPerDay >= 3) triggers.push('small_wins');

  // Se responde a lembretes → accountability
  const engagedCount = allEvents.filter(e => e.event_type === 'reminder_engaged').length;
  const totalReminders = allEvents.filter(e =>
    e.event_type === 'reminder_engaged' || e.event_type === 'reminder_ignored'
  ).length;
  if (totalReminders > 3 && engagedCount / totalReminders > 0.6) {
    triggers.push('accountability');
  }

  // Progress é um default quando nenhum outro se destaca
  if (triggers.length === 0 || completionEvents.length > 10) {
    triggers.push('progress');
  }

  return triggers;
}

function detectPreferredReminderHours(engagedReminders) {
  if (engagedReminders.length < 3) return [8, 13, 19]; // default

  const hourCounts = new Map();
  for (const ev of engagedReminders) {
    const hour = ev.event_data?.hour ?? 9;
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  }

  return [...hourCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => hour)
    .sort((a, b) => a - b);
}

function calculateMaxStreak(completionEvents) {
  const days = new Set(completionEvents.map(e => e.occurred_at.split('T')[0]));
  const sorted = [...days].sort();
  let max = 0, current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) { current++; max = Math.max(max, current); }
    else { current = 1; }
  }

  return Math.max(max, current);
}

function calculateIdealCadence(events) {
  const messageEvents = events
    .filter(e => e.event_type === 'message_sent')
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  if (messageEvents.length < 5) return 180; // default 3h

  const gaps = [];
  for (let i = 1; i < messageEvents.length; i++) {
    const gap = (new Date(messageEvents[i].occurred_at) - new Date(messageEvents[i - 1].occurred_at)) / 60000;
    // Ignora gaps enormes (>12h = provavelmente dormiu)
    if (gap > 0 && gap < 720) gaps.push(gap);
  }

  if (gaps.length === 0) return 180;

  // Pega a mediana
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(30, Math.min(360, Math.round(median)));
}

// ── Limpeza de eventos antigos ───────────────────────────────────────────────

export async function cleanOldEvents(daysToKeep = 90) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  try {
    await supabase
      .from('behavioral_events')
      .delete()
      .lt('occurred_at', cutoff);
    console.log('[BehavioralProfile] Eventos antigos limpos');
  } catch (err) {
    console.error('[BehavioralProfile] Erro ao limpar eventos:', err.message);
  }
}
