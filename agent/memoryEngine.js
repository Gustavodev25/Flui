import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  generateMemoryEmbedding,
  getMemoryEmbeddingModel,
  getMemoryEmbeddingStatus,
  toPgVectorLiteral,
} from './memoryEmbedding.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const MEMORY_SEMANTIC_MIN_SIMILARITY = Number(process.env.MEMORY_SEMANTIC_MIN_SIMILARITY || 0.72);
const MEMORY_DEDUPE_SEMANTIC_THRESHOLD = Number(process.env.MEMORY_DEDUPE_SEMANTIC_THRESHOLD || 0.88);
const MEMORY_DEDUPE_TEXT_THRESHOLD = Number(process.env.MEMORY_DEDUPE_TEXT_THRESHOLD || 0.7);

const memoryHealth = {
  last_error: null,
  last_error_at: null,
  last_error_scope: null,
  semantic_search_available: null,
};

function recordMemoryError(scope, error) {
  memoryHealth.last_error = error?.message || String(error);
  memoryHealth.last_error_at = new Date().toISOString();
  memoryHealth.last_error_scope = scope;
  console.error(`[MemoryEngine] ${scope}:`, memoryHealth.last_error);
}

function clearMemoryError(scope) {
  if (memoryHealth.last_error_scope === scope) {
    memoryHealth.last_error = null;
    memoryHealth.last_error_at = null;
    memoryHealth.last_error_scope = null;
  }
}

export function getMemorySystemStatus() {
  return {
    ...memoryHealth,
    embedding: getMemoryEmbeddingStatus(),
  };
}

function getRecentMemoryWarning() {
  if (!memoryHealth.last_error_at) return '';
  const errorAgeMs = Date.now() - new Date(memoryHealth.last_error_at).getTime();
  if (!Number.isFinite(errorAgeMs) || errorAgeMs > 5 * 60 * 1000) return '';
  return `AVISO INTERNO: a memoria pode estar parcial agora (${memoryHealth.last_error_scope}). Nao afirme que lembra algo se a informacao nao aparecer explicitamente aqui ou no MemoryRecall.`;
}

// ── Armazenamento de memórias ────────────────────────────────────────────────

/**
 * Salva uma nova memória de longo prazo.
 */
export async function saveMemory(userId, {
  memoryType,
  content,
  summary,
  entities = [],
  tags = [],
  importance = 0.5,
  sourceMessage = null,
  expiresAt = null,
}) {
  try {
    // Verifica se já existe memória muito similar (evita duplicatas)
    const searchableText = buildMemorySearchText({ content, summary, entities, tags });
    const embedding = await generateMemoryEmbedding(searchableText);
    const vectorLiteral = toPgVectorLiteral(embedding);
    const existing = await findSimilarMemory(userId, searchableText, {
      memoryType,
      embedding,
    });
    if (existing) {
      // Atualiza a existente se for similar
      const updatePayload = {
        content: content.length > existing.content.length ? content : existing.content,
        entities: mergeEntities(existing.entities, entities),
        tags: [...new Set([...(existing.tags || []), ...tags])],
        importance: Math.max(existing.importance, importance),
        access_count: (existing.access_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (vectorLiteral) {
        updatePayload.embedding = vectorLiteral;
        updatePayload.embedding_model = getMemoryEmbeddingModel();
        updatePayload.embedding_updated_at = new Date().toISOString();
      }

      const data = await persistMemoryUpdate(existing.id, updatePayload, Boolean(vectorLiteral));
      clearMemoryError('saveMemory');
      return data;
    }

    const insertPayload = {
      user_id: userId,
      memory_type: memoryType,
      content,
      summary: summary || content.substring(0, 100),
      entities,
      tags,
      importance,
      source_message: sourceMessage,
      expires_at: expiresAt,
    };

    if (vectorLiteral) {
      insertPayload.embedding = vectorLiteral;
      insertPayload.embedding_model = getMemoryEmbeddingModel();
      insertPayload.embedding_updated_at = new Date().toISOString();
    }

    const data = await persistMemoryInsert(insertPayload, Boolean(vectorLiteral));
    clearMemoryError('saveMemory');

    // Atualiza grafo de entidades
    for (const entity of entities) {
      await upsertEntity(userId, entity);
    }

    return data;
  } catch (err) {
    recordMemoryError('saveMemory', err);
    return null;
  }
}

/**
 * Recupera memorias relevantes usando busca semantica quando disponivel,
 * com fallback textual por palavras-chave.
 */
export async function recallMemories(userId, {
  query = null,
  memoryType = null,
  tags = null,
  limit = 5,
  minImportance = 0.3,
} = {}) {
  try {
    const nowIso = new Date().toISOString();
    const queryText = normalizeQueryText(query);
    const semanticResults = queryText
      ? await recallMemoriesByEmbedding(userId, queryText, {
        memoryType,
        limit,
        minImportance,
      })
      : [];

    let dbQuery = supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .gte('importance', minImportance)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (memoryType) {
      dbQuery = dbQuery.eq('memory_type', memoryType);
    }

    // Busca textual: aceita string ou array; quebra em palavras e ORs em content/summary.
    const terms = normalizeSearchTerms(query);
    if (terms.length > 0) {
      const orFilters = terms
        .flatMap(t => [`content.ilike.%${t}%`, `summary.ilike.%${t}%`])
        .join(',');
      dbQuery = dbQuery.or(orFilters);
    }

    const { data, error } = await dbQuery;
    if (error) throw error;
    const merged = mergeMemoryResults(semanticResults, data || [], limit);

    // Marca como acessadas (fire-and-forget; só atualiza last_accessed_at,
    // access_count é incrementado no findSimilarMemory path)
    if (merged?.length > 0) {
      const ids = merged.map(m => m.id);
      supabase
        .from('user_memories')
        .update({ last_accessed_at: nowIso })
        .in('id', ids)
        .then(({ error: updErr }) => {
          if (updErr) console.error('[MemoryEngine] last_accessed_at update:', updErr.message);
        });
    }

    clearMemoryError('recallMemories');
    return merged;
  } catch (err) {
    recordMemoryError('recallMemories', err);
    console.error('[MemoryEngine] Erro ao recuperar memórias:', err.message);
    return [];
  }
}

/**
 * Busca memórias por entidade (pessoa, projeto, etc).
 * `entities` é jsonb — ilike direto não funciona de forma confiável.
 * Buscamos pelo nome em content/summary (onde ele costuma aparecer ao ser mencionado).
 */
export async function recallByEntity(userId, entityName, limit = 5) {
  if (!entityName) return [];
  try {
    const nowIso = new Date().toISOString();
    const safe = entityName.replace(/[%_,()]/g, '').trim();
    if (!safe) return [];

    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .or(`content.ilike.%${safe}%,summary.ilike.%${safe}%`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    recordMemoryError('recallByEntity', err);
    console.error('[MemoryEngine] Erro ao buscar por entidade:', err.message);
    return [];
  }
}

/**
 * Retorna memórias recentes de alta importância para contexto.
 */
export async function getRecentImportantMemories(userId, limit = 5) {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .gte('importance', 0.6)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    recordMemoryError('getRecentImportantMemories', err);
    console.error('[MemoryEngine] getRecentImportantMemories:', err.message);
    return [];
  }
}

/**
 * Gera o contexto de memória para inclusão no system prompt.
 * IMPORTANTE: passe `currentMessage` para recall contextual — sem isso, só
 * memórias de alta importância e notas fixadas entram no contexto.
 */
export async function getMemoryContext(userId, currentMessage = '') {
  try {
    const keywords = extractKeywords(currentMessage);
    const hasKeywords = keywords.length > 0;

    const [recentMemories, relevantMemories, pinnedKnowledge, topEntities] = await Promise.all([
      getRecentImportantMemories(userId, 3),
      hasKeywords
        ? recallMemories(userId, { query: keywords, limit: 4, minImportance: 0.2 })
        : Promise.resolve([]),
      getPinnedKnowledge(userId),
      getTopEntities(userId, 5),
    ]);

    // Deduplica por id (recent + relevant podem se sobrepor)
    const seen = new Set();
    const allMemories = [...relevantMemories, ...recentMemories].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const memoryWarning = getRecentMemoryWarning();
    if (allMemories.length === 0 && pinnedKnowledge.length === 0 && topEntities.length === 0 && !memoryWarning) {
      return '';
    }

    const lines = ['═══ MEMORIA DE LONGO PRAZO ═══'];
    lines.push('Voce se lembra dessas informacoes sobre o usuario:');
    if (memoryWarning) lines.push(memoryWarning);

    for (const mem of allMemories.slice(0, 6)) {
      const typeLabel = {
        episodic: 'Evento',
        semantic: 'Fato',
        entity: 'Pessoa/Projeto',
      }[mem.memory_type] || 'Info';
      const dateStr = new Date(mem.created_at).toLocaleDateString('pt-BR');
      const body = (mem.summary || mem.content || '').toString().substring(0, 160);
      lines.push(`- [${typeLabel}, ${dateStr}]: ${body}`);
    }

    if (topEntities.length > 0) {
      lines.push('');
      lines.push('PESSOAS/PROJETOS mais citados pelo usuario:');
      for (const ent of topEntities) {
        const desc = ent.description ? ` — ${ent.description}` : '';
        lines.push(`- ${ent.name} (${ent.entity_type}, ${ent.mention_count}x)${desc}`);
      }
    }

    if (pinnedKnowledge.length > 0) {
      lines.push('');
      lines.push('NOTAS FIXADAS (sempre relevantes):');
      for (const note of pinnedKnowledge) {
        lines.push(`- [${note.category}] "${note.title}": ${note.content.substring(0, 120)}`);
      }
    }

    lines.push('');
    lines.push('REGRAS DE USO DA MEMORIA:');
    lines.push('1. USE essas memorias para personalizar respostas ("como vai o projeto X que voce mencionou?").');
    lines.push('2. Quando o usuario contar um FATO NOVO sobre ele (preferencia, rotina, pessoa, projeto), CHAME MemorySave em background. NAO avise que salvou — é invisivel.');
    lines.push('3. Se o usuario perguntar "voce lembra...", "o que eu te disse sobre...", CHAME MemoryRecall antes de responder.');
    lines.push('4. NUNCA invente memorias. Se nao aparecer aqui nem no MemoryRecall, diga que nao lembra.');

    return lines.join('\n');
  } catch (err) {
    console.error('[MemoryEngine] getMemoryContext:', err.message);
    return '';
  }
}

// ── Grafo de entidades ───────────────────────────────────────────────────────

async function upsertEntity(userId, entity) {
  if (!entity?.name || !entity?.type) return;

  try {
    const { data: existing } = await supabase
      .from('entity_graph')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', entity.name)
      .eq('entity_type', entity.type)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('entity_graph')
        .update({
          mention_count: existing.mention_count + 1,
          last_mentioned_at: new Date().toISOString(),
          attributes: { ...existing.attributes, ...(entity.attributes || {}) },
          description: entity.description || existing.description,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('entity_graph').insert({
        user_id: userId,
        name: entity.name,
        entity_type: entity.type,
        description: entity.description || null,
        attributes: entity.attributes || {},
      });
    }
  } catch (err) {
    console.error('[MemoryEngine] Erro ao upsert entidade:', err.message);
  }
}

/**
 * Busca entidades do grafo do usuário.
 */
export async function getEntities(userId, { type = null, query = null, limit = 10 } = {}) {
  try {
    let dbQuery = supabase
      .from('entity_graph')
      .select('*')
      .eq('user_id', userId)
      .order('mention_count', { ascending: false })
      .limit(limit);

    if (type) dbQuery = dbQuery.eq('entity_type', type);
    if (query) dbQuery = dbQuery.ilike('name', `%${query}%`);

    const { data, error } = await dbQuery;
    if (error) throw error;
    return data || [];
  } catch (err) {
    recordMemoryError('getEntities', err);
    return [];
  }
}

/**
 * Retorna entidades frequentemente mencionadas para contexto.
 */
export async function getTopEntities(userId, limit = 8) {
  try {
    const { data } = await supabase
      .from('entity_graph')
      .select('name, entity_type, description, mention_count')
      .eq('user_id', userId)
      .order('mention_count', { ascending: false })
      .limit(limit);

    return data || [];
  } catch (err) {
    recordMemoryError('getTopEntities', err);
    return [];
  }
}

// ── Decay de importância ─────────────────────────────────────────────────────

/**
 * Reduz importância de memórias não acessadas há muito tempo.
 * Roda periodicamente (1x por dia).
 */
export async function decayMemoryImportance() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Memórias não acessadas há 30+ dias perdem importância
    const { data: stale } = await supabase
      .from('user_memories')
      .select('id, importance')
      .lt('last_accessed_at', thirtyDaysAgo)
      .gt('importance', 0.2);

    if (!stale?.length) return;

    for (const mem of stale) {
      await supabase
        .from('user_memories')
        .update({
          importance: Math.max(0.1, mem.importance * 0.85),
          updated_at: new Date().toISOString(),
        })
        .eq('id', mem.id);
    }

    console.log(`[MemoryEngine] Decayed ${stale.length} memórias`);
  } catch (err) {
    console.error('[MemoryEngine] Erro no decay:', err.message);
  }
}

// ── Helpers internos ─────────────────────────────────────────────────────────

function buildMemorySearchText({ content = '', summary = '', entities = [], tags = [] } = {}) {
  const entityText = (entities || [])
    .map((entity) => [entity.name, entity.type, entity.description].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ');
  const tagText = (tags || []).map(String).join(' ');
  return [summary, content, entityText, tagText].filter(Boolean).join('\n').trim();
}

function isEmbeddingSchemaError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('embedding') &&
    (
      message.includes('Could not find') ||
      message.includes('column') ||
      message.includes('schema cache') ||
      message.includes('type vector does not exist')
    )
  );
}

function withoutEmbeddingFields(payload) {
  const {
    embedding,
    embedding_model,
    embedding_updated_at,
    ...rest
  } = payload;
  return rest;
}

async function persistMemoryUpdate(id, payload, hasEmbedding) {
  const run = (nextPayload) => supabase
    .from('user_memories')
    .update(nextPayload)
    .eq('id', id)
    .select('*')
    .single();

  const { data, error } = await run(payload);
  if (!error) return data;

  if (hasEmbedding && isEmbeddingSchemaError(error)) {
    recordMemoryError('memoryEmbeddingSchema', error);
    const retry = await run(withoutEmbeddingFields(payload));
    if (retry.error) throw retry.error;
    return retry.data;
  }

  throw error;
}

async function persistMemoryInsert(payload, hasEmbedding) {
  const run = (nextPayload) => supabase
    .from('user_memories')
    .insert(nextPayload)
    .select('*')
    .single();

  const { data, error } = await run(payload);
  if (!error) return data;

  if (hasEmbedding && isEmbeddingSchemaError(error)) {
    recordMemoryError('memoryEmbeddingSchema', error);
    const retry = await run(withoutEmbeddingFields(payload));
    if (retry.error) throw retry.error;
    return retry.data;
  }

  throw error;
}

function normalizeQueryText(query) {
  if (Array.isArray(query)) return query.map(String).join(' ').trim();
  return String(query || '').trim();
}

async function recallMemoriesByEmbedding(userId, queryText, {
  memoryType = null,
  limit = 5,
  minImportance = 0.3,
  minSimilarity = MEMORY_SEMANTIC_MIN_SIMILARITY,
} = {}) {
  const embedding = await generateMemoryEmbedding(queryText);
  if (!embedding) return [];

  return matchUserMemoriesByVector(userId, embedding, {
    memoryType,
    limit,
    minImportance,
    minSimilarity,
  });
}

async function matchUserMemoriesByVector(userId, embedding, {
  memoryType = null,
  limit = 5,
  minImportance = 0.3,
  minSimilarity = MEMORY_SEMANTIC_MIN_SIMILARITY,
} = {}) {
  const vectorLiteral = toPgVectorLiteral(embedding);
  if (!vectorLiteral) return [];

  try {
    const { data, error } = await supabase.rpc('match_user_memories', {
      query_user_id: userId,
      query_embedding: vectorLiteral,
      match_count: limit,
      min_importance: minImportance,
      filter_memory_type: memoryType,
      min_similarity: minSimilarity,
    });

    if (error) throw error;
    memoryHealth.semantic_search_available = true;
    clearMemoryError('semanticSearch');
    return data || [];
  } catch (error) {
    memoryHealth.semantic_search_available = false;
    recordMemoryError('semanticSearch', error);
    return [];
  }
}

async function findSimilarMemory(userId, text, { memoryType = null, embedding = null } = {}) {
  if (!text || text.length < 10) return null;

  if (embedding) {
    const semanticMatches = await matchUserMemoriesByVector(userId, embedding, {
      memoryType,
      limit: 3,
      minImportance: 0,
      minSimilarity: MEMORY_DEDUPE_SEMANTIC_THRESHOLD,
    });
    const bestSemantic = semanticMatches[0];
    if (bestSemantic?.similarity >= MEMORY_DEDUPE_SEMANTIC_THRESHOLD) {
      return bestSemantic;
    }
  }

  const candidates = await findLexicalMemoryCandidates(userId, text, { memoryType });
  let best = { score: 0, memory: null };
  for (const candidate of candidates) {
    const candidateText = buildMemorySearchText(candidate);
    const score = textSimilarity(text, candidateText);
    if (score > best.score) best = { score, memory: candidate };
  }

  return best.score >= MEMORY_DEDUPE_TEXT_THRESHOLD ? best.memory : null;
}

async function findLexicalMemoryCandidates(userId, text, { memoryType = null } = {}) {
  const keywords = extractKeywords(text);
  if (keywords.length < 2) return [];

  const top = keywords.slice(0, 4);
  const filters = top
    .flatMap(k => [`summary.ilike.%${k}%`, `content.ilike.%${k}%`])
    .join(',');

  let query = supabase
    .from('user_memories')
    .select('*')
    .eq('user_id', userId)
    .or(filters)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (memoryType) query = query.eq('memory_type', memoryType);

  const { data, error } = await query;
  if (error) {
    recordMemoryError('findLexicalMemoryCandidates', error);
    return [];
  }

  return data || [];
}

function mergeMemoryResults(primary = [], fallback = [], limit = 5) {
  const byId = new Map();
  for (const memory of [...primary, ...fallback]) {
    if (!memory?.id || byId.has(memory.id)) continue;
    byId.set(memory.id, memory);
  }

  return [...byId.values()]
    .sort((a, b) => {
      const scoreA = Number(a.similarity || 0) + Number(a.importance || 0) * 0.15;
      const scoreB = Number(b.similarity || 0) + Number(b.importance || 0) * 0.15;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    })
    .slice(0, limit);
}

function textSimilarity(a, b) {
  const aTokens = new Set(normalizeSearchTerms(a));
  const bTokens = new Set(normalizeSearchTerms(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }

  return (2 * intersection) / (aTokens.size + bTokens.size);
}

function mergeEntities(existing, newOnes) {
  const merged = [...(existing || [])];
  for (const entity of (newOnes || [])) {
    const found = merged.find(e =>
      e.name?.toLowerCase() === entity.name?.toLowerCase() && e.type === entity.type
    );
    if (!found) merged.push(entity);
  }
  return merged;
}

const STOPWORDS_PT = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do',
  'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'por', 'para', 'pra',
  'com', 'sem', 'que', 'se', 'e', 'ou', 'mas', 'como', 'esse', 'essa',
  'isso', 'aqui', 'ali', 'la', 'aquele', 'aquela', 'meu', 'minha',
  'seu', 'sua', 'me', 'te', 'nos', 'voce', 'vc', 'eu', 'ele', 'ela',
  'foi', 'era', 'tem', 'ter', 'ser', 'estar', 'tá', 'ta', 'tô', 'to',
  'vou', 'vai', 'vamos', 'está', 'estou', 'sobre', 'qual', 'quais',
  'quando', 'onde', 'hoje', 'ontem', 'amanha', 'amanhã', 'sempre',
  'nunca', 'muito', 'pouco', 'mais', 'menos', 'tudo', 'nada', 'algum',
  'alguma', 'alguns', 'algumas', 'também', 'tambem', 'entao', 'então',
  'assim', 'porque', 'pois',
]);

/**
 * Extrai palavras-chave significativas (array) para busca.
 * Mantém acentos — `ilike` é case-insensitive mas NÃO ignora acentos.
 * Stopwords são testadas sem acento pra pegar variações ("está"/"esta").
 */
function extractKeywords(message) {
  if (!message || typeof message !== 'string') return [];

  const stripAccents = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => {
      if (w.length <= 3) return false;
      if (/^\d+$/.test(w)) return false;
      if (STOPWORDS_PT.has(w) || STOPWORDS_PT.has(stripAccents(w))) return false;
      return true;
    })
    .slice(0, 6);
}

/**
 * Normaliza entrada de busca: aceita string (frase) ou array (palavras).
 * Aplica escape de chars perigosos para filtros PostgREST.
 */
function normalizeSearchTerms(input) {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : extractKeywords(input);
  return raw
    .map(t => String(t).replace(/[%_,()]/g, '').trim())
    .filter(t => t.length >= 3)
    .slice(0, 6);
}

async function getPinnedKnowledge(userId) {
  try {
    const { data } = await supabase
      .from('knowledge_entries')
      .select('title, content, category')
      .eq('user_id', userId)
      .eq('pinned', true)
      .order('created_at', { ascending: false })
      .limit(3);

    return data || [];
  } catch (err) {
    recordMemoryError('getPinnedKnowledge', err);
    return [];
  }
}
