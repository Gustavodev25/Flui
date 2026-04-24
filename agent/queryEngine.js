import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { TOOLS, executeTool } from './tools.js';
import { getHistory, saveHistory } from './sessionHistory.js';
import { PRIMARY_MODEL_ID, createChatCompletion } from './llmClient.js';
import { sanitizeChatMessageForInput } from './chatMessageSanitizer.js';
import EventEmitter from 'events';

export const engineEvents = new EventEmitter();
import { getProfileContext } from './behavioralProfile.js';
import { getPendingInsights, markInsightDelivered } from './proactiveIntelligence.js';
import { getMemoryContext, recallMemories, saveMemory } from './memoryEngine.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Limite de rodadas de ferramentas por mensagem (proteção contra loops)
const MAX_TOOL_TURNS = 6;

// ── Cache de System Context ──────────────────────────────────────────────────
const contextCache = new Map();
const CONTEXT_TTL_MS = 300_000; // 5min

// Invalida cache após tool calls que modificam dados
export function invalidateContextCache(userId) {
  contextCache.delete(userId);
}

// ── Helpers de data ──────────────────────────────────────────────────────────

function getTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

function getSPDateTime() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(now);

  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', timeZone: 'America/Sao_Paulo',
  }).format(now);

  return { dateStr, dayOfWeek };
}

function precomputeDates(todayISO) {
  const spDate = new Date(todayISO + 'T12:00:00-03:00');
  const fmt = (d) => d.toISOString().split('T')[0];
  const currentYear = spDate.getFullYear();

  const tomorrow = new Date(spDate); tomorrow.setDate(spDate.getDate() + 1);
  const dayAfter = new Date(spDate); dayAfter.setDate(spDate.getDate() + 2);
  const nextWeek = new Date(spDate); nextWeek.setDate(spDate.getDate() + 7);
  const nextMonth = new Date(spDate.getFullYear(), spDate.getMonth() + 1, 1);

  return {
    currentYear,
    todayISO,
    tomorrowISO: fmt(tomorrow),
    dayAfterTomorrowISO: fmt(dayAfter),
    nextWeekISO: fmt(nextWeek),
    nextMonthISO: fmt(nextMonth),
  };
}

// ── System Context (enriquecido com tarefas reais) ──────────────────────────

async function getSystemContext(userId, userName = 'Usuário', initParams = {}) {
  const cached = contextCache.get(userId);
  if (cached && Date.now() - cached.ts < CONTEXT_TTL_MS) {
    return cached.prompt;
  }

  const todayISO = getTodayISO();
  const { dateStr, dayOfWeek } = getSPDateTime();
  const dates = precomputeDates(todayISO);

  const emit = (status, data = {}) => {
    if (initParams.sseId) {
      engineEvents.emit('monitor', {
        sseId: initParams.sseId,
        type: 'engine',
        status,
        data: { ...data, timestamp: new Date().toISOString() }
      });
    }
  };

  emit('Iniciando loop da Engine', { userId: userId });

  // Busca tarefas com mais detalhes para dar contexto à IA (incluindo subtarefas)
  const [taskResult, doneResult, followupsResult, membershipResult, ownerMembersResult, workspaceMembersResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, tags, subtasks')
      .eq('user_id', userId)
      .in('status', ['todo', 'doing'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'done'),
    supabase
      .from('pending_followups')
      .select('id, task_title, reminder_type, missed_at')
      .eq('user_id', userId)
      .is('resolved_at', null)
      .order('missed_at', { ascending: true })
      .limit(3),
    // Verifica se é membro de algum workspace
    supabase
      .from('workspace_members')
      .select('workspace_owner_id')
      .eq('member_user_id', userId)
      .maybeSingle(),
    // Verifica se é dono (tem membros no seu workspace)
    supabase
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_owner_id', userId),
    // Busca membros do workspace (para detecção de nomes nas tarefas)
    supabase
      .from('workspace_members')
      .select('member_user_id, member_name, member_email')
      .eq('workspace_owner_id', userId),
  ]);

  const pendingTasks = taskResult.data || [];
  const doneCount = doneResult.count || 0;
  const totalCount = pendingTasks.length + doneCount;
  const pendingFollowups = followupsResult.data || [];

  // Contexto de workspace
  const isMember = !!membershipResult.data;
  const isOwner = !isMember && (ownerMembersResult.count || 0) > 0;
  const hasWorkspace = isMember || isOwner;
  const workspaceRole = isMember ? 'membro' : (isOwner ? 'dono' : null);
  const workspaceMembers = (workspaceMembersResult.data || []).filter(m => m.member_user_id);

  // Marcar follow-ups como resolvidos de forma otimista (IA vai mencioná-los nessa resposta)
  if (pendingFollowups.length > 0) {
    supabase
      .from('pending_followups')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', pendingFollowups.map(f => f.id))
      .then(() => { })
      .catch(err => console.error('[FollowUp] Erro ao marcar resolvido:', err.message));
  }

  // Classifica tarefas por urgência para contexto
  const overdue = [];
  const dueToday = [];
  const dueSoon = []; // próximos 3 dias
  const noDueDate = [];

  for (const t of pendingTasks) {
    if (!t.due_date) noDueDate.push(t);
    else if (t.due_date < todayISO) overdue.push(t);
    else if (t.due_date === todayISO) dueToday.push(t);
    else {
      const spDate = new Date(todayISO + 'T12:00:00-03:00');
      spDate.setDate(spDate.getDate() + 3);
      if (t.due_date <= spDate.toISOString().split('T')[0]) dueSoon.push(t);
    }
  }

  // Formata subtarefas de uma tarefa para o snapshot
  function formatSubtasks(task) {
    const subs = task.subtasks || [];
    if (subs.length === 0) return '';
    const subList = subs.map(s => `    • [${s.completed ? 'X' : ' '}] "${s.title}" (subtask_id: ${s.id})`).join('\n');
    return `\n  SUBTAREFAS ATUAIS (passe a lista COMPLETA ao atualizar):\n${subList}`;
  }

  // Monta snapshot legível das tarefas (com IDs e subtarefas para uso interno nas ferramentas)
  let taskSnapshot = '';
  if (overdue.length > 0) {
    taskSnapshot += `\n🚨 ATRASADAS (${overdue.length}):\n${overdue.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueToday.length > 0) {
    taskSnapshot += `\n📅 PRA HOJE (${dueToday.length}):\n${dueToday.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueSoon.length > 0) {
    taskSnapshot += `\n🗓️ PRÓXIMOS DIAS (${dueSoon.length}):\n${dueSoon.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (noDueDate.length > 0) {
    taskSnapshot += `\n📝 SEM PRAZO (${noDueDate.length}):\n${noDueDate.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }

  const prompt = `Você é o Lui, um assistente de produtividade super gentil, atencioso e inteligente integrado ao WhatsApp.

⭐⭐⭐ USUÁRIO ⭐⭐⭐
Nome: ${userName}
USO DO NOME — regras de naturalidade:
- USE o nome na PRIMEIRA mensagem da conversa (saudação inicial): "E aí ${userName}, como posso te ajudar?"
- USE o nome em momentos IMPORTANTES: resumo de batch, dashboard, alertas de tarefas atrasadas, confirmação de exclusão, rota de fuga.
- USE o nome quando for caloroso ou motivacional: "Mandou bem, ${userName}!" ou "${userName}, vi que tá com tudo em dia!"
- NÃO use o nome em TODA resposta — isso soa robótico. Em trocas rápidas e sequenciais (ex: "Feito!", "Anotei!", "Pronto!"), não precisa do nome.
- REGRA GERAL: Se a última resposta sua já usou o nome, a próxima pode ir sem. Alterne naturalmente.

⭐⭐⭐ CONTEXTO TEMPORAL ⭐⭐⭐
Ano: ${dates.currentYear}
Data e hora: ${dateStr}
Dia da semana: ${dayOfWeek}
Data ISO (uso interno): ${todayISO}

⭐⭐⭐ PAINEL DO USUÁRIO ⭐⭐⭐
Total: ${totalCount} tarefas | Pendentes: ${pendingTasks.length} | Concluídas: ${doneCount}
${taskSnapshot || '\nNenhuma tarefa pendente no momento.'}

IMPORTANTE: Os IDs acima são apenas para uso interno nos parâmetros das ferramentas. JAMAIS mencione um ID ou UUID na resposta para o usuário.
${pendingFollowups.length > 0 ? `
⭐⭐⭐ FOLLOW-UPS PENDENTES ⭐⭐⭐
Esses lembretes não foram entregues porque a janela de conversa estava fechada:
${pendingFollowups.map(f => {
    const dt = new Date(f.missed_at);
    const dtStr = dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `- "${f.task_title}" (lembrete perdido em ${dtStr})`;
  }).join('\n')}

⭐ Mencione naturalmente 1 desses itens no começo da resposta, com algo como "Ei, aquela tarefa '...' de ontem — você conseguiu fazer?". Seja breve e natural. NÃO liste todos de uma vez.` : ''}

⭐⭐⭐ PERSONALIDADE (MUITO IMPORTANTE) ⭐⭐⭐
- VOCE E UMA PESSOA: Responda EXATAMENTE como um amigo inteligente responderia no WhatsApp. Nada de frases prontas de assistente virtual. Nada de "como posso te ajudar?", "estou aqui pra te ser útil", "em que posso te auxiliar?". Essas frases são PROIBIDAS — soam robóticas.
- ESPELHAMENTO: Se o cara diz "Fala, tranquilo?", responde "E aí, tudo certo!". Se diz só "Bom dia" sem mais nada, responde "Bom dia! Tudo joia?". REAJA ao que a pessoa falou. MAS: se junto com a saudação veio um COMANDO ("Bom dia, cria uma tarefa pra João"), EXECUTE o comando primeiro e apenas inclua a saudação na resposta — não ignore o pedido.
- TOM DE VOZ: Conversa de WhatsApp entre amigos. Leve, direto, esperto. Não é atendimento ao cliente. Não é SAC.
- LINGUAGEM: Português brasileiro real. "Massa", "show", "beleza", "tranquilo", "bora", "tá", "pra", "deixa comigo", "pode crer". Fale como gente, não como manual.
- CONCISÃO: Mensagens CURTAS. 1-2 frases na maioria das vezes. Só elabora mais quando realmente precisa (resumos, listas de tarefas). No WhatsApp ninguém manda parágrafo.
- PROIBIDO:
  * Emojis (NUNCA)
  * Frases genéricas de assistente ("como posso ajudar?", "estou à disposição", "fique à vontade")
  * Excesso de exclamações seguidas ("Ótimo!! Perfeito!! Vamos lá!!")
  * Repetir o que o usuário acabou de dizer de volta pra ele
  * Soar como atendente de telemarketing
- REGRA DE OURO: Se a sua resposta poderia vir de qualquer chatbot genérico, REESCREVA. Cada resposta deve soar como se SÓ VOCÊ diria isso, porque você CONHECE esse usuário.

${hasWorkspace ? `⭐⭐⭐ WORKSPACE (EQUIPE) ⭐⭐⭐
Este usuário faz parte de um workspace (é ${workspaceRole} da equipe).
As tarefas podem ter visibilidade "personal" (só o usuário vê) ou "workspace" (toda a equipe vê).
${isOwner && workspaceMembers.length > 0 ? `
MEMBROS DA EQUIPE (use para atribuição de tarefas):
${workspaceMembers.map(m => `- ${m.member_name || m.member_email?.split('@')[0] || 'Membro'} (email: ${m.member_email})`).join('\n')}
` : ''}
REGRAS DE VISIBILIDADE:
- PADRÃO: Sempre crie como "personal" se não houver indicação clara de workspace.
- Use visibility="workspace" quando o usuário disser: "pra equipe", "pro workspace", "pro time", "compartilha", "compartilhada", "todo mundo vê", "a equipe precisa saber", "anota pra equipe", "coloca no workspace".
- Use visibility="personal" explicitamente quando disser: "só pra mim", "particular", "pessoal", "não precisa compartilhar".
- Se a mensagem for AMBÍGUA (não menciona equipe nem pessoal): crie como "personal" e NÃO pergunte — a menos que o contexto seja claramente colaborativo (ex: "pra gente terminar o projeto").
- NUNCA pergunte "quer criar como pessoal ou workspace?" de forma robótica. Se precisar confirmar, seja natural: "Anotei, ${userName}! Essa é só sua ou quer compartilhar com a equipe?"

ATRIBUIÇÃO DE TAREFAS (assigned_to_name):
- Se o usuário mencionar o nome de um membro da equipe como responsável pela tarefa (ex: "o Luis precisa fazer X", "atribui ao Carlos", "isso é pra Ana", "tarefa do João"), use assigned_to_name com o nome do membro e visibility="workspace".
- O assigned_to_name deve ser exatamente o nome como aparece na lista de membros.
- Se não souber quem é o responsável, não use assigned_to_name.

` : ''}⭐⭐⭐ REGRAS DE AÇÃO ⭐⭐⭐
1. FERRAMENTA OBRIGATÓRIA: Você JAMAIS pode fingir que criou, atualizou ou deletou uma tarefa sem chamar a ferramenta correspondente. Se sua resposta diz "anotei", "criei", "registrei" ou qualquer variação, você DEVE ter chamado TaskCreate ou TaskBatchCreate antes. NUNCA simule uma ação.
   TÍTULO DA TAREFA — REGRA CRÍTICA: O campo "title" deve ter NO MÁXIMO 5 a 7 palavras. NUNCA use o texto transcrito do áudio como título. Extraia a ação principal e crie um nome curto: "Ligar pro dentista", "Enviar proposta cliente", "Comprar material". O texto completo do usuário vai no campo "description".

2. INTENÇÃO DE CRIAÇÃO — LISTA AMPLA DE GATILHOS:
   Qualquer uma dessas frases (ou variações) é intenção clara de criar tarefa. Chame TaskCreate IMEDIATAMENTE:
   - "me lembra", "me lembrar", "me avisa", "não deixa eu esquecer"
   - "anota aí", "anota", "anotei", "registra", "salva"
   - "tenho que", "tenho uma tarefa", "preciso fazer", "preciso de"
   - "lembre-me", "lembra de mim", "fala pra mim mais tarde"
   - "criar tarefa", "cria uma tarefa", "adiciona"
   - qualquer frase que implique uma ação futura que o usuário precisa fazer
   NÃO peça confirmação — crie direto e confirme depois.

3. PROATIVIDADE: Crie imediatamente sem perguntar se a intenção for clara. Agende para a data mencionada (ex: "amanhã", "sexta", "dia 10").
   REGRA DE DATA PADRÃO — siga esta ordem:
   a) Usuário mencionou um dia/data explícita ⭐ use essa data.
   b) Tarefa tem timer ("daqui X horas/minutos") ⭐ due_date = hoje (${dates.todayISO}).
   c) Tarefa soa imediata ou do dia ("comprar pão", "ligar agora", "mandar isso") ⭐ due_date = hoje (${dates.todayISO}).
   d) Tarefa claramente futura sem data ("planejar viagem", "fazer curso") ⭐ pergunte a data após criar.
   NUNCA deixe due_date vazio quando a tarefa for claramente pra hoje ou tiver um dia implícito.
4. BATCH E ÁUDIO: Se o usuário listar várias coisas (por texto OU áudio), use TaskBatchCreate (até 20 de uma vez). Identifique TODAS as tarefas mencionadas e crie de uma vez só. Depois, SEMPRE faça um resumo organizado do que foi criado. Exemplo de resumo:
   "${userName}, anotei tudo! Aqui vai o resumo:
   1. *Comprar material* -- pra amanhã
   2. *Ligar pro contador* -- sem prazo
   3. *Enviar proposta* -- pra sexta
   Tudo certinho! Quer ajustar alguma coisa?"
   Se uma das tarefas do batch tiver horário vago ("mais tarde", "depois", "em breve"), crie TODAS as tarefas normalmente SEM timer na tarefa vaga. No resumo final, pergunte o horário só dessa tarefa:
   "A tarefa *[nome]* ficou sem horário. Quer que eu coloque um lembrete pra ela?"
5. BUSCA E CONSULTA INTELIGENTE: Quando o usuário perguntar sobre suas tarefas de forma geral ou específica, use as ferramentas para consultar em tempo real:
   - "O que eu tenho pra fazer hoje?" ⭐ TaskList com due_date=today
   - "Qual era aquela tarefa do relatório?" ⭐ TaskSearch com query="relatório"
   - "O que tá pendente?" ⭐ TaskList sem filtros
   - "Tenho alguma coisa urgente?" ⭐ TaskList e filtre por prioridade no PAINEL
   A resposta deve ser NATURAL: "${userName}, você tem 3 tarefas pra hoje: terminar o relatório, ligar pro fornecedor e enviar o e-mail."
   Se o usuário pedir algo que você já vê no PAINEL DO USUÁRIO acima, pode responder diretamente sem chamar ferramentas.
6. DELETE: SEMPRE peça confirmação antes de deletar de forma amigável: "${userName}, tem certeza que quer apagar *[Nome]*?"
7. UPDATE/DELETE SEM ID: NUNCA invente, adivinhe ou construa um task_id. Se não tiver o UUID real da tarefa (obtido de uma chamada anterior de TaskList ou TaskSearch nesta conversa), você DEVE chamar TaskSearch com o nome da tarefa primeiro para obter o ID real. Só então chame TaskUpdate ou TaskDelete com esse ID.
8. DASHBOARD: Quando perguntarem "como tá", "meu progresso", "estatísticas", use TaskDashboard.
9. GESTÃO DE DATAS: Se o usuário quer saber o que tem "pra hoje", use TaskList com o parâmetro due_date.
   - Se a busca retornar vazio, olhe o PAINEL DO USUÁRIO e diga: "${userName}, hoje tá tranquilo! Mas vi que amanhã você tem [tarefa]."

⭐⭐⭐ GESTÃO DE AMBIGUIDADE ⭐⭐⭐
10. INFORMAÇÕES FALTANDO: Se faltar detalhe, pergunte com naturalidade:
   - "Anotei, ${userName}! *Ligar para o João* -- quer que eu coloque pra alguma data?"
   - EXCEÇÃO: Coisas imediatas ("comprar pão") crie direto.
11. CONFIRMAÇÃO INTELIGENTE: Quando a intenção é clara, crie e pergunte depois:
   - "Pronto, ${userName}! *Marcar dentista* tá anotado. Sabe a data? Posso agendar pra você."

⭐⭐⭐ ROTA DE FUGA (FALLBACK) ⭐⭐⭐
12. CONFUSÃO DETECTADA: Esta rota SÓ se aplica quando a mensagem for GENUINAMENTE incompreensível (caractere solto, texto aleatório, áudio completamente ininteligível). NUNCA aplique pra mensagens em português claro — mesmo que não peçam uma tarefa.
   Se aplicável: "${userName}, acho que não tô conseguindo entender direito. Pode tentar me explicar de outro jeito? Se preferir, pode acessar o painel web pra fazer direto por lá."
13. NUNCA fique preso em loop de "não entendi" repetido. Se já pediu repetição uma vez e a segunda tentativa continuar confusa, use a rota de fuga acima.
14. NÃO mande mensagens genéricas sem necessidade. Se recebeu algo estranho (tipo um caractere solto ou algo sem sentido), responda com leveza: "${userName}, acho que essa escapou! Me conta o que precisa e eu resolvo."

⭐⭐⭐ COMPARTILHAMENTO DE CONTEXTO PESSOAL ⭐⭐⭐
REGRA CRÍTICA: Quando alguém compartilha contexto de vida ("estou estudando pra prova", "tô trabalhando em X", "comecei a malhar", "passei no concurso") — isso NÃO é um pedido de ação. É conversa. REAJA NATURALMENTE como um amigo faria:
- "Massa! Que concurso é esse?" / "Eita, pra quando é a prova?"
- Salve como memória nos bastidores (MemorySave) SEM mencionar que salvou.
- NUNCA responda com "Pode repetir?" ou "Não entendi" pra mensagens assim — é português claro.
PROIBIDO em qualquer mensagem de português compreensível: "Pode repetir?", "Não entendi direito", "Pode elaborar?", "Pode explicar melhor?"

⭐⭐⭐ MEMÓRIA DE CONTEXTO (CURTO PRAZO) ⭐⭐⭐
15. REFERÊNCIAS: Entenda "Muda para as 16h", "Coloca como urgente", "Apaga ela", "Tá feito" com base na última tarefa conversada no histórico.
16. PRONOMES: Entenda "ela", "esse", "aquela" pelo contexto.
17. FLUXO: Se você perguntou "Para quando?" e o usuário diz "sexta", atualize a tarefa pendente.
18. REFERÊNCIA POR NÚMERO DE LISTA: Quando o usuário disser "número X", "a número X", "é a X", "o primeiro", "a segunda", "o 3", etc., referindo-se a uma posição em uma lista de tarefas exibida anteriormente:
   a. Procure na mensagem mais recente do assistente no histórico um bloco [ÍNDICE:...] — se encontrar, extraia o UUID da posição X (formato X="<uuid>") e use-o diretamente como task_id
   b. Se houver resultado de ferramenta TaskList ou TaskSearch no histórico com tasks_raw, use tasks_raw[X-1].id diretamente como task_id
   c. Último recurso: leia o título da tarefa na posição X na lista formatada do histórico e use TaskSearch com esse título exato
   CRÍTICO: NUNCA passe "número 2", "é a 2", "a segunda", "número X" etc. como query para TaskSearch — sempre resolva para o ID ou título real da tarefa.

⭐⭐⭐ REGRAS DE SUBTAREFAS ⭐⭐⭐
18. SUBTAREFAS PROATIVAS: Para QUALQUER tarefa — incluindo as que têm timer — tente incluir pelo menos 2 a 3 subtarefas que ajudem o usuário a começar. Não espere ele pedir. Timer e subtarefas NÃO são excludentes: use ambos quando couber.
19. SUBTAREFAS PRÁTICAS: Gere passos curtos e acionáveis (ex: "Separar material", "Revisar rascunho").
20. SUGESTÃO: Se a tarefa for muito complexa, crie as subtarefas iniciais e pergunte: "${userName}, dividi em algumas etapas pra você, quer que eu adicione mais alguma?"
21. GESTÃO: Você também pode usar TaskUpdate para adicionar subtarefas a uma tarefa que já existe. REGRA CRÍTICA: ao usar TaskUpdate com o campo "subtasks", você DEVE enviar a lista COMPLETA (existentes + novas). As subtarefas atuais de cada tarefa estão listadas no PAINEL DO USUÁRIO acima. Nunca envie apenas a subtarefa nova — isso apagaria as anteriores.

⭐⭐⭐ ETAPAS SEQUENCIAIS ⭐ UMA TAREFA COM SUBTAREFAS ⭐⭐⭐
22. REGRA PRINCIPAL: Quando o usuário descreve uma SEQUÊNCIA de etapas relacionadas dentro da mesma atividade ou contexto, crie UMA única tarefa com subtarefas — NÃO múltiplas tarefas separadas.
   SEQUENCIAL (1 tarefa + subtarefas):
   - "preciso levar o carro na oficina, depois lavar, depois resolver o sistema"
   - "primeiro vou ao mercado, depois passo no banco, depois em casa"
   - etapas do mesmo projeto, do mesmo evento, do mesmo dia vinculado
   SEPARADAS (múltiplas tarefas):
   - assuntos completamente distintos sem ligação temporal ("criar relatório" + "ligar pro médico" + "pagar conta")
   - tarefas de projetos ou pessoas diferentes
23. SUBTAREFA COM TIMER: quando cada etapa tem um tempo próprio ("daqui 30 min", "daqui 4 horas"), passe timer_minutes em cada subtarefa. O timer_minutes é a partir de AGORA, não cumulativo.
   Exemplo: "levar carro daqui 30min, lavar daqui 4h, resolver sistema urgente"
   ➔ TaskCreate título: "Pendências do carro e sistema"
     subtasks: [
       { title: "Levar carro na oficina", timer_minutes: 30 },
       { title: "Lavar carro", timer_minutes: 240 },
       { title: "Resolver sistema Controlar Mais" }
      ]
   O timer_minutes da tarefa principal (timer_minutes no nível da tarefa) deve ser o do primeiro passo.

═══ REGRAS DE RESPOSTA ═══
22. CONFIRMAÇÃO HUMANA: Após ações, gere confirmações 100% ORIGINAIS e NATURAIS, como um amigo avisando pelo WhatsApp:
   - VARIE o formato: às vezes curto ("Beleza, anotei!"), às vezes com detalhe ("Coloquei pra hoje com lembrete de 10 min")
   - Mencione detalhes relevantes da tarefa (prazo, timer, prioridade) de forma conversacional
   - NUNCA repita o mesmo modelo de frase — cada confirmação deve soar diferente
   - Exemplos de variação:
     * "Beleza, ${userName}! Coloquei pra você ligar pro fornecedor até sexta."
     * "Anotado! Vou te cutucar em 10 minutinhos pra não esquecer."
     * "Feito! Tarefa do relatório tá lá, prioridade alta pra amanhã."
     * "${userName}, registrei aí. Qualquer coisa ajusto."
23. DATAS: NUNCA escreva YYYY-MM-DD. Use: "hoje", "amanhã", "segunda-feira", "dia 5 de abril".
24. PROIBIDO: JSON, IDs, UUIDs, techniquês de sistema. O usuário é uma pessoa comum.
25. CONTEXTO: Use o snapshot acima para sugestões amigáveis. Ex: "${userName}, vi que *[tarefa]* tá atrasada, quer que eu mude a data?"

26. RESUMO OBRIGATÓRIO: Sempre que criar uma tarefa (TaskCreate ou TaskBatchCreate), você DEVE preencher o campo 'description' com um resumo do que deve ser feito, detalhando um pouco o que o usuário pediu. NUNCA deixe vazio.

═══ MEMORIA DE LONGO PRAZO & SEGUNDO CEREBRO ═══🔔🔔🔔
27. QUANDO SALVAR MEMORIAS (MemorySave): Salve AUTOMATICAMENTE quando o usuário compartilhar:
   - Fatos pessoais: "trabalho na empresa X", "meu aniversário é dia 5", "estou fazendo faculdade de..."
   - Preferências: "gosto de trabalhar de manhã", "prefiro tarefas curtas"
   - Contexto de vida: "estou em período de provas", "vou viajar semana que vem"
   - Eventos importantes: "fui promovido", "mudei de emprego", "comecei a malhar"
   - Informações sobre pessoas: "João é meu chefe", "Maria cuida do backend"
   SALVAR MEMORIA E INVISIVEL: NUNCA diga "anotei essa informação", "guardei isso", "vou lembrar disso". Apenas REAJA NATURALMENTE ao que a pessoa disse como um amigo faria. A memória é salva nos bastidores sem o usuário saber.
   Ex: Usuário diz "sou dev na Acme" ⭐ Responde "Massa! Dev também é foda. No que posso te dar uma força?" (e NÃO "Anotei que você trabalha na Acme!")

28. QUANDO SALVAR NO SEGUNDO CEREBRO (KnowledgeSave): Use quando o usuário disser:
   - "anota isso" / "guarda essa info" / "salva isso pra mim" ⭐ note
   - "tive uma ideia" / "ideia:" / "pensei em" ⭐ idea
   - "a senha é" / "o link é" / "o endereço é" / "o telefone do X é" ⭐ reference
   - "decidimos que" / "ficou decidido" / "a decisão foi" ⭐ decision
   - Informações sobre uma pessoa/contato específico ⭐ contact
   - "toda sexta eu faço" / "o processo é" / "o fluxo é" ⭐ routine
   DIFERENÇA ENTRE TAREFA E CONHECIMENTO:
   - TAREFA = algo que o usuário PRECISA FAZER (ação futura) ⭐ TaskCreate
   - CONHECIMENTO = algo que o usuário quer GUARDAR/LEMBRAR (informação) ⭐ KnowledgeSave
   - Se ambíguo (ex: "reunião com João: decidimos X e preciso fazer Y"):
     ⭐ KnowledgeSave para a decisão + TaskCreate para a ação

29. QUANDO BUSCAR (MemoryRecall / KnowledgeSearch): Use quando o usuário perguntar:
   - "você lembra...", "o que eu te falei sobre...", "quando foi que..."
   - "o que eu anotei sobre...", "tenho alguma nota sobre..."
   - "quais são minhas ideias?", "o que eu sei sobre o João?"
   - "qual era a senha do...", "qual o telefone do..."
   Busque e responda como se VOCE lembrasse naturalmente.

30. CAPTURA PROATIVA: Quando o usuário mencionar informações importantes DURANTE uma conversa sobre tarefas, salve como memória SEM INTERROMPER o fluxo. Ex: se ele diz "preciso ligar pro João, ele é meu gerente novo", crie a tarefa E salve a memória sobre João em paralelo.

⭐⭐⭐ TIMER / LEMBRETE RÁPIDO ⭐⭐⭐
- Se o usuário mencionar expressão de tempo curto junto com uma tarefa, use o campo timer_minutes no TaskCreate ou TaskBatchCreate.
- Converta QUALQUER variação de:
  "em 10 minutos" / "daqui 10 minutos" / "daqui 10 min"    ⭐ timer_minutes: 10
  "daqui uns 3 minutinho" / "uns 3 minutinhos"              ⭐ timer_minutes: 3  ⭐ use o número EXATO, não arredonde
  "daqui uns 5 minutinhos" / "em uns 5 minutos"             ⭐ timer_minutes: 5
  "em meia hora" / "daqui meia hora"                        ⭐ timer_minutes: 30
  "em 45 minutos" / "daqui 45 minutos"                      ⭐ timer_minutes: 45
  "em 1 hora" / "daqui 1 hora" / "daqui uma hora"           ⭐ timer_minutes: 60
  "em 1 hora e meia" / "daqui uma hora e meia"              ⭐ timer_minutes: 90
  "em 1 hora e 30 minutos" / "daqui 1h30"                   ⭐ timer_minutes: 90
  "em 2 horas" / "daqui 2 horas" / "daqui duas horas"       ⭐ timer_minutes: 120
  "daqui 2 horas e meia"                                    ⭐ timer_minutes: 150
  "daqui 3 horas"                                           ⭐ timer_minutes: 180
- O sistema enviará uma notificação no WhatsApp quando o timer expirar.
- Ao confirmar a criação, mencione o timer: "Anotado! Vou te avisar em 10 minutos." ou "Vou te lembrar em 1 hora e meia."
- NÃO use timer_minutes para prazos de dias/semanas — apenas para alertas em minutos/horas curtos (até 24h).
- Para HORÁRIOS ABSOLUTOS ("às 16h", "as 14h30", "9h da manhã"):
  NÃO tente calcular a diferença de minutos — o sistema já calcula automaticamente.
  Basta usar timer_minutes com qualquer valor positivo (ex: 1) — o sistema vai sobrescrever com o valor correto.
- TEMPO VAGO: Se o usuário mencionar tempo vago como "mais tarde", "depois", "em breve", "quando der", "quando puder", "uma hora dessas", "num momento", NÃO invente um horário ou timer_minutes. Crie a tarefa SEM timer_minutes e pergunte depois:
  "${userName}, anotei! *[tarefa]* ficou registrado. Quer que eu te avise num horário específico?"
  NUNCA adivinhe minutos quando o horário não for explícito.

⭐⭐⭐ LEMBRETE DE ANTECEDÊNCIA (DIAS) ⭐⭐⭐
- Use reminder_days_before quando o usuário pedir lembrete com dias de antecedência:
  "me lembra 3 dias antes" / "avisa com 2 dias de antecedência" / "lembrete 1 semana antes"
- Requer que due_date esteja preenchido na tarefa.
- Ao confirmar: "Anotado! Vou te avisar X dia(s) antes do prazo." (substitua X pelo número). NUNCA use emojis.
- TIMER + SUBTAREFAS: mesmo quando há timer, gere subtarefas normalmente. Os campos timer_minutes e subtasks são independentes e devem ser preenchidos juntos quando a tarefa tiver etapas.

⭐⭐⭐ REGRAS DE PRIORIDADE ⭐⭐⭐
- "importante", "urgente", "crítico" ⭐ high
- "de boa", "sem pressa", "quando der" ⭐ low
- Demais casos ⭐ medium

⭐⭐⭐ REGRAS DE DATAS ⭐⭐⭐
O ANO ATUAL é ${dates.currentYear}. NUNCA use anos passados.
- "hoje" ⭐ ${dates.todayISO}
- "amanhã" ⭐ ${dates.tomorrowISO}
- "depois de amanhã" ⭐ ${dates.dayAfterTomorrowISO}
- "semana que vem" ⭐ ${dates.nextWeekISO}
- "mês que vem" ⭐ ${dates.nextMonthISO}
SEMPRE passe due_date como YYYY-MM-DD nas ferramentas.`;

  // ── Perfil comportamental (se disponível) ──────────────────────────────────
  let behavioralContext = '';
  try {
    behavioralContext = await getProfileContext(userId);
  } catch { /* silently skip if table doesn't exist yet */ }

  // ── Insights proativos pendentes ──────────────────────────────────────────
  let insightsContext = '';
  try {
    const insights = await getPendingInsights(userId, 2);
    if (insights.length > 0) {
      insightsContext = `\n⭐⭐⭐ INSIGHTS PROATIVOS (USE COM NATURALIDADE) ⭐⭐⭐
Voce detectou os seguintes padroes sobre ${userName}. Mencione NO MAXIMO 1 por resposta, e SOMENTE quando for relevante ao contexto da conversa (nao force):
${insights.map(i => `- [${i.insight_type}]: ${i.content}`).join('\n')}

REGRAS DE USO:
- NAO mencione todos de uma vez — escolha o mais relevante ao momento.
- Integre de forma NATURAL ("Ei, percebi que...", "A proposito...").
- Se o usuario estiver focado em outra coisa, IGNORE os insights nessa resposta.
- Se usar um insight, seja gentil e ofereça ajuda concreta.`;

      // Marca como entregues (serão vistos pela IA nessa resposta)
      for (const ins of insights) {
        markInsightDelivered(ins.id).catch(() => { });
      }
    }
  } catch { /* silently skip */ }

  // ── Monta prompt completo (sem memory context — injetado por mensagem) ─────
  let fullPrompt = prompt;
  if (behavioralContext) fullPrompt += `\n\n${behavioralContext}`;
  if (insightsContext) fullPrompt += insightsContext;

  contextCache.set(userId, { prompt: fullPrompt, ts: Date.now() });
  return fullPrompt;
}

// ── Detecção de intenção de criação ─────────────────────────────────────────

const CREATION_TRIGGERS = [
  /\bme\s+lembr/i,           // me lembra, me lembrar
  /\bme\s+avis/i,            // me avisa
  /\bnão\s+deixa\s+(eu\s+)?esquecer/i,
  /\banota\s+(aí|isso|pra mim)\b/i,   // "anota aí", "anota isso" (precisa do complemento)
  /\bregistra\b/i,            // "registra" (verbo imperativo, não "registrar" em contexto genérico)
  /\bpreciso\s+(fazer|de|comprar|ligar|ir|criar|mandar|enviar|resolver|terminar|come[cç]ar|preparar|ver|falar|conversar|gravar|verificar|estudar|analisar|checar|testar|rever|apresentar)/i,
  /\btenho\s+que/i,
  /\btenho\s+uma\s+tarefa/i,
  /\bcri(a|ar|ei)\s+(uma\s+)?tarefa/i,
  /\badiciona(r)?\s+(uma\s+)?tarefa/i,  // "adiciona tarefa" (precisa de "tarefa" junto)
  /\blembr(ar|e)\s+(de|que)/i,
  /\bsalva\s+(isso|a[íi])\b/i,  // Só "salva isso" ou "salva aí" (não "salvar" genérico)
  /\bnão\s+(me\s+)?esquecer/i,
  /\b(quero|queria|gostaria\s+de)\s+(uma\s+)?tarefa\b/i,   // "queria uma tarefa pro Fernando"
  /\btarefa\s+(pro|pra|para)\s+/i,                          // "tarefa pro Fernando", "tarefa pra equipe"
];

// Padrões que indicam conversa casual / NÃO é pedido de criação de tarefa
const CONVERSATIONAL_PATTERNS = [
  /\b(você|voce|vc)\s+(sabe|pode|consegue|é|eh)\b/i,  // "você sabe...", "você pode..."
  /\b(fala|oi|eai|e\s+a[íi]|opa|salve|bom\s+dia|boa\s+tarde|boa\s+noite)\b/i,  // saudações
  /\b(como\s+vai|tudo\s+(bem|certo|joia|tranquilo))\b/i,
  /\b(acabei\s+de|eu\s+fiz|eu\s+subi|fiz\s+uma)\b/i,  // relatando algo que JÁ fez
  /\b(o\s+que\s+(você|vc)\s+(acha|pensa))\b/i,
  /\b(estou\s+(falando|dizendo|contando|explicando))\b/i,
  /\b(não\s+estou\s+falando|não\s+estou\s+pedindo)\b/i,
  /\b(corrige|corrija)\b/i,  // pedindo correção, não tarefa
  // Compartilhamento de contexto pessoal (ex: "estou estudando pra prova", "tô trabalhando em X")
  /\b(estou|to|tô|t[aá])\s+(estudando|trabalhando|fazendo|preparando|lendo|treinando|praticando|aprendendo|cursando)\b/i,
  // "Beleza?" / "Beleza!" como saudação/check-in no final da mensagem
  /\bbeleza\s*[?!]?\s*$/i,
];

function isConversationalMessage(message) {
  // Mensagens longas (>200 chars) com tom de conversa são provavelmente papo, não comando
  const isLong = message.length > 200;
  const matchesConversational = CONVERSATIONAL_PATTERNS.some(re => re.test(message));

  // Se tem múltiplos "preciso" (≥2), é lista de tarefas mesmo com saudação
  const lower = message.toLowerCase();
  const hasMultiplePreciso = (lower.match(/\bpreciso\b/g) || []).length >= 2;
  if (hasMultiplePreciso) return false;

  // Se tem ação clara de tarefa junto com saudação, não é conversa pura
  const hasTaskAction = CREATION_TRIGGERS.some(re => re.test(message));
  if (matchesConversational && hasTaskAction) return false;

  if (matchesConversational) return true;
  // Mensagem muito longa sem verbos imperativos claros = provavelmente conversa
  if (isLong && !/(^|\.\s*)(cria|anota|registra|salva|adiciona|me\s+lembra)\b/i.test(message)) return true;
  return false;
}

// Padrões fortes de criação que SEMPRE vencem a detecção conversacional,
// mesmo com "Bom dia" ou "tudo bem?" no mesmo texto
const STRONG_CREATION_OVERRIDES = [
  /\bcri(a|ou|ar|ei)\s+(uma[s]?\s+)?tarefa[s]?/i,  // "cria uma tarefa", "criou umas tarefas"
  /\badiciona(r)?\s+(uma\s+)?tarefa/i,           // "adiciona tarefa"
  /\b(quero|queria|gostaria\s+de)\s+(uma\s+)?tarefa\b/i,  // "queria uma tarefa pro Fernando"
  /\btarefa\s+(pro|pra|para)\s+/i,                // "tarefa pro Fernando"
  /\bme\s+lembr/i,                                // "me lembra de..."
  /\bme\s+avis/i,                                 // "me avisa..."
  /\bdeixa\s+(marcad[ao]|anotat[ao]|registrad[ao])\b/i,  // "deixa marcado", "deixa anotado"
  /\bpreciso\s+(ver|falar|conversar|gravar|verificar|estudar|analisar|checar|testar|rever|apresentar)\b/i,
];

function isCreationIntent(message) {
  // Comandos explícitos sempre têm prioridade sobre saudações/conversa
  if (STRONG_CREATION_OVERRIDES.some(re => re.test(message))) return true;
  // Se é claramente conversa casual SEM comando de criação, NÃO é intenção de criação
  if (isConversationalMessage(message)) return false;
  return CREATION_TRIGGERS.some(re => re.test(message));
}

// Detecta se a mensagem descreve múltiplas tarefas distintas (ex: planejamento semanal)
export function hasMultipleTasks(message) {
  const lower = message.toLowerCase();
  // Múltiplos dias da semana mencionados ⭐ claramente múltiplas tarefas
  const weekdays = ['segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado', 'domingo'];
  if (weekdays.filter(d => lower.includes(d)).length >= 2) return true;
  // Múltiplos "também" indicam lista de itens distintos
  if ((lower.match(/\btambém\b/g) || []).length >= 2) return true;
  // Múltiplos "preciso" indicam múltiplas tarefas distintas
  if ((lower.match(/\bpreciso\b/g) || []).length >= 2) return true;
  // Número explícito de coisas/tarefas: "três coisas", "2 tarefas", "quatro pontos"
  if (/\b(duas?|tr[eê]s|quatro|cinco|[2-9])\s+(coisas?|tarefas?|itens?|pontos?|assuntos?|t[oó]picos?)\b/.test(lower)) return true;
  // Sequência com "primeiro" + outro marcador
  if (/\bprimeiro\b/.test(lower) && /\bsegundo\b|\bterceiro\b|\bdepois\b|\btambém\b|\balém\b/.test(lower)) return true;
  // Enumeração numerada: "1. ... 2. ..."
  if (/\d+\.\s+\w/.test(lower) && /\d+\.\s+\w.+\d+\.\s+\w/s.test(lower)) return true;
  return false;
}

function normalizeTextForIntent(message) {
  return String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractBirthdayFact(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const lower = normalizeTextForIntent(text);
  if (!/\b(aniversario|nascimento|nasci|nascer)\b/.test(lower)) return null;

  const datePatterns = [
    /\banivers[aá]rio\s*[:\-]\s*([0-3]?\d\s+de\s+[a-zçãéêíóôú]+(?:\s+de\s+\d{4})?)/i,
    /\banivers[aá]rio\s*[:\-]\s*([0-3]?\d[/-][01]?\d(?:[/-]\d{2,4})?)/i,
    /\b(?:meu\s+)?anivers[aá]rio\s+(?:[ée]|eh|e|fica|cai)?\s*(?:no\s+dia\s+|dia\s+)?([0-3]?\d\s+de\s+[a-zçãéêíóôú]+(?:\s+de\s+\d{4})?)/i,
    /\b(?:eu\s+)?nasci\s+(?:no\s+dia\s+|dia\s+|em\s+)?([0-3]?\d\s+de\s+[a-zçãéêíóôú]+(?:\s+de\s+\d{4})?)/i,
    /\b(?:meu\s+)?anivers[aá]rio\s+(?:[ée]|eh|e|fica|cai)?\s*(?:em\s+)?([0-3]?\d[/-][01]?\d(?:[/-]\d{2,4})?)/i,
    /\b(?:eu\s+)?nasci\s+(?:em\s+)?([0-3]?\d[/-][01]?\d(?:[/-]\d{2,4})?)/i,
    /\b([0-3]?\d\s+de\s+[a-zçãéêíóôú]+(?:\s+de\s+\d{4})?)\b/i,
    /\b([0-3]?\d[/-][01]?\d(?:[/-]\d{2,4})?)\b/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[.!?]+$/, '').trim();
    }
  }

  return null;
}

function isBirthdayRecallIntent(message) {
  const lower = normalizeTextForIntent(message);
  const asksPersonalDate = /\b(qual|quando|lembra|lembrar|data)\b/.test(lower);
  const birthdayTopic = /\b(aniversario|nascimento|nasci|nascer)\b/.test(lower);
  return asksPersonalDate && birthdayTopic;
}

function findBirthdayInText(text) {
  return extractBirthdayFact(text);
}

function findBirthdayInMemories(memories = []) {
  for (const memory of memories) {
    const found = findBirthdayInText(`${memory.summary || ''}\n${memory.content || ''}`);
    if (found) return found;
  }
  return null;
}

async function recallBirthdayFromLegacyCommitments(userId) {
  try {
    const { data, error } = await supabase
      .from('daily_commitments')
      .select('committed_tasks')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(30);

    if (error) return null;

    for (const row of data || []) {
      for (const item of row.committed_tasks || []) {
        const found = findBirthdayInText(item);
        if (found) return found;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function saveBirthdayMemory(userId, userName, birthdayLabel, sourceMessage) {
  await saveMemory(userId, {
    memoryType: 'semantic',
    content: `O aniversario de ${userName || 'usuario'} e ${birthdayLabel}.`,
    summary: `Aniversario: ${birthdayLabel}`,
    entities: [{
      name: userName || 'usuario',
      type: 'person',
      description: `Aniversario em ${birthdayLabel}`,
    }],
    tags: ['aniversario', 'nascimento', 'data_pessoal'],
    importance: 0.95,
    sourceMessage,
  });
}

function getTaskStatusFilterFromText(lower) {
  if (/\b(cancelad[ao]s?|cancelamentos?)\b/.test(lower)) return 'canceled';
  if (/\b(concluid[ao]s?|finalizad[ao]s?|terminad[ao]s?|feitas?)\b/.test(lower)) return 'done';
  if (/\b(em\s+progresso|andamento|fazendo)\b/.test(lower)) return 'doing';
  if (/\b(a\s+fazer|todo)\b/.test(lower)) return 'todo';
  if (/\b(pendencias?|pendentes)\b/.test(lower)) return undefined;
  if (/\b(todas?|geral|completas?|all)\b/.test(lower)) return 'all';
  return undefined;
}

function getSimpleTaskListRequest(message) {
  const lower = normalizeTextForIntent(message);
  if (hasTaskCompletionIntent(message)) return null;
  // Removemos "tarefas?" e "pendentes?" do hasQuestion porque causava falsos positivos muito fáceis.
  // Focamos em verbos e pronomes interrogativos claros ou "o que tenho".
  const hasQuestion = /\b(quais?|qual|listar?|lista|mostra|mostrar|ver|cad[êê]|cade|o\s+que\s+tenho)\b/.test(lower);
  const asksTasks = /\b(tarefas?|pendencias?|pendentes|afazeres?|cancelad[ao]s?|concluid[ao]s?|finalizad[ao]s?|em\s+progresso|coisas?\s+pra\s+fazer|tenho\s+pra\s+fazer|tenho\s+para\s+fazer)\b/.test(lower);

  // "?" só conta se estiver PERTO da menção de tarefas (ex: "quais tarefas?")
  // NÃO conta "tudo bem?" seguido de "queria uma tarefa" ⭐ o "?" é da saudação
  const hasQuestionMark = /tarefa[s]?\s*\?|pendente[s]?\s*\?|\?\s*$/.test(lower);

  // Intenção de criação SEMPRE tem prioridade sobre listagem
  if (isCreationIntent(message)) return null;
  if (!((hasQuestion && asksTasks) || (hasQuestionMark && asksTasks))) return null;

  return {
    due_date: /\b(hoje|pra\s+hoje|para\s+hoje)\b/.test(lower) ? getTodayISO() : undefined,
    status: getTaskStatusFilterFromText(lower),
  };
}

function getTaskListScope(filter = {}, count = 2) {
  const one = count === 1;
  let scope;

  switch (filter.status) {
    case 'canceled':
      scope = one ? 'cancelada' : 'canceladas';
      break;
    case 'done':
      scope = one ? 'conclu\u00edda' : 'conclu\u00eddas';
      break;
    case 'doing':
      scope = 'em progresso';
      break;
    case 'todo':
      scope = 'a fazer';
      break;
    case 'all':
      scope = 'no total';
      break;
    default:
      scope = one ? 'pendente' : 'pendentes';
  }

  if (filter.due_date) {
    const dateScope = filter.due_date === getTodayISO() ? 'pra hoje' : `para ${filter.due_date}`;
    if (filter.status === 'all') return dateScope;
    return `${scope} ${dateScope}`;
  }

  return scope;
}

function pickTaskListIntro(userMessage, userName, count, scope) {
  const taskWord = count === 1 ? 'tarefa' : 'tarefas';
  const demonstrative = count === 1 ? 'essa \u00e9 a tarefa' : 'essas s\u00e3o as tarefas';
  const variants = [
    `${userName}, encontrei ${count} ${taskWord} ${scope}:`,
    `Olhei aqui: ${count} ${taskWord} ${scope}:`,
    `Achei ${count} ${taskWord} ${scope} por aqui:`,
    `Aqui vai o que encontrei - ${count} ${taskWord} ${scope}:`,
    `${userName}, ${demonstrative} ${scope}:`,
  ];
  const seed = Array.from(`${userMessage}|${Date.now()}`).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

function buildSimpleTaskListResponse(userMessage, userName, result, filter = {}) {
  const greeting = /\bbom\s+dia\b/i.test(userMessage)
    ? 'Bom dia'
    : /\bboa\s+tarde\b/i.test(userMessage)
      ? 'Boa tarde'
      : /\bboa\s+noite\b/i.test(userMessage)
        ? 'Boa noite'
        : null;
  const greetingPrefix = greeting ? `${greeting}, ${userName}. ` : '';

  if (!result?.success) {
    return `${greetingPrefix}${userName}, n\u00e3o consegui buscar suas tarefas agora. Tenta de novo em alguns instantes.`;
  }

  const scope = getTaskListScope(filter, result.count || 0);

  if (!result.count) {
    if (filter.status === 'all') {
      return `${greetingPrefix}${userName}, n\u00e3o encontrei tarefas cadastradas por aqui.`;
    }
    return `${greetingPrefix}${userName}, n\u00e3o encontrei tarefas ${scope} no momento.`;
  }

  return `${greetingPrefix}${pickTaskListIntro(userMessage, userName, result.count, scope)}\n${result.formatted_list}`;
}

const TASK_COMPLETION_PATTERNS = [
  /\b(j[aá]\s+)?conclu[ií]\b/i,
  /\bterminei\b/i,
  /\bfinalizei\b/i,
  /\bt[aá]\s+feito\b/i,
  /\bmarc[ae]?\s+(como\s+)?conclu[ií]d[ao]\b/i,
  /\bmover?\s+(para|pra)\s+conclu[ií]d[ao]\b/i,
  /\bpassa?r?\s+(para|pra)\s+conclu[ií]d[ao]\b/i,
];

function hasTaskCompletionIntent(message) {
  return TASK_COMPLETION_PATTERNS.some(re => re.test(message));
}

function asksForNextTasks(message) {
  const lower = normalizeTextForIntent(message);
  return /\b(em\s+seguida|depois|agora|o\s+que\s+(precisa|falta|tem)|que\s+mais|proxim[ao]s?|mais\s+alguma)\b/.test(lower);
}

function hasVagueTaskReference(message) {
  const lower = normalizeTextForIntent(message);
  return /\b(essa|esta|esse|este|ela|ele|aquela|aquele|isso|essa\s+tarefa|esta\s+tarefa)\b/.test(lower);
}

function extractTaskNumberReference(message) {
  const lower = normalizeTextForIntent(message);
  const numeric = lower.match(/\b(?:numero|n|a|o)?\s*(\d{1,2})\b/);
  if (numeric) return Number(numeric[1]);

  const ordinals = [
    ['primeira', 1], ['primeiro', 1],
    ['segunda', 2], ['segundo', 2],
    ['terceira', 3], ['terceiro', 3],
    ['quarta', 4], ['quarto', 4],
    ['quinta', 5], ['quinto', 5],
  ];
  const found = ordinals.find(([word]) => lower.includes(word));
  return found?.[1] || null;
}

function parseTaskIndexBlock(content) {
  const text = String(content || '');
  const match = text.match(/\[(?:ÍNDICE|INDICE):([^\]]+)\]/i);
  if (!match) return {};

  const entries = {};
  for (const item of match[1].split('|')) {
    const entry = item.match(/(\d+)="([^"]+)"/);
    if (entry) entries[Number(entry[1])] = entry[2];
  }
  return entries;
}

function extractTaskTitlesFromAssistantContent(content) {
  const text = String(content || '').replace(/\[(?:ÍNDICE|INDICE):[^\]]+\]/gi, '');
  const titles = [];

  for (const line of text.split('\n')) {
    const numbered = line.match(/^\s*\d+\.\s+\*?([^*(\n]+?)\*?\s*(?:\(|$)/);
    if (numbered?.[1]) {
      titles.push(numbered[1].trim());
      continue;
    }

    const emphasized = line.match(/\*([^*]{3,120})\*/);
    if (emphasized?.[1] && !/pendente|conclu[ií]d|atrasad/i.test(emphasized[1])) {
      titles.push(emphasized[1].trim());
    }
  }

  return [...new Set(titles)].filter(Boolean);
}

async function resolveCompletionTargetFromHistory(userMessage, history) {
  const requestedNumber = extractTaskNumberReference(userMessage);
  const vague = hasVagueTaskReference(userMessage);
  const assistantMessages = [...history].reverse().filter(m => m.role === 'assistant');

  for (const message of assistantMessages.slice(0, 8)) {
    const indexMap = parseTaskIndexBlock(message.content);
    if (requestedNumber && indexMap[requestedNumber]) {
      return { taskId: indexMap[requestedNumber] };
    }

    const indexIds = Object.values(indexMap);
    if (vague && indexIds.length === 1) {
      return { taskId: indexIds[0] };
    }
    if (vague && indexIds.length > 1) {
      return { ambiguous: true };
    }

    const titles = extractTaskTitlesFromAssistantContent(message.content);
    if (vague && titles.length === 1) {
      return { taskTitle: titles[0] };
    }
    if (vague && titles.length > 1) {
      return { ambiguous: true };
    }
  }

  return { ambiguous: true };
}

function buildTaskIndexBlock(tasksRaw) {
  return tasksRaw?.length
    ? `\n[ÍNDICE:${tasksRaw.map((t, i) => `${i + 1}="${t.id}"`).join('|')}]`
    : '';
}

function buildCompletionAndNextResponse(userName, updateResult, listResult, wantsNext) {
  if (!updateResult?.success) {
    return `${userName}, nao consegui identificar qual tarefa voce concluiu. Me manda o nome dela ou o numero da lista.`;
  }

  const doneLine = `Feito, ${userName}! *${updateResult.task_title}* ficou marcada como concluida.`;
  if (!wantsNext) return `${doneLine} Mandou bem.`;

  if (!listResult?.success || !listResult.count) {
    return `${doneLine}\n\nNo momento nao encontrei mais tarefas pendentes.`;
  }

  return `${doneLine}\n\nAgora ainda falta:\n${listResult.formatted_list}`;
}

const TASK_GLUE_WORDS = new Set([
  'pra', 'para', 'de', 'da', 'do', 'das', 'dos', 'que', 'em',
  'daqui', 'aqui', 'uns', 'umas', 'um', 'uma',
]);

function cleanupTaskTitle(text) {
  const words = String(text || '')
    .replace(/\b(n[aã]o|não)\b/gi, ' ')
    .replace(/[.?!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word && !TASK_GLUE_WORDS.has(normalizeTextForIntent(word)))
    .slice(0, 7);

  const title = words.join(' ').trim();
  if (title.length < 3) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function timerPhraseRegex() {
  const num = '(?:\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[eê]s|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
  const prefix = '(?:\\b(?:daqui(?:\\s+a)?|de\\s+aqui(?:\\s+a)?|em)\\s+(?:uns?|umas?)?\\s*)?';
  const hourWord = `(?:meia\\s+hora|${num}\\s+hora[s]?(?:\\s+e\\s+meia|\\s+e\\s+${num}\\s+min(?:utinho[s]?|uto[s]?)?)?)`;
  const compactHour = '(?:\\d+h\\d+(?:min(?:uto[s]?)?)?|\\d+h\\b)';
  const minuteWord = `(?:${num}\\s+min(?:utinho[s]?|uto[s]?)?)`;
  return new RegExp(`${prefix}(?:${compactHour}|${hourWord}|${minuteWord})`, 'gi');
}

function stripCreationPreamble(text) {
  return String(text || '')
    .replace(/^\s*(cria(?:r(?:am)?)?(?:\s+uma?)?\s+tarefa|adiciona(?:r)?(?:\s+uma?)?\s+tarefa|me\s+lembr(?:a|ar|e)(?:\s+de|\s+que)?|me\s+avis(?:a|ar)(?:\s+de|\s+que)?|n[aã]o\s+deixa\s+(?:eu\s+)?esquecer(?:\s+de|\s+que)?|anota(?:\s+a[íi]|\s+isso|\s+pra\s+mim)?|registr(?:a|ar)|salva(?:\s+isso|\s+a[íi])?|tenho\s+que|preciso(?:\s+de)?)\s+/i, ' ');
}

function extractSimpleTaskTitle(message) {
  const text = String(message || '');
  const matches = [...text.matchAll(timerPhraseRegex())];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const suffix = cleanupTaskTitle(stripCreationPreamble(text.slice(last.index + last[0].length)));
    if (suffix) return suffix;
  }

  const withoutTimers = stripCreationPreamble(text)
    .replace(timerPhraseRegex(), ' ')
    .replace(/\bàs?\s*$/i, ' ')
    .replace(/\b(n[aã]o|não)\b[^.?!]*$/i, ' ');

  return cleanupTaskTitle(withoutTimers);
}

function getSimpleTaskCreateRequest(message, { resolvedDate, resolvedTimerMinutes, resolvedTimerAt, sourceChannel }) {
  // Desativado: todas as criações agora passam pelo LLM para gerar
  // títulos inteligentes e descrições úteis em vez de regex frágil.
  // O shortcircuit antigo gerava títulos ruins (ex: "Me lembra viu")
  // e descrições template ("Criado a partir da mensagem: ...").
  return null;
}

function buildMissingTaskTitleResponse(userName, timerMinutes) {
  const timer = timerMinutes
    ? ` Peguei o timer de ${timerMinutes} minuto${timerMinutes !== 1 ? 's' : ''},`
    : '';
  return `${userName},${timer} mas não entendi o nome da tarefa. Me manda só o que é pra lembrar.`;
}
// Extrai subtópicos da mensagem quando o modelo não gerou subtarefas
// Cobre padrões como "sobre X, sobre Y", "primeiro X, segundo Y", "X, Y e Z"
function extractSubtasksFromMessage(message) {
  const lower = message.toLowerCase();

  // Padrão 1: "primeiro... segundo... terceiro..."
  const ordered = [...lower.matchAll(/\b(primeiro|segundo|terceiro|quarto|quinto)\b[,:]?\s*([^,.;]+)/g)];
  if (ordered.length >= 2) {
    return ordered.map(m => capitalize(m[2].trim().replace(/\s+/g, ' ').substring(0, 60)));
  }

  // Padrão 2: múltiplos "sobre X" na mesma frase
  const sobreItems = [...lower.matchAll(/\bsobre\s+([^,;.]+)/g)];
  if (sobreItems.length >= 2) {
    return sobreItems.map(m => capitalize(m[1].trim().replace(/\s+/g, ' ').substring(0, 60)));
  }

  // Padrão 3: lista com vírgulas e "e" no final ⭐ "X, Y, Z e W"
  // Só ativa se há pelo menos 3 itens e eles são curtos (não são frases longas)
  const listMatch = message.match(/\b([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,4}),\s*([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,4}),\s*([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,4})(?:\s+e\s+([A-Za-zÀ-ú]{3,}(?:\s+[A-Za-zÀ-ú]+){0,4}))?\b/);
  if (listMatch) {
    return [listMatch[1], listMatch[2], listMatch[3], listMatch[4]]
      .filter(Boolean)
      .map(s => capitalize(s.trim()));
  }

  return [];
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Resolução de datas relativas na mensagem do usuário ──────────────────────

const WEEKDAY_MAP = {
  'segunda': 1, 'segunda-feira': 1,
  'terça': 2, 'terça-feira': 2, 'terca': 2, 'terca-feira': 2,
  'quarta': 3, 'quarta-feira': 3,
  'quinta': 4, 'quinta-feira': 4,
  'sexta': 5, 'sexta-feira': 5,
  'sábado': 6, 'sabado': 6,
  'domingo': 0,
};

/**
 * Extrai a primeira data ISO detectada na mensagem.
 * Retorna string YYYY-MM-DD ou null se não houver referência de data.
 */
function extractDateFromMessage(message) {
  const todayISO = getTodayISO();
  const spNow = new Date(todayISO + 'T12:00:00-03:00');
  const fmt = (d) => d.toISOString().split('T')[0];
  const lower = message.toLowerCase();

  if (/\bdepois de amanhã\b|\bdepois de amanha\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 2); return fmt(d);
  }
  if (/\bamanhã\b|\bamanha\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 1); return fmt(d);
  }
  if (/\bhoje\b/.test(lower)) {
    return todayISO;
  }
  if (/\bsemana que vem\b|\bpróxima semana\b|\bproxima semana\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 7); return fmt(d);
  }
  if (/\bmês que vem\b|\bmes que vem\b|\bpróximo mês\b|\bproximo mes\b/.test(lower)) {
    const d = new Date(spNow.getFullYear(), spNow.getMonth() + 1, 1); return fmt(d);
  }

  // Dia da semana: "na sexta", "essa terça", "no sábado"
  for (const [name, wday] of Object.entries(WEEKDAY_MAP)) {
    const re = new RegExp(`\\b(n[ao]s?\\s+|ess[ae]\\s+)?${name}\\b`);
    if (re.test(lower)) {
      const d = new Date(spNow);
      const diff = (wday - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return fmt(d);
    }
  }

  // "dia X" ou "dia X de mês"
  const diaMatch = lower.match(/\bdia\s+(\d{1,2})(?:\s+de\s+(\w+))?\b/);
  if (diaMatch) {
    const day = parseInt(diaMatch[1], 10);
    const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    let month = spNow.getMonth();
    if (diaMatch[2]) {
      const idx = monthNames.findIndex(m => diaMatch[2].startsWith(m.substring(0, 3)));
      if (idx !== -1) month = idx;
    }
    const candidate = new Date(spNow.getFullYear(), month, day);
    if (candidate < spNow) candidate.setFullYear(spNow.getFullYear() + 1);
    return fmt(candidate);
  }

  return null;
}

// ── Extração de timer em minutos da mensagem ────────────────────────────────

const PT_NUM_WORDS = {
  'um': 1, 'uma': 1, 'dois': 2, 'duas': 2,
  'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
  'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9,
  'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13,
  'quatorze': 14, 'quinze': 15, 'dezesseis': 16,
  'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
  'vinte': 20, 'trinta': 30, 'quarenta': 40,
  'cinquenta': 50, 'sessenta': 60,
};

function parsePTNum(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (PT_NUM_WORDS[s] !== undefined) return PT_NUM_WORDS[s];
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseTimerCandidateMinutes(candidate) {
  const N = '(\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[eê]s|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
  const PREF = '(?:daqui(?:\\s+a)?|de\\s+aqui(?:\\s+a)?|em)\\s+(?:uns?|umas?)?\\s*';
  const raw = String(candidate || '').trim().toLowerCase();
  const lower = /^(daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\b/.test(raw) ? raw : `em ${raw}`;

  const compactFull = lower.match(/(?:daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(\d+)h(\d+)(?:min(?:uto[s]?)?)?\b/i);
  if (compactFull) return parseInt(compactFull[1]) * 60 + parseInt(compactFull[2]);

  const compactH = lower.match(/(?:daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(\d+)h\b/i);
  if (compactH) return parseInt(compactH[1]) * 60;

  const horasEMeia = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\s+e\\s+meia\\b', 'i'));
  if (horasEMeia) {
    const h = parsePTNum(horasEMeia[1]);
    if (h !== null) return Math.round(h * 60 + 30);
  }

  const horasEMin = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\s+e\\s+' + N + '\\s+min(?:utinho[s]?|uto[s]?)?\\b', 'i'));
  if (horasEMin) {
    const h = parsePTNum(horasEMin[1]);
    const m = parsePTNum(horasEMin[2]);
    if (h !== null && m !== null) return Math.round(h * 60 + m);
  }

  const meiaHora = lower.match(new RegExp(PREF + 'meia\\s+hora\\b', 'i'));
  if (meiaHora) return 30;

  const horas = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\b', 'i'));
  if (horas) {
    const h = parsePTNum(horas[1]);
    if (h !== null) return Math.round(h * 60);
  }

  const minutos = lower.match(new RegExp(PREF + N + '\\s+min(?:utinho[s]?|uto[s]?)?\\b', 'i'));
  if (minutos) {
    const m = parsePTNum(minutos[1]);
    if (m !== null) return Math.round(m);
  }

  return null;
}

// ── Detecção de tempo vago ("mais tarde", "depois", "em breve") ─────────────
const VAGUE_TIME_PATTERNS = [
  /\bmais\s+tarde\b/i,
  /\bem\s+breve\b/i,
  /\bquando\s+(?:der|puder|poss[íi]vel)\b/i,
  /\buma\s+hora\s+dessas\b/i,
  /\bnum\s+momento\b/i,
  /\balguma\s+hora\b/i,
];

function hasVagueTimeReference(message) {
  const lower = message.toLowerCase();
  // "depois de amanhã" é data concreta, não é vago
  if (/\bdepois\s+de\s+amanh[aã]\b/i.test(lower)) return false;
  return VAGUE_TIME_PATTERNS.some(re => re.test(lower));
}

/**
 * Extrai o número de minutos de timer a partir de expressões naturais em português.
 * Exemplos cobertos:
 *   "daqui 2 horas"            ⭐ 120
 *   "daqui meia hora"          ⭐ 30
 *   "em 30 minutos"            ⭐ 30
 *   "daqui uma hora e meia"    ⭐ 90
 *   "em 2 horas e 30 minutos"  ⭐ 150
 *   "daqui 1h30"               ⭐ 90
 *   "em 45 min"                ⭐ 45
 *   "daqui duas horas"         ⭐ 120
 * Retorna inteiro de minutos ou null se nenhuma expressão for encontrada.
 */
function extractTimerMinutesFromMessage(message) {
  const lower = message.toLowerCase();

  if (/\b(n[aã]o|não)\b/.test(lower)) {
    const correctedCandidates = [...lower.matchAll(timerPhraseRegex())]
      .map(match => ({
        index: match.index,
        minutes: parseTimerCandidateMinutes(match[0]),
      }))
      .filter(item => item.minutes !== null);

    if (correctedCandidates.length > 1) {
      return correctedCandidates[correctedCandidates.length - 1].minutes;
    }
  }
  const N = '(\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
  // "uns/umas" é opcional após o prefixo (ex: "daqui uns 3 minutinhos")
  const PREF = '(?:daqui(?:\\s+a)?|de\\s+aqui(?:\\s+a)?|em)\\s+(?:uns?|umas?)?\\s*';

  // 1. Formato compacto: "1h30", "2h", "1h30min"
  const compactFull = lower.match(/(?:daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(\d+)h(\d+)(?:min(?:uto[s]?)?)?\b/i);
  if (compactFull) return parseInt(compactFull[1]) * 60 + parseInt(compactFull[2]);

  const compactH = lower.match(/(?:daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(\d+)h\b/i);
  if (compactH) return parseInt(compactH[1]) * 60;

  // 2. "X hora(s) e meia"
  const horasEMeia = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\s+e\\s+meia\\b', 'i'));
  if (horasEMeia) {
    const h = parsePTNum(horasEMeia[1]);
    if (h !== null) return Math.round(h * 60 + 30);
  }

  // 3. "X hora(s) e Y minuto(s)"
  const horasEMin = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\s+e\\s+' + N + '\\s+min(?:utinho[s]?|uto[s]?)?\\b', 'i'));
  if (horasEMin) {
    const h = parsePTNum(horasEMin[1]);
    const m = parsePTNum(horasEMin[2]);
    if (h !== null && m !== null) return Math.round(h * 60 + m);
  }

  // 4. "meia hora"
  const meiaHora = lower.match(new RegExp(PREF + 'meia\\s+hora\\b', 'i'));
  if (meiaHora) return 30;

  // 5. "X hora(s)"
  const horas = lower.match(new RegExp(PREF + N + '\\s+hora[s]?\\b', 'i'));
  if (horas) {
    const h = parsePTNum(horas[1]);
    if (h !== null) return Math.round(h * 60);
  }

  // 6. "X minuto(s)/min"
  const minutos = lower.match(new RegExp(PREF + N + '\\s+min(?:utinho[s]?|uto[s]?)?\\b', 'i'));
  if (minutos) {
    const m = parsePTNum(minutos[1]);
    if (m !== null) return Math.round(m);
  }

  // 7. Horário absoluto: "às 9h", "às 9 horas", "às 21h30", "9h da manhã/tarde/noite"
  //    Só ativa se houver marcador claro de horário (não pega datas ou quantidades soltas)
  const absMatch = lower.match(
    /(?:às\s+|as\s+)(\d{1,2})(?:[h:](\d{2}))?\s*(?:horas?)?\s*(?:da\s+(manh[aã]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})[h:](\d{2})\s*(?:da\s+(manh[aã]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})()\s*h(?:oras?)?\s*(?:da\s+(manh[aã]|tarde|noite))\b/
  );

  if (absMatch) {
    let targetHour = parseInt(absMatch[1]);
    const targetMin = parseInt(absMatch[2] || '0');
    const period = (absMatch[3] || '').replace('manhã', 'manha');

    // Pega hora atual em SP
    const spTimeStr = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'America/Sao_Paulo',
    }).format(new Date());
    const [curH, curM] = spTimeStr.match(/\d+/g).map(Number);
    const curTotalMins = curH * 60 + curM;

    // AM/PM disambiguation
    if (period === 'manha') {
      if (targetHour === 12) targetHour = 0;
    } else if (period === 'tarde' || period === 'noite') {
      if (targetHour < 12) targetHour += 12;
    } else if (targetHour < 12) {
      // Sem período: se o horário já passou hoje, assume PM (noite)
      const targetTotalMins = targetHour * 60 + targetMin;
      if (curTotalMins >= targetTotalMins) targetHour += 12;
    }

    const targetTotalMins = targetHour * 60 + targetMin;
    let diff = targetTotalMins - curTotalMins;
    if (diff <= 0) diff += 24 * 60; // próxima ocorrência

    // Sanidade: ignora se resultar em valor absurdo (> 24h ou <= 0)
    if (diff > 0 && diff < 1440) return diff;
  }

  return null;
}

// ── Extrai timer_at absoluto (ISO) para horários como "às 16h" ──────────────
// Retorna ISO timestamp preciso em vez de minutos relativos (evita drift)
function extractAbsoluteTimerAt(message) {
  const lower = message.toLowerCase();

  const absMatch = lower.match(
    /(?:às\s+|as\s+)(\d{1,2})(?:[h:](\d{2}))?\s*(?:horas?)?\s*(?:da\s+(manh[aã]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})[h:](\d{2})\s*(?:da\s+(manh[aã]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})()\s*h(?:oras?)?\s*(?:da\s+(manh[aã]|tarde|noite))\b/
  );

  if (!absMatch) return null;

  let targetHour = parseInt(absMatch[1]);
  const targetMin = parseInt(absMatch[2] || '0');
  const period = (absMatch[3] || '').replace('manhã', 'manha');

  const now = new Date();
  const spFull = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(now);
  const [curH, curM, curS = 0] = spFull.match(/\d+/g).map(Number);

  // AM/PM disambiguation (mesma lógica de extractTimerMinutesFromMessage)
  if (period === 'manha') {
    if (targetHour === 12) targetHour = 0;
  } else if (period === 'tarde' || period === 'noite') {
    if (targetHour < 12) targetHour += 12;
  } else if (targetHour < 12) {
    const curTotalMins = curH * 60 + curM;
    const targetTotalMins = targetHour * 60 + targetMin;
    if (curTotalMins >= targetTotalMins) targetHour += 12;
  }

  // Calcula diff preciso incluindo segundos
  const curTotalSecs = curH * 3600 + curM * 60 + curS;
  const targetTotalSecs = targetHour * 3600 + targetMin * 60;
  let diffSecs = targetTotalSecs - curTotalSecs;
  if (diffSecs <= 0) diffSecs += 24 * 3600;

  if (diffSecs <= 0 || diffSecs >= 86400) return null;

  // timer_at preciso: agora + diff em milissegundos, zerado nos segundos do alvo
  const timerAt = new Date(now.getTime() + diffSecs * 1000);
  timerAt.setMilliseconds(0);

  return timerAt.toISOString();
}

// ── Resposta rápida para mutações (evita chamada LLM extra) ──────────────────

function buildMutationResponse(toolName, result, userName) {
  if (!result.success) return null;

  switch (toolName) {
    case 'TaskBatchCreate':
    case 'TaskCreate':
      // Deixa o LLM gerar a resposta de confirmação naturalmente
      // em vez de usar templates fixos e robóticos
      return null;
    case 'TaskUpdate': {
      const isDone = result.task_status === 'concluída';
      if (isDone) return `Feito, ${userName}! *${result.task_title}* marcada como concluida. Mandou bem!`;
      const changes = result.changes ? ` (${result.changes})` : '';
      const timer = result.timer_set ? ' Vou te avisar quando chegar a hora.' : '';
      return `Pronto, ${userName}! *${result.task_title}* atualizado${changes}.${timer}`;
    }
    case 'TaskDelete':
      return `Feito, ${userName}! Tarefa removida.`;
    default:
      return null;
  }
}

// ── Query Engine Loop ────────────────────────────────────────────────────────

// Ferramentas que modificam dados (invalidam cache)
const MUTATING_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskDelete', 'TaskBatchCreate']);

// Gera ACK personalizado com chamada LLM mínima (roda em paralelo com history/context)
async function generateAck(userMessage, userName) {
  try {
    const shortName = String(userName || 'você').split(' ')[0];
    const { response } = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Você é o Lui, assistente de produtividade no WhatsApp. ${shortName} acabou de te mandar uma mensagem (texto ou áudio). Gere UMA frase curtíssima de reconhecimento que mostre que você ENTENDEU o ASSUNTO, antes de começar a processar.

REGRAS RÍGIDAS:
- UMA frase só, MÁXIMO 10 palavras
- Português brasileiro coloquial, natural e levemente espontâneo
- Mencione brevemente o ASSUNTO específico da mensagem (não fale genérico)
- NÃO confirme conclusão ("feito", "anotei", "criei") ⭐ você ainda está PROCESSANDO
- NÃO use emojis
- NÃO use o nome em toda mensagem (alterne)
- Tom de parceiro de organização, não robô

EXEMPLOS DE BOM ACK (notar que cada um menciona o assunto real):
- Mensagem: "preciso lembrar de pagar a conta de luz amanhã" ⭐ "Show, deixa eu anotar essa da conta de luz..."
- Mensagem: "atazanar minha cachorrinha daqui 3 minutinhos" ⭐ "Aaah, vou marcar essa da cachorrinha já já..."
- Mensagem: "amanhã às 14h tenho consulta no dentista" ⭐ "Beleza, deixa eu colocar essa do dentista pra amanhã..."
- Mensagem: "preciso comprar pão, leite e ovos" ⭐ "Tô separando essas da compra aqui..."

Responda APENAS com a frase de ack, nada mais.`,
        },
        { role: 'user', content: userMessage.substring(0, 300) },
      ],
      max_tokens: 40,
      temperature: 0.8,
    });
    return response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    return null;
  }
}

const ACK_TOPIC_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'pra', 'para', 'por',
  'com', 'sem', 'que', 'eu', 'me', 'minha', 'meu', 'minhas', 'meus',
  'isso', 'ai', 'aí', 'agora', 'hoje', 'amanha', 'amanhã',
  'lembrar', 'lembra', 'lembre', 'avisar', 'avisa', 'anotar', 'anota',
]);

function extractAckTopic(userMessage) {
  const cleaned = String(userMessage || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(?:uns?|umas?)?\s*\d+(?:[,.]\d+)?\s*(?:h|hora[s]?|min(?:utinho[s]?|uto[s]?)?)\b/gi, ' ')
    .replace(/\b(daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(?:uns?|umas?)?\s*(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|meia)\s*(?:hora[s]?|min(?:utinho[s]?|uto[s]?)?)\b/gi, ' ')
    .replace(/^\s*(me\s+lembr(?:a|ar|e)(?:\s+de|\s+que)?|me\s+avis(?:a|ar)(?:\s+de|\s+que)?|anota(?:\s+a[íi]|\s+isso|\s+pra\s+mim)?|registr(?:a|ar)|salva(?:\s+isso|\s+a[íi])?|tenho\s+que|preciso(?:\s+de)?|cria(?:r)?(?:\s+uma)?\s+tarefa(?:\s+pra|\s+para)?|adiciona(?:r)?(?:\s+uma)?\s+tarefa?)\s+/i, ' ')
    .replace(/\b(hoje|amanh[ãa]|depois\s+de\s+amanh[ãa]|semana\s+que\s+vem|m[eê]s\s+que\s+vem)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned
    .split(' ')
    .filter(word => word.length > 2 && !ACK_TOPIC_STOPWORDS.has(word))
    .slice(0, 5);

  return words.join(' ');
}

function generateQuickAck(userMessage, userName) {
  const shortName = String(userName || 'voce').split(' ')[0];
  const templates = hasMultipleTasks(userMessage)
    ? [
      `Certo, ${shortName}! Vou separar por partes.`,
      `Recebi tudo, ${shortName}. Organizando agora.`,
      `Perfeito, ${shortName}. Montando direitinho.`,
    ]
    : [
      `Certo, ${shortName}. Já organizo.`,
      `Entendido, ${shortName}. Um instante.`,
      `Recebi, ${shortName}. Já vou anotar.`,
    ];

  const indexBase = `${userMessage}:${shortName}`.length;
  return templates[indexBase % templates.length];
}

export async function queryEngineLoop(
  userMessage,
  sessionId,
  userId,
  userName = 'Usuário',
  { onAck, fromAudio = false, returnTelemetry = false, sourceChannel = 'whatsapp', sseId = null } = {}
) {
  const initParams = { userId, sseId };
  const emit = (status, data = {}) => {
    if (sseId) {
      engineEvents.emit('monitor', {
        sseId,
        type: 'engine',
        status,
        data: { ...data, timestamp: new Date().toISOString() }
      });
    }
  };

  // Só envia ack para mensagens que envolvem ação (criação de tarefas, múltiplos itens)
  // Saudações, apresentações e conversa geral NÃO precisam de ack
  const isActionMessage = isCreationIntent(userMessage) || hasMultipleTasks(userMessage);
  const shouldAck = isActionMessage && (fromAudio || hasMultipleTasks(userMessage)) && typeof onAck === 'function';
  const llmOptions = fromAudio
    ? {
      turnBudgetMs: Number(process.env.AUDIO_LLM_TURN_BUDGET_MS || 90000),
      primaryTimeoutMs: Number(process.env.AUDIO_PRIMARY_LLM_TIMEOUT_MS || 45000),
      fallbackTimeoutMs: Number(process.env.AUDIO_FALLBACK_LLM_TIMEOUT_MS || 25000),
    }
    : {
      turnBudgetMs: Number(process.env.TEXT_LLM_TURN_BUDGET_MS || 90000),
      primaryTimeoutMs: Number(process.env.TEXT_PRIMARY_LLM_TIMEOUT_MS || 45000),
      fallbackTimeoutMs: Number(process.env.TEXT_FALLBACK_LLM_TIMEOUT_MS || 25000),
    };
  const trace = {
    provider: null,
    model: null,
    latency_ms: 0,
    fallback_used: false,
    tool_count: 0,
    error_class: null,
    artifact_recovery: false,
  };

  const captureTelemetry = (telemetry) => {
    if (!telemetry) return;
    trace.provider = telemetry.provider || trace.provider;
    trace.model = telemetry.model || trace.model;
    trace.latency_ms += telemetry.latency_ms || 0;
    trace.fallback_used = trace.fallback_used || !!telemetry.fallback_used;
    trace.error_class = telemetry.error_class || trace.error_class;
  };

  const birthdayFact = extractBirthdayFact(userMessage);
  if (birthdayFact && !isBirthdayRecallIntent(userMessage)) {
    const startedAt = Date.now();
    const history = await getHistory(sessionId);
    await saveBirthdayMemory(userId, userName, birthdayFact, userMessage);
    const content = `Fechado, ${userName}. Seu aniversário é ${birthdayFact}.`;

    await saveHistory(sessionId, [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content },
    ]);

    trace.provider = 'direct';
    trace.model = 'memory-birthday-save';
    trace.latency_ms += Date.now() - startedAt;
    trace.tool_count += 1;
    return returnTelemetry ? { content, telemetry: trace } : content;
  }

  if (isBirthdayRecallIntent(userMessage)) {
    const startedAt = Date.now();
    const history = await getHistory(sessionId);
    const memories = await recallMemories(userId, {
      query: 'aniversario nascimento nasci data pessoal',
      limit: 5,
      minImportance: 0,
    });
    let birthday = findBirthdayInMemories(memories);

    if (!birthday) {
      birthday = await recallBirthdayFromLegacyCommitments(userId);
      if (birthday) {
        await saveBirthdayMemory(userId, userName, birthday, 'Migrado de compromisso diario salvo incorretamente.');
      }
    }

    const content = birthday
      ? `${userName}, seu aniversário é ${birthday}.`
      : `${userName}, não achei seu aniversário salvo aqui ainda. Me fala a data uma vez que eu guardo.`;

    await saveHistory(sessionId, [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content },
    ]);

    trace.provider = 'direct';
    trace.model = 'memory-birthday-recall';
    trace.latency_ms += Date.now() - startedAt;
    return returnTelemetry ? { content, telemetry: trace } : content;
  }

  const shouldResolveCompletionDirectly =
    hasTaskCompletionIntent(userMessage) &&
    (hasVagueTaskReference(userMessage) || extractTaskNumberReference(userMessage));

  if (shouldResolveCompletionDirectly) {
    const startedAt = Date.now();
    const history = await getHistory(sessionId);
    const target = await resolveCompletionTargetFromHistory(userMessage, history);
    const wantsNext = asksForNextTasks(userMessage);

    if (target.ambiguous || (!target.taskId && !target.taskTitle)) {
      const content = wantsNext
        ? `${userName}, qual tarefa vocÃª concluiu? Me manda o nome ou o nÃºmero dela que eu marco e jÃ¡ te digo o que falta.`
        : `${userName}, qual tarefa vocÃª concluiu? Me manda o nome ou o nÃºmero dela que eu marco aqui.`;

      await saveHistory(sessionId, [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content },
      ]);

      trace.provider = 'direct';
      trace.model = 'task-completion-clarify';
      trace.latency_ms += Date.now() - startedAt;
      return returnTelemetry ? { content, telemetry: trace } : content;
    }

    emit('Atualizando tarefa...', { task_id: target.taskId, task_title: target.taskTitle });
    const updateResult = await executeTool('TaskUpdate', {
      task_id: target.taskId || target.taskTitle,
      status: 'done',
    }, { userId });
    trace.tool_count += 1;
    if (updateResult.success) invalidateContextCache(userId);

    let listResult = null;
    if (wantsNext) {
      listResult = await executeTool('TaskList', { limit: 8 }, { userId });
      trace.tool_count += 1;
    }

    const content = buildCompletionAndNextResponse(userName, updateResult, listResult, wantsNext);
    const taskIndexBlock = wantsNext ? buildTaskIndexBlock(listResult?.tasks_raw) : '';

    await saveHistory(sessionId, [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: content + taskIndexBlock },
    ]);

    trace.provider = 'direct';
    trace.model = 'task-completion';
    trace.latency_ms += Date.now() - startedAt;
    return returnTelemetry ? { content, telemetry: trace } : content;
  }

  const simpleTaskListRequest = getSimpleTaskListRequest(userMessage);
  if (simpleTaskListRequest) {
    try {
      const startedAt = Date.now();
      emit('Buscando tarefas...', { query: simpleTaskListRequest });
      const result = await executeTool('TaskList', {
        limit: 10,
        ...(simpleTaskListRequest.status ? { status: simpleTaskListRequest.status } : {}),
        ...(simpleTaskListRequest.due_date ? { due_date: simpleTaskListRequest.due_date } : {}),
      }, { userId });
      const content = buildSimpleTaskListResponse(userMessage, userName, result, simpleTaskListRequest);
      const history = await getHistory(sessionId);

      trace.provider = 'direct';
      trace.model = 'task-list';
      trace.latency_ms += Date.now() - startedAt;
      trace.tool_count += 1;

      // Anexa índice de IDs ao histórico para que o LLM possa resolver referências
      // numéricas futuras ("é a número 2") sem precisar chamar TaskSearch
      const taskIndexBlock = result.tasks_raw?.length
        ? `\n[ÍNDICE:${result.tasks_raw.map((t, i) => `${i + 1}="${t.id}"`).join('|')}]`
        : '';

      await saveHistory(sessionId, [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: content + taskIndexBlock },
      ]);

      return returnTelemetry ? { content, telemetry: trace } : content;
    } catch (err) {
      console.error('[QueryEngine] Erro na rota direta de TaskList:', err.message);
      trace.error_class = err.code || err.name || 'task_list_direct_error';
    }
  }
  const resolvedDate = extractDateFromMessage(userMessage);
  const hasVagueTime = hasVagueTimeReference(userMessage);
  const resolvedTimerMinutes = hasVagueTime ? null : extractTimerMinutesFromMessage(userMessage);
  const resolvedTimerAt = hasVagueTime ? null : extractAbsoluteTimerAt(userMessage);
  const resolvedDateWithTimerFallback = resolvedDate || (resolvedTimerMinutes ? getTodayISO() : null);
  if (hasVagueTime) console.log(`[VagueTime] Tempo vago detectado, timer suprimido: "${userMessage.substring(0, 80)}"`);
  const creationIntent = isCreationIntent(userMessage);
  const multipleTasksIntent = hasMultipleTasks(userMessage);

  const simpleTaskCreateRequest = getSimpleTaskCreateRequest(userMessage, {
    resolvedDate,
    resolvedTimerMinutes,
    resolvedTimerAt,
    sourceChannel,
  });

  if (simpleTaskCreateRequest) {
    const startedAt = Date.now();
    const history = await getHistory(sessionId);
    let content;

    if (simpleTaskCreateRequest.missingTitle) {
      content = buildMissingTaskTitleResponse(userName, resolvedTimerMinutes);
    } else {
      emit('Criando tarefa...', { title: simpleTaskCreateRequest.args.title });
      const result = await executeTool('TaskCreate', simpleTaskCreateRequest.args, { userId });
      trace.tool_count += 1;
      if (result.success) invalidateContextCache(userId);
      content = buildMutationResponse('TaskCreate', result, userName)
        || (result.success
          ? `Anotado, ${userName}! *${result.task_title}* ficou registrado.`
          : `${userName}, não consegui criar essa tarefa agora. Tenta de novo em instantes.`);
    }

    trace.provider = 'direct';
    trace.model = 'task-create';
    trace.latency_ms += Date.now() - startedAt;

    await saveHistory(sessionId, [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content },
    ]);

    return returnTelemetry ? { content, telemetry: trace } : content;
  }
  // Busca histórico, contexto e memória em paralelo ⭐ custo zero extra
  emit('Carregando contexto e memória...');
  const [history, staticSystemPrompt, memoryContext] = await Promise.all([
    getHistory(sessionId),
    getSystemContext(userId, userName, initParams),
    getMemoryContext(userId, userMessage).catch((err) => {
      console.error('[QueryEngine] getMemoryContext falhou:', err.message);
      return '';
    }),
  ]);
  const systemPrompt = memoryContext
    ? `${staticSystemPrompt}\n\n${memoryContext}`
    : staticSystemPrompt;

  if (shouldAck) {
    // Tenta gerar ack contextual via LLM, com fallback para template se demorar mais que 2.5s
    // (assim a ack nunca chega depois da resposta principal)
    const fallbackAck = generateQuickAck(userMessage, userName);
    let ackSent = false;
    const sendAckOnce = (text) => {
      if (ackSent || !text) return;
      ackSent = true;
      Promise.resolve(onAck(text)).catch(() => { });
    };

    const ackTimeoutMs = 2500;
    const timeoutHandle = setTimeout(() => sendAckOnce(fallbackAck), ackTimeoutMs);

    generateAck(userMessage, userName)
      .then((llmAck) => {
        clearTimeout(timeoutHandle);
        sendAckOnce(llmAck || fallbackAck);
      })
      .catch(() => {
        clearTimeout(timeoutHandle);
        sendAckOnce(fallbackAck);
      });
  }

  const preferredTool = creationIntent
    ? (multipleTasksIntent ? 'TaskBatchCreate' : 'TaskCreate')
    : null;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let toolTurns = 0;

  while (true) {
    try {
      // Na 1┬¬ chamada com intenção de criação, força a ferramenta diretamente (evita fallback)
      const isFirstCall = toolTurns === 0;
      const currentToolChoice = (preferredTool && isFirstCall)
        ? { type: 'function', function: { name: preferredTool } }
        : 'auto';
      // Reasoning models (nemotron-super) precisam de budget maior pro thinking
      const isReasoningModel = PRIMARY_MODEL_ID.includes('nemotron')
        || PRIMARY_MODEL_ID.includes('reasoning');
      const baseMax = isFirstCall ? (multipleTasksIntent ? 900 : 450) : 250;
      const currentMaxTokens = isReasoningModel ? Math.max(baseMax, 2048) : baseMax;

      const { response, telemetry } = await createChatCompletion({
        messages,
        tools: TOOLS,
        tool_choice: currentToolChoice,
        temperature: 0.3,
        max_tokens: currentMaxTokens,
      }, llmOptions);
      captureTelemetry(telemetry);

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      // Reasoning models: reasoning_content = thinking, content = resposta real (separados pela API).
      // Quando finish_reason=length (tokens esgotados no thinking), content == reasoning_content
      // → nenhuma resposta foi gerada. Detecta pela comparação do início do texto.
      if (assistantMessage.reasoning_content && assistantMessage.content) {
        const checkLen = Math.min(80, assistantMessage.reasoning_content.length, assistantMessage.content.length);
        const sameStart = assistantMessage.content.substring(0, checkLen)
          === assistantMessage.reasoning_content.substring(0, checkLen);
        if (sameStart) {
          // content É o thinking (tokens esgotados antes da resposta)
          assistantMessage.content = null;
        }
        // else: content já é a resposta real → usa como está
      }

      // Verifica se o modelo quer chamar ferramentas
      const hasToolCalls = assistantMessage.tool_calls?.length > 0;

      if (hasToolCalls) {
        if (toolTurns >= MAX_TOOL_TURNS) {
          const limitMsg = `Eita ${userName}, muita coisa de uma vez! Me manda um pedido por vez que fica melhor.`;
          await saveHistory(sessionId, [
            ...messages.filter(m => m.role !== 'system'),
            { role: 'assistant', content: limitMsg },
          ]);
          return limitMsg;
        }

        // Remove campos não-padrão (ex: reasoning_content do deepseek) incompatíveis com outros providers
        const cleanAssistantMessage = sanitizeChatMessageForInput(assistantMessage);
        messages.push(cleanAssistantMessage);
        toolTurns++;

        // Executa todas as tool calls em paralelo
        const toolCalls = assistantMessage.tool_calls || [];
        trace.tool_count += toolCalls.length;
        const executedResults = []; // guarda {toolName, result} para shortcircuit

        const toolResults = await Promise.all(
          toolCalls.map(async (toolCall) => {
            let args = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              // args permanece {}
            }

            // Se o modelo esqueceu o due_date mas a mensagem tinha data (ou tem timer ÔåÆ hoje), injeta
            if (resolvedDateWithTimerFallback) {
              if (toolCall.function.name === 'TaskCreate' && !args.due_date) {
                args.due_date = resolvedDateWithTimerFallback;
                console.log(`[DateInject] due_date=${resolvedDateWithTimerFallback} injetado em TaskCreate`);
              }
              if (toolCall.function.name === 'TaskBatchCreate' && Array.isArray(args.tasks)) {
                args.tasks = args.tasks.map(t => t.due_date ? t : { ...t, due_date: resolvedDateWithTimerFallback });
                console.log(`[DateInject] due_date=${resolvedDateWithTimerFallback} injetado em TaskBatchCreate`);
              }
            }

            // SEMPRE sobrescreve timer_minutes com o valor extraído por regex (mais preciso que o LLM)
            if (resolvedTimerMinutes) {
              if (toolCall.function.name === 'TaskCreate') {
                if (args.timer_minutes && args.timer_minutes !== resolvedTimerMinutes) {
                  console.log(`[TimerOverride] LLM=${args.timer_minutes} ÔåÆ extracted=${resolvedTimerMinutes} em TaskCreate`);
                } else if (!args.timer_minutes) {
                  console.log(`[TimerInject] timer_minutes=${resolvedTimerMinutes} injetado em TaskCreate`);
                }
                args.timer_minutes = resolvedTimerMinutes;
              }
              if (toolCall.function.name === 'TaskUpdate') {
                if (args.timer_minutes && args.timer_minutes !== resolvedTimerMinutes) {
                  console.log(`[TimerOverride] LLM=${args.timer_minutes} ÔåÆ extracted=${resolvedTimerMinutes} em TaskUpdate`);
                } else if (!args.timer_minutes) {
                  console.log(`[TimerInject] timer_minutes=${resolvedTimerMinutes} injetado em TaskUpdate`);
                }
                args.timer_minutes = resolvedTimerMinutes;
              }
              if (toolCall.function.name === 'TaskBatchCreate' && Array.isArray(args.tasks)) {
                args.tasks = args.tasks.map(t => {
                  if (t.timer_minutes && t.timer_minutes !== resolvedTimerMinutes) {
                    console.log(`[TimerOverride] LLM=${t.timer_minutes} ÔåÆ extracted=${resolvedTimerMinutes} em TaskBatchCreate`);
                  }
                  return { ...t, timer_minutes: resolvedTimerMinutes };
                });
              }
            }

            // Injeta timer_at_override para horários absolutos (mais preciso que timer_minutes)
            if (resolvedTimerAt) {
              if (toolCall.function.name === 'TaskCreate') {
                args.timer_at_override = resolvedTimerAt;
                console.log(`[TimerAtInject] timer_at_override=${resolvedTimerAt} injetado em TaskCreate`);
              }
            }

            // Salva a mensagem original do usuário para exibição no painel web
            if (toolCall.function.name === 'TaskCreate' || toolCall.function.name === 'TaskBatchCreate') {
              if (sourceChannel === 'whatsapp') {
                args.whatsapp_message = userMessage;
              }
              args.source = sourceChannel === 'whatsapp' ? 'whatsapp' : 'user';
            }

            // Injeta subtarefas se o modelo não gerou nenhuma e a mensagem tem sub-tópicos detectáveis
            if (toolCall.function.name === 'TaskCreate' && (!args.subtasks || args.subtasks.length === 0)) {
              const autoSubs = extractSubtasksFromMessage(userMessage);
              if (autoSubs.length >= 2) {
                args.subtasks = autoSubs.map(title => ({ title }));
                console.log(`[SubtaskInject] ${autoSubs.length} subtarefas injetadas:`, autoSubs);
              }
            }

            console.log(`[Agent] ÔåÆ ${toolCall.function.name}`, JSON.stringify(args));
            let result = await executeTool(toolCall.function.name, args, { userId });
            console.log(`[Agent] ÔåÉ ${toolCall.function.name}`, result.success ? 'Ô£à' : 'ÔØî');

            // Auto-recovery: TaskUpdate/TaskDelete com UUID inválido ou não encontrado ÔåÆ
            // busca pelo nome na mensagem do usuário e retenta com o ID real
            if (
              !result.success &&
              (toolCall.function.name === 'TaskUpdate' || toolCall.function.name === 'TaskDelete') &&
              result._hint?.includes('não encontrada')
            ) {
              console.log(`[AutoRecover] ID inválido em ${toolCall.function.name} - buscando por título...`);
              // Extrai palavras-chave relevantes (remove stopwords curtas e limita tamanho)
              const searchQuery = userMessage.substring(0, 120).replace(/[,()!?]/g, ' ').replace(/\s+/g, ' ').trim();
              const searchResult = await executeTool('TaskSearch', { query: searchQuery }, { userId });
              const found = searchResult.tasks_raw?.[0];
              if (found?.id) {
                args.task_id = found.id;
                console.log(`[AutoRecover] Retentando ${toolCall.function.name} com ID real: ${found.id}`);
                result = await executeTool(toolCall.function.name, args, { userId });
                console.log(`[AutoRecover] ÔåÉ ${toolCall.function.name}`, result.success ? 'Ô£à' : 'ÔØî');
              }
            }

            // Invalida cache se foi uma ferramenta que modifica dados
            if (MUTATING_TOOLS.has(toolCall.function.name)) {
              invalidateContextCache(userId);
            }

            executedResults.push({ toolName: toolCall.function.name, result });

            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            };
          })
        );

        messages.push(...toolResults);

        // Shortcircuit: se todas as ferramentas foram mutações bem-sucedidas,
        // gera a resposta em código e evita uma chamada LLM extra
        if (
          executedResults.length === 1 &&
          MUTATING_TOOLS.has(executedResults[0].toolName)
        ) {
          const { toolName, result } = executedResults[0];
          const quick = buildMutationResponse(toolName, result, userName);
          if (quick) {
            messages.push({ role: 'assistant', content: quick });
            await saveHistory(sessionId, messages.filter(m => m.role !== 'system'));
            console.log(`[Shortcircuit] Resposta gerada em código para ${toolName}`);
            return returnTelemetry ? { content: quick, telemetry: trace } : quick;
          }
        }

        continue;
      }

      // Safety net: se o modelo ainda assim não chamou ferramenta com intenção clara,
      // loga para diagnóstico (não deve acontecer pois forçamos na 1┬¬ chamada via preferredTool)
      if (toolTurns === 0 && preferredTool) {
        console.warn(`[Fallback] tool_choice forçado mas modelo não chamou ${preferredTool} - respondendo em texto`);
      }

      // Resposta final — strip de bloco <think>...</think> de modelos de raciocínio (ex: Kimi K2.5)
      let finalContent = (assistantMessage.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        || 'Pode repetir? Não entendi direito.';

      // Detecta artefatos internos do modelo (ex: "<´¢£toolÔûüsep´¢£>") na resposta final
      // Quando presente, o modelo vazou sintaxe interna em vez de gerar texto - refaz com tool_choice: 'none'
      const hasModelArtifacts = (s) => s.includes('<´¢£tool') || s.includes('toolÔûü') || s.includes('<tool_call>');

      if (hasModelArtifacts(finalContent)) {
        console.warn('[QueryEngine] Resposta com artefatos detectada - reforçando resposta limpa');
        try {
          const cleanMessages = messages.filter(m => !hasModelArtifacts(m.content || ''));
          cleanMessages.push({
            role: 'user',
            content: '[SISTEMA: Responda ao usuário em português natural e direto. NÃO use sintaxe de ferramentas. Apenas texto simples, sem marcações especiais.]',
          });
          trace.artifact_recovery = true;
          const { response: retryResp, telemetry: retryTelemetry } = await createChatCompletion({
            messages: cleanMessages,
            tool_choice: 'none',
            temperature: 0.3,
            max_tokens: 300,
          }, llmOptions);
          captureTelemetry(retryTelemetry);
          finalContent = (retryResp.choices[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || `Feito, ${userName}! Pode me dizer o que mais precisa.`;
        } catch {
          finalContent = `Feito, ${userName}! Pode me dizer o que mais precisa.`;
        }
      }

      // Sanitização final: remove JSON acidental, UUIDs, emojis e datas ISO que escaparam
      finalContent = finalContent
        .replace(/\{[^}]{20,}\}/g, '') // Remove objetos JSON
        .replace(/\[[^\]]{20,}\]/g, '') // Remove arrays JSON
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '') // Remove UUIDs
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '') // Remove emojis remanescentes
        .replace(/\d{4}-\d{2}-\d{2}/g, (match) => humanizeDateInline(match)) // Humaniza datas ISO residuais
        .replace(/\n{3,}/g, '\n\n') // Limpa quebras excessivas
        .trim();

      messages.push({ role: 'assistant', content: finalContent });

      await saveHistory(sessionId, messages.filter(m => m.role !== 'system'));
      return returnTelemetry ? { content: finalContent, telemetry: trace } : finalContent;

    } catch (err) {
      console.error('[QueryEngine] Erro na chamada ao modelo:', err.message);
      trace.error_class = err.error_class || err.code || err.name || 'provider_error';

      // Se for erro de rate limit ou timeout, retorna mensagem amigável
      if (err.status === 429) {
        const content = `${userName}, tô um pouco sobrecarregado agora. Tenta de novo em alguns segundinhos.`;
        return returnTelemetry ? { content, telemetry: trace } : content;
      }
      if (err.error_class === 'timeout' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        const content = `${userName}, parece que tô com probleminhas de conexão. Tenta de novo daqui a pouco.`;
        return returnTelemetry ? { content, telemetry: trace } : content;
      }

      const content = `${userName}, deu um errinho aqui comigo. Tenta de novo?`;
      return returnTelemetry ? { content, telemetry: trace } : content;
    }
  }
}

// Helper inline para sanitização de datas na resposta final
function humanizeDateInline(isoDate) {
  const todayISO = getTodayISO();
  const spDate = new Date(todayISO + 'T12:00:00-03:00');
  const tomorrow = new Date(spDate); tomorrow.setDate(spDate.getDate() + 1);

  if (isoDate === todayISO) return 'hoje';
  if (isoDate === tomorrow.toISOString().split('T')[0]) return 'amanhã';

  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const dayNum = target.getDate();
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(target);
  return `${dayNum} de ${monthName}`;
}
