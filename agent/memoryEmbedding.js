import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import OpenAI from 'openai';

const EMBEDDING_TIMEOUT_MS = Math.max(Number(process.env.MEMORY_EMBEDDING_TIMEOUT_MS || 8000), 1000);
const EMBEDDING_API_KEY = process.env.MEMORY_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
const EMBEDDING_BASE_URL = process.env.MEMORY_EMBEDDING_BASE_URL || '';
const EMBEDDING_PROVIDER = (process.env.MEMORY_EMBEDDING_PROVIDER || (EMBEDDING_API_KEY ? 'remote' : 'local')).toLowerCase();
const LOCAL_EMBEDDING_MODEL = 'local-hash-embedding-v1';
const EMBEDDING_MODEL = process.env.MEMORY_EMBEDDING_MODEL || (
  EMBEDDING_PROVIDER === 'local' ? LOCAL_EMBEDDING_MODEL : 'text-embedding-3-small'
);
const LOCAL_EMBEDDING_DIMENSIONS = 1536;

const embeddingClient = EMBEDDING_PROVIDER !== 'local' && EMBEDDING_API_KEY
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
    configured: EMBEDDING_PROVIDER === 'local' || Boolean(embeddingClient),
    provider: EMBEDDING_PROVIDER === 'local' ? 'local' : 'remote',
    model: EMBEDDING_MODEL,
    base_url: EMBEDDING_PROVIDER === 'local' ? 'local_runtime' : (EMBEDDING_BASE_URL || 'openai_default'),
    cost: EMBEDDING_PROVIDER === 'local' ? 'zero_external_api_cost' : 'provider_billed',
    last_error: lastEmbeddingError,
  };
}

export async function generateMemoryEmbedding(text) {
  const input = normalizeEmbeddingInput(text);
  if (!input) return null;

  const cacheKey = `${EMBEDDING_MODEL}:${input}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  if (EMBEDDING_PROVIDER === 'local') {
    const embedding = generateLocalHashEmbedding(input);
    cacheSet(cacheKey, embedding);
    return embedding;
  }

  if (!embeddingClient) return null;

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

function generateLocalHashEmbedding(input) {
  const vector = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenizeForLocalEmbedding(input);

  for (const token of tokens) {
    addTokenToVector(vector, token, 1);
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    addTokenToVector(vector, `${tokens[i]} ${tokens[i + 1]}`, 0.65);
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

function tokenizeForLocalEmbedding(input) {
  const normalized = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');

  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    .slice(0, 400);
}

function addTokenToVector(vector, token, weight) {
  const digest = crypto.createHash('sha256').update(token).digest();
  const index = digest.readUInt32BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
  const sign = digest[4] % 2 === 0 ? 1 : -1;
  vector[index] += sign * weight;
}
