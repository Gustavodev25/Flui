import dotenv from 'dotenv';
dotenv.config();

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { trackEvent } from './behavioralProfile.js';
import { saveMemory, recallMemories, recallByEntity, getEntities } from './memoryEngine.js';
import { saveKnowledge, searchKnowledge, listIdeas, getPersonContext } from './secondBrain.js';

// Usa service_role no backend (agente) para bypassar RLS.
// O agente j├í filtra por user_id em todas as queries.
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ÔöÇÔöÇ Zod schemas (valida├º├úo em runtime dos args gerados pela IA) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const optionalPositiveInt = (max) =>
  z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return numeric;
  }, z.number().int().min(1).max(max).optional());

// Subtarefa aceita string simples (retrocompat.) ou objeto com timer opcional
const subtaskItemSchema = z.union([
  z.string().transform(s => ({ title: s })),
  z.object({
    title: z.string(),
    timer_minutes: optionalPositiveInt(1440),
  }),
]);

const taskCreateSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  subtasks: z.array(subtaskItemSchema).optional(),
  timer_minutes: optionalPositiveInt(1440),
  timer_at_override: z.string().optional(),
  reminder_days_before: optionalPositiveInt(365),
  whatsapp_message: z.string().optional(),
  source: z.enum(['user', 'whatsapp']).optional(),
  visibility: z.enum(['personal', 'workspace']).optional(),
  assigned_to_name: z.string().optional(), // nome do membro para auto-atribui├º├úo
});

const taskUpdateSchema = z.object({
  task_id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'done', 'canceled']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().optional(),
  subtasks: z.array(z.string()).optional(),
  timer_minutes: optionalPositiveInt(1440),
  remove_timer: z.boolean().optional(),
  reminder_days_before: optionalPositiveInt(365),
});

const taskListSchema = z.object({
  status: z.enum(['todo', 'doing', 'done', 'canceled', 'all']).optional(),
  due_date: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const taskDeleteSchema = z.object({
  task_id: z.string(),
});

const taskSearchSchema = z.object({
  query: z.string(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const taskBatchCreateSchema = z.object({
  whatsapp_message: z.string().optional(),
  source: z.enum(['user', 'whatsapp']).optional(),
  tasks: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    due_date: z.string().optional(),
    tags: z.array(z.string()).optional(),
    subtasks: z.array(subtaskItemSchema).optional(),
    timer_minutes: optionalPositiveInt(1440),
    visibility: z.enum(['personal', 'workspace']).optional(),
  })).min(1).max(20),
});

// ÔöÇÔöÇ Defini├º├Áes de ferramentas no formato OpenAI / NVIDIA NIM ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// ——— Definições de ferramentas no formato OpenAI / NVIDIA NIM ——————————————————

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'TaskCreate',
      description: 'Cria uma nova tarefa para o usuário. Use quando o usuário disser "tenho uma tarefa", "anota aí", "registrar", "preciso fazer" ou "cria". Para tarefas complexas, inclua subtarefas automaticamente.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Título claro e conciso da tarefa (3 a 8 palavras). EXTRAIA a AÇÃO PRINCIPAL da mensagem do usuário. ' +
              'Exemplos: "Ligar o computador" (de "preciso ligar o computador daqui a dois minutos"), ' +
              '"Cobrar Rafael sobre proposta" (de "fala lui preciso cobrar o rafael sobre a proposta dele"), ' +
              '"Comprar material de escritório" (de "me lembra de comprar material pro escritório amanhã"). ' +
              'NUNCA use saudações, interjeições ou trechos de conversa como título (ex: não use "Me lembra viu", "Fala Luí"). ' +
              'Foque no VERBO + OBJETO da ação.',
          },
          description: {
            type: 'string',
            description: 'Resumo inteligente do que precisa ser feito, com contexto útil extraído da mensagem do usuário. ' +
              'NUNCA use "Criado a partir da mensagem: ..." — em vez disso, resuma com suas próprias palavras o que o usuário precisa fazer, ' +
              'quando, e qualquer detalhe relevante mencionado. ' +
              'Exemplo: para "preciso ligar o computador daqui a dois minutos, me lembra viu", ' +
              'a descrição seria "Ligar o computador — lembrete rápido de 2 minutos para não esquecer."',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Prioridade da tarefa. Padrão: medium.',
          },
          due_date: {
            type: 'string',
            description: 'Data de vencimento no formato YYYY-MM-DD. Resolva datas relativas ("amanhã", "semana que vem") para o formato exato. NUNCA deixe vazio se o usuário mencionou prazo.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de tags ou categorias (ex: ["Trabalho", "Pessoal"]).',
          },
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Título da subtarefa.' },
                timer_minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Timer individual desta etapa em minutos a partir de AGORA. Use quando a etapa tem um tempo próprio.' },
              },
              required: ['title'],
            },
            description: 'Etapas/passos da tarefa. Quando o usuário descreve etapas sequenciais de uma mesma atividade, use subtarefas em vez de criar tarefas separadas. Cada subtarefa pode ter seu próprio timer_minutes.',
          },
          timer_minutes: {
            type: 'integer',
            minimum: 0,
            maximum: 1440,
            description: 'Se o usuário pediu um lembrete/timer em X minutos (ex: "me lembre em 10 minutos", "daqui 30 min", "em 1 hora"), passe o número de minutos aqui. O sistema enviará uma notificação no WhatsApp quando o tempo acabar.',
          },
          reminder_days_before: {
            type: 'integer',
            minimum: 0,
            maximum: 365,
            description: 'Número de dias ANTES do prazo (due_date) para enviar um lembrete no WhatsApp. Use quando o usuário disser "me lembra X dias antes", "avisa com X dias de antecedência", etc. Requer que due_date esteja preenchido.',
          },
          visibility: {
            type: 'string',
            enum: ['personal', 'workspace'],
            description: 'Visibilidade da tarefa. "personal" = só o usuário vê (padrão). "workspace" = visível para toda a equipe/workspace. Use "workspace" quando o usuário disser "pra equipe", "pro workspace", "pro time", "todo mundo vê", "compartilha", "compartilhada". Use "personal" para tarefas individuais ou quando o usuário disser "só pra mim".',
          },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskUpdate',
      description: 'Atualiza campos de uma tarefa existente: status, prioridade, título, descrição ou prazo. Use para marcar como concluída, alterar prioridade, etc. Precisa do task_id (obtido via TaskList).',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'UUID da tarefa (obtido via TaskList).',
          },
          title: { type: 'string', description: 'Novo título.' },
          description: { type: 'string', description: 'Nova descrição ou notas.' },
          status: {
            type: 'string',
            enum: ['todo', 'doing', 'done', 'canceled'],
            description: 'Novo status. "done" = concluída.',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Nova prioridade.',
          },
          due_date: {
            type: 'string',
            description: 'Nova data (YYYY-MM-DD). Resolva datas relativas.',
          },
          subtasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Nova lista completa de subtarefas. Use para adicionar novos passos ou modificar os existentes.',
          },
          timer_minutes: {
            type: 'integer',
            minimum: 0,
            maximum: 1440,
            description: 'Define ou redefine um timer em minutos a partir de AGORA. Use também quando o usuário quiser reativar uma tarefa concluída com um novo lembrete.',
          },
          remove_timer: {
            type: 'boolean',
            description: 'Use true para remover/cancelar o timer de uma tarefa. Não use junto com timer_minutes.',
          },
          reminder_days_before: {
            type: 'integer',
            minimum: 0,
            maximum: 365,
            description: 'Número de dias ANTES do prazo para enviar um lembrete no WhatsApp. Use quando o usuário quiser adicionar ou alterar o lembrete de antecedência.',
          },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskList',
      description: 'Lista as tarefas do usuário. Por padrão retorna apenas pendentes (todo, doing). Use "all" para ver todas. Você pode filtrar por data específica.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['todo', 'doing', 'done', 'canceled', 'all'],
            description: 'Filtrar por status. Omitir = pendentes. "all" = todas.',
          },
          due_date: {
            type: 'string',
            description: 'Filtrar por data no formato YYYY-MM-DD. Use "today" para ver as de hoje.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Máximo de tarefas. Padrão: 10.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskDelete',
      description: 'Exclui permanentemente uma tarefa. Use com cautela — pergunte confirmação antes de deletar. Precisa do task_id (obtido via TaskList).',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'UUID da tarefa a ser excluída (obtido via TaskList).',
          },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskSearch',
      description: 'Busca tarefas por palavra-chave no título ou descrição. Use quando o usuário quiser encontrar, localizar, consultar ou perguntar sobre uma tarefa específica (ex: "qual era aquela tarefa do relatório?", "tenho algo sobre marketing?"). NÃO use se o usuário estiver pedindo para criar ou anotando algo novo.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca (palavra-chave presente no título ou descrição da tarefa).',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Máximo de resultados. Padrão: 10.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskDashboard',
      description: 'Mostra um resumo/dashboard de produtividade: total de tarefas, pendentes, concluídas, atrasadas, taxa de conclusão, e streak. Use quando o usuário perguntar sobre progresso, desempenho, estatísticas ou como está indo.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'SubtaskToggle',
      description: 'Marca ou desmarca uma subtarefa específica como concluída. Use quando o usuário confirmar que terminou uma etapa/subtarefa específica.',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'UUID da tarefa pai que contém a subtarefa (obtido via TaskList ou contexto).',
          },
          subtask_id: {
            type: 'string',
            description: 'ID da subtarefa a ser marcada (obtido do contexto de tarefas).',
          },
          completed: {
            type: 'boolean',
            description: 'true = marcar como concluída, false = desmarcar.',
          },
        },
        required: ['task_id', 'subtask_id', 'completed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TaskBatchCreate',
      description: 'Cria múltiplas tarefas de uma vez (até 20). Use quando o usuário listar várias coisas para fazer, ou pedir para criar mais de uma tarefa.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Título claro e conciso (3 a 8 palavras). EXTRAIA a AÇÃO PRINCIPAL: VERBO + OBJETO. NUNCA copie saudações ou trechos de conversa.' },
                description: { type: 'string', description: 'Resumo inteligente do que precisa ser feito. NUNCA use "Criado a partir da mensagem: ..." — resuma com suas próprias palavras.' },
                priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                due_date: { type: 'string', description: 'Data YYYY-MM-DD.' },
                tags: { type: 'array', items: { type: 'string' } },
                subtasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      timer_minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Timer desta etapa em minutos a partir de agora.' },
                    },
                    required: ['title'],
                  },
                  description: 'Etapas da tarefa, opcionalmente com timer individual.',
                },
                timer_minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Timer em minutos para notifica├º├úo no WhatsApp.' },
                visibility: { type: 'string', enum: ['personal', 'workspace'], description: 'Visibilidade: "workspace" se a tarefa for da equipe, "personal" para individual.' },
              },
              required: ['title', 'description'],
            },
            description: 'Lista de tarefas a criar (m├íximo 20).',
          },
        },
        required: ['tasks'],
      },
    },
  },
  // ÔöÇÔöÇ Ferramentas de Mem├│ria e Segundo C├®rebro ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  {
    type: 'function',
    function: {
      name: 'MemorySave',
      description: 'Salva uma informa├º├úo na mem├│ria de longo prazo do usu├írio. Use quando o usu├írio compartilhar um fato pessoal, prefer├¬ncia, evento importante, ou qualquer informa├º├úo que seria ├║til lembrar no futuro. Tamb├®m use automaticamente quando detectar informa├º├Áes importantes na conversa.',
      parameters: {
        type: 'object',
        properties: {
          memory_type: {
            type: 'string',
            enum: ['episodic', 'semantic', 'entity'],
            description: 'Tipo: "episodic" para eventos/conversas, "semantic" para fatos/prefer├¬ncias, "entity" para pessoas/projetos.',
          },
          content: {
            type: 'string',
            description: 'Conte├║do completo da mem├│ria. Seja espec├¡fico e detalhado.',
          },
          summary: {
            type: 'string',
            description: 'Resumo curto (1 frase) para busca r├ípida.',
          },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Nome da entidade (pessoa, projeto, lugar).' },
                type: { type: 'string', enum: ['person', 'project', 'place', 'company', 'topic'], description: 'Tipo da entidade.' },
                description: { type: 'string', description: 'Descri├º├úo breve.' },
              },
              required: ['name', 'type'],
            },
            description: 'Pessoas, projetos ou entidades mencionadas.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags para categoriza├º├úo (ex: ["trabalho", "sa├║de", "pessoal"]).',
          },
          importance: {
            type: 'number',
            description: 'Import├óncia de 0.0 a 1.0. Padr├úo: 0.5. Use 0.8+ para fatos cruciais.',
          },
        },
        required: ['memory_type', 'content', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'MemoryRecall',
      description: 'Busca na mem├│ria de longo prazo do usu├írio. Use quando o usu├írio perguntar "o que eu te disse sobre...", "voc├¬ lembra...", "o que o [pessoa] falou...", ou quando precisar de contexto hist├│rico para responder melhor.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca (palavra-chave, nome de pessoa, assunto).',
          },
          memory_type: {
            type: 'string',
            enum: ['episodic', 'semantic', 'entity'],
            description: 'Filtrar por tipo espec├¡fico (opcional).',
          },
          entity_name: {
            type: 'string',
            description: 'Buscar mem├│rias sobre uma pessoa/projeto espec├¡fico.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'KnowledgeSave',
      description: 'Salva uma informa├º├úo no "segundo c├®rebro" do usu├írio. Use para anota├º├Áes, ideias, decis├Áes, informa├º├Áes de refer├¬ncia, dados sobre pessoas, ou qualquer conhecimento que o usu├írio queira guardar. Diferente de tarefas ÔÇö isso ├® INFORMA├ç├âO, n├úo a├º├úo.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['note', 'idea', 'reference', 'decision', 'contact', 'routine'],
            description: 'Categoria: "note" (anota├º├úo), "idea" (ideia futura), "reference" (consulta/senha/dado), "decision" (decis├úo tomada), "contact" (info sobre pessoa), "routine" (processo recorrente).',
          },
          title: {
            type: 'string',
            description: 'T├¡tulo curto e descritivo.',
          },
          content: {
            type: 'string',
            description: 'Conte├║do completo da informa├º├úo. Estruture bem: quem, o qu├¬, quando, contexto.',
          },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['person', 'project', 'place', 'company', 'topic'] },
              },
              required: ['name', 'type'],
            },
            description: 'Pessoas/projetos mencionados.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags para organiza├º├úo.',
          },
          pinned: {
            type: 'boolean',
            description: 'Se true, essa informa├º├úo aparece SEMPRE no contexto. Use para dados muito importantes.',
          },
        },
        required: ['category', 'title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'KnowledgeSearch',
      description: 'Busca no segundo c├®rebro do usu├írio. Use quando perguntar "o que eu anotei sobre...", "tenho alguma nota sobre...", "quais s├úo minhas ideias", "o que eu sei sobre [pessoa]", ou qualquer consulta ao banco de conhecimento.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca.',
          },
          category: {
            type: 'string',
            enum: ['note', 'idea', 'reference', 'decision', 'contact', 'routine'],
            description: 'Filtrar por categoria (opcional).',
          },
          entity: {
            type: 'string',
            description: 'Buscar por pessoa/projeto espec├¡fico (opcional).',
          },
        },
        required: ['query'],
      },
    },
  },
];

function relaxToolNumericMinimums() {
  const taskCreate = TOOLS.find((tool) => tool.function?.name === 'TaskCreate')?.function?.parameters?.properties;
  if (taskCreate) {
    if (taskCreate.subtasks?.items?.properties?.timer_minutes) taskCreate.subtasks.items.properties.timer_minutes.minimum = 0;
    if (taskCreate.timer_minutes) taskCreate.timer_minutes.minimum = 0;
    if (taskCreate.reminder_days_before) taskCreate.reminder_days_before.minimum = 0;
  }

  const taskUpdate = TOOLS.find((tool) => tool.function?.name === 'TaskUpdate')?.function?.parameters?.properties;
  if (taskUpdate) {
    if (taskUpdate.timer_minutes) taskUpdate.timer_minutes.minimum = 0;
    if (taskUpdate.reminder_days_before) taskUpdate.reminder_days_before.minimum = 0;
  }

  const taskBatchCreate = TOOLS.find((tool) => tool.function?.name === 'TaskBatchCreate')?.function?.parameters?.properties?.tasks?.items?.properties;
  if (taskBatchCreate) {
    if (taskBatchCreate.subtasks?.items?.properties?.timer_minutes) taskBatchCreate.subtasks.items.properties.timer_minutes.minimum = 0;
    if (taskBatchCreate.timer_minutes) taskBatchCreate.timer_minutes.minimum = 0;
  }
}

relaxToolNumericMinimums();

// ÔöÇÔöÇ Helpers ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

/**
 * Corrige datas com ano errado geradas pela IA.
 */
function fixDueDate(dateStr) {
  if (!dateStr) return null;

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearStr, month, day] = match;
  let year = parseInt(yearStr, 10);

  const now = new Date();
  const currentYear = parseInt(
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(now),
    10
  );
  const todayISO = getTodayISO();

  if (year < currentYear) {
    year = currentYear;
    const corrected = `${year}-${month}-${day}`;
    if (corrected < todayISO) {
      year = currentYear + 1;
    }
  }

  const fixed = `${year}-${month}-${day}`;
  console.log(`[fixDueDate] ${dateStr} ÔåÆ ${fixed}`);
  return fixed;
}

/**
 * Converte data ISO em texto humanizado pt-BR.
 */
function humanizeDate(dateStr) {
  if (!dateStr) return 'sem prazo definido';

  const todayISO = getTodayISO();
  const spDate = new Date(todayISO + 'T12:00:00-03:00');

  const tomorrow = new Date(spDate);
  tomorrow.setDate(spDate.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().split('T')[0];

  const dayAfter = new Date(spDate);
  dayAfter.setDate(spDate.getDate() + 2);
  const dayAfterISO = dayAfter.toISOString().split('T')[0];

  // Atrasada
  if (dateStr < todayISO) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const target = new Date(year, month - 1, day);
    const diffMs = spDate.getTime() - target.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'ontem (atrasada)';
    if (diffDays <= 7) return `${diffDays} dias atr├ís (atrasada)`;
    const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(target);
    const dayNum = target.getDate();
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(target);
    return `${weekday}, ${dayNum} de ${monthName} (atrasada)`;
  }

  if (dateStr === todayISO) return 'hoje';
  if (dateStr === tomorrowISO) return 'amanh├ú';
  if (dateStr === dayAfterISO) return 'depois de amanh├ú';

  const [year, month, day] = dateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);

  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(targetDate);
  const dayNum = targetDate.getDate();
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(targetDate);

  return `${weekday}, ${dayNum} de ${monthName}`;
}

const PRIORITY_LABEL = { high: 'alta', medium: 'm├®dia', low: 'baixa' };
const PRIORITY_EMOJI = { high: '', medium: '', low: '' };
const STATUS_LABEL = { todo: 'a fazer', doing: 'em progresso', done: 'conclu├¡da', canceled: 'cancelada' };

// ÔöÇÔöÇ Executores das ferramentas ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

async function resolveWorkspaceOwnerId(userId, visibility) {
  if (visibility !== 'workspace') return null;
  // Verifica se ├® membro de algum workspace
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_owner_id')
    .eq('member_user_id', userId)
    .maybeSingle();
  // Membro ÔåÆ usa o ID do dono; dono ÔåÆ usa o pr├│prio ID
  return membership ? membership.workspace_owner_id : userId;
}

async function resolveAssignedTo(userId, assignedToName, visibility) {
  if (!assignedToName || visibility !== 'workspace') return null;
  // Busca membros do workspace do owner
  const ownerIdResult = await resolveWorkspaceOwnerId(userId, 'workspace');
  if (!ownerIdResult) return null;
  const { data: members } = await supabase
    .from('workspace_members')
    .select('member_user_id, member_name, member_email')
    .eq('workspace_owner_id', ownerIdResult);
  if (!members) return null;
  const nameLower = assignedToName.toLowerCase().trim();
  const match = members.find(m => {
    const mName = (m.member_name || '').toLowerCase();
    const mEmail = (m.member_email || '').toLowerCase();
    return mName.includes(nameLower) || nameLower.includes(mName.split(' ')[0]) || mEmail.startsWith(nameLower);
  });
  return match ? match.member_user_id : null;
}

async function executeTaskCreate(args, userId) {
  const parsed = taskCreateSchema.parse(args);
  const dueDateFixed = fixDueDate(parsed.due_date);
  let visibility = parsed.visibility || 'personal';
  let isGuest = false;

  // Verifica proativamente se ├® membro convidado
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_owner_id')
    .eq('member_user_id', userId)
    .maybeSingle();

  if (membership) {
    visibility = 'workspace';
    isGuest = true;
  }

  // Resolve workspace_owner_id se necess├írio
  const workspaceOwnerId = await resolveWorkspaceOwnerId(userId, visibility);

  // Resolve respons├ível por nome (se informado)
  let assignedToId = await resolveAssignedTo(userId, parsed.assigned_to_name, visibility);

  // Auto-atribui para o convidado caso n├úo tenha atribui├º├úo expl├¡cita
  if (isGuest && !assignedToId) {
    assignedToId = userId;
  }

  // Monta array de subtarefas no formato do banco (suporta timer por subtarefa)
  const now = Date.now();
  const subtasksFormatted = (parsed.subtasks || []).map(s => ({
    id: Math.random().toString(36).substr(2, 9),
    title: s.title,
    completed: false,
    timer_at: s.timer_minutes ? new Date(now + s.timer_minutes * 60 * 1000).toISOString() : null,
    timer_fired: false,
    timer_warned: false,
  }));

  // Calcula timer_at: prefere timer_at_override (preciso) sobre timer_minutes (relativo)
  let timerAt = null;
  if (parsed.timer_at_override) {
    timerAt = parsed.timer_at_override;
    console.log(`[Timer] Usando timer_at_override preciso: ${timerAt}`);
  } else if (parsed.timer_minutes) {
    timerAt = new Date(Date.now() + parsed.timer_minutes * 60 * 1000).toISOString();
  }

  const insertData = {
    user_id: userId,
    title: parsed.title,
    status: 'todo',
    priority: parsed.priority || 'medium',
    due_date: dueDateFixed,
    tags: parsed.tags || [],
    progress: 0,
    source: parsed.source || 'whatsapp',
    subtasks: subtasksFormatted,
    timer_at: timerAt,
    timer_fired: false,
    reminder_days_before: parsed.reminder_days_before || null,
    reminder_fired: false,
    whatsapp_message: parsed.whatsapp_message || null,
    visibility,
    workspace_owner_id: workspaceOwnerId,
    assigned_to: assignedToId || null,
    assigned_by: assignedToId ? userId : null,
  };

  // Adiciona descri├º├úo (auto-gera se n├úo veio)
  insertData.description = parsed.description || `Tarefa: ${parsed.title}`;

  const { data, error } = await supabase
    .from('tasks')
    .insert(insertData)
    .select('id, title, status, priority, due_date, subtasks, timer_at')
    .single();

  if (error) throw new Error(`Falha ao criar tarefa: ${error.message}`);

  // Track behavioral event
  trackEvent(userId, 'task_created', {
    task_id: data.id,
    priority: data.priority,
    has_due_date: !!data.due_date,
    has_timer: !!data.timer_at,
    subtask_count: data.subtasks?.length || 0,
  }).catch(() => {});

  const priorityLabel = PRIORITY_LABEL[data.priority] || 'm├®dia';
  const dateLabel = humanizeDate(data.due_date);
  const subtaskCount = data.subtasks?.length || 0;
  const subtaskHint = subtaskCount > 0
    ? ` com ${subtaskCount} subtarefa${subtaskCount > 1 ? 's' : ''}: ${data.subtasks.map(s => s.title).join(', ')}`
    : '';

  let timerHint = '';
  if (data.timer_at) {
    const mins = parsed.timer_minutes;
    const hintTime = mins >= 60
      ? `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}min` : ''}`
      : `${mins} minutos`;
    timerHint = ` Timer de ${hintTime} configurado ÔÇö vou te avisar aqui pelo WhatsApp quando chegar a hora.`;
  }

  return {
    success: true,
    task_title: data.title,
    task_priority: priorityLabel,
    task_due_date: dateLabel,
    subtask_count: subtaskCount,
    timer_set: !!data.timer_at,
    timer_minutes: parsed.timer_minutes || null,
    _hint: `Tarefa "${data.title}" criada com prioridade ${priorityLabel} pra ${dateLabel}${subtaskHint}.${timerHint}${parsed.reminder_days_before ? ` Lembrete configurado para ${parsed.reminder_days_before} dia(s) antes do prazo.` : ''}${visibility === 'workspace' ? ' Tarefa compartilhada com o workspace (equipe).' : ''}${assignedToId ? ` Atribu├¡da a ${parsed.assigned_to_name || 'membro da equipe'}.` : ''} Responda de forma natural e curta. NUNCA use emojis, datas ISO, IDs ou JSON.`
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function executeTaskUpdate(args, userId) {
  const { task_id, ...rest } = taskUpdateSchema.parse(args);

  // Se o modelo inventou um ID falso, tenta resolver automaticamente por busca
  let resolvedId = task_id;
  if (!UUID_RE.test(task_id)) {
    const searchTerm = task_id.replace(/_/g, ' ').replace(/ID_DA_TAREFA_?/i, '').trim();
    const { data: found } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', userId)
      .in('status', ['todo', 'doing'])
      .ilike('title', `%${searchTerm}%`)
      .limit(1)
      .maybeSingle();

    if (!found) {
      return {
        success: false,
        _hint: `N├úo encontrei nenhuma tarefa com o nome "${searchTerm}". Use TaskSearch para localizar a tarefa antes de atualizar.`
      };
    }
    resolvedId = found.id;
    console.log(`[TaskUpdate] ID resolvido por busca: "${searchTerm}" ÔåÆ ${resolvedId} ("${found.title}")`);
  }

  if (rest.due_date) {
    rest.due_date = fixDueDate(rest.due_date);
    // Prazo mudou ÔåÆ reseta lembrete para poder disparar novamente
    rest.reminder_fired = false;
  }

  if (rest.subtasks) {
    rest.subtasks = rest.subtasks.map(title => ({
      id: Math.random().toString(36).substr(2, 9),
      title,
      completed: false,
    }));
  }

  // Busca dados atuais para opera├º├Áes que precisam de contexto
  const needsCurrentData = rest.status || rest.timer_minutes !== undefined;
  let currentTask = null;
  if (needsCurrentData) {
    const { data: cur } = await supabase
      .from('tasks')
      .select('subtasks, timer_at')
      .eq('id', resolvedId)
      .eq('user_id', userId)
      .maybeSingle();
    currentTask = cur;
  }

  // Quando marcar como conclu├¡da: auto-completa todas as subtarefas
  if (rest.status === 'done') {
    const currentSubs = currentTask?.subtasks || [];
    if (currentSubs.length > 0) {
      rest.subtasks = currentSubs.map(s => ({ ...s, completed: true }));
    }
    rest.progress = 100;
    rest.timer_fired = true;
  }

  // Quando reverter para todo/doing: reseta timer e desbloqueia subtarefas
  if (rest.status === 'todo' || rest.status === 'doing') {
    rest.timer_fired = false;
    rest.timer_warned = false;
    // Desmarca subtarefas se a tarefa estava conclu├¡da (todas marcadas)
    const currentSubs = currentTask?.subtasks || [];
    if (currentSubs.length > 0 && currentSubs.every(s => s.completed)) {
      rest.subtasks = currentSubs.map(s => ({ ...s, completed: false }));
      rest.progress = 0;
    }
  }

  // Quando definir timer_minutes: calcula timer_at e reseta flags
  if (rest.timer_minutes !== undefined) {
    rest.timer_at = new Date(Date.now() + rest.timer_minutes * 60 * 1000).toISOString();
    rest.timer_fired = false;
    rest.timer_warned = false;
    delete rest.timer_minutes;
  }

  // Quando remover timer: zera timer_at e reseta flags
  if (rest.remove_timer) {
    rest.timer_at = null;
    rest.timer_fired = false;
    rest.timer_warned = false;
    delete rest.remove_timer;
  }

  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(updates).length === 0) {
    return { success: false, _hint: 'Nenhum campo foi fornecido para atualiza├º├úo. Pergunte ao usu├írio o que ele quer mudar.' };
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', resolvedId)
    .eq('user_id', userId)
    .select('id, title, status, priority, due_date, subtasks')
    .maybeSingle();

  if (error) throw new Error(`Falha ao atualizar tarefa: ${error.message}`);

  if (!data) {
    return {
      success: false,
      _hint: `Tarefa com ID "${resolvedId}" n├úo encontrada. Use TaskSearch para localizar a tarefa pelo nome e obter o ID correto antes de atualizar.`,
    };
  }

  const statusLabel = STATUS_LABEL[data.status] || data.status;
  const dateLabel = humanizeDate(data.due_date);

  // Monta hint contextual baseado no que mudou
  const changes = [];
  if (rest.status) changes.push(`status: ${statusLabel}`);
  if (rest.priority) changes.push(`prioridade: ${PRIORITY_LABEL[rest.priority]}`);
  if (rest.due_date) changes.push(`prazo: ${dateLabel}`);
  if (rest.title) changes.push(`t├¡tulo: "${data.title}"`);
  if (rest.subtasks && rest.status !== 'done' && rest.status !== 'todo' && rest.status !== 'doing') changes.push(`subtarefas: ${rest.subtasks.length} novos passos`);
  if (rest.timer_at === null) {
    changes.push('timer: removido');
  } else if (rest.timer_at) {
    const mins = Math.round((new Date(rest.timer_at) - Date.now()) / 60000);
    const timerLabel = mins >= 60
      ? `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}min` : ''}`
      : `${mins} minutos`;
    changes.push(`timer: ${timerLabel}`);
  }

  const subtasksAutoCompleted = rest.status === 'done' && (data.subtasks?.length || 0) > 0;
  const subtasksReset = (rest.status === 'todo' || rest.status === 'doing') && rest.subtasks?.length > 0;
  const subtaskHint = subtasksAutoCompleted
    ? ` Todas as ${data.subtasks.length} subtarefas foram marcadas como conclu├¡das.`
    : subtasksReset
      ? ` As ${rest.subtasks.length} subtarefas foram redefinidas para pendente.`
      : '';
  const timerHint = rest.timer_at === null
    ? ` Timer removido com sucesso.`
    : rest.timer_at
      ? ` Timer configurado ÔÇö vou avisar no WhatsApp quando chegar a hora.`
      : '';

  // Track behavioral events for status changes
  if (rest.status === 'done') {
    trackEvent(userId, 'task_completed', {
      task_id: data.id,
      task_title: data.title,
      priority: data.priority,
      was_overdue: data.due_date ? data.due_date < getTodayISO() : false,
      days_until_due: data.due_date ? Math.ceil((new Date(data.due_date) - new Date(getTodayISO())) / (1000 * 60 * 60 * 24)) : null,
    }).catch(() => {});
  } else if (rest.due_date && rest.due_date !== data.due_date) {
    trackEvent(userId, 'task_rescheduled', {
      task_id: data.id,
      task_title: data.title,
      old_due_date: data.due_date,
      new_due_date: rest.due_date,
      postpone_days: data.due_date && rest.due_date
        ? Math.ceil((new Date(rest.due_date) - new Date(data.due_date)) / (1000 * 60 * 60 * 24))
        : 0,
    }).catch(() => {});
  }

  return {
    success: true,
    task_title: data.title,
    task_status: statusLabel,
    subtasks_auto_completed: subtasksAutoCompleted,
    subtask_count: data.subtasks?.length || 0,
    timer_set: !!rest.timer_at,
    changes: changes.join(', '),
    _hint: `Tarefa "${data.title}" atualizada (${changes.join(', ')}).${subtaskHint}${timerHint} Responda de forma natural e motivacional. NUNCA mostre dados t├®cnicos.`
  };
}

async function executeTaskList(args, userId) {
  const parsed = taskListSchema.parse(args);
  const limit = parsed.limit || 10;

  let query = supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, tags')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (parsed.status && parsed.status !== 'all') {
    query = query.eq('status', parsed.status);
  } else if (!parsed.status) {
    query = query.in('status', ['todo', 'doing']);
  }

  if (parsed.due_date) {
    const filterDate = parsed.due_date === 'today' ? getTodayISO() : parsed.due_date;
    query = query.eq('due_date', filterDate);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Falha ao listar tarefas: ${error.message}`);

  const tasks = data || [];

  if (tasks.length === 0) {
    return {
      success: true,
      count: 0,
      formatted_list: '',
      _hint: 'O usu├írio n├úo tem tarefas nesse filtro. Informe de forma amig├ível.'
    };
  }

  const taskList = tasks.map((t, i) => {
    const statusLabel = STATUS_LABEL[t.status] || t.status;
    const dateLabel = t.due_date ? ` ÔÇö ${humanizeDate(t.due_date)}` : '';
    const tagsStr = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
    return `${i + 1}. *${t.title}* (${statusLabel}${dateLabel})${tagsStr}`;
  }).join('\n');

  return {
    success: true,
    count: tasks.length,
    formatted_list: taskList,
    tasks_raw: tasks.map(t => ({ id: t.id, title: t.title })),
    _hint: `${tasks.length} tarefa(s) encontrada(s). Apresente usando a formatted_list. Os IDs em tasks_raw s├úo para seu uso interno nas ferramentas. NUNCA mostre IDs, JSON ou emojis.`
  };
}

async function executeTaskDelete(args, userId) {
  const parsed = taskDeleteSchema.parse(args);

  // Se o modelo inventou um ID falso, tenta resolver automaticamente por busca
  let deleteId = parsed.task_id;
  if (!UUID_RE.test(parsed.task_id)) {
    const searchTerm = parsed.task_id.replace(/_/g, ' ').replace(/ID_DA_TAREFA_?/i, '').trim();
    const { data: found } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', userId)
      .ilike('title', `%${searchTerm}%`)
      .limit(1)
      .maybeSingle();

    if (!found) {
      return {
        success: false,
        _hint: `N├úo encontrei nenhuma tarefa com o nome "${searchTerm}". Use TaskSearch para localizar antes de deletar.`
      };
    }
    deleteId = found.id;
    console.log(`[TaskDelete] ID resolvido por busca: "${searchTerm}" ÔåÆ ${deleteId}`);
  }

  // Busca o t├¡tulo antes de deletar
  const { data: task } = await supabase
    .from('tasks')
    .select('title')
    .eq('id', deleteId)
    .eq('user_id', userId)
    .single();

  const taskTitle = task?.title || 'Tarefa';

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', deleteId)
    .eq('user_id', userId);

  if (error) throw new Error(`Falha ao excluir tarefa: ${error.message}`);

  return {
    success: true,
    task_title: taskTitle,
    _hint: `Tarefa "${taskTitle}" foi exclu├¡da permanentemente. Confirme ao usu├írio de forma breve.`
  };
}

async function executeTaskSearch(args, userId) {
  const parsed = taskSearchSchema.parse(args);
  const limit = parsed.limit || 10;

  // Sanitiza a query: remove caracteres que quebram o filtro .or() do PostgREST
  const sanitized = parsed.query.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, description, status, priority, due_date, tags')
    .eq('user_id', userId)
    .or(`title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha na busca: ${error.message}`);

  const tasks = data || [];

  if (tasks.length === 0) {
    return {
      success: true,
      count: 0,
      formatted_list: '',
      _hint: `Nenhuma tarefa encontrada com "${parsed.query}". Se o usu├írio estiver tentando anotar algo novo, use TaskCreate. Caso contr├írio, informe e sugira uma busca diferente.`
    };
  }

  const taskList = tasks.map((t, i) => {
    const statusLabel = STATUS_LABEL[t.status] || t.status;
    const dateLabel = t.due_date ? ` ÔÇö ${humanizeDate(t.due_date)}` : '';
    return `${i + 1}. *${t.title}* (${statusLabel}${dateLabel})`;
  }).join('\n');

  return {
    success: true,
    count: tasks.length,
    query: parsed.query,
    formatted_list: taskList,
    tasks_raw: tasks.map(t => ({ id: t.id, title: t.title })),
    _hint: `${tasks.length} tarefa(s) encontrada(s) com "${parsed.query}". Apresente usando formatted_list. Os IDs em tasks_raw s├úo para seu uso interno nas ferramentas. NUNCA mostre IDs.`
  };
}

async function executeTaskDashboard(args, userId) {
  const todayISO = getTodayISO();

  // Busca todas as tarefas do usu├írio
  const { data: allTasks, error } = await supabase
    .from('tasks')
    .select('status, priority, due_date, created_at, updated_at')
    .eq('user_id', userId);

  if (error) throw new Error(`Falha ao gerar dashboard: ${error.message}`);

  const tasks = allTasks || [];
  const total = tasks.length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const doing = tasks.filter(t => t.status === 'doing').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const canceled = tasks.filter(t => t.status === 'canceled').length;
  const pending = todo + doing;
  const overdue = tasks.filter(t => ['todo', 'doing'].includes(t.status) && t.due_date && t.due_date < todayISO).length;
  const highPriority = tasks.filter(t => t.priority === 'high' && ['todo', 'doing'].includes(t.status)).length;

  // Taxa de conclus├úo
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

  // Tarefas conclu├¡das esta semana
  const weekAgo = new Date(todayISO + 'T12:00:00-03:00');
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoISO = weekAgo.toISOString();
  const doneThisWeek = tasks.filter(t => t.status === 'done' && t.updated_at && t.updated_at >= weekAgoISO).length;

  // Streak: dias consecutivos com pelo menos 1 tarefa conclu├¡da
  const doneDates = new Set();
  for (const t of tasks) {
    if (t.status === 'done' && t.updated_at) {
      doneDates.add(t.updated_at.split('T')[0]);
    }
  }
  let streak = 0;
  const checkDate = new Date(todayISO + 'T12:00:00-03:00');
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (doneDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Monta resumo humanizado
  const lines = [];
  if (streak > 0) lines.push(`*Streak: ${streak} dia${streak > 1 ? 's' : ''}* consecutivo${streak > 1 ? 's' : ''} concluindo tarefas!`);

  return {
    success: true,
    formatted_dashboard: lines.join('\n'),
    stats: { total, pending, done, overdue, completionRate, streak, doneThisWeek },
    _hint: `Apresente o dashboard ao usu├írio usando o formatted_dashboard. Adicione um coment├írio motivacional breve no final. NUNCA mostre JSON ou emojis.`
  };
}

async function executeTaskBatchCreate(args, userId) {
  const parsed = taskBatchCreateSchema.parse(args);

  // Verifica proativamente se ├® membro convidado
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_owner_id')
    .eq('member_user_id', userId)
    .maybeSingle();

  const isGuest = !!membership;

  // Resolve workspace_owner_id uma vez se alguma tarefa ├® workspace
  const hasWorkspaceTask = isGuest || parsed.tasks.some(t => t.visibility === 'workspace');
  const workspaceOwnerId = hasWorkspaceTask ? await resolveWorkspaceOwnerId(userId, 'workspace') : null;

  const insertData = parsed.tasks.map(t => {
    const batchNow = Date.now();
    const subtasksFormatted = (t.subtasks || []).map(s => ({
      id: Math.random().toString(36).substr(2, 9),
      title: s.title,
      completed: false,
      timer_at: s.timer_minutes ? new Date(batchNow + s.timer_minutes * 60 * 1000).toISOString() : null,
      timer_fired: false,
      timer_warned: false,
    }));

    const timerAt = t.timer_minutes
      ? new Date(Date.now() + t.timer_minutes * 60 * 1000).toISOString()
      : null;

    let taskVisibility = t.visibility || 'personal';
    let assignedToId = null;

    if (isGuest) {
      taskVisibility = 'workspace';
      // Como n├úo tem assigned_to_name em batch, auto-atribui todas ao guest
      assignedToId = userId;
    }

    return {
      user_id: userId,
      title: t.title,
      description: t.description || `Tarefa: ${t.title}`,
      status: 'todo',
      priority: t.priority || 'medium',
      due_date: fixDueDate(t.due_date),
      tags: t.tags || [],
      progress: 0,
      source: parsed.source || 'whatsapp',
      subtasks: subtasksFormatted,
      timer_at: timerAt,
      timer_fired: false,
      whatsapp_message: parsed.whatsapp_message || null,
      visibility: taskVisibility,
      workspace_owner_id: taskVisibility === 'workspace' ? workspaceOwnerId : null,
      assigned_to: assignedToId,
      assigned_by: assignedToId ? userId : null,
    };
  });

  const { data, error } = await supabase
    .from('tasks')
    .insert(insertData)
    .select('title, priority, due_date, subtasks');

  if (error) throw new Error(`Falha ao criar tarefas: ${error.message}`);

  const created = (data || []).map((t, i) => {
    const dateLabel = t.due_date ? ` ÔÇö ${humanizeDate(t.due_date)}` : '';
    const subtaskInfo = t.subtasks?.length > 0 ? ` (${t.subtasks.length} subtarefas)` : '';
    return `${i + 1}. *${t.title}*${dateLabel}${subtaskInfo}`;
  }).join('\n');

  return {
    success: true,
    count: data?.length || 0,
    formatted_list: created,
    _hint: `${data?.length || 0} tarefas criadas com sucesso! Monte um resumo caloroso para o usu├írio usando o nome dele. Apresente a formatted_list numerada e feche com algo como "Tudo anotado! Quer ajustar alguma coisa?". NUNCA mostre JSON ou emojis.`
  };
}

const subtaskToggleSchema = z.object({
  task_id: z.string(),
  subtask_id: z.string(),
  completed: z.boolean(),
});

async function executeSubtaskToggle(args, userId) {
  const parsed = subtaskToggleSchema.parse(args);

  // Busca a tarefa com suas subtarefas
  const { data: task, error: fetchErr } = await supabase
    .from('tasks')
    .select('id, title, subtasks')
    .eq('id', parsed.task_id)
    .eq('user_id', userId)
    .single();

  if (fetchErr || !task) {
    return { success: false, _hint: `Tarefa n├úo encontrada. Use TaskList para verificar os IDs dispon├¡veis.` };
  }

  const subs = task.subtasks || [];
  const subtask = subs.find(s => s.id === parsed.subtask_id);
  if (!subtask) {
    return { success: false, _hint: `Subtarefa n├úo encontrada na tarefa "${task.title}". Verifique o subtask_id.` };
  }

  const updatedSubs = subs.map(s =>
    s.id === parsed.subtask_id ? { ...s, completed: parsed.completed } : s
  );

  const total = updatedSubs.length;
  const done = updatedSubs.filter(s => s.completed).length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const { error: updateErr } = await supabase
    .from('tasks')
    .update({ subtasks: updatedSubs, progress })
    .eq('id', parsed.task_id)
    .eq('user_id', userId);

  if (updateErr) throw new Error(`Falha ao atualizar subtarefa: ${updateErr.message}`);

  const action = parsed.completed ? 'conclu├¡da' : 'desmarcada';
  return {
    success: true,
    task_title: task.title,
    subtask_title: subtask.title,
    completed: parsed.completed,
    progress,
    done_count: done,
    total_count: total,
    _hint: `Subtarefa "${subtask.title}" da tarefa "${task.title}" foi marcada como ${action}. Progresso: ${done}/${total}. Responda de forma natural e breve, sem emojis.`,
  };
}

// ÔöÇÔöÇ Mem├│ria de Longo Prazo & Segundo C├®rebro ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

async function executeMemorySave(args, userId) {
  const { memory_type, content, summary, entities, tags, importance } = args;

  if (!content) {
    return { success: false, _hint: 'Conte├║do da mem├│ria ├® obrigat├│rio. Pergunte o que o usu├írio quer guardar.' };
  }

  const result = await saveMemory(userId, {
    memoryType: memory_type || 'semantic',
    content,
    summary: summary || content.substring(0, 100),
    entities: entities || [],
    tags: tags || [],
    importance: importance || 0.5,
    sourceMessage: content,
  });

  if (!result) {
    return { success: false, _hint: 'Erro ao salvar mem├│ria. Diga ao usu├írio para tentar novamente.' };
  }

  return {
    success: true,
    _hint: `Mem├│ria salva: "${summary || content.substring(0, 50)}". RESPONDA como um amigo responderia numa conversa de WhatsApp ÔÇö reaja ao que a pessoa DISSE, n├úo ao fato de ter salvado. Se ela se apresentou, responda a apresenta├º├úo ("Fala Gustavo! Massa, dev tamb├®m aqui haha. No que posso te ajudar?"). Se contou um fato pessoal, reaja a ele naturalmente. NUNCA diga "anotei essa informa├º├úo" ou "guardei isso" ÔÇö aja como se fosse parte natural da conversa. Salvar na mem├│ria ├® INVIS├ìVEL pro usu├írio.`,
  };
}

async function executeMemoryRecall(args, userId) {
  const { query, memory_type, entity_name } = args;

  let results = [];

  if (entity_name) {
    results = await recallByEntity(userId, entity_name, 5);
  } else {
    results = await recallMemories(userId, {
      query: query || '',
      memoryType: memory_type || null,
      limit: 5,
    });
  }

  // Se n├úo encontrou, tenta buscar por entidade com o query
  if (results.length === 0 && query) {
    results = await recallByEntity(userId, query, 3);
  }

  // Tamb├®m busca entidades relevantes
  let entityInfo = [];
  if (entity_name || query) {
    entityInfo = await getEntities(userId, { query: entity_name || query, limit: 3 });
  }

  if (results.length === 0 && entityInfo.length === 0) {
    return {
      success: true,
      found: false,
      _hint: `N├úo encontrei nenhuma mem├│ria sobre "${query || entity_name}". Diga ao usu├írio de forma natural: "N├úo me lembro de nada sobre isso. Quer me contar pra eu guardar?"`,
    };
  }

  const memoriesFormatted = results.map(m => ({
    type: m.memory_type,
    content: m.content,
    date: m.created_at,
    entities: m.entities,
  }));

  const entitiesFormatted = entityInfo.map(e => ({
    name: e.name,
    type: e.entity_type,
    description: e.description,
    mentions: e.mention_count,
  }));

  return {
    success: true,
    found: true,
    memories: memoriesFormatted,
    entities: entitiesFormatted,
    _hint: `Encontrei ${results.length} mem├│ria(s) e ${entityInfo.length} entidade(s) sobre "${query || entity_name}". Use essas informa├º├Áes para responder ao usu├írio de forma NATURAL ÔÇö como se voc├¬ realmente lembrasse. Ex: "Sim, lembro! Voc├¬ me contou que..." NUNCA liste mem├│rias como itens t├®cnicos. Integre na conversa.`,
  };
}

async function executeKnowledgeSave(args, userId) {
  const { category, title, content, entities, tags, pinned } = args;

  if (!title || !content) {
    return { success: false, _hint: 'T├¡tulo e conte├║do s├úo obrigat├│rios. Pergunte o que o usu├írio quer anotar.' };
  }

  const result = await saveKnowledge(userId, {
    category: category || 'note',
    title,
    content,
    entities: entities || [],
    tags: tags || [],
    pinned: pinned || false,
    source: 'whatsapp',
  });

  if (!result) {
    return { success: false, _hint: 'Erro ao salvar no segundo c├®rebro. Tente novamente.' };
  }

  const categoryLabels = {
    note: 'Anota├º├úo',
    idea: 'Ideia',
    reference: 'Refer├¬ncia',
    decision: 'Decis├úo',
    contact: 'Contato',
    routine: 'Rotina',
  };

  return {
    success: true,
    entry_title: title,
    category_label: categoryLabels[category] || 'Nota',
    pinned: pinned || false,
    _hint: `Salvo no segundo c├®rebro como ${categoryLabels[category] || 'nota'}: "${title}"${pinned ? ' (fixado ÔÇö sempre vis├¡vel)' : ''}. Confirme ao usu├írio de forma natural. Ex: "Guardei! Quando precisar, ├® s├│ perguntar." NUNCA use emojis ou jarg├úo t├®cnico.`,
  };
}

async function executeKnowledgeSearch(args, userId) {
  const { query, category, entity } = args;

  const results = await searchKnowledge(userId, {
    query: query || '',
    category: category || null,
    entity: entity || null,
    limit: 5,
  });

  if (results.length === 0) {
    // Se buscou por pessoa, tenta contexto da pessoa
    if (entity) {
      const personCtx = await getPersonContext(userId, entity);
      if (personCtx.entity || personCtx.knowledge.length > 0 || personCtx.memories.length > 0) {
        return {
          success: true,
          found: true,
          person_context: personCtx,
          _hint: `Encontrei informa├º├Áes sobre "${entity}". Use o person_context para montar uma resposta natural sobre essa pessoa/projeto. Integre as informa├º├Áes como se voc├¬ conhecesse esse contexto.`,
        };
      }
    }

    return {
      success: true,
      found: false,
      _hint: `N├úo encontrei nada sobre "${query || entity}" no segundo c├®rebro. Diga ao usu├írio: "N├úo tenho nada anotado sobre isso. Quer que eu guarde alguma informa├º├úo?"`,
    };
  }

  const formatted = results.map(entry => ({
    title: entry.title,
    category: entry.category,
    content: entry.content,
    tags: entry.tags,
    date: entry.created_at,
    pinned: entry.pinned,
  }));

  return {
    success: true,
    found: true,
    entries: formatted,
    count: results.length,
    _hint: `Encontrei ${results.length} entrada(s) no segundo c├®rebro sobre "${query || entity}". Apresente as informa├º├Áes de forma NATURAL e organizada. Se for uma consulta espec├¡fica, d├¬ a resposta direta. Se listar, use formato leg├¡vel. NUNCA mostre JSON ou IDs.`,
  };
}

// ÔöÇÔöÇ Dispatcher central ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

/**
 * Normaliza args gerados pela IA: se algum valor que deveria ser
 * array/object veio como string JSON, faz o parse automaticamente.
 * Isso acontece quando o modelo "double-serializa" campos complexos.
 */
function normalizeArgs(args) {
  if (!args || typeof args !== 'object') return args;

  const normalized = { ...args };
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          normalized[key] = JSON.parse(trimmed);
          console.log(`[normalizeArgs] Parsed stringified ${key}`);
        } catch {
          // N├úo ├® JSON v├ílido, mant├®m como string
        }
      }
    }
  }
  return normalized;
}

function sanitizeToolArgs(args) {
  if (Array.isArray(args)) {
    return args
      .map((item) => sanitizeToolArgs(item))
      .filter((item) => item !== undefined);
  }

  if (!args || typeof args !== 'object') return args;

  const sanitized = {};
  for (const [key, value] of Object.entries(args)) {
    let nextValue = value;

    if (key === 'timer_minutes' || key === 'reminder_days_before') {
      const numeric = Number(nextValue);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        continue;
      }
      sanitized[key] = numeric;
      continue;
    }

    if (Array.isArray(nextValue) || (nextValue && typeof nextValue === 'object')) {
      nextValue = sanitizeToolArgs(nextValue);
    }

    sanitized[key] = nextValue;
  }

  return sanitized;
}

export async function executeTool(name, args, context) {
  try {
    const normalizedArgs = sanitizeToolArgs(normalizeArgs(args));
    switch (name) {
      case 'TaskCreate': return await executeTaskCreate(normalizedArgs, context.userId);
      case 'TaskUpdate': return await executeTaskUpdate(normalizedArgs, context.userId);
      case 'TaskList': return await executeTaskList(normalizedArgs, context.userId);
      case 'TaskDelete': return await executeTaskDelete(normalizedArgs, context.userId);
      case 'TaskSearch': return await executeTaskSearch(normalizedArgs, context.userId);
      case 'TaskDashboard': return await executeTaskDashboard(normalizedArgs, context.userId);
      case 'TaskBatchCreate': return await executeTaskBatchCreate(normalizedArgs, context.userId);
      case 'SubtaskToggle': return await executeSubtaskToggle(normalizedArgs, context.userId);
      case 'MemorySave': return await executeMemorySave(normalizedArgs, context.userId);
      case 'MemoryRecall': return await executeMemoryRecall(normalizedArgs, context.userId);
      case 'KnowledgeSave': return await executeKnowledgeSave(normalizedArgs, context.userId);
      case 'KnowledgeSearch': return await executeKnowledgeSearch(normalizedArgs, context.userId);
      default: return { success: false, _hint: `Ferramenta "${name}" n├úo existe. Informe ao usu├írio que n├úo entendeu o pedido.` };
    }
  } catch (err) {
    // Tratamento especial para erro de valida├º├úo (Zod)
    if (err instanceof z.ZodError) {
      // Diferentes vers├Áes de Zod podem usar .issues ou .errors
      const issues = err.issues || err.errors || [];
      const missingFields = issues.map(e => e.path.join('.')).join(', ');

      console.error(`[Tool:${name}] Erro de valida├º├úo:`, missingFields);
      return {
        success: false,
        _hint: `Par├ómetros obrigat├│rios faltando ou inv├ílidos: ${missingFields}. Se voc├¬ n├úo tem o task_id, use TaskSearch ou TaskList para encontr├í-lo primeiro. N├âO mostre esse erro ao usu├írio.`
      };
    }

    console.error(`[Tool:${name}] Erro:`, err.message);
    return { success: false, _hint: `Houve um erro ao executar a a├º├úo. Diga ao usu├írio para tentar novamente. N├âO mostre detalhes t├®cnicos.` };
  }
}
