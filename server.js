import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
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
import OpenAI from 'openai';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const pendingAuthSessions = new Map();
const processedMessages = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000;
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

app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

async function getWhatsAppSession(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  if (pendingAuthSessions.has(normalizedPhone)) {
    return pendingAuthSessions.get(normalizedPhone);
  }

  const binding = await findBindingByExternalUserId('whatsapp', normalizedPhone);
  if (!binding?.user_id) return null;

  // Verifica se o usuário ainda tem plano Flow ativo
  const { data: subData } = await supabaseAdmin
    .from('subscriptions')
    .select('status, plan_id')
    .eq('user_id', binding.user_id)
    .limit(1)
    .maybeSingle();

  const hasActiveFlow = subData?.status === 'active' && ['flow', 'pulse'].includes(subData?.plan_id);

  if (!hasActiveFlow) {
    console.log(`[WhatsApp] ❌ Binding existe para ${normalizedPhone} mas plano Flow/Pulse expirou/inativo`);
    await sendWhatsAppMessage(normalizedPhone,
      "Oi! Sua assinatura não está mais ativa 😕\n\nO assistente via WhatsApp é exclusivo para assinantes do Flow ou Pulse.\n\nRenove em: *flui.app → Assinatura*\n\nAssim que ativar, volte aqui! 🚀"
    );
    return { blocked: true };
  }

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

  for (const [phone, pending] of pendingAuthSessions.entries()) {
    sessions[phone] = pending;
  }

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
// Evita processar a mesma mensagem 2x (Meta às vezes reenvia webhooks)
function isDuplicate(messageId) {
  if (!messageId) return true; // sem ID = ignora
  if (processedMessages.has(messageId)) return true;

  processedMessages.set(messageId, Date.now());

  // Limpa entradas antigas a cada 100 mensagens
  if (processedMessages.size > 200) {
    const now = Date.now();
    for (const [id, ts] of processedMessages) {
      if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
    }
  }

  return false;
}

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
      pendingAuthSessions.set(userPhone, session);

      const welcomeMsg = await generateWelcomeMessage()
        || "Oi! Eu sou o Lui, assistente da Flui 🌱\n\nMe passa seu *e-mail* pra gente começar.";
      await sendWhatsAppMessage(userPhone, welcomeMsg);
      return;
    }

    // ===== AUTH =====
    if (!session.authenticated) {
      if (session.step === 'ask_email') {
        session.email = cleanMessage;
        session.step = 'ask_password';
        pendingAuthSessions.set(userPhone, session);

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
          pendingAuthSessions.set(userPhone, session);

          // Verifica se o usuário existe e tem apenas identidade Google (sem senha)
          let isGoogleOnlyUser = false;
          try {
            const resp = await fetch(
              `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(session.email)}&per_page=1`,
              { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
            );
            const json = await resp.json();
            const found = json?.users?.[0];
            if (found) {
              const providers = (found.identities || []).map(i => i.provider);
              isGoogleOnlyUser = providers.includes('google') && !providers.includes('email');
            }
          } catch (_) { }

          if (isGoogleOnlyUser) {
            await sendWhatsAppMessage(userPhone,
              "Sua conta foi criada com o *Google* 🔵\n\nPara usar o assistente aqui, você precisa definir uma senha:\n1. Acesse o site\n2. Vá em *Configurações → Meu Perfil*\n3. Defina uma senha na seção indicada\n\nDepois volte e tente de novo. Qual é seu e-mail?"
            );
          } else {
            await sendWhatsAppMessage(userPhone,
              "Não bateu aqui 😕 vamos tentar de novo. Seu e-mail?"
            );
          }
          return;
        }

        // ===== VERIFICAÇÃO DE PLANO FLOW =====
        // Só permite conectar via WhatsApp se o usuário tiver plano Flow ativo
        const { data: subData, error: subError } = await supabaseAdmin
          .from('subscriptions')
          .select('status, plan_id')
          .eq('user_id', data.user.id)
          .limit(1)
          .maybeSingle();

        const hasActiveFlow = subData?.status === 'active' && ['flow', 'pulse'].includes(subData?.plan_id);

        if (!hasActiveFlow) {
          console.log(`[WhatsApp Auth] ❌ Usuário ${data.user.email} bloqueado — sem plano Flow/Pulse ativo`);
          session.step = 'ask_email';
          pendingAuthSessions.set(userPhone, session);

          await sendWhatsAppMessage(userPhone,
            "Login OK, mas o assistente via WhatsApp é exclusivo dos planos *Flow* ou *Pulse* \n\nVocê está no plano gratuito. Para liberar, acesse:\n *flui.app → Assinatura*\n\nDepois é só voltar aqui e conectar!"
          );
          return;
        }

        session.authenticated = true;
        session.userId = data.user.id;
        session.userName = data.user.user_metadata?.name || 'Usuário';
        pendingAuthSessions.delete(userPhone);

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

      // Limpa sessão em memória
      pendingAuthSessions.delete(userPhone);

      await sendWhatsAppMessage(userPhone,
        `Até logo, *${session.userName}*! 👋\n\nSua conta foi desconectada com sucesso.\n\nQuando quiser voltar, é só mandar qualquer mensagem que eu peço seus dados de novo. 🌱`
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

    // ── Behavioral event tracking (fire-and-forget) ─────────────────────
    const turnDuration = Date.now() - turnStart;
    trackEvent(session.userId, 'message_sent', {
      message_length: cleanMessage.length,
      message_text: cleanMessage.substring(0, 200),
      from_audio: fromAudio,
    }).catch(() => {});
    trackEvent(session.userId, 'message_response', {
      response_time_ms: turnDuration,
      response_length: result.reply?.length || 0,
    }).catch(() => {});

    // Detect reminder engagement: user responded within 15min of proactive message
    const lastProactive = lastProactiveMessageAt.get(session.userId);
    if (lastProactive && (Date.now() - lastProactive) < 15 * 60 * 1000) {
      trackEvent(session.userId, 'reminder_engaged', {
        response_delay_ms: Date.now() - lastProactive,
      }).catch(() => {});
      lastProactiveMessageAt.delete(session.userId);
    } else if (lastProactive && (Date.now() - lastProactive) >= 15 * 60 * 1000) {
      trackEvent(session.userId, 'reminder_ignored', {
        time_since_reminder_ms: Date.now() - lastProactive,
      }).catch(() => {});
      lastProactiveMessageAt.delete(session.userId);
    }

    // Periodically re-analyze profile (every ~20 interactions)
    if (Math.random() < 0.05) {
      analyzeAndUpdateProfile(session.userId).catch(() => {});
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

    // ── FILTRO 3: Deduplicação ──
    if (isDuplicate(message.id)) {
      console.log(`[Webhook] Mensagem duplicada ignorada: ${message.id}`);
      return;
    }

    const messageId = message.id;
    const messageType = message.type;
    const userPhone = message.from;

    // ── FILTRO 4: Ignora tipos sem conteúdo processável ──
    // Tipos que o WhatsApp manda mas não são ações do usuário:
    // system, reaction, ephemeral, order, unknown, unsupported, etc.
    const SUPPORTED_TYPES = new Set(['text', 'audio']);
    if (!SUPPORTED_TYPES.has(messageType)) {
      console.log(`[Webhook] Tipo "${messageType}" não suportado, ignorado`);
      return;
    }

    console.log(`[Webhook] 📩 ${messageType} de ${userPhone} (${messageId})`);

    // ── Mensagem de texto ──
    if (messageType === 'text') {
      const body = message.text?.body;
      // Ignora textos vazios ou só whitespace
      if (!body || !body.trim()) {
        console.log('[Webhook] Texto vazio ignorado');
        return;
      }
      await processAndRespondWithAI(userPhone, body, messageId);
      return;
    }

    // ── Mensagem de áudio / voz ──
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
  flow:  'price_1TLaplCJClQAQ7Cji2whsLHw',
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

    // 1ª tentativa: pelo stripe_subscription_id
    if (sub.stripe_subscription_id) {
      try {
        stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
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
        });
        if (list.data.length > 0) stripeSub = list.data[0];
      } catch (e) {
        console.warn('[Sync] Falha ao buscar por customer_id:', e.message);
      }
    }

    if (stripeSub) {
      const periodEnd = stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : null;

      await supabaseAdmin
        .from('subscriptions')
        .update({
          stripe_subscription_id: stripeSub.id,
          status: stripeSub.status,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      console.log(`[Sync] Sincronizado userId=${userId}, periodEnd=${periodEnd}`);

      return res.json({
        subscription: {
          ...sub,
          stripe_subscription_id: stripeSub.id,
          status: stripeSub.status,
          current_period_end: periodEnd,
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
    const { messages, temperature = 0.7, max_tokens = 100 } = req.body;

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
        model: process.env.MODEL_ID || 'deepseek-ai/deepseek-v3-0324',
        messages: turnMessages,
        tools: CHAT_AGENT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.6,
        max_tokens: 512,
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
        model: process.env.MODEL_ID || 'deepseek-ai/deepseek-v3-0324',
        messages: turnMessages,
        temperature: 0.6,
        max_tokens: 256,
      });
      finalContent = finalResponse.choices[0]?.message?.content || 'Pronto! Posso ajudar com mais alguma coisa?';
    }

    res.json({ content: finalContent });
  } catch (error) {
    console.error('[ChatAgent] Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================== ADMIN PANEL ==================
app.get('/api/admin/users', async (req, res) => {
  const { password } = req.query;
  if (password !== 'AdminFlui123@') {
    return res.status(401).json({ error: 'Senha incorreta!' });
  }

  try {
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000
    });
    if (authError) throw authError;

    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*');
    if (subError) throw subError;

    const usersData = users.map(u => {
      const sub = subscriptions?.find(s => s.user_id === u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || '',
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        hasFlow: sub?.status === 'active' && ['flow', 'pulse'].includes(sub?.plan_id),
        planId: sub?.status === 'active' ? (sub?.plan_id || null) : null,
        subscriptionStatus: sub?.status || 'none',
      };
    });

    res.json({ users: usersData });
  } catch (error) {
    console.error('Erro ao buscar usuários:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/grant', async (req, res) => {
  const { password, userId, plan } = req.body;
  if (password !== 'AdminFlui123@') {
    return res.status(401).json({ error: 'Senha incorreta!' });
  }
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

app.get('/api/admin/stats', async (req, res) => {
  const password = req.query.password;
  if (password !== 'AdminFlui123@') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
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
app.get('/api/admin/messages', async (req, res) => {
  const { password, page = 1, limit = 50, channel, search, userId } = req.query;
  if (password !== 'AdminFlui123@') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (Object.keys(updates).length === 0) return res.json({ success: true });

    await supabaseAdmin
      .from('workspace_members')
      .update(updates)
      .eq('member_user_id', userId);

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
  } catch(err) {
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
  buildReminderSessions()
    .then((sessions) => runReminderCycle(sessions, async (phone, message) => {
      const binding = await findBindingByExternalUserId('whatsapp', phone);
      if (binding?.user_id) {
        lastProactiveMessageAt.set(binding.user_id, Date.now());
        return enqueueSystemWhatsAppMessage(binding.user_id, message, 'assistant_text');
      }
      return sendWhatsAppMessage(phone, message);
    }))
    .catch((error) => console.error('[Reminders] Worker error:', error.message));
}, REMINDER_INTERVAL_MS);

// Roda uma vez ao iniciar (depois de 30s pra dar tempo de carregar sessões)
setTimeout(() => {
  console.log('📋 Sistema de lembretes ativo (verifica a cada 15 min)');
  buildReminderSessions()
    .then((sessions) => runReminderCycle(sessions, async (phone, message) => {
      const binding = await findBindingByExternalUserId('whatsapp', phone);
      if (binding?.user_id) {
        return enqueueSystemWhatsAppMessage(binding.user_id, message, 'assistant_text');
      }
      return sendWhatsAppMessage(phone, message);
    }))
    .catch((error) => console.error('[Reminders] Worker error:', error.message));
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

// ── Pool de templates de timer (variação natural) ────────────────────────────
const TIMER_WARN_TEMPLATES = [
  '{name}, daqui a pouco é hora de: "{title}" (faltam {time})',
  'Ei {name}, lembrete: "{title}" em {time}',
  '{name}, não esquece — "{title}" daqui {time}',
  'Atenção, {name}: "{title}" em {time}',
  '{name}, tô passando pra lembrar: "{title}" em {time}',
];

const TIMER_COMBINED_TEMPLATES = [
  '{name}, é agora: "{title}"',
  'Ei {name}, hora de: "{title}"',
  '{name}, bora — "{title}"',
  'Chegou a hora, {name}: "{title}"',
  '{name}, lembrete final: "{title}"',
];

function pickTimerTemplate(templates, name, title, timeLabel) {
  const tpl = templates[Math.floor(Math.random() * templates.length)];
  return tpl
    .replace('{name}', name)
    .replace('{title}', title)
    .replace('{time}', timeLabel || '');
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
            const msg = pickTimerTemplate(TIMER_COMBINED_TEMPLATES, userName, task.title, null);
            await sendTimerMessage(task.user_id, task.title, msg);
            console.log(`[Timer] Expirado (${task.timer_warned ? 'com' : 'sem'} warn previo, enviando final) -> "${task.title}"`);
          }
          continue;
        }

        if (!task.timer_warned) {
          const warnMs = warnBeforeMs(task.timer_at);
          const timeUntilTimer = timerMs - now.getTime();
          if (timeUntilTimer <= warnMs) {
            const inWindow = await isWithin24hWindow(task.user_id);
            if (!inWindow) {
              // Janela fechada — skip silencioso (o fire vai registrar o follow-up quando expirar)
              console.log(`[Timer] Janela 24h fechada — skip warn → "${task.title}"`);
            } else {
              const { error: upErr } = await supabaseAdmin
                .from('tasks').update({ timer_warned: true }).eq('id', task.id);
              if (upErr) { console.error(`[Timer] Erro ao marcar warned:`, upErr.message); continue; }
              const timeLabel = formatWarnLabel(task.timer_at);
              const msg = pickTimerTemplate(TIMER_WARN_TEMPLATES, userName, task.title, timeLabel);
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
            const msg = pickTimerTemplate(TIMER_COMBINED_TEMPLATES, userName, s.title, null);
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
          if (timeUntil <= warnMs) {
            const inWindow = await isWithin24hWindow(task.user_id);
            if (!inWindow) {
              console.log(`[Timer] Janela 24h fechada - skip warn subtarefa -> "${s.title}" (em "${task.title}")`);
              updatedSubs.push(s);
              continue;
            }

            const timeLabel = formatWarnLabel(s.timer_at);
            const msg = pickTimerTemplate(TIMER_WARN_TEMPLATES, userName, s.title, timeLabel);
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

  // Serve o frontend React em modo local
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀 Rodando na porta ${PORT}`));
}

export default app;
