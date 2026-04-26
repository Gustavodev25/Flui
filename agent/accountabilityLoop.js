import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getProfile } from './behavioralProfile.js';
import { PRIMARY_MODEL_ID } from './llmClient.js';

/*
  SQL migration — rode no Supabase antes de usar este módulo:

  CREATE TABLE IF NOT EXISTS daily_commitments (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       UUID NOT NULL,
    date          DATE NOT NULL,
    committed_tasks TEXT[] DEFAULT '{}',
    morning_sent_at   TIMESTAMPTZ,
    afternoon_sent_at TIMESTAMPTZ,
    evening_sent_at   TIMESTAMPTZ,
    weekly_sent_at    TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
  );

  CREATE INDEX IF NOT EXISTS daily_commitments_user_date
    ON daily_commitments(user_id, date);
*/

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

const MODEL_ID = process.env.REMINDER_MODEL_ID || PRIMARY_MODEL_ID;

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

// ── CRUD daily_commitments ───────────────────────────────────────────────────

export async function getTodayCommitment(userId) {
  try {
    const { data } = await supabase
      .from('daily_commitments')
      .select('*')
      .eq('user_id', userId)
      .eq('date', getTodayISO())
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

export async function upsertTodayCommitment(userId, patch) {
  const today = getTodayISO();
  try {
    const payload = { ...patch, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('daily_commitments')
      .upsert(
        { user_id: userId, date: today, ...payload, created_at: new Date().toISOString() },
        { onConflict: 'user_id,date', ignoreDuplicates: false }
      )
      .select('*')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[AccountabilityLoop] upsert error:', err.message);
    return null;
  }
}

// ── Controle de envio — substituição do Map em memória ───────────────────────

export async function wasPeriodSentToday(userId, period) {
  const commitment = await getTodayCommitment(userId);
  if (!commitment) return false;
  return !!commitment[`${period}_sent_at`];
}

export async function markPeriodSent(userId, period) {
  return upsertTodayCommitment(userId, { [`${period}_sent_at`]: new Date().toISOString() });
}

// ── Detecta compromisso na mensagem do usuário ───────────────────────────────

function normalizeForCommitmentIntent(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function looksLikeDailyCommitment(text) {
  const lower = normalizeForCommitmentIntent(text);
  if (/[?]/.test(text)) return false;
  if (/\b(aniversario|nascimento|nasci|idade|telefone|email|senha|endereco|gosto|prefiro|trabalho|faculdade|curso|moro|familia)\b/.test(lower)) {
    return false;
  }

  const itemCount = text
    .split(/[\n,;]|(?:^|\n)\s*\d+[.)]\s*/)
    .filter(item => item.trim().length > 2)
    .length;
  if (itemCount >= 2) return true;

  return /\b(vou|preciso|quero|tenho\s+que|fechar|terminar|finalizar|fazer|resolver|entregar|ligar|mandar|enviar|estudar|revisar|organizar|preparar|comprar|pagar)\b/.test(lower);
}

export async function detectAndSaveCommitment(userId, messageText) {
  try {
    const commitment = await getTodayCommitment(userId);
    // Só processa se manhã foi enviada e usuário ainda não respondeu
    if (!commitment?.morning_sent_at || commitment?.responded_at) return false;

    const text = messageText.trim();
    if (text.length < 3) return false;
    if (!looksLikeDailyCommitment(text)) return false;

    // Ignora respostas genéricas que não são listas de tarefas
    const generic = ['sim', 'não', 'nao', 'ok', 'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'tudo bem'];
    if (generic.includes(text.toLowerCase())) return false;

    // Extrai itens da mensagem: linhas, vírgulas, listas numeradas
    const rawItems = text.split(/[\n,;]|(?:^|\n)\s*\d+[.)]\s*/);
    const lines = rawItems
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 2 && l.length < 200);

    if (lines.length === 0) return false;

    await upsertTodayCommitment(userId, {
      committed_tasks: lines.slice(0, 5),
      responded_at: new Date().toISOString(),
    });

    console.log(`[AccountabilityLoop] Compromisso salvo para ${userId}: "${lines.join(', ')}"`);
    return true;
  } catch (err) {
    console.error('[AccountabilityLoop] detectAndSave error:', err.message);
    return false;
  }
}

// ── Mensagem de manhã — pede compromisso ─────────────────────────────────────

export async function buildMorningMessage(userId, userName) {
  const profile = await getProfile(userId);
  const todayISO = getTodayISO();

  const [tasksResult, noDueResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('title, status, priority, due_date')
      .eq('user_id', userId)
      .in('status', ['todo', 'doing'])
      .not('due_date', 'is', null)
      .lte('due_date', todayISO)
      .order('due_date', { ascending: true })
      .limit(20),
    supabase
      .from('tasks')
      .select('title, priority')
      .eq('user_id', userId)
      .in('status', ['todo', 'doing'])
      .is('due_date', null)
      .order('priority', { ascending: false })
      .limit(10),
  ]);

  const overdue = (tasksResult.data || []).filter(t => t.due_date < todayISO);
  const today = (tasksResult.data || []).filter(t => t.due_date === todayISO);
  const nodue = noDueResult.data || [];

  const allTasks = [...overdue, ...today, ...nodue];
  if (allTasks.length === 0) return null;

  // Tarefa principal: a mais urgente (atrasada > hoje > sem prazo)
  const mainTask = allTasks[0];
  const othersCount = allTasks.length - 1;

  let concise = profile?.communication_style === 'concise';

  const systemPrompt = `Você é um assistente de produtividade no WhatsApp. Mande uma mensagem curta e NATURAL de bom dia.

Nome: ${userName}
Tarefa principal (a mais urgente): "${mainTask.title}"${mainTask.due_date < todayISO ? ' (atrasada)' : ''}
Outras tarefas: ${othersCount} no total

REGRAS — SIGA À RISCA:
1. Bom dia natural, 1 frase só.
2. Mencione APENAS a tarefa principal pelo nome. Não liste mais nada.
3. Se houver outras tarefas (othersCount > 0), mencione só a quantidade: "você tem mais ${othersCount} coisa${othersCount > 1 ? 's' : ''} pra hoje" e pergunte se quer ver.
4. Se só existe essa 1 tarefa, pergunte se ela consegue fechar hoje.
5. NUNCA use bullets, numeração ou dois pontos para listar tarefas.
6. Máximo ${concise ? '2' : '3'} frases no total. Tom de amigo mandando mensagem rápida.
7. Sem emojis. Sem apresentação.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere a mensagem matinal.' },
      ],
      temperature: 0.7,
      max_tokens: 120,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AccountabilityLoop] morning LLM error:', err.message);
    if (othersCount > 0) {
      return `Bom dia, ${userName}! Tá lembrado de "${mainTask.title}"? Você tem mais ${othersCount} coisa${othersCount > 1 ? 's' : ''} pra hoje também. Quer ver?`;
    }
    return `Bom dia, ${userName}! Você tem "${mainTask.title}" pra fechar hoje. Consegue?`;
  }
}

// ── Check-in da tarde — só envia se houve compromisso ────────────────────────

export async function buildAfternoonCheckIn(userId, userName) {
  const commitment = await getTodayCommitment(userId);

  // Só faz check-in se o usuário respondeu de manhã com compromissos
  if (!commitment?.responded_at || !commitment?.committed_tasks?.length) return null;

  const tasks = commitment.committed_tasks;
  const profile = await getProfile(userId);

  let styleHint = 'Tom amigável.';
  if (profile?.communication_style === 'concise') styleHint = 'MUITO BREVE — 1-2 frases.';

  const systemPrompt = `Você é um coach de produtividade via WhatsApp fazendo um check-in da tarde.

Nome: ${userName}
Compromissos do dia: ${tasks.map(t => `"${t}"`).join(', ')}
${styleHint}

REGRAS:
1. Saudação breve de boa tarde.
2. Mencione 1-2 compromissos de forma natural.
3. Faça UMA pergunta simples sobre como está indo.
4. NÃO use emojis. Máximo 3 frases.
5. Tom de amigo que quer ajudar, não cobrar.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere o check-in da tarde.' },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AccountabilityLoop] afternoon LLM error:', err.message);
    return `Boa tarde, ${userName}! Como está indo com "${tasks[0]}"? Conseguindo avançar?`;
  }
}

// ── Resumo da noite — fecha o ciclo do dia ────────────────────────────────────

export async function buildEveningSummary(userId, userName) {
  const todayISO = getTodayISO();
  const commitment = await getTodayCommitment(userId);
  const committedTasks = commitment?.committed_tasks || [];

  // Busca tarefas concluídas hoje
  const { data: doneTodayRaw } = await supabase
    .from('tasks')
    .select('title')
    .eq('user_id', userId)
    .eq('status', 'done')
    .gte('updated_at', `${todayISO}T00:00:00-03:00`)
    .order('updated_at', { ascending: false })
    .limit(10);

  const doneToday = doneTodayRaw || [];

  // Sem compromisso E sem conclusões = silêncio
  if (committedTasks.length === 0 && doneToday.length === 0) return null;

  const profile = await getProfile(userId);
  let styleHint = 'Tom amigável.';
  if (profile?.communication_style === 'concise') styleHint = 'MUITO BREVE — máximo 3 frases.';

  const doneTitles = doneToday.map(t => t.title);
  const completedCommits = committedTasks.filter(c =>
    doneTitles.some(d => d.toLowerCase().includes(c.toLowerCase().substring(0, 15)))
  );

  const systemPrompt = `Você é um coach de produtividade via WhatsApp fechando o ciclo do dia.

Nome: ${userName}
Compromissos do dia: ${committedTasks.length > 0 ? committedTasks.map(t => `"${t}"`).join(', ') : 'Nenhum registrado'}
Tarefas concluídas hoje (${doneToday.length}): ${doneTitles.slice(0, 5).map(t => `"${t}"`).join(', ') || 'Nenhuma'}
Compromissos cumpridos: ${completedCommits.length} de ${committedTasks.length}
${styleHint}

REGRAS:
1. Boa noite breve.
2. Reconheça o que foi feito — seja genuíno, sem exagero.
3. Se não cumpriu nada: seja gentil, não julgue, projete para amanhã.
4. Feche com uma pergunta leve sobre amanhã OU uma observação positiva.
5. NÃO use emojis. Máximo 4 frases.`;

  try {
    const response = await nimClient.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Gere o resumo da noite.' },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AccountabilityLoop] evening LLM error:', err.message);
    if (doneToday.length > 0) {
      return `Boa noite, ${userName}! Você concluiu ${doneToday.length} tarefa(s) hoje. Bom trabalho! O que você quer atacar primeiro amanhã?`;
    }
    return `Boa noite, ${userName}! Amanhã é uma nova chance. O que você quer atacar primeiro?`;
  }
}
