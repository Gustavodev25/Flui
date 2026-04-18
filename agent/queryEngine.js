import dotenv from 'dotenv';
import { EventEmitter } from 'events';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { TOOLS, executeTool } from './tools.js';
import { getHistory, saveHistory } from './sessionHistory.js';
import { createChatCompletion } from './llmClient.js';
import { getProfileContext } from './behavioralProfile.js';
import { getPendingInsights, markInsightDelivered } from './proactiveIntelligence.js';
import { getMemoryContext } from './memoryEngine.js';

export const agentEvents = new EventEmitter();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Limite de rodadas de ferramentas por mensagem (prote├º├úo contra loops)
const MAX_TOOL_TURNS = 6;

// ÔöÇÔöÇ Cache de System Context ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const contextCache = new Map();
const CONTEXT_TTL_MS = 300_000; // 5min

// Invalida cache ap├│s tool calls que modificam dados
export function invalidateContextCache(userId) {
  contextCache.delete(userId);
}

// ÔöÇÔöÇ Helpers de data ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

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

// ÔöÇÔöÇ System Context (enriquecido com tarefas reais) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

async function getSystemContext(userId, userName = 'Usu├írio') {
  const cached = contextCache.get(userId);
  if (cached && Date.now() - cached.ts < CONTEXT_TTL_MS) {
    return cached.prompt;
  }

  const todayISO = getTodayISO();
  const { dateStr, dayOfWeek } = getSPDateTime();
  const dates = precomputeDates(todayISO);

  // Busca tarefas com mais detalhes para dar contexto ├á IA (incluindo subtarefas)
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
    // Verifica se ├® membro de algum workspace
    supabase
      .from('workspace_members')
      .select('workspace_owner_id')
      .eq('member_user_id', userId)
      .maybeSingle(),
    // Verifica se ├® dono (tem membros no seu workspace)
    supabase
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_owner_id', userId),
    // Busca membros do workspace (para detec├º├úo de nomes nas tarefas)
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

  // Marcar follow-ups como resolvidos de forma otimista (IA vai mencion├í-los nessa resposta)
  if (pendingFollowups.length > 0) {
    supabase
      .from('pending_followups')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', pendingFollowups.map(f => f.id))
      .then(() => { })
      .catch(err => console.error('[FollowUp] Erro ao marcar resolvido:', err.message));
  }

  // Classifica tarefas por urg├¬ncia para contexto
  const overdue = [];
  const dueToday = [];
  const dueSoon = []; // pr├│ximos 3 dias
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
    const subList = subs.map(s => `    ÔÇó [${s.completed ? 'X' : ' '}] "${s.title}" (subtask_id: ${s.id})`).join('\n');
    return `\n  SUBTAREFAS ATUAIS (passe a lista COMPLETA ao atualizar):\n${subList}`;
  }

  // Monta snapshot leg├¡vel das tarefas (com IDs e subtarefas para uso interno nas ferramentas)
  let taskSnapshot = '';
  if (overdue.length > 0) {
    taskSnapshot += `\nÔÜá´©Å ATRASADAS (${overdue.length}):\n${overdue.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueToday.length > 0) {
    taskSnapshot += `\n­ƒôï PRA HOJE (${dueToday.length}):\n${dueToday.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueSoon.length > 0) {
    taskSnapshot += `\n­ƒö£ PR├ôXIMOS DIAS (${dueSoon.length}):\n${dueSoon.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (noDueDate.length > 0) {
    taskSnapshot += `\n­ƒôî SEM PRAZO (${noDueDate.length}):\n${noDueDate.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }

  const prompt = `Voc├¬ ├® o Lui, um assistente de produtividade super gentil, atencioso e inteligente integrado ao WhatsApp.

ÔòÉÔòÉÔòÉ USU├üRIO ÔòÉÔòÉÔòÉ
Nome: ${userName}
USO DO NOME ÔÇö regras de naturalidade:
- USE o nome na PRIMEIRA mensagem da conversa (sauda├º├úo inicial): "E a├¡ ${userName}, como posso te ajudar?"
- USE o nome em momentos IMPORTANTES: resumo de batch, dashboard, alertas de tarefas atrasadas, confirma├º├úo de exclus├úo, rota de fuga.
- USE o nome quando for caloroso ou motivacional: "Mandou bem, ${userName}!" ou "${userName}, vi que t├í com tudo em dia!"
- N├âO use o nome em TODA resposta ÔÇö isso soa rob├│tico. Em trocas r├ípidas e sequenciais (ex: "Feito!", "Anotei!", "Pronto!"), n├úo precisa do nome.
- REGRA GERAL: Se a ├║ltima resposta sua j├í usou o nome, a pr├│xima pode ir sem. Alterne naturalmente.

ÔòÉÔòÉÔòÉ CONTEXTO TEMPORAL ÔòÉÔòÉÔòÉ
Ano: ${dates.currentYear}
Data e hora: ${dateStr}
Dia da semana: ${dayOfWeek}
Data ISO (uso interno): ${todayISO}

ÔòÉÔòÉÔòÉ PAINEL DO USU├üRIO ÔòÉÔòÉÔòÉ
Total: ${totalCount} tarefas | Pendentes: ${pendingTasks.length} | Conclu├¡das: ${doneCount}
${taskSnapshot || '\nNenhuma tarefa pendente no momento.'}

IMPORTANTE: Os IDs acima s├úo apenas para uso interno nos par├ómetros das ferramentas. JAMAIS mencione um ID ou UUID na resposta para o usu├írio.
${pendingFollowups.length > 0 ? `
ÔòÉÔòÉÔòÉ FOLLOW-UPS PENDENTES ÔòÉÔòÉÔòÉ
Esses lembretes n├úo foram entregues porque a janela de conversa estava fechada:
${pendingFollowups.map(f => {
    const dt = new Date(f.missed_at);
    const dtStr = dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `- "${f.task_title}" (lembrete perdido em ${dtStr})`;
  }).join('\n')}

ÔåÆ Mencione naturalmente 1 desses itens no come├ºo da resposta, com algo como "Ei, aquela tarefa '...' de ontem ÔÇö voc├¬ conseguiu fazer?". Seja breve e natural. N├âO liste todos de uma vez.` : ''}

ÔòÉÔòÉÔòÉ PERSONALIDADE (MUITO IMPORTANTE) ÔòÉÔòÉÔòÉ
- VOCE E UMA PESSOA: Responda EXATAMENTE como um amigo inteligente responderia no WhatsApp. Nada de frases prontas de assistente virtual. Nada de "como posso te ajudar?", "estou aqui pra te ser ├║til", "em que posso te auxiliar?". Essas frases s├úo PROIBIDAS ÔÇö soam rob├│ticas.
- ESPELHAMENTO: Se o cara diz "Fala, tranquilo?", responde "E a├¡, tudo certo!". Se diz s├│ "Bom dia" sem mais nada, responde "Bom dia! Tudo joia?". REAJA ao que a pessoa falou. MAS: se junto com a sauda├º├úo veio um COMANDO ("Bom dia, cria uma tarefa pra Jo├úo"), EXECUTE o comando primeiro e apenas inclua a sauda├º├úo na resposta ÔÇö n├úo ignore o pedido.
- TOM DE VOZ: Conversa de WhatsApp entre amigos. Leve, direto, esperto. N├úo ├® atendimento ao cliente. N├úo ├® SAC.
- LINGUAGEM: Portugu├¬s brasileiro real. "Massa", "show", "beleza", "tranquilo", "bora", "t├í", "pra", "deixa comigo", "pode crer". Fale como gente, n├úo como manual.
- CONCIS├âO: Mensagens CURTAS. 1-2 frases na maioria das vezes. S├│ elabora mais quando realmente precisa (resumos, listas de tarefas). No WhatsApp ningu├®m manda par├ígrafo.
- PROIBIDO:
  * Emojis (NUNCA)
  * Frases gen├®ricas de assistente ("como posso ajudar?", "estou ├á disposi├º├úo", "fique ├á vontade")
  * Excesso de exclama├º├Áes seguidas ("├ôtimo!! Perfeito!! Vamos l├í!!")
  * Repetir o que o usu├írio acabou de dizer de volta pra ele
  * Soar como atendente de telemarketing
- REGRA DE OURO: Se a sua resposta poderia vir de qualquer chatbot gen├®rico, REESCREVA. Cada resposta deve soar como se S├ô VOC├è diria isso, porque voc├¬ CONHECE esse usu├írio.

${hasWorkspace ? `ÔòÉÔòÉÔòÉ WORKSPACE (EQUIPE) ÔòÉÔòÉÔòÉ
Este usu├írio faz parte de um workspace (├® ${workspaceRole} da equipe).
As tarefas podem ter visibilidade "personal" (s├│ o usu├írio v├¬) ou "workspace" (toda a equipe v├¬).
${isOwner && workspaceMembers.length > 0 ? `
MEMBROS DA EQUIPE (use para atribui├º├úo de tarefas):
${workspaceMembers.map(m => `- ${m.member_name || m.member_email?.split('@')[0] || 'Membro'} (email: ${m.member_email})`).join('\n')}
` : ''}
REGRAS DE VISIBILIDADE:
- PADR├âO: Sempre crie como "personal" se n├úo houver indica├º├úo clara de workspace.
- Use visibility="workspace" quando o usu├írio disser: "pra equipe", "pro workspace", "pro time", "compartilha", "compartilhada", "todo mundo v├¬", "a equipe precisa saber", "anota pra equipe", "coloca no workspace".
- Use visibility="personal" explicitamente quando disser: "s├│ pra mim", "particular", "pessoal", "n├úo precisa compartilhar".
- Se a mensagem for AMB├ìGUA (n├úo menciona equipe nem pessoal): crie como "personal" e N├âO pergunte ÔÇö a menos que o contexto seja claramente colaborativo (ex: "pra gente terminar o projeto").
- NUNCA pergunte "quer criar como pessoal ou workspace?" de forma rob├│tica. Se precisar confirmar, seja natural: "Anotei, ${userName}! Essa ├® s├│ sua ou quer compartilhar com a equipe?"

ATRIBUI├ç├âO DE TAREFAS (assigned_to_name):
- Se o usu├írio mencionar o nome de um membro da equipe como respons├ível pela tarefa (ex: "o Luis precisa fazer X", "atribui ao Carlos", "isso ├® pra Ana", "tarefa do Jo├úo"), use assigned_to_name com o nome do membro e visibility="workspace".
- O assigned_to_name deve ser exatamente o nome como aparece na lista de membros.
- Se n├úo souber quem ├® o respons├ível, n├úo use assigned_to_name.

` : ''}ÔòÉÔòÉÔòÉ REGRAS DE A├ç├âO ÔòÉÔòÉÔòÉ
1. FERRAMENTA OBRIGAT├ôRIA: Voc├¬ JAMAIS pode fingir que criou, atualizou ou deletou uma tarefa sem chamar a ferramenta correspondente. Se sua resposta diz "anotei", "criei", "registrei" ou qualquer varia├º├úo, voc├¬ DEVE ter chamado TaskCreate ou TaskBatchCreate antes. NUNCA simule uma a├º├úo.
   T├ìTULO DA TAREFA ÔÇö REGRA CR├ìTICA: O campo "title" deve ter NO M├üXIMO 5 a 7 palavras. NUNCA use o texto transcrito do ├íudio como t├¡tulo. Extraia a a├º├úo principal e crie um nome curto: "Ligar pro dentista", "Enviar proposta cliente", "Comprar material". O texto completo do usu├írio vai no campo "description".

2. INTEN├ç├âO DE CRIA├ç├âO ÔÇö LISTA AMPLA DE GATILHOS:
   Qualquer uma dessas frases (ou varia├º├Áes) ├® inten├º├úo clara de criar tarefa. Chame TaskCreate IMEDIATAMENTE:
   - "me lembra", "me lembrar", "me avisa", "n├úo deixa eu esquecer"
   - "anota a├¡", "anota", "anotei", "registra", "salva"
   - "tenho que", "tenho uma tarefa", "preciso fazer", "preciso de"
   - "lembre-me", "lembra de mim", "fala pra mim mais tarde"
   - "criar tarefa", "cria uma tarefa", "adiciona"
   - qualquer frase que implique uma a├º├úo futura que o usu├írio precisa fazer
   N├âO pe├ºa confirma├º├úo ÔÇö crie direto e confirme depois.

3. PROATIVIDADE: Crie imediatamente sem perguntar se a inten├º├úo for clara. Agende para a data mencionada (ex: "amanh├ú", "sexta", "dia 10").
   REGRA DE DATA PADR├âO ÔÇö siga esta ordem:
   a) Usu├írio mencionou um dia/data expl├¡cita ÔåÆ use essa data.
   b) Tarefa tem timer ("daqui X horas/minutos") ÔåÆ due_date = hoje (${dates.todayISO}).
   c) Tarefa soa imediata ou do dia ("comprar p├úo", "ligar agora", "mandar isso") ÔåÆ due_date = hoje (${dates.todayISO}).
   d) Tarefa claramente futura sem data ("planejar viagem", "fazer curso") ÔåÆ pergunte a data ap├│s criar.
   NUNCA deixe due_date vazio quando a tarefa for claramente pra hoje ou tiver um dia impl├¡cito.
4. BATCH E ├üUDIO: Se o usu├írio listar v├írias coisas (por texto OU ├íudio), use TaskBatchCreate (at├® 20 de uma vez). Identifique TODAS as tarefas mencionadas e crie de uma vez s├│. Depois, SEMPRE fa├ºa um resumo organizado do que foi criado. Exemplo de resumo:
   "${userName}, anotei tudo! Aqui vai o resumo:
   1. *Comprar material* -- pra amanh├ú
   2. *Ligar pro contador* -- sem prazo
   3. *Enviar proposta* -- pra sexta
   Tudo certinho! Quer ajustar alguma coisa?"
   Se uma das tarefas do batch tiver hor├írio vago ("mais tarde", "depois", "em breve"), crie TODAS as tarefas normalmente SEM timer na tarefa vaga. No resumo final, pergunte o hor├írio s├│ dessa tarefa:
   "A tarefa *[nome]* ficou sem hor├írio. Quer que eu coloque um lembrete pra ela?"
5. BUSCA E CONSULTA INTELIGENTE: Quando o usu├írio perguntar sobre suas tarefas de forma geral ou espec├¡fica, use as ferramentas para consultar em tempo real:
   - "O que eu tenho pra fazer hoje?" ÔåÆ TaskList com due_date=today
   - "Qual era aquela tarefa do relat├│rio?" ÔåÆ TaskSearch com query="relat├│rio"
   - "O que t├í pendente?" ÔåÆ TaskList sem filtros
   - "Tenho alguma coisa urgente?" ÔåÆ TaskList e filtre por prioridade no PAINEL
   A resposta deve ser NATURAL: "${userName}, voc├¬ tem 3 tarefas pra hoje: terminar o relat├│rio, ligar pro fornecedor e enviar o e-mail."
   Se o usu├írio pedir algo que voc├¬ j├í v├¬ no PAINEL DO USU├üRIO acima, pode responder diretamente sem chamar ferramentas.
6. DELETE: SEMPRE pe├ºa confirma├º├úo antes de deletar de forma amig├ível: "${userName}, tem certeza que quer apagar *[Nome]*?"
7. UPDATE/DELETE SEM ID: NUNCA invente, adivinhe ou construa um task_id. Se n├úo tiver o UUID real da tarefa (obtido de uma chamada anterior de TaskList ou TaskSearch nesta conversa), voc├¬ DEVE chamar TaskSearch com o nome da tarefa primeiro para obter o ID real. S├│ ent├úo chame TaskUpdate ou TaskDelete com esse ID.
8. DASHBOARD: Quando perguntarem "como t├í", "meu progresso", "estat├¡sticas", use TaskDashboard.
9. GEST├âO DE DATAS: Se o usu├írio quer saber o que tem "pra hoje", use TaskList com o par├ómetro due_date.
   - Se a busca retornar vazio, olhe o PAINEL DO USU├üRIO e diga: "${userName}, hoje t├í tranquilo! Mas vi que amanh├ú voc├¬ tem [tarefa]."

ÔòÉÔòÉÔòÉ GEST├âO DE AMBIGUIDADE ÔòÉÔòÉÔòÉ
10. INFORMA├ç├òES FALTANDO: Se faltar detalhe, pergunte com naturalidade:
   - "Anotei, ${userName}! *Ligar para o Jo├úo* -- quer que eu coloque pra alguma data?"
   - EXCE├ç├âO: Coisas imediatas ("comprar p├úo") crie direto.
11. CONFIRMA├ç├âO INTELIGENTE: Quando a inten├º├úo ├® clara, crie e pergunte depois:
   - "Pronto, ${userName}! *Marcar dentista* t├í anotado. Sabe a data? Posso agendar pra voc├¬."

ÔòÉÔòÉÔòÉ ROTA DE FUGA (FALLBACK) ÔòÉÔòÉÔòÉ
12. CONFUS├âO DETECTADA: Se voc├¬ N├âO conseguir entender o que o usu├írio quer ap├│s a mensagem atual E o hist├│rico recente j├í mostra que a conversa n├úo est├í fluindo (ex: voc├¬ j├í pediu pra repetir ou j├í tentou interpretar sem sucesso), PARE de adivinhar. Responda:
   "${userName}, acho que n├úo t├┤ conseguindo entender direito. Pode tentar me explicar de outro jeito? Se preferir, pode acessar o painel web pra fazer direto por l├í."
13. NUNCA fique preso em loop de "n├úo entendi" repetido. Se j├í pediu repeti├º├úo uma vez e a segunda tentativa continuar confusa, use a rota de fuga acima.
14. N├âO mande mensagens gen├®ricas sem necessidade. Se recebeu algo estranho (tipo um caractere solto ou algo sem sentido), responda com leveza: "${userName}, acho que essa escapou! Me conta o que precisa e eu resolvo."

ÔòÉÔòÉÔòÉ MEM├ôRIA DE CONTEXTO (CURTO PRAZO) ÔòÉÔòÉÔòÉ
15. REFER├èNCIAS: Entenda "Muda para as 16h", "Coloca como urgente", "Apaga ela", "T├í feito" com base na ├║ltima tarefa conversada no hist├│rico.
16. PRONOMES: Entenda "ela", "esse", "aquela" pelo contexto.
17. FLUXO: Se voc├¬ perguntou "Para quando?" e o usu├írio diz "sexta", atualize a tarefa pendente.
18. REFER├èNCIA POR N├ÜMERO DE LISTA: Quando o usu├írio disser "n├║mero X", "a n├║mero X", "├® a X", "o primeiro", "a segunda", "o 3", etc., referindo-se a uma posi├º├úo em uma lista de tarefas exibida anteriormente:
   a. Procure na mensagem mais recente do assistente no hist├│rico um bloco [├ìNDICE:...] ÔÇö se encontrar, extraia o UUID da posi├º├úo X (formato X="<uuid>") e use-o diretamente como task_id
   b. Se houver resultado de ferramenta TaskList ou TaskSearch no hist├│rico com tasks_raw, use tasks_raw[X-1].id diretamente como task_id
   c. ├Ültimo recurso: leia o t├¡tulo da tarefa na posi├º├úo X na lista formatada do hist├│rico e use TaskSearch com esse t├¡tulo exato
   CR├ìTICO: NUNCA passe "n├║mero 2", "├® a 2", "a segunda", "n├║mero X" etc. como query para TaskSearch ÔÇö sempre resolva para o ID ou t├¡tulo real da tarefa.

ÔòÉÔòÉÔòÉ REGRAS DE SUBTAREFAS ÔòÉÔòÉÔòÉ
18. SUBTAREFAS PROATIVAS: Para QUALQUER tarefa ÔÇö incluindo as que t├¬m timer ÔÇö tente incluir pelo menos 2 a 3 subtarefas que ajudem o usu├írio a come├ºar. N├úo espere ele pedir. Timer e subtarefas N├âO s├úo excludentes: use ambos quando couber.
19. SUBTAREFAS PR├üTICAS: Gere passos curtos e acion├íveis (ex: "Separar material", "Revisar rascunho").
20. SUGEST├âO: Se a tarefa for muito complexa, crie as subtarefas iniciais e pergunte: "${userName}, dividi em algumas etapas pra voc├¬, quer que eu adicione mais alguma?"
21. GEST├âO: Voc├¬ tamb├®m pode usar TaskUpdate para adicionar subtarefas a uma tarefa que j├í existe. REGRA CR├ìTICA: ao usar TaskUpdate com o campo "subtasks", voc├¬ DEVE enviar a lista COMPLETA (existentes + novas). As subtarefas atuais de cada tarefa est├úo listadas no PAINEL DO USU├üRIO acima. Nunca envie apenas a subtarefa nova ÔÇö isso apagaria as anteriores.

ÔòÉÔòÉÔòÉ ETAPAS SEQUENCIAIS ÔåÆ UMA TAREFA COM SUBTAREFAS ÔòÉÔòÉÔòÉ
22. REGRA PRINCIPAL: Quando o usu├írio descreve uma SEQU├èNCIA de etapas relacionadas dentro da mesma atividade ou contexto, crie UMA ├║nica tarefa com subtarefas ÔÇö N├âO m├║ltiplas tarefas separadas.
   SEQUENCIAL (1 tarefa + subtarefas):
   - "preciso levar o carro na oficina, depois lavar, depois resolver o sistema"
   - "primeiro vou ao mercado, depois passo no banco, depois em casa"
   - etapas do mesmo projeto, do mesmo evento, do mesmo dia vinculado
   SEPARADAS (m├║ltiplas tarefas):
   - assuntos completamente distintos sem liga├º├úo temporal ("criar relat├│rio" + "ligar pro m├®dico" + "pagar conta")
   - tarefas de projetos ou pessoas diferentes
23. SUBTAREFA COM TIMER: quando cada etapa tem um tempo pr├│prio ("daqui 30 min", "daqui 4 horas"), passe timer_minutes em cada subtarefa. O timer_minutes ├® a partir de AGORA, n├úo cumulativo.
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
   - Informa├º├Áes sobre pessoas: "Jo├úo ├® meu chefe", "Maria cuida do backend"
   SALVAR MEMORIA E INVISIVEL: NUNCA diga "anotei essa informa├º├úo", "guardei isso", "vou lembrar disso". Apenas REAJA NATURALMENTE ao que a pessoa disse como um amigo faria. A mem├│ria ├® salva nos bastidores sem o usu├írio saber.
   Ex: Usu├írio diz "sou dev na Acme" ÔåÆ Responde "Massa! Dev tamb├®m ├® foda. No que posso te dar uma for├ºa?" (e N├âO "Anotei que voc├¬ trabalha na Acme!")

28. QUANDO SALVAR NO SEGUNDO CEREBRO (KnowledgeSave): Use quando o usu├írio disser:
   - "anota isso" / "guarda essa info" / "salva isso pra mim" ÔåÆ note
   - "tive uma ideia" / "ideia:" / "pensei em" ÔåÆ idea
   - "a senha ├®" / "o link ├®" / "o endere├ºo ├®" / "o telefone do X ├®" ÔåÆ reference
   - "decidimos que" / "ficou decidido" / "a decis├úo foi" ÔåÆ decision
   - Informa├º├Áes sobre uma pessoa/contato espec├¡fico ÔåÆ contact
   - "toda sexta eu fa├ºo" / "o processo ├®" / "o fluxo ├®" ÔåÆ routine
   DIFEREN├çA ENTRE TAREFA E CONHECIMENTO:
   - TAREFA = algo que o usu├írio PRECISA FAZER (a├º├úo futura) ÔåÆ TaskCreate
   - CONHECIMENTO = algo que o usu├írio quer GUARDAR/LEMBRAR (informa├º├úo) ÔåÆ KnowledgeSave
   - Se amb├¡guo (ex: "reuni├úo com Jo├úo: decidimos X e preciso fazer Y"):
     ÔåÆ KnowledgeSave para a decis├úo + TaskCreate para a a├º├úo

29. QUANDO BUSCAR (MemoryRecall / KnowledgeSearch): Use quando o usu├írio perguntar:
   - "voc├¬ lembra...", "o que eu te falei sobre...", "quando foi que..."
   - "o que eu anotei sobre...", "tenho alguma nota sobre..."
   - "quais s├úo minhas ideias?", "o que eu sei sobre o Jo├úo?"
   - "qual era a senha do...", "qual o telefone do..."
   Busque e responda como se VOCE lembrasse naturalmente.

30. CAPTURA PROATIVA: Quando o usu├írio mencionar informa├º├Áes importantes DURANTE uma conversa sobre tarefas, salve como mem├│ria SEM INTERROMPER o fluxo. Ex: se ele diz "preciso ligar pro Jo├úo, ele ├® meu gerente novo", crie a tarefa E salve a mem├│ria sobre Jo├úo em paralelo.

ÔòÉÔòÉÔòÉ TIMER / LEMBRETE R├üPIDO ÔòÉÔòÉÔòÉ
- Se o usu├írio mencionar express├úo de tempo curto junto com uma tarefa, use o campo timer_minutes no TaskCreate ou TaskBatchCreate.
- Converta QUALQUER varia├º├úo de:
  "em 10 minutos" / "daqui 10 minutos" / "daqui 10 min"    ÔåÆ timer_minutes: 10
  "daqui uns 3 minutinho" / "uns 3 minutinhos"              ÔåÆ timer_minutes: 3  ÔåÉ use o n├║mero EXATO, n├úo arredonde
  "daqui uns 5 minutinhos" / "em uns 5 minutos"             ÔåÆ timer_minutes: 5
  "em meia hora" / "daqui meia hora"                        ÔåÆ timer_minutes: 30
  "em 45 minutos" / "daqui 45 minutos"                      ÔåÆ timer_minutes: 45
  "em 1 hora" / "daqui 1 hora" / "daqui uma hora"           ÔåÆ timer_minutes: 60
  "em 1 hora e meia" / "daqui uma hora e meia"              ÔåÆ timer_minutes: 90
  "em 1 hora e 30 minutos" / "daqui 1h30"                   ÔåÆ timer_minutes: 90
  "em 2 horas" / "daqui 2 horas" / "daqui duas horas"       ÔåÆ timer_minutes: 120
  "daqui 2 horas e meia"                                    ÔåÆ timer_minutes: 150
  "daqui 3 horas"                                           ÔåÆ timer_minutes: 180
- O sistema enviar├í uma notifica├º├úo no WhatsApp quando o timer expirar.
- Ao confirmar a cria├º├úo, mencione o timer: "Anotado! Vou te avisar em 10 minutos." ou "Vou te lembrar em 1 hora e meia."
- N├âO use timer_minutes para prazos de dias/semanas ÔÇö apenas para alertas em minutos/horas curtos (at├® 24h).
- Para HOR├üRIOS ABSOLUTOS ("├ás 16h", "as 14h30", "9h da manh├ú"):
  N├âO tente calcular a diferen├ºa de minutos ÔÇö o sistema j├í calcula automaticamente.
  Basta usar timer_minutes com qualquer valor positivo (ex: 1) ÔÇö o sistema vai sobrescrever com o valor correto.
- TEMPO VAGO: Se o usu├írio mencionar tempo vago como "mais tarde", "depois", "em breve", "quando der", "quando puder", "uma hora dessas", "num momento", N├âO invente um hor├írio ou timer_minutes. Crie a tarefa SEM timer_minutes e pergunte depois:
  "${userName}, anotei! *[tarefa]* ficou registrado. Quer que eu te avise num hor├írio espec├¡fico?"
  NUNCA adivinhe minutos quando o hor├írio n├úo for expl├¡cito.

ÔòÉÔòÉÔòÉ LEMBRETE DE ANTECED├èNCIA (DIAS) ÔòÉÔòÉÔòÉ
- Use reminder_days_before quando o usu├írio pedir lembrete com dias de anteced├¬ncia:
  "me lembra 3 dias antes" / "avisa com 2 dias de anteced├¬ncia" / "lembrete 1 semana antes"
- Requer que due_date esteja preenchido na tarefa.
- Ao confirmar: "Anotado! Vou te avisar X dia(s) antes do prazo." (substitua X pelo n├║mero). NUNCA use emojis.
- TIMER + SUBTAREFAS: mesmo quando h├í timer, gere subtarefas normalmente. Os campos timer_minutes e subtasks s├úo independentes e devem ser preenchidos juntos quando a tarefa tiver etapas.

ÔòÉÔòÉÔòÉ REGRAS DE PRIORIDADE ÔòÉÔòÉÔòÉ
- "importante", "urgente", "cr├¡tico" ÔåÆ high
- "de boa", "sem pressa", "quando der" ÔåÆ low
- Demais casos ÔåÆ medium

ÔòÉÔòÉÔòÉ REGRAS DE DATAS ÔòÉÔòÉÔòÉ
O ANO ATUAL ├® ${dates.currentYear}. NUNCA use anos passados.
- "hoje" ÔåÆ ${dates.todayISO}
- "amanh├ú" ÔåÆ ${dates.tomorrowISO}
- "depois de amanh├ú" ÔåÆ ${dates.dayAfterTomorrowISO}
- "semana que vem" ÔåÆ ${dates.nextWeekISO}
- "m├¬s que vem" ÔåÆ ${dates.nextMonthISO}
SEMPRE passe due_date como YYYY-MM-DD nas ferramentas.`;

  // ÔöÇÔöÇ Perfil comportamental (se dispon├¡vel) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  let behavioralContext = '';
  try {
    behavioralContext = await getProfileContext(userId);
  } catch { /* silently skip if table doesn't exist yet */ }

  // ÔöÇÔöÇ Mem├│ria de longo prazo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  // IMPORTANTE: N├âO carrega memory context aqui. Ele ├® constru├¡do por
  // mensagem (precisa da userMessage para recall contextual) e anexado
  // ao prompt no queryEngineLoop logo antes da chamada do LLM.

  // ÔöÇÔöÇ Insights proativos pendentes ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
  let insightsContext = '';
  try {
    const insights = await getPendingInsights(userId, 2);
    if (insights.length > 0) {
      insightsContext = `\nÔòÉÔòÉÔòÉ INSIGHTS PROATIVOS (USE COM NATURALIDADE) ÔòÉÔòÉÔòÉ
Voce detectou os seguintes padroes sobre ${userName}. Mencione NO MAXIMO 1 por resposta, e SOMENTE quando for relevante ao contexto da conversa (nao force):
${insights.map(i => `- [${i.insight_type}]: ${i.content}`).join('\n')}

REGRAS DE USO:
- NAO mencione todos de uma vez ÔÇö escolha o mais relevante ao momento.
- Integre de forma NATURAL ("Ei, percebi que...", "A proposito...").
- Se o usuario estiver focado em outra coisa, IGNORE os insights nessa resposta.
- Se usar um insight, seja gentil e ofere├ºa ajuda concreta.`;

      // Marca como entregues (ser├úo vistos pela IA nessa resposta)
      for (const ins of insights) {
        markInsightDelivered(ins.id).catch(() => { });
      }
    }
  } catch { /* silently skip */ }

  // ÔöÇÔöÇ Monta prompt completo (sem memory context ÔÇö injetado por mensagem) ÔöÇÔöÇÔöÇÔöÇ
  let fullPrompt = prompt;
  if (behavioralContext) fullPrompt += `\n\n${behavioralContext}`;
  if (insightsContext) fullPrompt += insightsContext;

  contextCache.set(userId, { prompt: fullPrompt, ts: Date.now() });
  return fullPrompt;
}

// ÔöÇÔöÇ Detec├º├úo de inten├º├úo de cria├º├úo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const CREATION_TRIGGERS = [
  /\bme\s+lembr/i,           // me lembra, me lembrar
  /\bme\s+avis/i,            // me avisa
  /\bn├úo\s+deixa\s+(eu\s+)?esquecer/i,
  /\banota\s+(a├¡|isso|pra mim)\b/i,   // "anota a├¡", "anota isso" (precisa do complemento)
  /\bregistra\b/i,            // "registra" (verbo imperativo, n├úo "registrar" em contexto gen├®rico)
  /\bpreciso\s+(fazer|de|comprar|ligar|ir|criar|mandar|enviar|resolver|terminar|come[c├º]ar|preparar|ver|falar|conversar|gravar|verificar|estudar|analisar|checar|testar|rever|apresentar)/i,
  /\btenho\s+que/i,
  /\btenho\s+uma\s+tarefa/i,
  /\bcri(a|ar|ei)\s+(uma\s+)?tarefa/i,
  /\badiciona(r)?\s+(uma\s+)?tarefa/i,  // "adiciona tarefa" (precisa de "tarefa" junto)
  /\blembr(ar|e)\s+(de|que)/i,
  /\bsalva\s+(isso|a[i├¡])\b/i,  // S├│ "salva isso" ou "salva a├¡" (n├úo "salvar" gen├®rico)
  /\bn├úo\s+(me\s+)?esquecer/i,
  /\b(quero|queria|gostaria\s+de)\s+(uma\s+)?tarefa\b/i,   // "queria uma tarefa pro Fernando"
  /\btarefa\s+(pro|pra|para)\s+/i,                          // "tarefa pro Fernando", "tarefa pra equipe"
];

// Padr├Áes que indicam conversa casual / N├âO ├® pedido de cria├º├úo de tarefa
const CONVERSATIONAL_PATTERNS = [
  /\b(voc├¬|voce|vc)\s+(sabe|pode|consegue|├®|eh)\b/i,  // "voc├¬ sabe...", "voc├¬ pode..."
  /\b(fala|oi|eai|e\s+a[i├¡]|opa|salve|bom\s+dia|boa\s+tarde|boa\s+noite)\b/i,  // sauda├º├Áes
  /\b(como\s+vai|tudo\s+(bem|certo|joia|tranquilo))\b/i,
  /\b(acabei\s+de|eu\s+fiz|eu\s+subi|fiz\s+uma)\b/i,  // relatando algo que J├ü fez
  /\b(o\s+que\s+(voc├¬|vc)\s+(acha|pensa))\b/i,
  /\b(estou\s+(falando|dizendo|contando|explicando))\b/i,
  /\b(n├úo\s+estou\s+falando|n├úo\s+estou\s+pedindo)\b/i,
  /\b(corrige|corrija)\b/i,  // pedindo corre├º├úo, n├úo tarefa
];

function isConversationalMessage(message) {
  // Mensagens longas (>200 chars) com tom de conversa s├úo provavelmente papo, n├úo comando
  const isLong = message.length > 200;
  const matchesConversational = CONVERSATIONAL_PATTERNS.some(re => re.test(message));

  // Se tem m├║ltiplos "preciso" (ÔëÑ2), ├® lista de tarefas mesmo com sauda├º├úo
  const lower = message.toLowerCase();
  const hasMultiplePreciso = (lower.match(/\bpreciso\b/g) || []).length >= 2;
  if (hasMultiplePreciso) return false;

  // Se tem a├º├úo clara de tarefa junto com sauda├º├úo, n├úo ├® conversa pura
  const hasTaskAction = CREATION_TRIGGERS.some(re => re.test(message));
  if (matchesConversational && hasTaskAction) return false;

  if (matchesConversational) return true;
  // Mensagem muito longa sem verbos imperativos claros = provavelmente conversa
  if (isLong && !/(^|\.\s*)(cria|anota|registra|salva|adiciona|me\s+lembra)\b/i.test(message)) return true;
  return false;
}

// Padr├Áes fortes de cria├º├úo que SEMPRE vencem a detec├º├úo conversacional,
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
  // Comandos expl├¡citos sempre t├¬m prioridade sobre sauda├º├Áes/conversa
  if (STRONG_CREATION_OVERRIDES.some(re => re.test(message))) return true;
  // Se ├® claramente conversa casual SEM comando de cria├º├úo, N├âO ├® inten├º├úo de cria├º├úo
  if (isConversationalMessage(message)) return false;
  return CREATION_TRIGGERS.some(re => re.test(message));
}

// Detecta se a mensagem descreve m├║ltiplas tarefas distintas (ex: planejamento semanal)
export function hasMultipleTasks(message) {
  const lower = message.toLowerCase();
  // M├║ltiplos dias da semana mencionados ÔåÆ claramente m├║ltiplas tarefas
  const weekdays = ['segunda', 'ter├ºa', 'terca', 'quarta', 'quinta', 'sexta', 's├íbado', 'sabado', 'domingo'];
  if (weekdays.filter(d => lower.includes(d)).length >= 2) return true;
  // M├║ltiplos "tamb├®m" indicam lista de itens distintos
  if ((lower.match(/\btamb├®m\b/g) || []).length >= 2) return true;
  // M├║ltiplos "preciso" indicam m├║ltiplas tarefas distintas
  if ((lower.match(/\bpreciso\b/g) || []).length >= 2) return true;
  // N├║mero expl├¡cito de coisas/tarefas: "tr├¬s coisas", "2 tarefas", "quatro pontos"
  if (/\b(duas?|tr[e├¬]s|quatro|cinco|[2-9])\s+(coisas?|tarefas?|itens?|pontos?|assuntos?|t[o├│]picos?)\b/.test(lower)) return true;
  // Sequ├¬ncia com "primeiro" + outro marcador
  if (/\bprimeiro\b/.test(lower) && /\bsegundo\b|\bterceiro\b|\bdepois\b|\btamb├®m\b|\bal├®m\b/.test(lower)) return true;
  // Enumera├º├úo numerada: "1. ... 2. ..."
  if (/\d+\.\s+\w/.test(lower) && /\d+\.\s+\w.+\d+\.\s+\w/s.test(lower)) return true;
  return false;
}

function normalizeTextForIntent(message) {
  return String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getSimpleTaskListRequest(message) {
  const lower = normalizeTextForIntent(message);
  // Removemos "tarefas?" e "pendentes?" do hasQuestion porque causava falsos positivos muito f├íceis.
  // Focamos em verbos e pronomes interrogativos claros ou "o que tenho".
  const hasQuestion = /\b(quais?|qual|listar?|lista|mostra|mostrar|ver|cad[e├¬]|cade|o\s+que\s+tenho)\b/.test(lower);
  const asksTasks = /\b(tarefas?|pendencias?|pendentes|afazeres?|coisas?\s+pra\s+fazer|tenho\s+pra\s+fazer|tenho\s+para\s+fazer)\b/.test(lower);

  // "?" s├│ conta se estiver PERTO da men├º├úo de tarefas (ex: "quais tarefas?")
  // N├âO conta "tudo bem?" seguido de "queria uma tarefa" ÔÇö o "?" ├® da sauda├º├úo
  const hasQuestionMark = /tarefa[s]?\s*\?|pendente[s]?\s*\?|\?\s*$/.test(lower);

  // Inten├º├úo de cria├º├úo SEMPRE tem prioridade sobre listagem
  if (isCreationIntent(message)) return null;
  if (!((hasQuestion && asksTasks) || (hasQuestionMark && asksTasks))) return null;

  return {
    due_date: /\b(hoje|pra\s+hoje|para\s+hoje)\b/.test(lower) ? getTodayISO() : undefined,
  };
}

function buildSimpleTaskListResponse(userMessage, userName, result, filter = {}) {
  const greeting = /\bbom\s+dia\b/i.test(userMessage)
    ? 'Bom dia'
    : /\bboa\s+tarde\b/i.test(userMessage)
      ? 'Boa tarde'
      : /\bboa\s+noite\b/i.test(userMessage)
        ? 'Boa noite'
        : null;
  const prefix = greeting ? `${greeting}, ${userName}! ` : `${userName}, `;
  const scope = filter.due_date ? 'pra hoje' : 'pendentes';

  if (!result?.success) {
    return `${prefix}n├úo consegui buscar suas tarefas agora. Tenta de novo em alguns instantes.`;
  }

  if (!result.count) {
    return filter.due_date
      ? `${prefix}hoje est├í tranquilo: n├úo encontrei tarefas pendentes pra hoje.`
      : `${prefix}n├úo encontrei tarefas pendentes no momento.`;
  }

  return `${prefix}voc├¬ tem ${result.count} tarefa${result.count > 1 ? 's' : ''} ${scope}:\n${result.formatted_list}`;
}

const TASK_GLUE_WORDS = new Set([
  'pra', 'para', 'de', 'da', 'do', 'das', 'dos', 'que', 'em',
  'daqui', 'aqui', 'uns', 'umas', 'um', 'uma',
]);

function cleanupTaskTitle(text) {
  const words = String(text || '')
    .replace(/\b(n[a├ú]o|n├úo)\b/gi, ' ')
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
  const num = '(?:\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[e├¬]s|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
  const prefix = '(?:\\b(?:daqui(?:\\s+a)?|de\\s+aqui(?:\\s+a)?|em)\\s+(?:uns?|umas?)?\\s*)?';
  const hourWord = `(?:meia\\s+hora|${num}\\s+hora[s]?(?:\\s+e\\s+meia|\\s+e\\s+${num}\\s+min(?:utinho[s]?|uto[s]?)?)?)`;
  const compactHour = '(?:\\d+h\\d+(?:min(?:uto[s]?)?)?|\\d+h\\b)';
  const minuteWord = `(?:${num}\\s+min(?:utinho[s]?|uto[s]?)?)`;
  return new RegExp(`${prefix}(?:${compactHour}|${hourWord}|${minuteWord})`, 'gi');
}

function stripCreationPreamble(text) {
  return String(text || '')
    .replace(/^\s*(cria(?:r(?:am)?)?(?:\s+uma?)?\s+tarefa|adiciona(?:r)?(?:\s+uma?)?\s+tarefa|me\s+lembr(?:a|ar|e)(?:\s+de|\s+que)?|me\s+avis(?:a|ar)(?:\s+de|\s+que)?|n[a├ú]o\s+deixa\s+(?:eu\s+)?esquecer(?:\s+de|\s+que)?|anota(?:\s+a[i├¡]|\s+isso|\s+pra\s+mim)?|registr(?:a|ar)|salva(?:\s+isso|\s+a[i├¡])?|tenho\s+que|preciso(?:\s+de)?)\s+/i, ' ');
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
    .replace(/\b├ás?\s*$/i, ' ')
    .replace(/\b(n[a├ú]o|n├úo)\b[^.?!]*$/i, ' ');

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
  return `${userName},${timer} mas n├úo entendi o nome da tarefa. Me manda s├│ o que ├® pra lembrar.`;
}
// Extrai subt├│picos da mensagem quando o modelo n├úo gerou subtarefas
// Cobre padr├Áes como "sobre X, sobre Y", "primeiro X, segundo Y", "X, Y e Z"
function extractSubtasksFromMessage(message) {
  const lower = message.toLowerCase();

  // Padr├úo 1: "primeiro... segundo... terceiro..."
  const ordered = [...lower.matchAll(/\b(primeiro|segundo|terceiro|quarto|quinto)\b[,:]?\s*([^,.;]+)/g)];
  if (ordered.length >= 2) {
    return ordered.map(m => capitalize(m[2].trim().replace(/\s+/g, ' ').substring(0, 60)));
  }

  // Padr├úo 2: m├║ltiplos "sobre X" na mesma frase
  const sobreItems = [...lower.matchAll(/\bsobre\s+([^,;.]+)/g)];
  if (sobreItems.length >= 2) {
    return sobreItems.map(m => capitalize(m[1].trim().replace(/\s+/g, ' ').substring(0, 60)));
  }

  // Padr├úo 3: lista com v├¡rgulas e "e" no final ÔÇö "X, Y, Z e W"
  // S├│ ativa se h├í pelo menos 3 itens e eles s├úo curtos (n├úo s├úo frases longas)
  const listMatch = message.match(/\b([A-Za-z├Ç-├║]{3,}(?:\s+[A-Za-z├Ç-├║]+){0,4}),\s*([A-Za-z├Ç-├║]{3,}(?:\s+[A-Za-z├Ç-├║]+){0,4}),\s*([A-Za-z├Ç-├║]{3,}(?:\s+[A-Za-z├Ç-├║]+){0,4})(?:\s+e\s+([A-Za-z├Ç-├║]{3,}(?:\s+[A-Za-z├Ç-├║]+){0,4}))?\b/);
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

// ÔöÇÔöÇ Resolu├º├úo de datas relativas na mensagem do usu├írio ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const WEEKDAY_MAP = {
  'segunda': 1, 'segunda-feira': 1,
  'ter├ºa': 2, 'ter├ºa-feira': 2, 'terca': 2, 'terca-feira': 2,
  'quarta': 3, 'quarta-feira': 3,
  'quinta': 4, 'quinta-feira': 4,
  'sexta': 5, 'sexta-feira': 5,
  's├íbado': 6, 'sabado': 6,
  'domingo': 0,
};

/**
 * Extrai a primeira data ISO detectada na mensagem.
 * Retorna string YYYY-MM-DD ou null se n├úo houver refer├¬ncia de data.
 */
function extractDateFromMessage(message) {
  const todayISO = getTodayISO();
  const spNow = new Date(todayISO + 'T12:00:00-03:00');
  const fmt = (d) => d.toISOString().split('T')[0];
  const lower = message.toLowerCase();

  if (/\bdepois de amanh├ú\b|\bdepois de amanha\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 2); return fmt(d);
  }
  if (/\bamanh├ú\b|\bamanha\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 1); return fmt(d);
  }
  if (/\bhoje\b/.test(lower)) {
    return todayISO;
  }
  if (/\bsemana que vem\b|\bpr├│xima semana\b|\bproxima semana\b/.test(lower)) {
    const d = new Date(spNow); d.setDate(d.getDate() + 7); return fmt(d);
  }
  if (/\bm├¬s que vem\b|\bmes que vem\b|\bpr├│ximo m├¬s\b|\bproximo mes\b/.test(lower)) {
    const d = new Date(spNow.getFullYear(), spNow.getMonth() + 1, 1); return fmt(d);
  }

  // Dia da semana: "na sexta", "essa ter├ºa", "no s├íbado"
  for (const [name, wday] of Object.entries(WEEKDAY_MAP)) {
    const re = new RegExp(`\\b(n[ao]s?\\s+|ess[ae]\\s+)?${name}\\b`);
    if (re.test(lower)) {
      const d = new Date(spNow);
      const diff = (wday - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return fmt(d);
    }
  }

  // "dia X" ou "dia X de m├¬s"
  const diaMatch = lower.match(/\bdia\s+(\d{1,2})(?:\s+de\s+(\w+))?\b/);
  if (diaMatch) {
    const day = parseInt(diaMatch[1], 10);
    const monthNames = ['janeiro', 'fevereiro', 'mar├ºo', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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

// ÔöÇÔöÇ Extra├º├úo de timer em minutos da mensagem ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const PT_NUM_WORDS = {
  'um': 1, 'uma': 1, 'dois': 2, 'duas': 2,
  'tr├¬s': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
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
  const N = '(\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[e├¬]s|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
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

// ÔöÇÔöÇ Detec├º├úo de tempo vago ("mais tarde", "depois", "em breve") ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
const VAGUE_TIME_PATTERNS = [
  /\bmais\s+tarde\b/i,
  /\bem\s+breve\b/i,
  /\bquando\s+(?:der|puder|poss[i├¡]vel)\b/i,
  /\buma\s+hora\s+dessas\b/i,
  /\bnum\s+momento\b/i,
  /\balguma\s+hora\b/i,
];

function hasVagueTimeReference(message) {
  const lower = message.toLowerCase();
  // "depois de amanh├ú" ├® data concreta, n├úo ├® vago
  if (/\bdepois\s+de\s+amanh[a├ú]\b/i.test(lower)) return false;
  return VAGUE_TIME_PATTERNS.some(re => re.test(lower));
}

/**
 * Extrai o n├║mero de minutos de timer a partir de express├Áes naturais em portugu├¬s.
 * Exemplos cobertos:
 *   "daqui 2 horas"            ÔåÆ 120
 *   "daqui meia hora"          ÔåÆ 30
 *   "em 30 minutos"            ÔåÆ 30
 *   "daqui uma hora e meia"    ÔåÆ 90
 *   "em 2 horas e 30 minutos"  ÔåÆ 150
 *   "daqui 1h30"               ÔåÆ 90
 *   "em 45 min"                ÔåÆ 45
 *   "daqui duas horas"         ÔåÆ 120
 * Retorna inteiro de minutos ou null se nenhuma express├úo for encontrada.
 */
function extractTimerMinutesFromMessage(message) {
  const lower = message.toLowerCase();

  if (/\b(n[a├ú]o|n├úo)\b/.test(lower)) {
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
  const N = '(\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[e├¬]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)';
  // "uns/umas" ├® opcional ap├│s o prefixo (ex: "daqui uns 3 minutinhos")
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

  // 7. Hor├írio absoluto: "├ás 9h", "├ás 9 horas", "├ás 21h30", "9h da manh├ú/tarde/noite"
  //    S├│ ativa se houver marcador claro de hor├írio (n├úo pega datas ou quantidades soltas)
  const absMatch = lower.match(
    /(?:├ás\s+|as\s+)(\d{1,2})(?:[h:](\d{2}))?\s*(?:horas?)?\s*(?:da\s+(manh[a├ú]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})[h:](\d{2})\s*(?:da\s+(manh[a├ú]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})()\s*h(?:oras?)?\s*(?:da\s+(manh[a├ú]|tarde|noite))\b/
  );

  if (absMatch) {
    let targetHour = parseInt(absMatch[1]);
    const targetMin = parseInt(absMatch[2] || '0');
    const period = (absMatch[3] || '').replace('manh├ú', 'manha');

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
      // Sem per├¡odo: se o hor├írio j├í passou hoje, assume PM (noite)
      const targetTotalMins = targetHour * 60 + targetMin;
      if (curTotalMins >= targetTotalMins) targetHour += 12;
    }

    const targetTotalMins = targetHour * 60 + targetMin;
    let diff = targetTotalMins - curTotalMins;
    if (diff <= 0) diff += 24 * 60; // pr├│xima ocorr├¬ncia

    // Sanidade: ignora se resultar em valor absurdo (> 24h ou <= 0)
    if (diff > 0 && diff < 1440) return diff;
  }

  return null;
}

// ÔöÇÔöÇ Extrai timer_at absoluto (ISO) para hor├írios como "├ás 16h" ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// Retorna ISO timestamp preciso em vez de minutos relativos (evita drift)
function extractAbsoluteTimerAt(message) {
  const lower = message.toLowerCase();

  const absMatch = lower.match(
    /(?:├ás\s+|as\s+)(\d{1,2})(?:[h:](\d{2}))?\s*(?:horas?)?\s*(?:da\s+(manh[a├ú]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})[h:](\d{2})\s*(?:da\s+(manh[a├ú]|tarde|noite))?/
  ) || lower.match(
    /\b(\d{1,2})()\s*h(?:oras?)?\s*(?:da\s+(manh[a├ú]|tarde|noite))\b/
  );

  if (!absMatch) return null;

  let targetHour = parseInt(absMatch[1]);
  const targetMin = parseInt(absMatch[2] || '0');
  const period = (absMatch[3] || '').replace('manh├ú', 'manha');

  const now = new Date();
  const spFull = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(now);
  const [curH, curM, curS = 0] = spFull.match(/\d+/g).map(Number);

  // AM/PM disambiguation (mesma l├│gica de extractTimerMinutesFromMessage)
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

// ÔöÇÔöÇ Resposta r├ípida para muta├º├Áes (evita chamada LLM extra) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function buildMutationResponse(toolName, result, userName) {
  if (!result.success) return null;

  switch (toolName) {
    case 'TaskBatchCreate':
    case 'TaskCreate':
      // Deixa o LLM gerar a resposta de confirmação naturalmente
      // em vez de usar templates fixos e robóticos
      return null;
    case 'TaskUpdate': {
      const isDone = result.task_status === 'conclu├¡da';
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

// ÔöÇÔöÇ Query Engine Loop ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

// Ferramentas que modificam dados (invalidam cache)
const MUTATING_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskDelete', 'TaskBatchCreate']);

// Gera ACK personalizado com chamada LLM m├¡nima (roda em paralelo com history/context)
async function generateAck(userMessage, userName) {
  try {
    const shortName = String(userName || 'voc├¬').split(' ')[0];
    const { response } = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `Voc├¬ ├® o Lui, assistente de produtividade no WhatsApp. ${shortName} acabou de te mandar uma mensagem (texto ou ├íudio). Gere UMA frase curt├¡ssima de reconhecimento que mostre que voc├¬ ENTENDEU o ASSUNTO, antes de come├ºar a processar.

REGRAS R├ìGIDAS:
- UMA frase s├│, M├üXIMO 10 palavras
- Portugu├¬s brasileiro coloquial, natural e levemente espont├óneo
- Mencione brevemente o ASSUNTO espec├¡fico da mensagem (n├úo fale gen├®rico)
- N├âO confirme conclus├úo ("feito", "anotei", "criei") ÔÇö voc├¬ ainda est├í PROCESSANDO
- N├âO use emojis
- N├âO use o nome em toda mensagem (alterne)
- Tom de parceiro de organiza├º├úo, n├úo rob├┤

EXEMPLOS DE BOM ACK (notar que cada um menciona o assunto real):
- Mensagem: "preciso lembrar de pagar a conta de luz amanh├ú" ÔåÆ "Show, deixa eu anotar essa da conta de luz..."
- Mensagem: "atazanar minha cachorrinha daqui 3 minutinhos" ÔåÆ "Aaah, vou marcar essa da cachorrinha j├í j├í..."
- Mensagem: "amanh├ú ├ás 14h tenho consulta no dentista" ÔåÆ "Beleza, deixa eu colocar essa do dentista pra amanh├ú..."
- Mensagem: "preciso comprar p├úo, leite e ovos" ÔåÆ "T├┤ separando essas da compra aqui..."

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
  'isso', 'ai', 'a\u00ed', 'agora', 'hoje', 'amanha', 'amanh\u00e3',
  'lembrar', 'lembra', 'lembre', 'avisar', 'avisa', 'anotar', 'anota',
]);

function extractAckTopic(userMessage) {
  const cleaned = String(userMessage || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(?:uns?|umas?)?\s*\d+(?:[,.]\d+)?\s*(?:h|hora[s]?|min(?:utinho[s]?|uto[s]?)?)\b/gi, ' ')
    .replace(/\b(daqui(?:\s+a)?|de\s+aqui(?:\s+a)?|em)\s+(?:uns?|umas?)?\s*(um|uma|dois|duas|tr[e\u00ea]s|quatro|cinco|seis|sete|oito|nove|dez|meia)\s*(?:hora[s]?|min(?:utinho[s]?|uto[s]?)?)\b/gi, ' ')
    .replace(/^\s*(me\s+lembr(?:a|ar|e)(?:\s+de|\s+que)?|me\s+avis(?:a|ar)(?:\s+de|\s+que)?|anota(?:\s+a[i\u00ed]|\s+isso|\s+pra\s+mim)?|registr(?:a|ar)|salva(?:\s+isso|\s+a[i\u00ed])?|tenho\s+que|preciso(?:\s+de)?|cria(?:r)?(?:\s+uma)?\s+tarefa(?:\s+pra|\s+para)?|adiciona(?:r)?(?:\s+uma)?\s+tarefa?)\s+/i, ' ')
    .replace(/\b(hoje|amanh[\u00e3a]|depois\s+de\s+amanh[\u00e3a]|semana\s+que\s+vem|m[e\u00ea]s\s+que\s+vem)\b/gi, ' ')
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
  const topic = extractAckTopic(userMessage);
  const topicPart = topic ? `essa de ${topic}` : 'isso';
  const templates = hasMultipleTasks(userMessage)
    ? [
      `Certo, ${shortName}! Vou separar ${topicPart} por partes.`,
      `Recebi tudo, ${shortName}. Organizando ${topicPart} agora.`,
      `Perfeito, ${shortName}. Montando ${topicPart} direitinho.`,
    ]
    : [
      `Certo, ${shortName}. Peguei ${topicPart}, vou organizar.`,
      `Entendi ${topicPart}, ${shortName}. Um instante.`,
      `Recebi ${topicPart}, ${shortName}. Ja vou anotar.`,
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
  const emit = (type, status, data = {}) => {
    if (sseId) {
      agentEvents.emit('status', { sseId, type, status, data: { ...data, timestamp: new Date().toISOString() } });
    }
  };

  const finishAndReturn = (content) => {
    emit('finished', 'Processamento concluído.', { 
      latency_ms: trace.latency_ms,
      tool_count: trace.tool_count,
      model: trace.model 
    });
    return returnTelemetry ? { content, telemetry: trace } : content;
  };

  emit('thinking', 'Iniciando processamento da mensagem...');
  // S├│ envia ack para mensagens que envolvem a├º├úo (cria├º├úo de tarefas, m├║ltiplos itens)
  // Sauda├º├Áes, apresenta├º├Áes e conversa geral N├âO precisam de ack
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

  if (simpleTaskListRequest) {
    try {
      emit('processing', 'Detectada intenção de listagem (atalho rápido)...');
      const startedAt = Date.now();
      const result = await executeTool('TaskList', {
        limit: 10,
        ...(simpleTaskListRequest.due_date ? { due_date: simpleTaskListRequest.due_date } : {}),
      }, { userId });
      const content = buildSimpleTaskListResponse(userMessage, userName, result, simpleTaskListRequest);
      const history = await getHistory(sessionId);

      trace.provider = 'direct';
      trace.model = 'task-list';
      trace.latency_ms += Date.now() - startedAt;
      trace.tool_count += 1;

      // Anexa ├¡ndice de IDs ao hist├│rico para que o LLM possa resolver refer├¬ncias
      // num├®ricas futuras ("├® a n├║mero 2") sem precisar chamar TaskSearch
      const taskIndexBlock = result.tasks_raw?.length
        ? `\n[├ìNDICE:${result.tasks_raw.map((t, i) => `${i + 1}="${t.id}"`).join('|')}]`
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
      const result = await executeTool('TaskCreate', simpleTaskCreateRequest.args, { userId });
      trace.tool_count += 1;
      if (result.success) invalidateContextCache(userId);
      content = buildMutationResponse('TaskCreate', result, userName)
        || (result.success
          ? `Anotado, ${userName}! *${result.task_title}* ficou registrado.`
          : `${userName}, n├úo consegui criar essa tarefa agora. Tenta de novo em instantes.`);
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
  // Busca hist├│rico, contexto e mem├│ria em paralelo ÔÇö custo zero extra
  emit('context', 'Carregando histórico, contexto do sistema e memórias...');
  const [history, staticSystemPrompt, memoryContext] = await Promise.all([
    getHistory(sessionId),
    getSystemContext(userId, userName),
    getMemoryContext(userId, userMessage).catch((err) => {
      console.error('[QueryEngine] getMemoryContext falhou:', err.message);
      return '';
    }),
  ]);
  emit('context_loaded', 'Contexto carregado com sucesso.');
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
      // Na 1┬¬ chamada com inten├º├úo de cria├º├úo, for├ºa a ferramenta diretamente (evita fallback)
      const isFirstCall = toolTurns === 0;
      const currentToolChoice = (preferredTool && isFirstCall)
        ? { type: 'function', function: { name: preferredTool } }
        : 'auto';
      // max_tokens: menor para chamadas de tool, menor ainda para gera├º├úo de resposta
      const currentMaxTokens = isFirstCall
        ? (multipleTasksIntent ? 900 : 450)
        : 250;

      emit('llm_call', toolTurns > 0 ? `Refinando resposta (rodada ${toolTurns})...` : 'Consultando modelo de linguagem...', { toolTurns });
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

      // Verifica se o modelo quer chamar ferramentas
      const hasToolCalls = assistantMessage.tool_calls?.length > 0;

      if (hasToolCalls) {
        emit('tool_call', `Executando ${assistantMessage.tool_calls.length} ferramenta(s)...`, { 
          tools: assistantMessage.tool_calls.map(tc => tc.function.name) 
        });
        if (toolTurns >= MAX_TOOL_TURNS) {
          const limitMsg = `Eita ${userName}, muita coisa de uma vez! Me manda um pedido por vez que fica melhor.`;
          await saveHistory(sessionId, [
            ...messages.filter(m => m.role !== 'system'),
            { role: 'assistant', content: limitMsg },
          ]);
          return limitMsg;
        }

        // Remove campos n├úo-padr├úo (ex: reasoning_content do deepseek) incompat├¡veis com outros providers
        const { reasoning_content, ...cleanAssistantMessage } = assistantMessage;
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

            // SEMPRE sobrescreve timer_minutes com o valor extra├¡do por regex (mais preciso que o LLM)
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

            // Injeta timer_at_override para hor├írios absolutos (mais preciso que timer_minutes)
            if (resolvedTimerAt) {
              if (toolCall.function.name === 'TaskCreate') {
                args.timer_at_override = resolvedTimerAt;
                console.log(`[TimerAtInject] timer_at_override=${resolvedTimerAt} injetado em TaskCreate`);
              }
            }

            // Salva a mensagem original do usu├írio para exibi├º├úo no painel web
            if (toolCall.function.name === 'TaskCreate' || toolCall.function.name === 'TaskBatchCreate') {
              if (sourceChannel === 'whatsapp') {
                args.whatsapp_message = userMessage;
              }
              args.source = sourceChannel === 'whatsapp' ? 'whatsapp' : 'user';
            }

            // Injeta subtarefas se o modelo n├úo gerou nenhuma e a mensagem tem sub-t├│picos detect├íveis
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

            // Auto-recovery: TaskUpdate/TaskDelete com UUID inv├ílido ou n├úo encontrado ÔåÆ
            // busca pelo nome na mensagem do usu├írio e retenta com o ID real
            if (
              !result.success &&
              (toolCall.function.name === 'TaskUpdate' || toolCall.function.name === 'TaskDelete') &&
              result._hint?.includes('n├úo encontrada')
            ) {
              console.log(`[AutoRecover] ID inv├ílido em ${toolCall.function.name} ÔÇö buscando por t├¡tulo...`);
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

        // Shortcircuit: se todas as ferramentas foram muta├º├Áes bem-sucedidas,
        // gera a resposta em c├│digo e evita uma chamada LLM extra
        if (
          executedResults.length === 1 &&
          MUTATING_TOOLS.has(executedResults[0].toolName)
        ) {
          const { toolName, result } = executedResults[0];
          const quick = buildMutationResponse(toolName, result, userName);
          if (quick) {
            messages.push({ role: 'assistant', content: quick });
            await saveHistory(sessionId, messages.filter(m => m.role !== 'system'));
            console.log(`[Shortcircuit] Resposta gerada em c├│digo para ${toolName}`);
            return finishAndReturn(quick);
          }
        }

        continue;
      }

      // Safety net: se o modelo ainda assim n├úo chamou ferramenta com inten├º├úo clara,
      // loga para diagn├│stico (n├úo deve acontecer pois for├ºamos na 1┬¬ chamada via preferredTool)
      if (toolTurns === 0 && preferredTool) {
        console.warn(`[Fallback] tool_choice for├ºado mas modelo n├úo chamou ${preferredTool} ÔÇö respondendo em texto`);
      }

      // Resposta final
      let finalContent = assistantMessage.content?.trim() || 'Pode repetir? N├úo entendi direito.';

      // Detecta artefatos internos do modelo (ex: "<´¢£toolÔûüsep´¢£>") na resposta final
      // Quando presente, o modelo vazou sintaxe interna em vez de gerar texto ÔÇö refaz com tool_choice: 'none'
      const hasModelArtifacts = (s) => s.includes('<´¢£tool') || s.includes('toolÔûü') || s.includes('<tool_call>');

      if (hasModelArtifacts(finalContent)) {
        console.warn('[QueryEngine] Resposta com artefatos detectada ÔÇö refor├ºando resposta limpa');
        try {
          const cleanMessages = messages.filter(m => !hasModelArtifacts(m.content || ''));
          cleanMessages.push({
            role: 'user',
            content: '[SISTEMA: Responda ao usu├írio em portugu├¬s natural e direto. N├âO use sintaxe de ferramentas. Apenas texto simples, sem marca├º├Áes especiais.]',
          });
          trace.artifact_recovery = true;
          const { response: retryResp, telemetry: retryTelemetry } = await createChatCompletion({
            messages: cleanMessages,
            tool_choice: 'none',
            temperature: 0.3,
            max_tokens: 300,
          }, llmOptions);
          captureTelemetry(retryTelemetry);
          finalContent = retryResp.choices[0]?.message?.content?.trim() || `Feito, ${userName}! Pode me dizer o que mais precisa.`;
        } catch {
          finalContent = `Feito, ${userName}! Pode me dizer o que mais precisa.`;
        }
      }

      // Sanitiza├º├úo final: remove JSON acidental, UUIDs, emojis e datas ISO que escaparam
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
      return finishAndReturn(finalContent);

    } catch (err) {
      console.error('[QueryEngine] Erro na chamada ao modelo:', err.message);
      trace.error_class = err.error_class || err.code || err.name || 'provider_error';

      // Se for erro de rate limit ou timeout, retorna mensagem amig├ível
      if (err.status === 429) {
        const content = `${userName}, t├┤ um pouco sobrecarregado agora. Tenta de novo em alguns segundinhos.`;
        return returnTelemetry ? { content, telemetry: trace } : content;
      }
      if (err.error_class === 'timeout' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        const content = `${userName}, parece que t├┤ com probleminhas de conex├úo. Tenta de novo daqui a pouco.`;
        return returnTelemetry ? { content, telemetry: trace } : content;
      }

      const content = `${userName}, deu um errinho aqui comigo. Tenta de novo?`;
      return returnTelemetry ? { content, telemetry: trace } : content;
    }
  }
}

// Helper inline para sanitiza├º├úo de datas na resposta final
function humanizeDateInline(isoDate) {
  const todayISO = getTodayISO();
  const spDate = new Date(todayISO + 'T12:00:00-03:00');
  const tomorrow = new Date(spDate); tomorrow.setDate(spDate.getDate() + 1);

  if (isoDate === todayISO) return 'hoje';
  if (isoDate === tomorrow.toISOString().split('T')[0]) return 'amanh├ú';

  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const dayNum = target.getDate();
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(target);
  return `${dayNum} de ${monthName}`;
}
