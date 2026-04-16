import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

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
    const existing = await findSimilarMemory(userId, summary || content);
    if (existing) {
      // Atualiza a existente se for similar
      await supabase
        .from('user_memories')
        .update({
          content: content.length > existing.content.length ? content : existing.content,
          entities: mergeEntities(existing.entities, entities),
          tags: [...new Set([...(existing.tags || []), ...tags])],
          importance: Math.max(existing.importance, importance),
          access_count: existing.access_count + 1,
          last_accessed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      return existing;
    }

    const { data, error } = await supabase
      .from('user_memories')
      .insert({
        user_id: userId,
        memory_type: memoryType,
        content,
        summary: summary || content.substring(0, 100),
        entities,
        tags,
        importance,
        source_message: sourceMessage,
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (error) throw error;

    // Atualiza grafo de entidades
    for (const entity of entities) {
      await upsertEntity(userId, entity);
    }

    return data;
  } catch (err) {
    console.error('[MemoryEngine] Erro ao salvar memória:', err.message);
    return null;
  }
}

/**
 * Recupera memórias relevantes para um contexto.
 * Usa busca textual simples + importância + recência.
 */
export async function recallMemories(userId, {
  query = null,
  memoryType = null,
  tags = null,
  limit = 5,
  minImportance = 0.3,
} = {}) {
  try {
    let dbQuery = supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .gte('importance', minImportance)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (memoryType) {
      dbQuery = dbQuery.eq('memory_type', memoryType);
    }

    if (query) {
      // Busca textual no conteúdo e resumo
      dbQuery = dbQuery.or(`content.ilike.%${query}%,summary.ilike.%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) throw error;

    // Marca como acessadas
    if (data?.length > 0) {
      const ids = data.map(m => m.id);
      supabase
        .from('user_memories')
        .update({
          access_count: supabase.rpc ? undefined : undefined, // increment via raw
          last_accessed_at: new Date().toISOString(),
        })
        .in('id', ids)
        .then(() => {})
        .catch(() => {});
    }

    return data || [];
  } catch (err) {
    console.error('[MemoryEngine] Erro ao recuperar memórias:', err.message);
    return [];
  }
}

/**
 * Busca memórias por entidade (pessoa, projeto, etc).
 */
export async function recallByEntity(userId, entityName, limit = 5) {
  try {
    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .ilike('entities', `%${entityName}%`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[MemoryEngine] Erro ao buscar por entidade:', err.message);
    return [];
  }
}

/**
 * Retorna memórias recentes de alta importância para contexto.
 */
export async function getRecentImportantMemories(userId, limit = 5) {
  try {
    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .gte('importance', 0.6)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    return [];
  }
}

/**
 * Gera o contexto de memória para inclusão no system prompt.
 */
export async function getMemoryContext(userId, currentMessage = '') {
  try {
    const [recentMemories, relevantMemories, pinnedKnowledge] = await Promise.all([
      getRecentImportantMemories(userId, 3),
      currentMessage ? recallMemories(userId, { query: extractKeywords(currentMessage), limit: 3 }) : Promise.resolve([]),
      getPinnedKnowledge(userId),
    ]);

    // Deduplica
    const seen = new Set();
    const allMemories = [...recentMemories, ...relevantMemories].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    if (allMemories.length === 0 && pinnedKnowledge.length === 0) return '';

    const lines = ['═══ MEMORIA DE LONGO PRAZO ═══'];
    lines.push('Voce se lembra dessas informacoes sobre o usuario:');

    for (const mem of allMemories.slice(0, 5)) {
      const typeLabel = {
        episodic: 'Evento',
        semantic: 'Fato',
        entity: 'Pessoa/Projeto',
      }[mem.memory_type] || 'Info';
      const dateStr = new Date(mem.created_at).toLocaleDateString('pt-BR');
      lines.push(`- [${typeLabel}, ${dateStr}]: ${mem.summary || mem.content.substring(0, 120)}`);
    }

    if (pinnedKnowledge.length > 0) {
      lines.push('');
      lines.push('NOTAS FIXADAS (sempre relevantes):');
      for (const note of pinnedKnowledge) {
        lines.push(`- [${note.category}] "${note.title}": ${note.content.substring(0, 100)}`);
      }
    }

    lines.push('');
    lines.push('USE essas memorias para personalizar respostas. Referencie informacoes lembradas quando relevante.');
    lines.push('Se o usuario perguntar algo que voce "lembra", consulte essas memorias.');

    return lines.join('\n');
  } catch {
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
  } catch {
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
  } catch {
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

async function findSimilarMemory(userId, text) {
  if (!text || text.length < 10) return null;

  // Busca por similaridade simples (primeiras 50 chars do resumo)
  const searchTerm = text.substring(0, 50).replace(/[%_]/g, '');
  const { data } = await supabase
    .from('user_memories')
    .select('*')
    .eq('user_id', userId)
    .ilike('summary', `%${searchTerm}%`)
    .limit(1)
    .maybeSingle();

  return data || null;
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

function extractKeywords(message) {
  // Extrai palavras significativas para busca
  const stopwords = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do',
    'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'por', 'para', 'pra',
    'com', 'sem', 'que', 'se', 'e', 'ou', 'mas', 'como', 'esse', 'essa',
    'isso', 'aqui', 'ali', 'la', 'aquele', 'aquela', 'meu', 'minha',
    'seu', 'sua', 'me', 'te', 'nos', 'voce', 'eu', 'ele', 'ela',
    'foi', 'era', 'tem', 'ter', 'ser', 'estar', 'tá', 'ta',
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\sà-ú]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 5)
    .join(' ');
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
  } catch {
    return [];
  }
}
