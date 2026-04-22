import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { runReminderCycle, getReminderPreview } from './agent/reminders.js';
import { transcribeWhatsAppAudio } from './agent/transcriber.js';
import { TOOLS, executeTool } from './agent/tools.js';
import { createChatCompletion, getLlmStatus, pingPrimaryModel } from './agent/llmClient.js';
import {
  claimDueJobs,
  completeOutboundJob,
  deleteChannelBinding,
  failOutboundJob,
  findBindingByExternalUserId,
  findBindingByUserId,
  getConversationStoreMode,
  getThreadForUser,
  getThreadMessagesForUser,
  listBindingsByChannel,
  listMessagesForThread,
  listThreadsForUser,
  markThreadRead,
  updateMessageStatusByExternalId,
  updateMessageTransport,
  upsertChannelBinding,
} from './agent/conversationStore.js';
import {
  enqueueOutboundConversationMessage,
  getDefaultThreadForUser,
  processConversationTurn,
} from './agent/conversationOrchestrator.js';
import { trackEvent, analyzeAndUpdateProfile } from './agent/behavioralProfile.js';
import { detectAndSaveCommitment } from './agent/accountabilityLoop.js';
import { engineEvents as agentEvents } from './agent/queryEngine.js';
import { getSession, setSession, deleteSession, checkAndMarkMessage, checkRateLimit } from './agent/memoryState.js';
import OpenAI from 'openai';
import Stripe from 'stripe';

dotenv.config();

const app = express();

// CORS manual — compatível com Express 5 + Node 18
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,stripe-signature,ngrok-skip-browser-warning');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  next();
});

// Webhook do Stripe precisa do body RAW — deve ficar ANTES do express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const session = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = session.metadata.userId;
      const planId = session.metadata.plan || 'flow';
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      const sub = await stripe.subscriptions.retrieve(subscriptionId);

      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      // Verifica se já existe assinatura para este usuário
      const { data: existing } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      let upsertError;
      if (existing) {
        // Atualiza registro existente
        const { error } = await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            plan_id: planId,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
        upsertError = error;
      } else {
        // Insere novo registro
        const { error } = await supabaseAdmin
          .from('subscriptions')
          .insert({
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            plan_id: planId,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          });
        upsertError = error;
      }

      if (upsertError) console.error('[Stripe] Erro ao salvar assinatura:', upsertError);
      else console.log(`[Stripe] Assinatura salva para userId=${userId}`);
      break;
    }

    case 'customer.subscription.deleted':
    case 'customer.subscription.updated': {
      const status = session.status;
      const subId = session.id;

      const periodEnd = session.current_period_end
        ? new Date(session.current_period_end * 1000).toISOString()
        : null;

      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
          status: status,
          ...(periodEnd && { current_period_end: periodEnd }),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subId);

      if (updateError) console.error('[Stripe] Erro ao atualizar assinatura:', updateError);

      // Se o plano foi cancelado ou ficou inativo, revogar membros do workspace
      const isInactive = ['canceled', 'unpaid', 'past_due', 'incomplete_expired'].includes(status);
      if (isInactive || event.type === 'customer.subscription.deleted') {
        // Encontra o dono pela stripe_subscription_id
        const { data: ownerSub } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();

        if (ownerSub?.user_id) {
          // Busca todos os membros do workspace do dono
          const { data: wsMembers } = await supabaseAdmin
            .from('workspace_members')
            .select('member_user_id')
            .eq('workspace_owner_id', ownerSub.user_id);

          if (wsMembers?.length) {
            const memberIds = wsMembers.map(m => m.member_user_id).filter(Boolean);

            // Revoga apenas planos derivados (sem stripe_subscription_id próprio)
            const { data: memberSubs } = await supabaseAdmin
              .from('subscriptions')
              .select('user_id, stripe_subscription_id')
              .in('user_id', memberIds);

            const derivedIds = (memberSubs || [])
              .filter(s => !s.stripe_subscription_id)
              .map(s => s.user_id);

            if (derivedIds.length) {
              await supabaseAdmin
                .from('subscriptions')
                .update({ status: 'inactive', updated_at: new Date().toISOString() })
                .in('user_id', derivedIds);
              console.log(`[Workspace] Plano revogado de ${derivedIds.length} membro(s) do workspace do owner=${ownerSub.user_id}`);
            }
          }
        }
      }
      break;
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ================== ENV ==================
const requireEnv = (name) => {
  if (!process.env[name]) throw new Error(`🚨 Variável de ambiente ausente: ${name}`);
  return process.env[name];
};

// ================== FETCH UTILS ==================
function fetchWithTimeout(timeout) {
  return (url, options = {}) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  };
}

requireEnv('NVIDIA_API_KEY'); // validação na inicialização; consumido pelo queryEngine
const WHATSAPP_ACCESS_TOKEN = requireEnv('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_NUMBER_ID = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
const WHATSAPP_VERIFY_TOKEN = requireEnv('WHATSAPP_VERIFY_TOKEN');
console.log(`[ENV Check] PHONE_ID=${WHATSAPP_PHONE_NUMBER_ID} | TOKEN=...${WHATSAPP_ACCESS_TOKEN.slice(-10)}`);
const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL');
const SUPABASE_KEY = requireEnv('VITE_SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// Cliente admin para operações do servidor (bypassa RLS)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  global: { fetch: fetchWithTimeout(30_000) },
});
const resend = new Resend('re_AaQ8QNKS_Ljvo7xxJoGEKMLvnWmaXcYUd');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const VITE_API_URL = process.env.VITE_API_URL || '';
const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://flui.ia.br' : 'http://localhost:5173');
const nimClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// ================== SESSÕES ==================
// Sessao, deduplicacao e rate limit locais ficam em memoria do processo.
const OUTBOUND_WORKER_ID = `server-${crypto.randomUUID()}`;

// Track last proactive message time per userId for engagement detection
const lastProactiveMessageAt = new Map();

function getCorrelationId(req) {
  return req.correlationId || crypto.randomUUID();
}

function logWithCorrelation(level, req, message, extra = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    correlationId: getCorrelationId(req),
    method: req.method,
    path: req.path,
    ...extra,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line, message);
  else if (level === 'warn') console.warn(line, message);
  else console.log(line, message);
}

function createHttpError(status, code, message, retryable = false, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  error.details = details;
  return error;
}

function sendApiError(res, req, error, fallbackStatus = 500) {
  const status = error.status || fallbackStatus;
  const payload = {
    error: {
      code: error.code || 'internal_error',
      message: error.message || 'Erro interno',
      retryable: Boolean(error.retryable),
      correlationId: getCorrelationId(req),
    },
  };

  logWithCorrelation('error', req, payload.error.message, {
    code: payload.error.code,
    retryable: payload.error.retryable,
    details: error.details || null,
  });

  return res.status(status).json(payload);
}

const LEGACY_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminFlui123@';
const SEEDED_ADMIN_USER_IDS = [
  '2021bd41-b925-45e1-829b-a263aae7a000',
];

function getConfiguredAdminUserIds() {
  const envUserIds = (process.env.ADMIN_USER_IDS || '')
    .split(/[,\s]+/)
    .map(id => id.trim())
    .filter(Boolean);

  return [...new Set([...SEEDED_ADMIN_USER_IDS, ...envUserIds])];
}

function getConfiguredAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(/[,\s]+/)
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function hasAdminRole(user) {
  const appMetadata = user?.app_metadata || {};
  const userMetadata = user?.user_metadata || {};
  const metadataRoles = Array.isArray(appMetadata.roles)
    ? appMetadata.roles
    : String(appMetadata.roles || '').split(/[,\s]+/);
  const roles = [appMetadata.role, userMetadata.role, ...metadataRoles]
    .filter(Boolean)
    .map(role => String(role).toLowerCase());

  return (
    appMetadata.is_admin === true ||
    userMetadata.is_admin === true ||
    roles.some(role => ['admin', 'adm', 'administrator'].includes(role))
  );
}

function getAdminAccessToken(req) {
  const authorization = req.headers.authorization || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return req.query.access_token || req.body?.accessToken || null;
}

function hasLegacyAdminPassword(req) {
  const supplied =
    req.query.password ||
    req.body?.password ||
    req.headers['x-admin-password'];

  return supplied && supplied === LEGACY_ADMIN_PASSWORD;
}

function sendAdminAuthError(res, status = 401, message = 'Acesso de administrador necessario') {
  return res.status(status).json({ error: { message } });
}

async function requireAdmin(req, res, next) {
  if (hasLegacyAdminPassword(req)) {
    req.adminUser = { id: 'legacy-password', email: null };
    return next();
  }

  const token = getAdminAccessToken(req);
  if (!token) {
    return sendAdminAuthError(res, 401, 'Sessao Supabase ausente');
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return sendAdminAuthError(res, 401, 'Sessao Supabase invalida');
    }

    const configuredIds = getConfiguredAdminUserIds();
    const configuredEmails = getConfiguredAdminEmails();
    const isConfiguredUser = configuredIds.includes(user.id);
    const isConfiguredEmail = user.email && configuredEmails.includes(user.email.toLowerCase());

    if (!hasAdminRole(user) && !isConfiguredUser && !isConfiguredEmail) {
      return sendAdminAuthError(res, 403, 'Usuario sem permissao de administrador');
    }

    req.adminUser = user;
    return next();
  } catch (error) {
    console.error('[AdminAuth] Falha ao validar admin:', error.message);
    return sendAdminAuthError(res, 500, 'Falha ao validar administrador');
  }
}

async function syncConfiguredAdminUsers() {
  const userIds = getConfiguredAdminUserIds();

  await Promise.all(userIds.map(async (userId) => {
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !user) throw error || new Error('Usuario nao encontrado');
      if (hasAdminRole(user)) return;

      const currentMetadata = user.app_metadata || {};
      const currentRoles = Array.isArray(currentMetadata.roles)
        ? currentMetadata.roles
        : String(currentMetadata.roles || '').split(/[,\s]+/).filter(Boolean);
      const roles = [...new Set([...currentRoles, currentMetadata.role, 'admin'].filter(Boolean))];

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...currentMetadata,
          role: 'admin',
          roles,
          is_admin: true,
        },
      });

      if (updateError) throw updateError;
      console.log(`[AdminAuth] Usuario ${userId} marcado como admin no Supabase Auth`);
    } catch (error) {
      console.error(`[AdminAuth] Nao foi possivel sincronizar admin ${userId}:`, error.message);
    }
  }));
}

syncConfiguredAdminUsers().catch(error => {
  console.error('[AdminAuth] Falha ao sincronizar admins configurados:', error.message);
});

function isMissingTableError(error) {
  if (!error) return false;
  return /does not exist|relation .* does not exist|Could not find the table/i.test(error.message || '');
}

function decodeHeaderValue(value) {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

function firstHeader(req, names) {
  for (const name of names) {
    const value = decodeHeaderValue(req.headers[name]);
    if (value) return value;
  }
  return null;
}

function getRequestGeo(req) {
  return {
    country: firstHeader(req, ['x-vercel-ip-country', 'cf-ipcountry', 'x-country-code']),
    state: firstHeader(req, ['x-vercel-ip-country-region', 'cloudfront-viewer-country-region', 'x-region', 'x-state']),
    city: firstHeader(req, ['x-vercel-ip-city', 'x-city']),
  };
}

function getClientIpHash(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();

  if (!ip) return null;
  const salt = process.env.ANALYTICS_SALT || 'flui-route-analytics';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function normalizeRoutePath(value) {
  if (!value || typeof value !== 'string') return '/';
  try {
    const url = value.startsWith('http') ? new URL(value) : null;
    const path = url ? url.pathname : value.split('?')[0];
    return path.startsWith('/') ? path.slice(0, 200) : `/${path.slice(0, 199)}`;
  } catch {
    return '/';
  }
}

function routeLabel(path) {
  const labels = {
    '/': 'Landing',
    '/login': 'Login',
    '/dashboard': 'Dashboard',
    '/tasks': 'Tarefas',
    '/calendar': 'Calendario',
    '/whatsapp': 'WhatsApp',
    '/subscription': 'Assinatura',
    '/checkout-preview': 'Checkout',
    '/terms': 'Termos',
    '/invite': 'Convites',
    '/mockups': 'Mockups',
    '/admin': 'Admin',
    '/admin/chat-simulator': 'Simulador Admin',
  };

  return labels[path] || path;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function pickUserState(metadata = {}) {
  return (
    metadata.state ||
    metadata.estado ||
    metadata.region ||
    metadata.uf ||
    metadata.province ||
    null
  );
}

function textIncludesAny(text, terms) {
  const value = (text || '').toLowerCase();
  return terms.some((term) => value.includes(term));
}

function buildTrainingSignals(messages = []) {
  const groups = [
    {
      topic: 'Criacao e gestao de tarefas',
      terms: ['tarefa', 'tarefas', 'lembrete', 'prazo', 'deadline', 'checklist', 'prioridade', 'projeto'],
      recommendation: 'Criar exemplos de intencao para criar, reagendar, concluir e explicar tarefas.',
    },
    {
      topic: 'Agenda e compromissos',
      terms: ['agenda', 'calendario', 'calendário', 'reuniao', 'reunião', 'compromisso', 'evento', 'horario', 'horário'],
      recommendation: 'Treinar respostas que convertam datas relativas em acoes claras no calendario.',
    },
    {
      topic: 'Onboarding e WhatsApp',
      terms: ['whatsapp', 'telefone', 'numero', 'número', 'vincular', 'conectar', 'codigo', 'código'],
      recommendation: 'Melhorar o fluxo de ajuda para conectar numero, confirmar conta e recuperar vinculo.',
    },
    {
      topic: 'Planos, assinatura e pagamento',
      terms: ['plano', 'assinatura', 'assinar', 'pagamento', 'cartao', 'cartão', 'checkout', 'cobranca', 'cobrança'],
      recommendation: 'Adicionar respostas consistentes sobre planos, limites, upgrade e problemas de pagamento.',
    },
    {
      topic: 'Erros e suporte',
      terms: ['erro', 'bug', 'problema', 'travou', 'nao funciona', 'não funciona', 'falha', 'sumiu'],
      recommendation: 'Coletar exemplos reais para respostas de diagnostico e encaminhamento ao suporte.',
    },
  ];

  const signals = groups.map((group) => {
    const matches = messages.filter((message) =>
      message.role === 'user' && textIncludesAny(message.content, group.terms)
    );
    const sample = matches.find((message) => message.content?.trim())?.content || '';
    return {
      topic: group.topic,
      count: matches.length,
      sample: sample.length > 180 ? `${sample.slice(0, 177)}...` : sample,
      recommendation: group.recommendation,
    };
  });

  return signals
    .filter((signal) => signal.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

async function getWhatsAppSession(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  const pending = await getSession(normalizedPhone);
  if (pending) return pending;

  const binding = await findBindingByExternalUserId('whatsapp', normalizedPhone);
  if (!binding?.user_id) return null;

  const thread = await getDefaultThreadForUser(binding.user_id);
  return {
    authenticated: true,
    userId: binding.user_id,
    userName: binding.display_name || 'você',
    threadId: thread?.id || null,
  };
}

async function buildReminderSessions() {
  const bindings = await listBindingsByChannel('whatsapp');
  const sessions = {};

  for (const binding of bindings) {
    if (!binding.user_id) continue;
    sessions[binding.external_user_id] = {
      authenticated: true,
      userId: binding.user_id,
      userName: binding.display_name || 'você',
    };
  }

  // Usuarios sem binding ativo ainda nao tem lembretes configurados.
  return sessions;
}

// ================== WHATSAPP ==================

/** Envia indicador de "digitando..." nativo do WhatsApp + marca como lido */
async function sendTypingIndicator(to, messageId) {
  try {
    await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      })
    });
  } catch (error) {
    console.error('Erro typing indicator:', error.message);
  }
}

async function sendWhatsAppPayload(to, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        ...payload,
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[WhatsApp Debug]', JSON.stringify({ to: to.replace(/\D/g, ''), phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, status: response.status, error: data.error }));
      throw new Error(data.error?.message);
    }

    return {
      success: true,
      data,
      externalMessageId: data.messages?.[0]?.id || null,
    };
  } catch (error) {
    console.error('Erro WhatsApp:', error.message);
    return {
      success: false,
      error,
      externalMessageId: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendWhatsAppMessage(to, text) {
  const result = await sendWhatsAppPayload(to, {
    type: 'text',
    text: { body: text },
  });
  return result.success;
}

function mapWhatsAppStatus(status) {
  if (status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed') {
    return status;
  }
  return 'processing';
}

async function dispatchOutboundMessageJobs() {
  let jobs;
  try {
    jobs = await claimDueJobs({ workerId: OUTBOUND_WORKER_ID, limit: 10 });
  } catch (error) {
    console.error('[OutboundJobs] Falha ao buscar jobs no DB:', error.message);
    return;
  }

  for (const job of jobs) {
    try {
      if (job.channel !== 'whatsapp') {
        await failOutboundJob(job.id, `Canal não suportado: ${job.channel}`, false);
        continue;
      }

      const payload = job.payload?.type === 'template'
        ? {
          type: 'template',
          template: {
            name: job.payload.template,
            language: { code: 'en_US' },
          },
        }
        : {
          type: 'text',
          text: { body: job.payload.text },
        };

      const result = await sendWhatsAppPayload(job.target, payload);
      if (!result.success) {
        await failOutboundJob(job.id, result.error?.message || 'Falha ao enviar pelo Meta', true);
        continue;
      }

      await updateMessageTransport(job.message_id, {
        status: 'sent',
        external_message_id: result.externalMessageId,
        metadata: {
          transport: 'meta',
          last_job_id: job.id,
        },
      });

      await completeOutboundJob(job.id, {
        external_message_id: result.externalMessageId,
      });
    } catch (error) {
      await failOutboundJob(job.id, error.message || 'Falha inesperada no worker', true);
    }
  }
}

async function enqueueSystemWhatsAppMessage(userId, content, messageType = 'assistant_text') {
  const binding = await findBindingByUserId(userId, 'whatsapp');
  if (!binding?.external_user_id) return false;

  await enqueueOutboundConversationMessage({
    userId,
    externalUserId: binding.external_user_id,
    threadId: null,
    channel: 'whatsapp',
    content,
    role: 'assistant',
    messageType,
  });

  await dispatchOutboundMessageJobs();
  return true;
}

// ================== DEDUPLICAÇÃO ==================
// Deduplicacao local em memoria do processo.

// ================== BOAS-VINDAS COM IA ==================
async function generateWelcomeMessage() {
  try {
    const { response } = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Você é o Lui, assistente de produtividade da Flui. Gere uma mensagem de boas-vindas curta e calorosa em português brasileiro para um usuário novo que chegou pelo WhatsApp. A mensagem DEVE: se apresentar como Lui, assistente da Flui; pedir o e-mail do usuário para começar. Máximo 2 frases curtas. Pode usar no máximo 1 emoji. Seja natural e acolhedor, nunca genérico.`,
        },
        { role: 'user', content: 'novo usuário' },
      ],
      max_tokens: 80,
      temperature: 0.85,
    });
    return response.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ================== AGENTE ==================
async function processAndRespondWithAI(userPhone, textMessage, messageId, { fromAudio = false } = {}) {
  try {
    // Proteção contra mensagens vazias ou só espaços
    if (!textMessage || !textMessage.trim()) {
      console.log(`[Webhook] Mensagem vazia ignorada de ${userPhone}`);
      return;
    }

    const cleanMessage = textMessage.trim();
    let session = await getWhatsAppSession(userPhone);

    // ===== BLOQUEADO (plano expirado/inativo) =====
    if (session?.blocked) {
      console.log(`[AI] Usuário ${userPhone} bloqueado — plano Flow inativo`);
      return;
    }

    console.log(`[AI] Processando de ${userPhone}: "${cleanMessage.substring(0, 50)}..." | Sessão: ${session ? (session.authenticated ? '✅ auth' : `⏳ ${session.step}`) : '❌ nova'}`);

    // ===== INIT =====
    if (!session) {
      session = { authenticated: false, step: 'ask_email' };
      await setSession(userPhone, session);

      const welcomeMsg = await generateWelcomeMessage()
        || "Oi! Eu sou o Lui, assistente da Flui \n\nMe passa seu *e-mail* pra gente começar.";
      await sendWhatsAppMessage(userPhone, welcomeMsg);
      return;
    }

    // ===== AUTH =====
    if (!session.authenticated) {
      if (session.step === 'ask_email') {
        const candidateEmail = cleanMessage.trim().toLowerCase();
        session.email = candidateEmail;
        sendTypingIndicator(userPhone, messageId);

        // Verifica se o usuário existe e tenta auto-conectar (Google ou binding do modal)
        try {
          // Busca o usuário por email via GoTrue admin + fallback SDK
          let foundUser = null;
          try {
            const lookupResp = await fetch(
              `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(candidateEmail)}&per_page=10`,
              { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
            );
            if (lookupResp.ok) {
              const lookupJson = await lookupResp.json();
              foundUser = (lookupJson?.users || []).find(
                u => u.email?.toLowerCase() === candidateEmail
              );
            }
          } catch (fetchErr) {
            console.warn('[WhatsApp Auth] GoTrue REST falhou, tentando SDK:', fetchErr.message);
          }

          // Fallback: busca via Supabase Admin SDK paginado
          if (!foundUser) {
            let page = 1;
            let found = false;
            while (!found && page <= 10) {
              const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
                page,
                perPage: 100,
              });
              if (listError || !listData?.users?.length) break;
              foundUser = listData.users.find(u => u.email?.toLowerCase() === candidateEmail);
              if (foundUser) found = true;
              if (listData.users.length < 100) break;
              page++;
            }
          }

          if (foundUser) {
            // ── CHECK 1: Já existe binding criado pelo modal para este userId? ──
            // Se o usuário vinculou o número pelo modal, o binding já existe com um
            // external_user_id que pode ser diferente do formato do WhatsApp API.
            // Atualizamos o binding para usar o número real do WhatsApp (userPhone).
            const existingBinding = await findBindingByUserId(foundUser.id, 'whatsapp');
            if (existingBinding) {
              console.log(`[WhatsApp Auth] 🟢 Binding existente encontrado para ${candidateEmail} (userId=${foundUser.id}) — conectando automaticamente via binding do modal`);

              session.authenticated = true;
              session.userId = foundUser.id;
              session.userName = foundUser.user_metadata?.full_name || foundUser.user_metadata?.name || 'Usuário';
              await deleteSession(userPhone);

              // Atualiza o binding existente explicitamente para evitar duplicatas errôneas e cobrir o número atual
              try {
                await supabaseAdmin.from('channel_bindings').update({
                  external_user_id: userPhone,
                  metadata: { ...existingBinding.metadata, email: candidateEmail, phone: userPhone, authMethod: 'modal_binding' },
                  updated_at: new Date().toISOString()
                }).eq('id', existingBinding.id);
              } catch (updateErr) {
                console.error('[WhatsApp Auth] Falha ao atualizar binding existente:', updateErr.message);
              }

              const thread = await getDefaultThreadForUser(foundUser.id);
              session.threadId = thread?.id || null;

              await sendWhatsAppMessage(userPhone,
                `Fechou, *${session.userName}*! 🚀\n\nConectei com sua conta automaticamente.\n\nO que vamos fazer hoje?`
              );
              return;
            }

            // ── CHECK 2: Usuário Google-only (sem senha) ──
            const providers = foundUser.app_metadata?.providers || (foundUser.identities || []).map(i => i.provider);
            const isGoogleOnly = providers.includes('google') && !providers.includes('email');

            if (isGoogleOnly) {
              console.log(`[WhatsApp Auth] 🔵 Usuário Google-only detectado: ${candidateEmail} — autenticando automaticamente`);

              session.authenticated = true;
              session.userId = foundUser.id;
              session.userName = foundUser.user_metadata?.full_name || foundUser.user_metadata?.name || 'Usuário';
              await deleteSession(userPhone);

              // Cria binding com o número real do WhatsApp
              await upsertChannelBinding({
                userId: foundUser.id,
                channel: 'whatsapp',
                externalUserId: userPhone,
                displayName: session.userName,
                authenticated: true,
                metadata: { email: candidateEmail, phone: userPhone, authMethod: 'google_auto' },
              });

              const thread = await getDefaultThreadForUser(foundUser.id);
              session.threadId = thread?.id || null;

              await sendWhatsAppMessage(userPhone,
                `Fechou, *${session.userName}*! 🚀\n\nConectei com sua conta Google automaticamente.\n\nO que vamos fazer hoje?`
              );
              return;
            }
          }
        } catch (err) {
          console.error('[WhatsApp Auth] Erro ao verificar auto-login:', err.message);
          // Continua normalmente pedindo senha
        }

        // Não é Google-only nem tem binding do modal, pede senha normalmente
        session.step = 'ask_password';
        await setSession(userPhone, session);
        await sendWhatsAppMessage(userPhone, "Boa! Agora sua *senha* 🔒");
        return;
      }

      if (session.step === 'ask_password') {
        sendTypingIndicator(userPhone, messageId);

        const { data, error } = await supabase.auth.signInWithPassword({
          email: session.email,
          password: cleanMessage,
        });

        if (error) {
          session.step = 'ask_email';
          await setSession(userPhone, session);

          await sendWhatsAppMessage(userPhone,
            "Não bateu aqui 😕 vamos tentar de novo. Seu e-mail?"
          );
          return;
        }

        session.authenticated = true;
        session.userId = data.user.id;
        session.userName = data.user.user_metadata?.name || 'Usuário';
        await deleteSession(userPhone);

        const binding = await upsertChannelBinding({
          userId: session.userId,
          channel: 'whatsapp',
          externalUserId: userPhone,
          displayName: session.userName,
          authenticated: true,
          metadata: {
            email: data.user.email,
            phone: userPhone,
          },
        });

        const thread = await getDefaultThreadForUser(session.userId);
        session.threadId = thread?.id || null;

        await sendWhatsAppMessage(userPhone,
          `Fechou, *${session.userName}* 🚀\n\nO que vamos fazer hoje?`
        );
        return;
      }
    }

    // ===== COMANDO SAIR =====
    const LOGOUT_KEYWORDS = ['sair', 'desconectar', 'logout', 'deslogar'];
    if (LOGOUT_KEYWORDS.includes(cleanMessage.toLowerCase())) {
      console.log(`[WhatsApp] 👋 Logout solicitado por ${userPhone} (${session.userName})`);

      // Remove o binding do banco
      try {
        await deleteChannelBinding('whatsapp', userPhone);
      } catch (err) {
        console.error('[WhatsApp] Erro ao remover binding:', err.message);
      }

      // Limpa sessao local
      await deleteSession(userPhone);

      await sendWhatsAppMessage(userPhone,
        `Até logo, *${session.userName}*! 👋\n\nSua conta foi desconectada com sucesso.\n\nQuando quiser voltar, é só mandar qualquer mensagem que eu peço seus dados de novo.`
      );
      return;
    }

    // ===== VERIFICAÇÃO DE PLANO (antes de usar a IA) =====
    const { data: subData } = await supabaseAdmin
      .from('subscriptions')
      .select('status, plan_id')
      .eq('user_id', session.userId)
      .limit(1)
      .maybeSingle();

    const hasActivePlan = subData?.status === 'active' && ['flow', 'pulse'].includes(subData?.plan_id);

    if (!hasActivePlan) {
      await sendWhatsAppMessage(userPhone,
        "Oi! Para usar o assistente via WhatsApp você precisa de um plano ativo 😊\n\nAcesse *flui.ia.br → Assinatura* para ativar.\n\nAssim que ativar, volte aqui! 🚀"
      );
      return;
    }

    // ===== AGENT LOOP =====
    sendTypingIndicator(userPhone, messageId);

    // Atualiza janela de 24h: registra último inbound do usuário na binding
    supabaseAdmin
      .from('channel_bindings')
      .update({ last_inbound_at: new Date().toISOString() })
      .eq('channel', 'whatsapp')
      .eq('external_user_id', userPhone)
      .then(() => { })
      .catch(err => console.error('[24hWindow] Erro ao atualizar last_inbound_at:', err.message));

    const turnStart = Date.now();
    const result = await processConversationTurn({
      userId: session.userId,
      userName: session.userName,
      threadId: session.threadId || null,
      content: cleanMessage,
      incomingChannel: 'whatsapp',
      preferredThreadChannel: 'whatsapp',
      externalUserId: userPhone,
      externalMessageId: messageId,
      messageType: fromAudio ? 'audio_transcript' : 'user_text',
      fromAudio,
      onAck: (ackText) => sendWhatsAppMessage(userPhone, ackText),
    });
    console.log(`[AI] Resposta: "${result.reply?.substring(0, 80)}..."`);
    await dispatchOutboundMessageJobs();

    // ── Accountability loop: detecta resposta ao compromisso matinal ───
    detectAndSaveCommitment(session.userId, cleanMessage).catch(() => {});

    // ── Behavioral event tracking (fire-and-forget) ─────────────────────
    const turnDuration = Date.now() - turnStart;
    trackEvent(session.userId, 'message_sent', {
      message_length: cleanMessage.length,
      message_text: cleanMessage.substring(0, 200),
      from_audio: fromAudio,
    }).catch(() => { });
    trackEvent(session.userId, 'message_response', {
      response_time_ms: turnDuration,
      response_length: result.reply?.length || 0,
    }).catch(() => { });

    // Detect reminder engagement: user responded within 15min of proactive message
    const lastProactive = lastProactiveMessageAt.get(session.userId);
    if (lastProactive && (Date.now() - lastProactive) < 15 * 60 * 1000) {
      trackEvent(session.userId, 'reminder_engaged', {
        response_delay_ms: Date.now() - lastProactive,
      }).catch(() => { });
      lastProactiveMessageAt.delete(session.userId);
    } else if (lastProactive && (Date.now() - lastProactive) >= 15 * 60 * 1000) {
      trackEvent(session.userId, 'reminder_ignored', {
        time_since_reminder_ms: Date.now() - lastProactive,
      }).catch(() => { });
      lastProactiveMessageAt.delete(session.userId);
    }

    // Periodically re-analyze profile (every ~20 interactions)
    if (Math.random() < 0.05) {
      analyzeAndUpdateProfile(session.userId).catch(() => { });
    }

  } catch (error) {
    console.error('[processAndRespondWithAI] ❌ ERRO:', error);
    await sendWhatsAppMessage(userPhone,
      "Deu um erro aqui 😕 tenta de novo daqui a pouco"
    );
  }
}

// ================== ÁUDIO ==================
async function handleAudioMessage(userPhone, audioId, messageId) {
  try {
    // Mostra "digitando..." enquanto transcreve
    sendTypingIndicator(userPhone, messageId);

    const { text, duration } = await transcribeWhatsAppAudio(audioId);

    if (!text || !text.trim()) {
      await sendWhatsAppMessage(userPhone,
        "Não consegui entender esse áudio 😕 Pode tentar de novo ou digitar?"
      );
      return;
    }

    console.log(`[Audio] Transcrito em ${duration}ms: "${text.substring(0, 80)}..."`);

    // Processa o texto transcrito como se fosse uma mensagem de texto
    await processAndRespondWithAI(userPhone, text, messageId, { fromAudio: true });

  } catch (error) {
    console.error('[handleAudioMessage] Erro:', error.message);
    await sendWhatsAppMessage(userPhone,
      "Não consegui processar o áudio agora 😕 Tenta mandar por texto?"
    );
  }
}

// ================== WEBHOOK ==================
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/api/whatsapp/webhook', async (req, res) => {
  // Responde 200 imediatamente para o Meta não reenviar
  res.sendStatus(200);

  try {
    const entry = req.body?.entry;
    if (!Array.isArray(entry) || entry.length === 0) return;

    const changes = entry[0]?.changes;
    if (!Array.isArray(changes) || changes.length === 0) return;

    const value = changes[0]?.value;
    if (!value) return;

    // ── FILTRO 1: Ignora status updates (delivered, read, sent, failed) ──
    // Esses NÃO são mensagens do usuário — são notificações de entrega
    if (value.statuses) {
      for (const statusEvent of value.statuses) {
        await updateMessageStatusByExternalId(
          'whatsapp',
          statusEvent.id,
          mapWhatsAppStatus(statusEvent.status),
          statusEvent
        );
      }
      return;
    }

    // ── FILTRO 2: Precisa ter array de mensagens ──
    const messages = value.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      // console.log('[Webhook] Evento sem mensagens, ignorado');
      return;
    }

    const message = messages[0];
    if (!message) return;

    // ── FILTRO 3: Deduplicacao em memoria do processo ──
    if (await checkAndMarkMessage(message.id)) {
      console.log(`[Webhook] Mensagem duplicada ignorada: ${message.id}`);
      return;
    }

    const messageId = message.id;
    const messageType = message.type;
    const userPhone = message.from;

    // ── FILTRO 4: Rate limiting por número ──
    if (await checkRateLimit(userPhone)) {
      console.warn(`[Webhook] Rate limit atingido para ${userPhone} — mensagem descartada`);
      return;
    }

    // ── FILTRO 5: Ignora tipos sem conteúdo processável ──
    const SUPPORTED_TYPES = new Set(['text', 'audio']);
    if (!SUPPORTED_TYPES.has(messageType)) {
      console.log(`[Webhook] Tipo "${messageType}" não suportado, ignorado`);
      return;
    }

    console.log(`[Webhook] 📩 ${messageType} de ${userPhone} (${messageId})`);

    // ── Processa diretamente sem fila externa ──
    if (messageType === 'text') {
      const body = message.text?.body;
      if (!body || !body.trim()) {
        console.log('[Webhook] Texto vazio ignorado');
        return;
      }
      await processAndRespondWithAI(userPhone, body, messageId);
      return;
    }

    if (messageType === 'audio' && message.audio?.id) {
      await handleAudioMessage(userPhone, message.audio.id, messageId);
      return;
    }

  } catch (err) {
    console.error('[Webhook] Erro ao processar evento:', err.message);
  }
});

// ================== STRIPE ==================

// Price IDs por plano
const PLAN_PRICE_IDS = {
  flow: 'price_1TLaplCJClQAQ7Cji2whsLHw',
  pulse: 'price_1TLaq9CJClQAQ7CjKHUjDoXi',
};

// 1. Criar Sessão de Checkout
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  const { userId, userEmail, promoCode, plan } = req.body;

  console.log(`[Stripe] create-checkout-session → userId=${userId} plan=${plan} email=${userEmail}`);

  try {
    const resolvedPlan = plan === 'pulse' ? 'pulse' : 'flow';
    const priceId = PLAN_PRICE_IDS[resolvedPlan];

    console.log(`[Stripe] Plano resolvido: ${resolvedPlan} → priceId: ${priceId}`);

    const sessionParams = {
      customer_email: userEmail,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${FRONTEND_URL}/subscription?success=true`,
      cancel_url: `${FRONTEND_URL}/subscription?canceled=true`,
      metadata: {
        userId: userId,
        plan: resolvedPlan,
      },
    };

    if (promoCode) {
      // Resolve o código promocional para o ID interno do Stripe
      const promoCodes = await stripe.promotionCodes.list({ code: promoCode, active: true, limit: 1 });
      if (promoCodes.data.length > 0) {
        sessionParams.discounts = [{ promotion_code: promoCodes.data[0].id }];
      } else {
        return res.status(400).json({ error: 'Cupom inválido ou expirado.' });
      }
    } else {
      // Sem código: habilita o campo nativo de cupom na página do Stripe
      sessionParams.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Session Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Validar Código Promocional
app.post('/api/stripe/validate-promo', async (req, res) => {
  const { promoCode } = req.body;
  if (!promoCode) return res.status(400).json({ error: 'Código não informado.' });

  try {
    const promoCodes = await stripe.promotionCodes.list({ code: promoCode, active: true, limit: 1 });

    if (promoCodes.data.length === 0) {
      return res.status(404).json({ error: 'Cupom inválido ou expirado.' });
    }

    const promo = promoCodes.data[0];
    const coupon = promo.coupon;

    let discountLabel = '';
    if (coupon.percent_off) {
      discountLabel = `${coupon.percent_off}% de desconto`;
    } else if (coupon.amount_off) {
      const amount = (coupon.amount_off / 100).toFixed(2).replace('.', ',');
      discountLabel = `R$ ${amount} de desconto`;
    }

    res.json({ valid: true, discountLabel, promoId: promo.id });
  } catch (error) {
    console.error('Validate Promo Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Criar Sessão de Portal de Faturamento (Stripe Portal)
app.post('/api/stripe/create-portal-session', async (req, res) => {
  const { userId } = req.body;
  try {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return res.status(404).json({ error: 'Customer ID não encontrado.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${FRONTEND_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Portal Error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 2. Verificar status da assinatura (server-side, bypassa RLS)
app.get('/api/subscription/status', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Subscription] Erro ao verificar:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ subscription: data });
  } catch (err) {
    console.error('[Subscription] Erro inesperado:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Sincronizar dados reais do Stripe (current_period_end, status)
app.get('/api/subscription/sync', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Buscar assinatura do DB
    const { data: sub, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !sub) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }

    // Tenta obter a assinatura ativa diretamente do Stripe
    let stripeSub = null;

    // 1ª tentativa: pelo stripe_subscription_id (com payment method expandido)
    if (sub.stripe_subscription_id) {
      try {
        stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
          expand: ['default_payment_method'],
        });
      } catch (e) {
        console.warn('[Sync] stripe_subscription_id inválido, tentando pelo customer:', e.message);
      }
    }

    // 2ª tentativa: pelo stripe_customer_id (busca a assinatura ativa do customer)
    if (!stripeSub && sub.stripe_customer_id) {
      try {
        const list = await stripe.subscriptions.list({
          customer: sub.stripe_customer_id,
          status: 'active',
          limit: 1,
          expand: ['data.default_payment_method'],
        });
        if (list.data.length > 0) stripeSub = list.data[0];
      } catch (e) {
        console.warn('[Sync] Falha ao buscar por customer_id:', e.message);
      }
    }

    if (stripeSub) {
      // Na API Stripe 2025-01-27.acacia, current_period_end foi movido para subscription.items.data[0]
      const rawPeriodEnd = stripeSub.current_period_end
        || stripeSub.items?.data?.[0]?.current_period_end
        || null;
      const periodEnd = rawPeriodEnd
        ? new Date(rawPeriodEnd * 1000).toISOString()
        : null;

      // Extrair dados do cartão
      let cardBrand = null;
      let cardLast4 = null;

      const pm = stripeSub.default_payment_method;
      if (pm && pm.card) {
        cardBrand = pm.card.brand;
        cardLast4 = pm.card.last4;
      }

      // Fallback: buscar payment method padrão do customer
      if (!cardBrand && sub.stripe_customer_id) {
        try {
          const customer = await stripe.customers.retrieve(sub.stripe_customer_id, {
            expand: ['invoice_settings.default_payment_method'],
          });
          const defaultPm = customer.invoice_settings?.default_payment_method;
          if (defaultPm && defaultPm.card) {
            cardBrand = defaultPm.card.brand;
            cardLast4 = defaultPm.card.last4;
          }
        } catch (e) {
          console.warn('[Sync] Falha ao buscar payment method do customer:', e.message);
        }
      }

      await supabaseAdmin
        .from('subscriptions')
        .update({
          stripe_subscription_id: stripeSub.id,
          status: stripeSub.status,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      console.log(`[Sync] Sincronizado userId=${userId}, periodEnd=${periodEnd}, cardBrand=${cardBrand}`);

      return res.json({
        subscription: {
          ...sub,
          stripe_subscription_id: stripeSub.id,
          status: stripeSub.status,
          current_period_end: periodEnd,
          card_brand: cardBrand,
          card_last4: cardLast4,
        },
        synced: true,
      });
    }

    res.json({ subscription: sub, synced: false });
  } catch (err) {
    console.error('[Sync] Erro inesperado:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================== CHAT API (DeepSeek/NIM) ==================
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, temperature = 0.7, max_tokens = 2048 } = req.body;

    const { response, telemetry } = await createChatCompletion({
      messages,
      temperature,
      max_tokens
    });

    res.json({ ...response, telemetry });
  } catch (error) {
    return sendApiError(res, req, createHttpError(500, 'chat_failed', error.message, true));
  }
});

// ================== CHAT AGENT (Web Chat com subtarefas) ==================
// Endpoint inteligente: detecta conclusão de subtarefas e executa ferramentas

const CHAT_AGENT_TOOLS = TOOLS.filter(t =>
  ['TaskList', 'TaskSearch', 'SubtaskToggle', 'TaskUpdate'].includes(t.function.name)
);

const MAX_CHAT_AGENT_TURNS = 3;

app.post('/api/chat-agent', async (req, res) => {
  try {
    const { messages, userId, userName = 'você' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });

    const latestUserMessage = [...(messages || [])]
      .reverse()
      .find((message) => message.role === 'user');

    if (latestUserMessage?.content?.trim()) {
      const result = await processConversationTurn({
        userId,
        userName,
        threadId: req.body.threadId || null,
        content: latestUserMessage.content.trim(),
        incomingChannel: 'web',
        preferredThreadChannel: 'whatsapp',
        messageType: 'user_text',
        mirrorAssistantToWhatsApp: true,
      });

      await dispatchOutboundMessageJobs();

      return res.json({
        content: result.reply,
        threadId: result.thread.id,
        telemetry: result.telemetry,
      });
    }

    // Busca tarefas do usuário com subtarefas para montar contexto
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, status, subtasks')
      .eq('user_id', userId)
      .in('status', ['todo', 'doing'])
      .order('created_at', { ascending: false })
      .limit(20);

    // Monta snapshot de tarefas com subtarefas pendentes
    const pendingTasks = (tasks || []);
    let taskSnapshot = '';
    for (const t of pendingTasks) {
      const subs = (t.subtasks || []);
      if (subs.length === 0) {
        taskSnapshot += `\n- "${t.title}" (id: ${t.id}, sem subtarefas)`;
      } else {
        const subList = subs.map(s =>
          `  • [${s.completed ? 'X' : ' '}] "${s.title}" (subtask_id: ${s.id})`
        ).join('\n');
        taskSnapshot += `\n- "${t.title}" (task_id: ${t.id})\n${subList}`;
      }
    }

    const systemPrompt = `Você é um assistente de produtividade integrado ao painel web do usuário.

═══ TAREFAS ATIVAS DO USUÁRIO ═══
${taskSnapshot || 'Nenhuma tarefa pendente.'}

IMPORTANTE: Os IDs acima são apenas para uso interno nas ferramentas. NUNCA mencione IDs, UUIDs ou dados técnicos para o usuário.

═══ SUAS CAPACIDADES ═══
1. Ver e buscar tarefas do usuário (TaskList, TaskSearch)
2. Marcar subtarefas como concluídas ou pendentes (SubtaskToggle)
3. Atualizar status de tarefas (TaskUpdate)

═══ DETECÇÃO INTELIGENTE DE CONCLUSÃO ═══
Quando o usuário disser algo que sugere que terminou uma atividade, siga esta lógica:

PASSO 1 — IDENTIFIQUE O NÍVEL:
- Combina com uma TAREFA INTEIRA? → fluxo de tarefa (abaixo)
- Combina com uma SUBTAREFA específica? → fluxo de subtarefa (abaixo)
- Combina com ambos? → priorize a subtarefa e mencione a tarefa também

FLUXO DE TAREFA (quando o usuário terminou uma tarefa completa):
1. Pergunte: "Ótimo! Devo marcar a tarefa '[nome]' como concluída?"
2. Se confirmar → chame TaskUpdate com status: "done"
   - IMPORTANTE: ao marcar a tarefa como "done", o sistema automaticamente marca todas as subtarefas como concluídas
   - Após executar, informe: "Tarefa '[nome]' concluída! Todas as [N] subtarefas foram marcadas automaticamente."
3. Se negar → responda naturalmente

FLUXO DE SUBTAREFA (quando o usuário terminou apenas uma etapa):
1. Pergunte: "Ótimo! Devo marcar a subtarefa '[nome]' da tarefa '[tarefa]' como concluída?"
2. Se confirmar → chame SubtaskToggle com os IDs corretos
3. Após executar, informe o progresso: "Feito! [N] de [total] etapas concluídas."
4. Se todas as subtarefas estiverem concluídas, pergunte: "Todas as etapas feitas! Quer marcar a tarefa '[nome]' como concluída também?"

REGRAS GERAIS:
- Sempre confirme ANTES de marcar (exceto se o usuário for explícito: "marca X como feita")
- Se houver múltiplas correspondências possíveis, liste as opções e pergunte qual
- Se o usuário negar, não marque nada e responda naturalmente

═══ TOM E ESTILO ═══
- Seja breve, natural e direto (máximo 2-3 frases)
- Use português brasileiro coloquial
- NUNCA use emojis
- NUNCA mostre IDs, JSON ou dados técnicos
- Se o usuário fizer perguntas gerais sobre tarefas, responda usando as ferramentas disponíveis`;

    const conversationMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    let turnMessages = [...conversationMessages];
    let finalContent = '';

    for (let turn = 0; turn < MAX_CHAT_AGENT_TURNS; turn++) {
      const response = await nimClient.chat.completions.create({
        model: process.env.MODEL_ID || 'deepseek-ai/deepseek-v3.2',
        messages: turnMessages,
        tools: CHAT_AGENT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.6,
        max_tokens: 1024,
      });

      const choice = response.choices[0];
      const assistantMsg = choice.message;

      // Sem tool calls — resposta final
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        finalContent = assistantMsg.content || '';
        break;
      }

      // Executa cada tool call
      turnMessages.push(assistantMsg);

      for (const toolCall of assistantMsg.tool_calls) {
        let toolArgs = {};
        try { toolArgs = JSON.parse(toolCall.function.arguments); } catch { }

        const toolResult = await executeTool(toolCall.function.name, toolArgs, { userId });
        const { _hint, ...publicResult } = toolResult;

        turnMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ ...publicResult, _hint }),
        });
      }
    }

    if (!finalContent) {
      // Força resposta final se o loop acabou sem texto
      const finalResponse = await nimClient.chat.completions.create({
        model: process.env.MODEL_ID || 'deepseek-ai/deepseek-v3.2',
        messages: turnMessages,
        temperature: 0.6,
        max_tokens: 2048,
      });
      finalContent = finalResponse.choices[0]?.message?.content || 'Pronto! Posso ajudar com mais alguma coisa?';
    }

    res.json({ content: finalContent });
  } catch (error) {
    console.error('[ChatAgent] Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analytics/route', async (req, res) => {
  try {
    const geo = getRequestGeo(req);
    const body = req.body || {};
    const path = normalizeRoutePath(body.path || body.url || req.headers.referer);

    const payload = {
      user_id: body.userId || null,
      path,
      label: routeLabel(path),
      referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null,
      title: typeof body.title === 'string' ? body.title.slice(0, 160) : null,
      user_agent: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null,
      country: geo.country,
      state: geo.state,
      city: geo.city,
      locale: typeof body.locale === 'string' ? body.locale.slice(0, 80) : null,
      timezone: typeof body.timezone === 'string' ? body.timezone.slice(0, 80) : null,
      viewport: body.viewport || null,
      ip_hash: getClientIpHash(req),
      created_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('site_route_events')
      .insert(payload);

    if (error) {
      if (isMissingTableError(error)) {
        return res.json({ ok: true, stored: false, reason: 'site_route_events_missing' });
      }

      console.warn('[Analytics] Falha ao registrar rota:', error.message);
      return res.json({ ok: true, stored: false });
    }

    res.json({ ok: true, stored: true });
  } catch (error) {
    console.warn('[Analytics] Falha inesperada ao registrar rota:', error.message);
    res.json({ ok: true, stored: false });
  }
});

// ================== ADMIN PANEL ==================
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({
    admin: true,
    user: {
      id: req.adminUser.id,
      email: req.adminUser.email,
    },
  });
});
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000
    });
    if (authError) throw authError;

    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*');
    if (subError) throw subError;

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentMsgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('user_id')
      .eq('role', 'user')
      .gte('created_at', since24h);

    const activeUserIds = new Set((recentMsgs || []).map(m => m.user_id));

    const usersData = users.map(u => {
      const sub = subscriptions?.find(s => s.user_id === u.id);
      const meta = u.user_metadata || {};
      const identityData = u.identities?.[0]?.identity_data || {};
      const avatar =
        meta.avatar_url ||
        meta.picture ||
        identityData.avatar_url ||
        identityData.picture ||
        null;

      return {
        id: u.id,
        email: u.email,
        name: meta.name || meta.full_name || '',
        avatar,
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        hasFlow: sub?.status === 'active' && ['flow', 'pulse'].includes(sub?.plan_id),
        planId: sub?.status === 'active' ? (sub?.plan_id || null) : null,
        subscriptionStatus: sub?.status || 'none',
        activeRecently: activeUserIds.has(u.id),
      };
    });

    res.json({ users: usersData });
  } catch (error) {
    console.error('Erro ao buscar usuários:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/grant', requireAdmin, async (req, res) => {
  const { userId, plan } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId obrigatório' });
  }

  const resolvedPlan = plan === 'pulse' ? 'pulse' : 'flow';

  try {
    const grantPeriodEnd = new Date();
    grantPeriodEnd.setFullYear(grantPeriodEnd.getFullYear() + 1);

    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin.from('subscriptions').update({
        status: 'active',
        plan_id: resolvedPlan,
        current_period_end: grantPeriodEnd.toISOString(),
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);
    } else {
      await supabaseAdmin.from('subscriptions').insert({
        user_id: userId,
        status: 'active',
        plan_id: resolvedPlan,
        current_period_end: grantPeriodEnd.toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    console.log(`[Admin] Plano ${resolvedPlan} concedido para userId=${userId}`);
    res.json({ success: true, plan: resolvedPlan });
  } catch (error) {
    console.error('Erro ao conceder acesso:', error.message);
    res.status(500).json({ error: error.message });
  }
});

async function buildAdminStatsPayload() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOf7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const routeEventsPromise = (async () => {
    const { data, error } = await supabaseAdmin
      .from('site_route_events')
      .select('id, user_id, path, label, referrer, country, state, city, timezone, ip_hash, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      if (isMissingTableError(error)) return { events: [], status: 'not_configured' };
      console.warn('[AdminStats] Falha ao buscar rotas:', error.message);
      return { events: [], status: 'error' };
    }

    return {
      events: data || [],
      status: data?.length ? 'active' : 'empty',
    };
  })();

  const authUsersPromise = supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    .then(({ data, error }) => {
      if (error) {
        console.warn('[AdminStats] Falha ao buscar usuarios auth:', error.message);
        return [];
      }
      return data?.users || [];
    })
    .catch((error) => {
      console.warn('[AdminStats] Falha inesperada ao buscar usuarios auth:', error.message);
      return [];
    });

  const [
    totalMessagesResp,
    totalTasksResp,
    firstMessageUsersResp,
    wppConversationsUsedResp,
    messagesTodayResp,
    totalThreadsResp,
    recentMessagesResp,
    recentThreadsResp,
    bindingsResp,
    routeEventsResult,
    authUsers,
  ] = await Promise.all([
    supabaseAdmin.from('conversation_messages').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('tasks').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('channel_bindings').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('conversation_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel', 'whatsapp')
      .gte('created_at', startOfMonth),
    supabaseAdmin
      .from('conversation_messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfDay),
    supabaseAdmin.from('conversation_threads').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('conversation_messages')
      .select('id, thread_id, user_id, channel, direction, role, message_type, content, status, provider, model, latency_ms, fallback_used, tool_count, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('conversation_threads')
      .select('id, user_id, channel, title, unread_count, metadata, created_at, last_message_at')
      .order('last_message_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('channel_bindings')
      .select('id, user_id, channel, metadata, last_seen_at, last_inbound_at, created_at')
      .limit(1000),
    routeEventsPromise,
    authUsersPromise,
  ]);

  const requiredError = [
    totalMessagesResp.error,
    totalTasksResp.error,
    firstMessageUsersResp.error,
    wppConversationsUsedResp.error,
    messagesTodayResp.error,
    recentMessagesResp.error,
    bindingsResp.error,
  ].find(Boolean);
  if (requiredError) throw requiredError;

  if (totalThreadsResp.error && !isMissingTableError(totalThreadsResp.error)) throw totalThreadsResp.error;
  if (recentThreadsResp.error && !isMissingTableError(recentThreadsResp.error)) throw recentThreadsResp.error;

  const recentMessages = recentMessagesResp.data || [];
  const recentThreads = recentThreadsResp.data || [];
  const bindings = bindingsResp.data || [];
  const routeEvents = routeEventsResult.events || [];

  const routesByPath = new Map();
  for (const event of routeEvents) {
    const path = normalizeRoutePath(event.path);
    const current = routesByPath.get(path) || {
      path,
      label: event.label || routeLabel(path),
      visits: 0,
      userKeys: new Set(),
      lastSeenAt: event.created_at || null,
    };

    current.visits += 1;
    const userKey = event.user_id || event.ip_hash || event.id;
    if (userKey) current.userKeys.add(userKey);
    if (!current.lastSeenAt || new Date(event.created_at) > new Date(current.lastSeenAt)) {
      current.lastSeenAt = event.created_at;
    }
    routesByPath.set(path, current);
  }

  const totalRouteVisits = routeEvents.length;
  const routes = [...routesByPath.values()]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8)
    .map((route) => ({
      path: route.path,
      label: route.label,
      visits: route.visits,
      uniqueUsers: route.userKeys.size,
      percentage: pct(route.visits, totalRouteVisits),
      lastSeenAt: route.lastSeenAt,
    }));

  const userStateById = new Map();
  const statesByKey = new Map();
  const ensureStateGroup = (state, country) => {
    const label = state || country || 'Nao identificado';
    const key = `${country || '--'}:${label}`;
    const current = statesByKey.get(key) || {
      state: label,
      country: country || '--',
      usersSet: new Set(),
      visitorSet: new Set(),
      visits: 0,
      conversations: 0,
      messages: 0,
      lastSeenAt: null,
    };
    statesByKey.set(key, current);
    return { key, group: current };
  };

  for (const authUser of authUsers) {
    const metadata = { ...(authUser.user_metadata || {}), ...(authUser.app_metadata || {}) };
    const state = pickUserState(metadata);
    const country = metadata.country || metadata.pais || metadata.country_code || null;
    if (!state && !country) continue;

    const { key, group } = ensureStateGroup(state, country);
    group.usersSet.add(authUser.id);
    userStateById.set(authUser.id, key);
  }

  for (const event of routeEvents) {
    if (!event.state && !event.country) continue;
    const { key, group } = ensureStateGroup(event.state, event.country);
    group.visits += 1;
    const visitorKey = event.user_id || event.ip_hash || event.id;
    if (visitorKey) group.visitorSet.add(visitorKey);
    if (event.user_id && !userStateById.has(event.user_id)) userStateById.set(event.user_id, key);
    if (!group.lastSeenAt || new Date(event.created_at) > new Date(group.lastSeenAt)) {
      group.lastSeenAt = event.created_at;
    }
  }

  for (const binding of bindings) {
    const metadata = binding.metadata || {};
    const state = pickUserState(metadata);
    const country = metadata.country || metadata.pais || metadata.country_code || null;
    if (!state && !country) continue;

    const { key, group } = ensureStateGroup(state, country);
    if (binding.user_id) {
      group.usersSet.add(binding.user_id);
      if (!userStateById.has(binding.user_id)) userStateById.set(binding.user_id, key);
    }
  }

  for (const thread of recentThreads) {
    const key = userStateById.get(thread.user_id);
    if (!key) continue;
    const group = statesByKey.get(key);
    if (group) group.conversations += 1;
  }

  for (const message of recentMessages) {
    const key = userStateById.get(message.user_id);
    if (!key) continue;
    const group = statesByKey.get(key);
    if (group) group.messages += 1;
  }

  const states = [...statesByKey.values()]
    .map((group) => ({
      state: group.state,
      country: group.country,
      users: group.usersSet.size || group.visitorSet.size,
      visits: group.visits,
      conversations: group.conversations,
      messages: group.messages,
      lastSeenAt: group.lastSeenAt,
    }))
    .sort((a, b) => (b.visits + b.users + b.messages) - (a.visits + a.users + a.messages))
    .slice(0, 8);

  const channelGroups = new Map();
  for (const message of recentMessages) {
    const channel = message.channel || 'web';
    const current = channelGroups.get(channel) || {
      channel,
      messages: 0,
      inbound: 0,
      outbound: 0,
      userKeys: new Set(),
    };

    current.messages += 1;
    if (message.direction === 'inbound' || message.role === 'user') current.inbound += 1;
    if (message.direction === 'outbound' || message.role === 'assistant') current.outbound += 1;
    if (message.user_id) current.userKeys.add(message.user_id);
    channelGroups.set(channel, current);
  }

  const channels = [...channelGroups.values()]
    .sort((a, b) => b.messages - a.messages)
    .map((channel) => ({
      channel: channel.channel,
      messages: channel.messages,
      inbound: channel.inbound,
      outbound: channel.outbound,
      users: channel.userKeys.size,
      percentage: pct(channel.messages, recentMessages.length),
    }));

  const assistantTelemetry = recentMessages.filter((message) => message.role === 'assistant');
  const latencyValues = assistantTelemetry
    .map((message) => Number(message.latency_ms))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgLatencyMs = latencyValues.length
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : 0;
  const fallbackCount = assistantTelemetry.filter((message) => message.fallback_used).length;
  const activeUsers7d = new Set(
    recentMessages
      .filter((message) => message.user_id && message.created_at >= startOf7d)
      .map((message) => message.user_id)
  ).size;

  return {
    totalMessages: totalMessagesResp.count || 0,
    totalTasks: totalTasksResp.count || 0,
    firstMessageUsers: firstMessageUsersResp.count || 0,
    wppConversationsUsed: wppConversationsUsedResp.count || 0,
    wppFreeLimit: 1000,
    analytics: {
      routeTrackingStatus: routeEventsResult.status,
      routes,
      states,
      channels,
      conversations: {
        totalThreads: totalThreadsResp.count || 0,
        messagesToday: messagesTodayResp.count || 0,
        activeUsers7d,
        assistantResponses: assistantTelemetry.length,
        avgLatencyMs,
        fallbackRate: pct(fallbackCount, assistantTelemetry.length),
        toolCalls: assistantTelemetry.reduce((sum, message) => sum + (Number(message.tool_count) || 0), 0),
        unreadThreads: recentThreads.filter((thread) => Number(thread.unread_count || 0) > 0).length,
        lastMessageAt: recentMessages[0]?.created_at || null,
      },
      trainingSignals: buildTrainingSignals(recentMessages),
    },
  };
}

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    return res.json(await buildAdminStatsPayload());

    // Total messages
    const { count: totalMessages } = await supabaseAdmin
      .from('conversation_messages')
      .select('*', { count: 'exact', head: true });

    // Total tasks
    const { count: totalTasks } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true });

    // Users with active bindings (those who sent/received messages)
    const { count: firstMessageUsers } = await supabaseAdmin
      .from('channel_bindings')
      .select('*', { count: 'exact', head: true });

    // WPP usage this month
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count: wppConversationsUsed } = await supabaseAdmin
      .from('conversation_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel', 'whatsapp')
      .gte('created_at', startOfMonth);

    res.json({
      totalMessages: totalMessages || 0,
      totalTasks: totalTasks || 0,
      firstMessageUsers: firstMessageUsers || 0,
      wppConversationsUsed: wppConversationsUsed || 0,
      wppFreeLimit: 1000
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas do painel:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Admin Messages Log ────────────────────────────────────────────
app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  const { page = 1, limit = 50, channel, search, userId } = req.query;
  try {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    const offset = (pageNum - 1) * limitNum;

    // Build query for messages
    let query = supabaseAdmin
      .from('conversation_messages')
      .select('id, thread_id, user_id, channel, direction, role, message_type, content, status, provider, model, latency_ms, fallback_used, tool_count, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (channel && channel !== 'all') {
      query = query.eq('channel', channel);
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: messages, count, error: msgError } = await query;
    if (msgError) throw msgError;

    // Get unique user IDs to fetch user info
    const userIds = [...new Set((messages || []).map(m => m.user_id).filter(Boolean))];
    if (userId && !userIds.includes(userId)) userIds.push(userId);

    let usersMap = {};

    if (userIds.length > 0) {
      // Fetch users individually by ID to avoid first-page limits of listUsers()
      await Promise.all(userIds.map(async (id) => {
        try {
          const { data: { user: authUser }, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(id);
          if (!getUserErr && authUser) {
            usersMap[id] = {
              name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Desconhecido',
              email: authUser.email,
              avatar: authUser.user_metadata?.avatar_url || null,
            };
          }
        } catch (err) {
          console.error(`Erro ao buscar usuário ${id}:`, err);
        }
      }));
    }

    console.log(`[Admin] Buscando mensagens para userId=${userId || 'todos'}. Encontradas: ${messages?.length || 0}`);

    // Merge user info into messages
    let enrichedMessages = (messages || []).map(m => ({
      ...m,
      user: usersMap[m.user_id] || { name: 'Desconhecido', email: '—', avatar: null },
    }));

    // Apply search filter (client-side since we need user info)
    if (search) {
      const searchLower = search.toLowerCase();
      enrichedMessages = enrichedMessages.filter(m =>
        m.user.name.toLowerCase().includes(searchLower) ||
        m.user.email.toLowerCase().includes(searchLower) ||
        (m.content && m.content.toLowerCase().includes(searchLower))
      );
    }

    res.json({
      messages: enrichedMessages,
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens admin:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Workspace Members ─────────────────────────────────────────────

// Retorna o workspace ao qual o usuário pertence como membro convidado
app.get('/api/workspace/my-membership', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    const { data: membership } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_owner_id')
      .eq('member_user_id', userId)
      .maybeSingle();

    if (!membership) return res.json({ membership: null });

    // Busca informações do dono do workspace
    const { data: { user: owner }, error: ownerErr } = await supabaseAdmin.auth.admin.getUserById(membership.workspace_owner_id);
    if (ownerErr || !owner) return res.json({ membership: null });

    // Busca o plano do dono
    const { data: ownerSub } = await supabaseAdmin
      .from('subscriptions')
      .select('status, plan_id')
      .eq('user_id', membership.workspace_owner_id)
      .maybeSingle();

    // Busca nome customizado do workspace
    const { data: wsData } = await supabaseAdmin
      .from('workspaces')
      .select('name')
      .eq('created_by', membership.workspace_owner_id)
      .maybeSingle();

    const defaultName = owner.user_metadata?.full_name || owner.user_metadata?.name || owner.email?.split('@')[0] || 'Workspace';

    res.json({
      membership: {
        ownerName: defaultName,
        ownerEmail: owner.email,
        planId: ownerSub?.plan_id || null,
        workspaceName: wsData?.name || defaultName,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retorna nome do workspace do owner
app.get('/api/workspace/name', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    const { data } = await supabaseAdmin
      .from('workspaces')
      .select('name')
      .eq('created_by', userId)
      .maybeSingle();
    res.json({ name: data?.name || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualiza nome do workspace (só o dono pode)
app.patch('/api/workspace/name', async (req, res) => {
  const { ownerUserId, name } = req.body;
  if (!ownerUserId || !name?.trim()) return res.status(400).json({ error: 'ownerUserId e name obrigatórios' });

  try {
    const { error } = await supabaseAdmin
      .from('workspaces')
      .upsert({ created_by: ownerUserId, name: name.trim() }, { onConflict: 'created_by' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincroniza nome e avatar do membro no workspace_members (bypassa RLS via supabaseAdmin)
app.patch('/api/workspace/sync-profile', async (req, res) => {
  const { userId, name, avatar } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    const updates = {};
    if (name !== undefined) updates.member_name = name;
    if (avatar !== undefined) updates.member_avatar = avatar;

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin
        .from('workspace_members')
        .update(updates)
        .eq('member_user_id', userId);
    }

    // Atualiza display_name no binding do WhatsApp para que lembretes usem o nome novo
    if (name !== undefined) {
      await supabaseAdmin
        .from('channel_bindings')
        .update({ display_name: name })
        .eq('user_id', userId)
        .eq('channel', 'whatsapp');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retorna tarefas compartilhadas do workspace (visíveis a todos os membros)
// - Se userId é membro: retorna tarefas workspace do owner dele
// - Se userId é owner: retorna todas as tarefas workspace do seu workspace (próprias + de membros)
app.get('/api/workspace/shared-tasks', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    // Verifica se é membro de algum workspace
    const { data: membership } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_owner_id')
      .eq('member_user_id', userId)
      .maybeSingle();

    let ownerId = membership ? membership.workspace_owner_id : userId;

    // Verifica se userId é owner (tem membros)
    const { count: memberCount } = await supabaseAdmin
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_owner_id', userId);

    const isOwner = !membership && (memberCount || 0) > 0;
    const isMember = !!membership;

    if (!isOwner && !isMember) {
      return res.json({ tasks: [], workspaceOwnerId: null });
    }

    // Busca tarefas workspace do owner (próprias do owner)
    const { data: ownerTasks, error: ownerErr } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('workspace_owner_id', ownerId)
      .eq('visibility', 'workspace')
      .order('created_at', { ascending: false });

    if (ownerErr) throw ownerErr;

    // Busca info dos autores e responsáveis para exibição no card
    const allUserIds = [...new Set([
      ...(ownerTasks || []).map(t => t.user_id),
      ...(ownerTasks || []).map(t => t.assigned_to),
    ].filter(Boolean))];
    let usersMap = {};

    if (allUserIds.length > 0) {
      const { data: { users }, error: usersErr } = await supabaseAdmin.auth.admin.listUsers();
      if (!usersErr && users) {
        for (const u of users) {
          if (allUserIds.includes(u.id)) {
            usersMap[u.id] = {
              name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split('@')[0] || 'Membro',
              avatar: u.user_metadata?.avatar_url || null,
              email: u.email,
            };
          }
        }
      }
    }

    const tasks = (ownerTasks || []).map(t => ({
      ...t,
      author: usersMap[t.user_id] || null,
      assignee: t.assigned_to ? (usersMap[t.assigned_to] || null) : null,
    }));

    res.json({ tasks, workspaceOwnerId: ownerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria uma tarefa compartilhada no workspace (membro cria tarefa visível para todos)
app.post('/api/workspace/shared-tasks', async (req, res) => {
  const { userId, task } = req.body;
  if (!userId || !task) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

  try {
    // Descobre o ownerId do workspace
    const { data: membership } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_owner_id')
      .eq('member_user_id', userId)
      .maybeSingle();

    const ownerId = membership ? membership.workspace_owner_id : userId;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert([{
        user_id: userId,
        workspace_owner_id: ownerId,
        visibility: 'workspace',
        title: task.title,
        status: task.status || 'todo',
        priority: task.priority || 'medium',
        due_date: (task.dueDate && task.dueDate !== 'Sem prazo') ? task.dueDate : null,
        source: task.source || 'user',
        progress: task.progress || 0,
        description: task.description || '',
        subtasks: task.subtasks || [],
        assigned_to: task.assignedTo || null,
        assigned_by: task.assignedTo ? userId : null,
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ task: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atribui ou transfere tarefa workspace para um membro
app.patch('/api/workspace/tasks/:taskId/assign', async (req, res) => {
  const { taskId } = req.params;
  const { assignedTo, assignedBy } = req.body;
  if (!taskId || !assignedBy) return res.status(400).json({ error: 'taskId e assignedBy obrigatórios' });

  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({
        assigned_to: assignedTo || null,
        assigned_by: assignedTo ? assignedBy : null,
      })
      .eq('id', taskId)
      .select('id, assigned_to, assigned_by')
      .single();

    if (error) throw error;
    res.json({ success: true, task: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deleta uma tarefa (pessoal ou workspace) — usa supabaseAdmin para bypass RLS
app.delete('/api/workspace/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  if (!taskId || !userId) return res.status(400).json({ error: 'taskId e userId obrigatórios' });

  try {
    // Busca a tarefa para verificar permissões
    const { data: task, error: fetchErr } = await supabaseAdmin
      .from('tasks')
      .select('id, user_id, visibility, workspace_owner_id')
      .eq('id', taskId)
      .single();

    if (fetchErr || !task) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }

    // Verifica se o userId tem permissão para deletar:
    // 1) É o criador da tarefa
    // 2) É o dono do workspace (para tarefas workspace)
    // 3) É membro do workspace (pode deletar suas próprias tarefas workspace)
    const isCreator = task.user_id === userId;
    const isWorkspaceOwner = task.visibility === 'workspace' && task.workspace_owner_id === userId;

    let isMemberOfWorkspace = false;
    if (task.visibility === 'workspace' && !isCreator && !isWorkspaceOwner) {
      const { data: membership } = await supabaseAdmin
        .from('workspace_members')
        .select('id')
        .eq('member_user_id', userId)
        .eq('workspace_owner_id', task.workspace_owner_id)
        .maybeSingle();
      isMemberOfWorkspace = !!membership;
    }

    if (!isCreator && !isWorkspaceOwner && !isMemberOfWorkspace) {
      return res.status(403).json({ error: 'Sem permissão para excluir esta tarefa' });
    }

    // Deleta via supabaseAdmin (bypass RLS)
    const { error: delErr } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (delErr) throw delErr;

    console.log(`[Tasks] Tarefa ${taskId} deletada por userId=${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Tasks] Erro ao deletar tarefa:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/members', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  try {
    const { data: members, error } = await supabaseAdmin
      .from('workspace_members')
      .select('*')
      .eq('workspace_owner_id', userId)
      .order('invited_at', { ascending: true });

    if (error) throw error;

    // Atualiza nome e avatar dos membros com os dados mais recentes do Auth
    if (members && members.length > 0) {
      await Promise.all(members.map(async (m) => {
        if (m.member_user_id) {
          try {
            const { data: { user: authUser }, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(m.member_user_id);
            if (!getUserErr && authUser) {
              const freshName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || null;
              const freshAvatar = authUser.user_metadata?.avatar_url || null;

              if (m.member_name !== freshName || m.member_avatar !== freshAvatar) {
                m.member_name = freshName;
                m.member_avatar = freshAvatar;

                // Atualiza em background para cache
                supabaseAdmin.from('workspace_members').update({
                  member_name: freshName,
                  member_avatar: freshAvatar
                }).eq('id', m.id).then();
              }
            }
          } catch (e) {
            console.error(`Erro ao atualizar perfil do membro ${m.member_user_id}:`, e);
          }
        }
      }));
    }

    // Buscar também convites pendentes
    const { data: invites, error: invitesError } = await supabaseAdmin
      .from('workspace_invites')
      .select('*')
      .eq('workspace_owner_id', userId)
      .order('created_at', { ascending: true });

    if (invitesError) throw invitesError;

    // Mesclar membros e convites pendentes
    const allMembers = [
      ...(members || []),
      ...(invites || []).map(inv => ({
        id: inv.id,
        is_invite: true,
        workspace_owner_id: inv.workspace_owner_id,
        member_user_id: null,
        member_email: inv.email,
        member_name: null,
        member_avatar: null,
        role: 'pending',
        invited_at: inv.created_at
      }))
    ];

    res.json({ members: allMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const WORKSPACE_MEMBER_LIMIT = 5;

// ── Recuperação de senha via código de 6 dígitos ──────────────────────────────

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  try {
    // Verifica se o usuário existe
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
      // Retorna sucesso mesmo assim para não expor quais emails existem
      return res.json({ ok: true });
    }

    // Gera código de 6 dígitos
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Remove códigos anteriores do mesmo email
    await supabaseAdmin.from('password_reset_codes').delete().eq('email', email.toLowerCase());

    // Salva novo código
    const { error: insertErr } = await supabaseAdmin.from('password_reset_codes').insert({
      email: email.toLowerCase(),
      code,
      expires_at: expiresAt.toISOString(),
    });
    if (insertErr) throw insertErr;

    // Envia email via Resend
    await resend.emails.send({
      from: 'Flui <noreply@flui.ia.br>',
      to: email,
      subject: 'Seu código de redefinição de senha — Flui',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #37352f;">
          <img src="https://uzyngunwxqjsukbhieei.supabase.co/storage/v1/object/public/Fotos/ZombieingDoodle.png" alt="Flui" style="width: 140px; height: auto; margin-bottom: 24px; display: block;">
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Redefinição de senha</h2>
          <p style="font-size: 14px; color: #6b6b6b; margin-bottom: 24px;">
            Use o código abaixo para redefinir sua senha. Ele expira em <strong>15 minutos</strong>.
          </p>
          <div style="background: #f7f7f5; border: 1px solid #e9e9e7; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 36px; font-weight: 800; letter-spacing: 12px; color: #37352f; font-family: monospace;">${code}</span>
          </div>
          <p style="font-size: 12px; color: #aaa; margin-top: 8px;">
            Se você não solicitou a redefinição de senha, pode ignorar este email com segurança.
          </p>
        </div>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-reset-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email e código obrigatórios' });

  try {
    const { data: record, error } = await supabaseAdmin
      .from('password_reset_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !record) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });

  try {
    // Verifica código
    const { data: record, error: codeErr } = await supabaseAdmin
      .from('password_reset_codes')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (codeErr || !record) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }

    // Busca o usuário
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Atualiza a senha
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateErr) throw updateErr;

    // Marca código como usado
    await supabaseAdmin.from('password_reset_codes').update({ used: true }).eq('id', record.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/workspace/invite', async (req, res) => {
  const { ownerUserId, inviteEmail } = req.body;
  if (!ownerUserId || !inviteEmail) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

  try {
    // Verifica limite de membros (aceitos + pendentes)
    const { count: memberCount } = await supabaseAdmin
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_owner_id', ownerUserId);

    const { count: inviteCount } = await supabaseAdmin
      .from('workspace_invites')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_owner_id', ownerUserId);

    const total = (memberCount || 0) + (inviteCount || 0);
    if (total >= WORKSPACE_MEMBER_LIMIT) {
      return res.status(403).json({ error: `Limite de ${WORKSPACE_MEMBER_LIMIT} membros atingido.` });
    }

    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const owner = users.find(u => u.id === ownerUserId);
    const target = users.find(u => u.email?.toLowerCase() === inviteEmail.toLowerCase());

    if (target && target.id === ownerUserId) {
      return res.status(400).json({ error: 'Você não pode convidar a si mesmo.' });
    }

    // Criar convite
    const { data: invite, error: insertErr } = await supabaseAdmin
      .from('workspace_invites')
      .insert({
        workspace_owner_id: ownerUserId,
        email: inviteEmail.toLowerCase()
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'Este usuário já possui um convite ou já é membro.' });
      }
      throw insertErr;
    }

    // Envia email de convite via Resend
    const ownerName = owner?.user_metadata?.full_name || owner?.user_metadata?.name || owner?.email?.split('@')[0] || 'Alguém';
    const inviteUrl = `${FRONTEND_URL}/invite?invite_token=${invite.token}`;

    resend.emails.send({
      from: 'Flui <noreply@flui.ia.br>',
      to: inviteEmail,
      subject: `${ownerName} te convidou para um workspace no Flui`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #37352f;">
          <img src="https://uzyngunwxqjsukbhieei.supabase.co/storage/v1/object/public/Fotos/ZombieingDoodle.png" alt="Workspace" style="width: 140px; height: auto; margin-bottom: 24px; display: block;">
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Você foi convidado!</h2>
          <p style="font-size: 14px; color: #6b6b6b; margin-bottom: 24px;">
            <strong>${ownerName}</strong> te convidou para colaborar no workspace dele no Flui.
          </p>
          <a href="${inviteUrl}" style="display: inline-block; background: #37352f; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Acessar o Flui
          </a>
          <p style="font-size: 12px; color: #aaa; margin-top: 32px;">
            Se você não esperava este convite, pode ignorar este email.
          </p>
        </div>
      `,
    }).catch(err => console.error('[Resend] Erro ao enviar email de convite:', err.message));

    res.json({
      member: {
        id: invite.id,
        is_invite: true,
        member_email: inviteEmail,
        member_name: target ? (target.user_metadata?.full_name || target.user_metadata?.name || null) : null,
        member_avatar: target ? (target.user_metadata?.avatar_url || null) : null,
        role: 'pending',
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/invite-info', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token missing' });

  try {
    const { data: invite, error } = await supabaseAdmin
      .from('workspace_invites')
      .select('workspace_owner_id, email, created_at')
      .eq('token', token)
      .single();

    if (error || !invite) {
      return res.status(404).json({ error: 'Convite inválido ou expirado' });
    }

    const { data: { users }, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
    if (authErr && !users) throw authErr;

    const owner = users?.find(u => u.id === invite.workspace_owner_id);
    const ownerName = owner?.user_metadata?.full_name || owner?.user_metadata?.name || owner?.email?.split('@')[0] || 'Alguém';

    res.json({ ownerName, email: invite.email, ownerId: invite.workspace_owner_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workspace/members/:memberId', async (req, res) => {
  const { memberId } = req.params;
  const { ownerUserId, is_invite } = req.body;
  if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId obrigatório' });

  try {
    if (is_invite) {
      // Convite pendente: só remove o convite
      const { error } = await supabaseAdmin
        .from('workspace_invites')
        .delete()
        .eq('id', memberId)
        .eq('workspace_owner_id', ownerUserId);
      if (error) throw error;
    } else {
      // Membro aceito: busca o member_user_id antes de deletar
      const { data: member } = await supabaseAdmin
        .from('workspace_members')
        .select('member_user_id')
        .eq('id', memberId)
        .eq('workspace_owner_id', ownerUserId)
        .maybeSingle();

      const { error } = await supabaseAdmin
        .from('workspace_members')
        .delete()
        .eq('id', memberId)
        .eq('workspace_owner_id', ownerUserId);
      if (error) throw error;

      // Revogar plano derivado do workspace (só se não tiver Stripe próprio)
      if (member?.member_user_id) {
        const { data: memberSub } = await supabaseAdmin
          .from('subscriptions')
          .select('id, stripe_subscription_id')
          .eq('user_id', member.member_user_id)
          .maybeSingle();

        if (memberSub && !memberSub.stripe_subscription_id) {
          await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('user_id', member.member_user_id);
          console.log(`[Workspace] Plano revogado do membro userId=${member.member_user_id}`);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspace/accept-invite', async (req, res) => {
  const { token, userId } = req.body;
  if (!token || !userId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

  try {
    // 1. Validar convite
    const { data: invite, error: invErr } = await supabaseAdmin
      .from('workspace_invites')
      .select('*')
      .eq('token', token)
      .single();

    if (invErr || !invite) {
      return res.status(404).json({ error: 'Convite Inválido ou já utilizado' });
    }

    // 2. Buscar o usuário
    const { data: user, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // 3. Adicionar ao workspace
    const { error: insertErr } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_owner_id: invite.workspace_owner_id,
        member_user_id: user.user.id,
        member_email: user.user.email,
        member_name: user.user.user_metadata?.full_name || user.user.user_metadata?.name || null,
        member_avatar: user.user.user_metadata?.avatar_url || null,
      });

    if (insertErr && insertErr.code !== '23505') {
      throw insertErr; // ignore if already member
    }

    // 4. Herdar o plano do dono do workspace
    const { data: ownerSub } = await supabaseAdmin
      .from('subscriptions')
      .select('status, plan_id')
      .eq('user_id', invite.workspace_owner_id)
      .maybeSingle();

    if (ownerSub?.status === 'active' && ownerSub?.plan_id) {
      // Verifica se o membro já tem assinatura própria (com Stripe)
      const { data: memberSub } = await supabaseAdmin
        .from('subscriptions')
        .select('id, stripe_subscription_id')
        .eq('user_id', user.user.id)
        .maybeSingle();

      // Só aplica o plano do workspace se o membro não tiver assinatura Stripe própria
      if (!memberSub?.stripe_subscription_id) {
        if (memberSub) {
          await supabaseAdmin
            .from('subscriptions')
            .update({
              status: 'active',
              plan_id: ownerSub.plan_id,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.user.id);
        } else {
          await supabaseAdmin
            .from('subscriptions')
            .insert({
              user_id: user.user.id,
              status: 'active',
              plan_id: ownerSub.plan_id,
              updated_at: new Date().toISOString(),
            });
        }
        console.log(`[Workspace] Plano ${ownerSub.plan_id} herdado pelo membro userId=${user.user.id}`);
      }
    }

    // 5. Remover convite
    await supabaseAdmin
      .from('workspace_invites')
      .delete()
      .eq('id', invite.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/model-info', requireAdmin, (req, res) => {
  res.json({
    modelId: process.env.MODEL_ID || 'meta/llama-3.1-70b-instruct',
    provider: 'NVIDIA NIM',
    description: 'Meta Llama 3.1 70B Instruct (State-of-the-art)'
  });
});

app.get('/api/admin/chat/stream/:sseId', requireAdmin, (req, res) => {
  const { sseId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onStatus = (data) => {
    if (data.sseId === sseId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  agentEvents.on('status', onStatus);

  req.on('close', () => {
    agentEvents.off('status', onStatus);
  });
});

app.post('/api/admin/chat/simulate', requireAdmin, async (req, res) => {
  try {
    const { userId, userName, content, sseId } = req.body;
    if (!userId || !content) return res.status(400).json({ error: 'userId e content são obrigatórios' });

    // Simula exatamente o fluxo de entrada do WhatsApp
    const result = await processConversationTurn({
      userId,
      userName: userName || 'Admin User',
      content: content.trim(),
      incomingChannel: 'whatsapp', // Simula como se viesse do WPP
      preferredThreadChannel: 'whatsapp',
      sseId,
    });

    res.json({
      success: true,
      role: 'assistant',
      content: result.reply,
      telemetry: result.telemetry
    });
  } catch (error) {
    console.error('[Simulate] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();

  const [supabaseStatus, metaStatus, llmPing] = await Promise.all([
    (async () => {
      try {
        const { error } = await supabaseAdmin.from('tasks').select('id').limit(1);
        if (error) throw error;
        return { status: 'ok' };
      } catch (error) {
        return { status: 'error', error: error.message };
      }
    })(),
    (async () => {
      try {
        const response = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}`, {
          headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || `Meta status ${response.status}`);
        }
        return { status: 'ok' };
      } catch (error) {
        return { status: 'error', error: error.message };
      }
    })(),
    pingPrimaryModel(),
  ]);

  res.json({
    status: [supabaseStatus, metaStatus, llmPing].every((item) => item.status === 'ok') ? 'ok' : 'degraded',
    correlationId: getCorrelationId(req),
    latency_ms: Date.now() - startedAt,
    mode: getConversationStoreMode(),
    llm: {
      ...getLlmStatus(),
      ping: llmPing,
    },
    dependencies: {
      supabase: supabaseStatus,
      meta: metaStatus,
    },
  });
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'flui-backend',
    health: '/api/health',
  });
});

app.get('/api/conversations', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const threads = await listThreadsForUser(userId);
    res.json({ threads });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.get('/api/conversations/:threadId/messages', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const thread = await getThreadForUser(userId, req.params.threadId);
    if (!thread) throw createHttpError(404, 'thread_not_found', 'Conversa não encontrada');

    const messages = await listMessagesForThread(thread.id, {
      cursor: req.query.cursor || null,
      limit: Number(req.query.limit || 200),
    });

    res.json({ thread, messages });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.post('/api/conversations/:threadId/messages', async (req, res) => {
  try {
    const { userId, content } = req.body;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');
    if (!content?.trim()) throw createHttpError(400, 'missing_content', 'content required');

    const thread = await getThreadForUser(userId, req.params.threadId);
    if (!thread) throw createHttpError(404, 'thread_not_found', 'Conversa não encontrada');

    const result = await enqueueOutboundConversationMessage({
      userId,
      threadId: thread.id,
      content: content.trim(),
      channel: thread.channel,
      role: 'assistant',
      messageType: 'assistant_text',
    });

    await dispatchOutboundMessageJobs();

    res.status(202).json({
      threadId: thread.id,
      message: result.message,
      status: result.job ? 'queued' : 'sent',
    });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.post('/api/conversations/:threadId/read', async (req, res) => {
  try {
    const userId = req.body.userId || req.query.userId;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const thread = await getThreadForUser(userId, req.params.threadId);
    if (!thread) throw createHttpError(404, 'thread_not_found', 'Conversa não encontrada');

    await markThreadRead(thread.id);
    res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.get('/api/reminders', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const binding = await findBindingByUserId(userId, 'whatsapp');
    const message = await getReminderPreview(userId, binding?.display_name || 'você');

    res.json({ message: message || null });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.get('/api/whatsapp/linked-phone', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');
    const binding = await findBindingByUserId(userId, 'whatsapp');
    res.json({ phone: binding?.external_user_id || null });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.post('/api/whatsapp/link-phone', async (req, res) => {
  try {
    const { userId, phone } = req.body;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');
    if (!phone) throw createHttpError(400, 'missing_phone', 'phone required');

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length < 10) throw createHttpError(400, 'invalid_phone', 'Número inválido');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !user) throw createHttpError(404, 'user_not_found', 'Usuário não encontrado');

    const userName = user.user_metadata?.full_name || user.user_metadata?.name || 'você';

    await upsertChannelBinding({
      userId,
      channel: 'whatsapp',
      externalUserId: normalizedPhone,
      displayName: userName,
      authenticated: true,
      metadata: { email: user.email, phone: normalizedPhone },
    });

    const sent = await sendWhatsAppMessage(normalizedPhone,
      `Conta conectada, *${userName}* 🚀\n\nAgora é só me mandar uma mensagem por aqui e eu te ajudo com suas tarefas!`
    );

    if (!sent) {
      throw createHttpError(400, 'whatsapp_unreachable', 'Este número não foi encontrado no WhatsApp ou não é acessível.');
    }

    res.json({ ok: true, phone: normalizedPhone });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.delete('/api/whatsapp/link-phone', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const binding = await findBindingByUserId(userId, 'whatsapp');
    if (binding?.external_user_id) {
      await deleteChannelBinding('whatsapp', binding.external_user_id);
      await deleteSession(binding.external_user_id);
    }

    res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.get('/api/whatsapp/messages', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');

    const { thread, messages } = await getThreadMessagesForUser(userId, 'whatsapp');
    if (!thread) return res.json([]);

    res.json(messages.map((message) => ({
      id: message.id,
      text: message.content,
      from: message.direction === 'outbound' ? 'me' : thread.title,
      to: thread.metadata?.phone || thread.title,
      timestamp: message.created_at,
      sentByMe: message.direction === 'outbound',
      status: message.status,
      threadId: thread.id,
    })));
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { userId, to, message, template } = req.body;
    if (!userId) throw createHttpError(400, 'missing_user_id', 'userId required');
    if (!to) throw createHttpError(400, 'missing_target', 'to required');
    if (!message && !template) throw createHttpError(400, 'missing_payload', 'message or template required');

    const result = await enqueueOutboundConversationMessage({
      userId,
      externalUserId: to,
      channel: 'whatsapp',
      content: message || `Template enviado: ${template}`,
      role: 'assistant',
      messageType: template ? 'system_notice' : 'assistant_text',
      metadata: template ? { template } : {},
    });

    await dispatchOutboundMessageJobs();

    res.status(202).json({
      ok: true,
      threadId: result.thread.id,
      messageId: result.message.id,
      status: result.job ? 'queued' : 'sent',
    });
  } catch (error) {
    return sendApiError(res, req, error, 500);
  }
});

// ================== LEMBRETES PROATIVOS (WhatsApp) ==================
// Verifica a cada 15 minutos se é hora de enviar lembretes
const REMINDER_INTERVAL_MS = 15 * 60 * 1000; // 15 min

setInterval(() => {
  runReminderCycle(async (userId, phone, message) => {
    lastProactiveMessageAt.set(userId, Date.now());
    return enqueueSystemWhatsAppMessage(userId, message, 'assistant_text');
  }).catch((error) => console.error('[Reminders] Worker error:', error.message));
}, REMINDER_INTERVAL_MS);

// Roda uma vez ao iniciar
setTimeout(() => {
  console.log('📋 Sistema de lembretes ativo (verifica a cada 15 min)');
  runReminderCycle(async (userId, phone, message) => {
    return enqueueSystemWhatsAppMessage(userId, message, 'assistant_text');
  }).catch((error) => console.error('[Reminders] Worker error:', error.message));
}, 30_000);

// ── Behavioral Profile: atualiza perfis 1x por dia (3h da manhã SP) ─────────
setInterval(async () => {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()), 10);
  if (hour !== 3) return; // Só roda às 3h da manhã

  console.log('[BehavioralProfile] Atualizando perfis...');
  try {
    const sessions = await buildReminderSessions();
    for (const [, session] of Object.entries(sessions)) {
      if (session.authenticated && session.userId) {
        await analyzeAndUpdateProfile(session.userId);
      }
    }
    console.log('[BehavioralProfile] Perfis atualizados com sucesso');
  } catch (err) {
    console.error('[BehavioralProfile] Erro ao atualizar perfis:', err.message);
  }
}, 60 * 60 * 1000); // Verifica a cada 1h

setInterval(() => {
  dispatchOutboundMessageJobs().catch((error) => {
    console.error('[OutboundJobs] Worker error:', error.message);
  });
}, 2_000);

setTimeout(() => {
  dispatchOutboundMessageJobs().catch((error) => {
    console.error('[OutboundJobs] Startup error:', error.message);
  });
}, 1_000);

// ================== TIMERS DE TAREFAS ==================
// Verifica a cada minuto avisos prévios e timers expirados

// ── Gerador de mensagens de timer via IA (com fallback em templates) ──────────

const TIMER_WARN_FALLBACK = [
  '{name}, daqui a pouco é hora de: "{title}" (faltam {time})',
  'Ei {name}, lembrete: "{title}" em {time}',
  '{name}, não esquece — "{title}" daqui {time}',
];

const TIMER_FIRE_FALLBACK = [
  '{name}, é agora: "{title}"',
  'Ei {name}, hora de: "{title}"',
  '{name}, bora — "{title}"',
];

function pickFallbackTemplate(templates, name, title, timeLabel) {
  const tpl = templates[Math.floor(Math.random() * templates.length)];
  return tpl
    .replace('{name}', name)
    .replace('{title}', title)
    .replace('{time}', timeLabel || '');
}

async function generateTimerMessage(name, title, type, timeLabel) {
  const isWarn = type === 'warn';
  const contextLine = isWarn
    ? `Faltam ${timeLabel} para o horário da tarefa.`
    : 'O timer da tarefa acabou agora.';

  const prompt = `Você é o Lui, assistente de produtividade no WhatsApp. Gere UMA mensagem curta (máximo 2 frases) avisando ${name} sobre a tarefa "${title}". ${contextLine}

Regras obrigatórias:
- Tom casual, de amigo, português brasileiro
- NUNCA use emojis
- NUNCA repita literalmente o título — mencione a tarefa de forma natural
- Varie a estrutura (não comece sempre com o nome)
- Responda APENAS com o texto da mensagem, sem explicações`;

  try {
    const { response } = await createChatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.0,
      max_tokens: 80,
    }, { preferFallback: false });
    const text = response.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  } catch (err) {
    console.warn(`[Timer] IA falhou ao gerar mensagem, usando fallback: ${err.message}`);
  }

  // Fallback para templates estáticos
  const pool = isWarn ? TIMER_WARN_FALLBACK : TIMER_FIRE_FALLBACK;
  return pickFallbackTemplate(pool, name, title, timeLabel);
}

// Aviso prévio: envia X minutos antes do timer expirar
// Regra: <= 5min → 1min antes | <= 30min → 5min antes | <= 90min → 15min antes | > 90min → 1h antes
function warnBeforeMs(timerAt) {
  const totalMs = new Date(timerAt).getTime() - Date.now();
  const totalMin = totalMs / 60_000;
  if (totalMin <= 5) return 1 * 60_000;  // < 5min:  avisa 1min antes
  if (totalMin <= 30) return 5 * 60_000;  // < 30min: avisa 5min antes
  if (totalMin <= 90) return 15 * 60_000;  // < 90min: avisa 15min antes
  return 60 * 60_000;                       // > 90min: avisa 1h antes
}

function formatWarnLabel(timerAt) {
  const msLeft = new Date(timerAt).getTime() - Date.now();
  const minsLeft = Math.ceil(msLeft / 60_000);
  if (minsLeft >= 60) {
    const h = Math.floor(minsLeft / 60);
    const m = minsLeft % 60;
    return m > 0 ? `${h}h${m}min` : `${h} hora${h > 1 ? 's' : ''}`;
  }
  return minsLeft <= 1 ? '1 minuto' : `${minsLeft} minutos`;
}

async function sendTimerMessage(userId, title, msg) {
  return enqueueSystemWhatsAppMessage(userId, msg, 'assistant_text');
}

// ── Janela de 24h do WhatsApp ─────────────────────────────────────────────────
async function isWithin24hWindow(userId) {
  try {
    const { data: binding } = await supabaseAdmin
      .from('channel_bindings')
      .select('last_inbound_at')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .maybeSingle();
    if (!binding?.last_inbound_at) return false;
    const windowMs = 24 * 60 * 60 * 1000;
    return (Date.now() - new Date(binding.last_inbound_at).getTime()) < windowMs;
  } catch {
    return true; // Em caso de erro, não bloquear o envio
  }
}

async function saveMissedFollowup(userId, taskId, taskTitle, reminderType) {
  try {
    await supabaseAdmin.from('pending_followups').insert({
      user_id: userId,
      task_id: taskId || null,
      task_title: taskTitle,
      reminder_type: reminderType,
      missed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[24hWindow] Erro ao salvar follow-up:', err.message);
  }
}

async function checkTaskTimers() {
  try {
    const now = new Date();

    // ── PARTE 1: Timers na tarefa principal ──────────────────────────────────
    const { data: tasks, error } = await supabaseAdmin
      .from('tasks')
      .select('id, title, user_id, timer_at, timer_warned')
      .eq('timer_fired', false)
      .not('timer_at', 'is', null)
      .in('status', ['todo', 'doing']);

    if (error) {
      console.error('[Timer] Erro ao buscar timers:', error.message);
    } else {
      for (const task of (tasks || [])) {
        const timerMs = new Date(task.timer_at).getTime();
        const userName = (await findBindingByUserId(task.user_id, 'whatsapp'))?.display_name || 'você';

        if (timerMs <= now.getTime()) {
          const { error: upErr } = await supabaseAdmin
            .from('tasks')
            .update({ timer_fired: true, timer_fired_at: new Date().toISOString() })
            .eq('id', task.id);
          if (upErr) { console.error(`[Timer] Erro ao marcar fired:`, upErr.message); continue; }
          const inWindow = await isWithin24hWindow(task.user_id);
          if (!inWindow) {
            await saveMissedFollowup(task.user_id, task.id, task.title, 'timer');
            console.log(`[Timer] Janela 24h fechada — follow-up salvo → "${task.title}"`);
          } else {
            const msg = await generateTimerMessage(userName, task.title, 'fire', null);
            await sendTimerMessage(task.user_id, task.title, msg);
            console.log(`[Timer] Expirado (${task.timer_warned ? 'com' : 'sem'} warn previo, enviando final) -> "${task.title}"`);
          }
          continue;
        }

        if (!task.timer_warned) {
          const warnMs = warnBeforeMs(task.timer_at);
          const timeUntilTimer = timerMs - now.getTime();
          // Só envia aviso prévio se ainda faltam mais de 5 minutos — evita duplicar mensagem em timers curtos
          const MIN_WARN_BUFFER_MS = 5 * 60_000;
          if (timeUntilTimer <= warnMs && timeUntilTimer > MIN_WARN_BUFFER_MS) {
            const inWindow = await isWithin24hWindow(task.user_id);
            if (!inWindow) {
              // Janela fechada — skip silencioso (o fire vai registrar o follow-up quando expirar)
              console.log(`[Timer] Janela 24h fechada — skip warn → "${task.title}"`);
            } else {
              const { error: upErr } = await supabaseAdmin
                .from('tasks').update({ timer_warned: true }).eq('id', task.id);
              if (upErr) { console.error(`[Timer] Erro ao marcar warned:`, upErr.message); continue; }
              const timeLabel = formatWarnLabel(task.timer_at);
              const msg = await generateTimerMessage(userName, task.title, 'warn', timeLabel);
              await sendTimerMessage(task.user_id, task.title, msg);
              console.log(`[Timer] Aviso previo → "${task.title}" (faltam ${timeLabel})`);
            }
          }
        }
      }
    }

    // ── PARTE 2: Timers em subtarefas ────────────────────────────────────────
    const { data: tasksWithSubs, error: subErr } = await supabaseAdmin
      .from('tasks')
      .select('id, title, user_id, subtasks')
      .in('status', ['todo', 'doing']);

    if (subErr) {
      console.error('[Timer] Erro ao buscar subtarefas:', subErr.message);
      return;
    }

    for (const task of (tasksWithSubs || [])) {
      const subs = task.subtasks || [];
      const pending = subs.filter(s => s.timer_at && !s.timer_fired);
      if (!pending.length) continue;

      const userName = (await findBindingByUserId(task.user_id, 'whatsapp'))?.display_name || 'você';
      let changed = false;
      const updatedSubs = [];

      for (const s of subs) {
        if (!s.timer_at || s.timer_fired) {
          updatedSubs.push(s);
          continue;
        }

        const subMs = new Date(s.timer_at).getTime();

        // Timer da subtarefa expirou
        if (subMs <= now.getTime()) {
          const inWindow = await isWithin24hWindow(task.user_id);
          if (!inWindow) {
            await saveMissedFollowup(task.user_id, task.id, s.title, 'subtask_timer');
            console.log(`[Timer] Janela 24h fechada - follow-up de subtarefa salvo -> "${s.title}" (em "${task.title}")`);
          } else {
            const msg = await generateTimerMessage(userName, s.title, 'fire', null);
            await sendTimerMessage(task.user_id, s.title, msg);
            console.log(`[Timer] Subtarefa expirada (${s.timer_warned ? 'com' : 'sem'} warn previo, enviando final) -> "${s.title}" (em "${task.title}")`);
          }

          changed = true;
          updatedSubs.push({ ...s, timer_fired: true, timer_fired_at: new Date().toISOString() });
          continue;
        }

        // Aviso previo da subtarefa
        if (!s.timer_warned) {
          const warnMs = warnBeforeMs(s.timer_at);
          const timeUntil = subMs - now.getTime();
          const MIN_WARN_BUFFER_MS = 5 * 60_000;
          if (timeUntil <= warnMs && timeUntil > MIN_WARN_BUFFER_MS) {
            const inWindow = await isWithin24hWindow(task.user_id);
            if (!inWindow) {
              console.log(`[Timer] Janela 24h fechada - skip warn subtarefa -> "${s.title}" (em "${task.title}")`);
              updatedSubs.push(s);
              continue;
            }

            const timeLabel = formatWarnLabel(s.timer_at);
            const msg = await generateTimerMessage(userName, s.title, 'warn', timeLabel);
            await sendTimerMessage(task.user_id, s.title, msg);
            console.log(`[Timer] Aviso subtarefa -> "${s.title}" (faltam ${timeLabel})`);
            changed = true;
            updatedSubs.push({ ...s, timer_warned: true });
            continue;
          }
        }

        updatedSubs.push(s);
      }

      if (changed) {
        await supabaseAdmin.from('tasks').update({ subtasks: updatedSubs }).eq('id', task.id);
      }
    }

    // ── PARTE 3: Lembretes por dias antes do prazo ───────────────────────────
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(now);

    const { data: reminderTasks, error: remErr } = await supabaseAdmin
      .from('tasks')
      .select('id, title, user_id, due_date, reminder_days_before')
      .eq('reminder_fired', false)
      .not('reminder_days_before', 'is', null)
      .not('due_date', 'is', null)
      .in('status', ['todo', 'doing']);

    if (remErr) {
      console.error('[Reminder] Erro ao buscar lembretes:', remErr.message);
    } else {
      for (const task of (reminderTasks || [])) {
        // Calcula a data alvo: due_date − reminder_days_before dias
        const [y, m, d] = task.due_date.split('-').map(Number);
        const dueDate = new Date(y, m - 1, d);
        dueDate.setDate(dueDate.getDate() - task.reminder_days_before);
        const triggerStr = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD

        if (triggerStr <= todayStr) {
          const { error: upErr } = await supabaseAdmin
            .from('tasks')
            .update({ reminder_fired: true })
            .eq('id', task.id);

          if (upErr) {
            console.error(`[Reminder] Erro ao marcar fired:`, upErr.message);
            continue;
          }

          const userName = (await findBindingByUserId(task.user_id, 'whatsapp'))?.display_name || 'você';

          const daysLeft = task.reminder_days_before;
          const daysLabel = daysLeft === 1 ? '1 dia' : `${daysLeft} dias`;
          await sendTimerMessage(
            task.user_id,
            task.title,
            `${userName}, faltam ${daysLabel} para o prazo: "${task.title}"`
          );
          console.log(`[Reminder] Disparado → "${task.title}" (faltam ${daysLabel})`);
        }
      }
    }

  } catch (err) {
    console.error('[Timer] Erro inesperado:', err.message);
  }
}

// Em ambiente não-serverless (local), faz listen e inicia timers
if (!process.env.VERCEL) {
  setInterval(checkTaskTimers, 60_000);
  setTimeout(checkTaskTimers, 5_000);

  app.get(/^(?!\/api).*/, (req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Rota nao encontrada no backend.',
      },
    });
  });

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀 Rodando na porta ${PORT}`));
}

export default app;
