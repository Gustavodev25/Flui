import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { saveMemory } from './memoryEngine.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ── Captura de conhecimento ──────────────────────────────────────────────────

/**
 * Salva uma entrada no segundo cérebro.
 */
export async function saveKnowledge(userId, {
  category,
  title,
  content,
  entities = [],
  tags = [],
  relatedTaskIds = [],
  metadata = {},
  pinned = false,
  source = 'whatsapp',
}) {
  try {
    // Verifica se já existe algo com título muito similar
    const existing = await findSimilarEntry(userId, title);
    if (existing) {
      // Atualiza ao invés de duplicar
      const merged = {
        content: content.length > existing.content.length ? content : `${existing.content}\n\n---\nAtualização: ${content}`,
        entities: mergeArrays(existing.entities, entities),
        tags: [...new Set([...(existing.tags || []), ...tags])],
        related_task_ids: [...new Set([...(existing.related_task_ids || []), ...relatedTaskIds])],
        metadata: { ...existing.metadata, ...metadata },
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('knowledge_entries')
        .update(merged)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('knowledge_entries')
      .insert({
        user_id: userId,
        category,
        title,
        content,
        entities,
        tags,
        related_task_ids: relatedTaskIds,
        metadata,
        pinned,
        source,
      })
      .select('*')
      .single();

    if (error) throw error;

    // Salva também como memória episódica para ser encontrada via recall
    await saveMemory(userId, {
      memoryType: 'episodic',
      content: `[${category}] ${title}: ${content.substring(0, 200)}`,
      summary: title,
      entities,
      tags,
      importance: pinned ? 0.9 : 0.6,
      sourceMessage: content,
    });

    return data;
  } catch (err) {
    console.error('[SecondBrain] Erro ao salvar:', err.message);
    return null;
  }
}

/**
 * Busca no segundo cérebro por palavra-chave.
 */
export async function searchKnowledge(userId, {
  query = null,
  category = null,
  tags = null,
  entity = null,
  limit = 10,
} = {}) {
  try {
    let dbQuery = supabase
      .from('knowledge_entries')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (category) dbQuery = dbQuery.eq('category', category);

    if (query) {
      dbQuery = dbQuery.or(
        `title.ilike.%${query}%,content.ilike.%${query}%`
      );
    }

    if (entity) {
      dbQuery = dbQuery.ilike('entities', `%${entity}%`);
    }

    const { data, error } = await dbQuery;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[SecondBrain] Erro na busca:', err.message);
    return [];
  }
}

/**
 * Lista entradas por categoria.
 */
export async function listByCategory(userId, category, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('knowledge_entries')
      .select('id, title, content, tags, pinned, created_at, updated_at')
      .eq('user_id', userId)
      .eq('category', category)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Lista ideias do usuário.
 */
export async function listIdeas(userId, limit = 10) {
  return listByCategory(userId, 'idea', limit);
}

/**
 * Busca informações sobre uma pessoa no grafo de entidades + knowledge.
 */
export async function getPersonContext(userId, personName) {
  try {
    const [entityResult, knowledgeResult, memoriesResult] = await Promise.all([
      supabase
        .from('entity_graph')
        .select('*')
        .eq('user_id', userId)
        .ilike('name', `%${personName}%`)
        .eq('entity_type', 'person')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('knowledge_entries')
        .select('title, content, category, created_at')
        .eq('user_id', userId)
        .ilike('entities', `%${personName}%`)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('user_memories')
        .select('content, memory_type, created_at')
        .eq('user_id', userId)
        .ilike('entities', `%${personName}%`)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    return {
      entity: entityResult.data || null,
      knowledge: knowledgeResult.data || [],
      memories: memoriesResult.data || [],
    };
  } catch {
    return { entity: null, knowledge: [], memories: [] };
  }
}

/**
 * Fixa/desfixa uma entrada do knowledge.
 */
export async function togglePin(userId, entryId, pinned) {
  try {
    const { data, error } = await supabase
      .from('knowledge_entries')
      .update({ pinned, updated_at: new Date().toISOString() })
      .eq('id', entryId)
      .eq('user_id', userId)
      .select('id, title, pinned')
      .single();

    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

/**
 * Remove uma entrada do knowledge.
 */
export async function deleteKnowledgeEntry(userId, entryId) {
  try {
    const { error } = await supabase
      .from('knowledge_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', userId);

    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findSimilarEntry(userId, title) {
  if (!title || title.length < 5) return null;

  const searchTerm = title.substring(0, 40).replace(/[%_]/g, '');
  const { data } = await supabase
    .from('knowledge_entries')
    .select('*')
    .eq('user_id', userId)
    .ilike('title', `%${searchTerm}%`)
    .limit(1)
    .maybeSingle();

  return data || null;
}

function mergeArrays(existing, incoming) {
  const merged = [...(existing || [])];
  for (const item of (incoming || [])) {
    const found = merged.find(e =>
      JSON.stringify(e) === JSON.stringify(item) ||
      (e.name && item.name && e.name.toLowerCase() === item.name.toLowerCase())
    );
    if (!found) merged.push(item);
  }
  return merged;
}
