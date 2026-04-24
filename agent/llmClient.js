import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { sanitizeChatMessagesForInput } from './chatMessageSanitizer.js';

export const PRIMARY_PROVIDER = 'nvidia';
export const RECOMMENDED_FAST_AGENT_MODEL = 'deepseek-ai/deepseek-v4-pro';
const LEGACY_TIMEOUT_PRONE_MODELS = new Set(['z-ai/glm4.7']);

function resolvePrimaryModelId() {
  const configured = process.env.PRIMARY_MODEL_ID || process.env.MODEL_ID || '';
  const normalized = configured.trim();

  if (!normalized) return RECOMMENDED_FAST_AGENT_MODEL;
  if (LEGACY_TIMEOUT_PRONE_MODELS.has(normalized) && process.env.ALLOW_LEGACY_LLM_MODEL !== 'true') {
    return RECOMMENDED_FAST_AGENT_MODEL;
  }
  return normalized;
}

export const PRIMARY_MODEL_ID = resolvePrimaryModelId();
export const PRIMARY_TIMEOUT_MS = Math.max(Number(process.env.PRIMARY_LLM_TIMEOUT_MS || 45000), 45000);

export const FALLBACK_PROVIDER = 'groq';
export const FALLBACK_MODEL_ID = process.env.GROQ_MODEL_ID || 'llama-3.3-70b-versatile';
export const FALLBACK_TIMEOUT_MS = Math.max(Number(process.env.FALLBACK_LLM_TIMEOUT_MS || 25000), 25000);
export const TURN_BUDGET_MS = Math.max(Number(process.env.LLM_TURN_BUDGET_MS || 90000), 90000);

const primaryClient = process.env.NVIDIA_API_KEY
  ? new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  })
  : null;

const useGroqChatFallback = process.env.ENABLE_GROQ_CHAT_FALLBACK !== 'false';

const fallbackClient = useGroqChatFallback && process.env.GROQ_API_KEY
  ? new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  })
  : null;

function isAbortLikeError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.name === 'AbortError' ||
    err?.name === 'APIUserAbortError' ||
    err?.code === 'ABORT_ERR' ||
    message.includes('request was aborted') ||
    message.includes('was aborted') ||
    message.includes('signal is aborted')
  );
}

function classifyError(err) {
  if (!err) return 'unknown_error';
  if (isAbortLikeError(err)) return 'timeout';
  if (err.status === 408) return 'timeout';
  if (err.status === 429) return 'rate_limit';
  if (err.status >= 500) return 'provider_5xx';
  if (err.code === 'ECONNRESET') return 'connection_reset';
  if (err.code === 'ECONNREFUSED') return 'connection_refused';
  if (err.code === 'ETIMEDOUT') return 'timeout';
  return err.code || err.name || 'provider_error';
}

export function isRetryableModelError(err) {
  if (!err) return false;
  if (isAbortLikeError(err)) return true;
  if (err.status === 408 || err.status === 409 || err.status === 429) return true;
  if (err.status >= 500) return true;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(err.code);
}

function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
}

function withNemotronThinking(model, params) {
  if (!model.includes('nemotron-3')) return params;
  const mode = params.extra_body?.chat_template_kwargs?.thinking_mode ?? 'off';
  return {
    ...params,
    extra_body: {
      ...params.extra_body,
      chat_template_kwargs: { thinking_mode: mode },
    },
  };
}

async function requestCompletion(client, provider, model, params, timeoutMs) {
  const startedAt = Date.now();
  const sanitizedParams = Array.isArray(params?.messages)
    ? { ...params, messages: sanitizeChatMessagesForInput(params.messages) }
    : params;
  const finalParams = withNemotronThinking(model, sanitizedParams);

  try {
    const response = await withTimeout(
      (signal) => client.chat.completions.create({ ...finalParams, model }, { signal }),
      timeoutMs
    );

    return {
      response,
      telemetry: {
        provider,
        model,
        latency_ms: Date.now() - startedAt,
        fallback_used: false,
        error_class: null,
      },
    };
  } catch (error) {
    error.provider = provider;
    error.model = model;
    error.latency_ms = Date.now() - startedAt;
    error.error_class = classifyError(error);
    throw error;
  }
}

export async function createChatCompletion(params, options = {}) {
  const {
    preferFallback = false,
    turnBudgetMs = TURN_BUDGET_MS,
    primaryTimeoutMs = PRIMARY_TIMEOUT_MS,
    fallbackTimeoutMs = FALLBACK_TIMEOUT_MS,
  } = options;

  const startedAt = Date.now();
  const errors = [];

  const tryPrimary = async () => {
    if (!primaryClient) return null;
    const result = await requestCompletion(
      primaryClient,
      PRIMARY_PROVIDER,
      PRIMARY_MODEL_ID,
      params,
      primaryTimeoutMs
    );
    return result;
  };

  const tryFallback = async () => {
    if (!fallbackClient) return null;
    const remainingBudget = turnBudgetMs - (Date.now() - startedAt);
    if (remainingBudget <= 250) return null;

    const timeoutMs = Math.min(fallbackTimeoutMs, remainingBudget);
    const result = await requestCompletion(
      fallbackClient,
      FALLBACK_PROVIDER,
      FALLBACK_MODEL_ID,
      params,
      timeoutMs
    );
    result.telemetry.fallback_used = true;
    return result;
  };

  const orderedAttempts = preferFallback ? [tryFallback, tryPrimary] : [tryPrimary, tryFallback];

  for (const attempt of orderedAttempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (error) {
      errors.push(error);
      console.warn(
        `[LLM] ${error.provider || 'provider'}:${error.model || 'model'} falhou com ${error.error_class || classifyError(error)} (${error.message})`
      );
      // sempre tenta o próximo provider (Groq fallback)
    }
  }

  const thrown = errors[errors.length - 1] || new Error('Nenhum provedor de IA configurado');
  thrown.error_class = thrown.error_class || classifyError(thrown);
  throw thrown;
}

export async function pingPrimaryModel() {
  if (!primaryClient) {
    return {
      status: 'missing',
      provider: PRIMARY_PROVIDER,
      model: PRIMARY_MODEL_ID,
    };
  }

  try {
    const { telemetry } = await requestCompletion(
      primaryClient,
      PRIMARY_PROVIDER,
      PRIMARY_MODEL_ID,
      {
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        max_tokens: 1,
      },
      1500
    );

    return {
      status: 'ok',
      provider: PRIMARY_PROVIDER,
      model: PRIMARY_MODEL_ID,
      latency_ms: telemetry.latency_ms,
    };
  } catch (error) {
    return {
      status: 'error',
      provider: PRIMARY_PROVIDER,
      model: PRIMARY_MODEL_ID,
      error: error.message,
      error_class: error.error_class || classifyError(error),
    };
  }
}

export function getLlmStatus() {
  return {
    primary: {
      configured: !!primaryClient,
      provider: PRIMARY_PROVIDER,
      model: PRIMARY_MODEL_ID,
    },
    fallback: {
      configured: !!fallbackClient,
      provider: FALLBACK_PROVIDER,
      model: FALLBACK_MODEL_ID,
      disabled_reason: useGroqChatFallback ? null : 'ENABLE_GROQ_CHAT_FALLBACK not true',
    },
  };
}
