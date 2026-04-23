import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';

const EMBEDDING_MODEL = process.env.MEMORY_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_TIMEOUT_MS = Math.max(Number(process.env.MEMORY_EMBEDDING_TIMEOUT_MS || 8000), 1000);
const EMBEDDING_API_KEY = process.env.MEMORY_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
const EMBEDDING_BASE_URL = process.env.MEMORY_EMBEDDING_BASE_URL || '';

const embeddingClient = EMBEDDING_API_KEY
  ? new OpenAI({
    apiKey: EMBEDDING_API_KEY,
    ...(EMBEDDING_BASE_URL ? { baseURL: EMBEDDING_BASE_URL } : {}),
  })
  : null;

const cache = new Map();
const MAX_CACHE_SIZE = 500;
let lastEmbeddingError = null;

function normalizeEmbeddingInput(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, value);
}

async function withTimeout(factory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await factory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function getMemoryEmbeddingStatus() {
  return {
    configured: Boolean(embeddingClient),
    model: EMBEDDING_MODEL,
    base_url: EMBEDDING_BASE_URL || 'openai_default',
    last_error: lastEmbeddingError,
  };
}

export async function generateMemoryEmbedding(text) {
  const input = normalizeEmbeddingInput(text);
  if (!input || !embeddingClient) return null;

  const cacheKey = `${EMBEDDING_MODEL}:${input}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const response = await withTimeout(
      (signal) => embeddingClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      }, { signal }),
      EMBEDDING_TIMEOUT_MS
    );

    const embedding = response?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding provider returned an empty vector');
    }

    lastEmbeddingError = null;
    cacheSet(cacheKey, embedding);
    return embedding;
  } catch (error) {
    lastEmbeddingError = {
      message: error.message,
      at: new Date().toISOString(),
      model: EMBEDDING_MODEL,
    };
    console.error('[MemoryEmbedding] Failed to generate embedding:', error.message);
    return null;
  }
}

export function getMemoryEmbeddingModel() {
  return EMBEDDING_MODEL;
}

export function toPgVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  return `[${embedding.map((value) => Number(value).toFixed(8)).join(',')}]`;
}
