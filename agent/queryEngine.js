import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { TOOLS, executeTool } from './tools.js';
import { getHistory, saveHistory } from './sessionHistory.js';
import { createChatCompletion } from './llmClient.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Limite de rodadas de ferramentas por mensagem (proteção contra loops)
const MAX_TOOL_TURNS = 6;

// ── Cache de System Context ───────────────────────────────────────────────────
const contextCache = new Map();
const CONTEXT_TTL_MS = 300_000; // 5min

// Invalida cache após tool calls que modificam dados
export function invalidateContextCache(userId) {
  contextCache.delete(userId);
}

// ── Helpers de data ───────────────────────────────────────────────────────────

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

// ── System Context (enriquecido com tarefas reais) ────────────────────────────

async function getSystemContext(userId, userName = 'Usuário') {
  const cached = contextCache.get(userId);
  if (cached && Date.now() - cached.ts < CONTEXT_TTL_MS) {
    return cached.prompt;
  }

  const todayISO = getTodayISO();
  const { dateStr, dayOfWeek } = getSPDateTime();
  const dates = precomputeDates(todayISO);

  // Busca tarefas com mais detalhes para dar contexto à IA (incluindo subtarefas)
  const [taskResult, doneResult, followupsResult] = await Promise.all([
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
  ]);

  const pendingTasks = taskResult.data || [];
  const doneCount = doneResult.count || 0;
  const totalCount = pendingTasks.length + doneCount;
  const pendingFollowups = followupsResult.data || [];

  // Marcar follow-ups como resolvidos de forma otimista (IA vai mencioná-los nessa resposta)
  if (pendingFollowups.length > 0) {
    supabase
      .from('pending_followups')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', pendingFollowups.map(f => f.id))
      .then(() => {})
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
    taskSnapshot += `\n⚠️ ATRASADAS (${overdue.length}):\n${overdue.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueToday.length > 0) {
    taskSnapshot += `\n📋 PRA HOJE (${dueToday.length}):\n${dueToday.map(t => `  - "${t.title}" (id: ${t.id}, prioridade ${t.priority})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (dueSoon.length > 0) {
    taskSnapshot += `\n🔜 PRÓXIMOS DIAS (${dueSoon.length}):\n${dueSoon.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }
  if (noDueDate.length > 0) {
    taskSnapshot += `\n📌 SEM PRAZO (${noDueDate.length}):\n${noDueDate.map(t => `  - "${t.title}" (id: ${t.id})${formatSubtasks(t)}`).join('\n')}`;
  }

  const prompt = `Você é o Lui, um assistente de produtividade super gentil, atencioso e inteligente integrado ao WhatsApp.

═══ USUÁRIO ═══
Nome: ${userName}
USO DO NOME — regras de naturalidade:
- USE o nome na PRIMEIRA mensagem da conversa (saudação inicial): "E aí ${userName}, como posso te ajudar?"
- USE o nome em momentos IMPORTANTES: resumo de batch, dashboard, alertas de tarefas atrasadas, confirmação de exclusão, rota de fuga.
- USE o nome quando for caloroso ou motivacional: "Mandou bem, ${userName}!" ou "${userName}, vi que tá com tudo em dia!"
- NÃO use o nome em TODA resposta — isso soa robótico. Em trocas rápidas e sequenciais (ex: "Feito!", "Anotei!", "Pronto!"), não precisa do nome.
- REGRA GERAL: Se a última resposta sua já usou o nome, a próxima pode ir sem. Alterne naturalmente.

═══ CONTEXTO TEMPORAL ═══
Ano: ${dates.currentYear}
Data e hora: ${dateStr}
Dia da semana: ${dayOfWeek}
Data ISO (uso interno): ${todayISO}

═══ PAINEL DO USUÁRIO ═══
Total: ${totalCount} tarefas | Pendentes: ${pendingTasks.length} | Concluídas: ${doneCount}
${taskSnapshot || '\nNenhuma tarefa pendente no momento.'}

IMPORTANTE: Os IDs acima são apenas para uso interno nos parâmetros das ferramentas. JAMAIS mencione um ID ou UUID na resposta para o usuário.
${pendingFollowups.length > 0 ? `
═══ FOLLOW-UPS PENDENTES ═══
Esses lembretes não foram entregues porque a janela de conversa estava fechada:
${pendingFollowups.map(f => {
  const dt = new Date(f.missed_at);
  const dtStr = dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `- "${f.task_title}" (lembrete perdido em ${dtStr})`;
}).join('\n')}

→ Mencione naturalmente 1 desses itens no começo da resposta, com algo como "Ei, aquela tarefa '...' de ontem — você conseguiu fazer?". Seja breve e natural. NÃO liste todos de uma vez.` : ''}

═══ PERSONALIDADE (MUITO IMPORTANTE) ═══
- ESPELHAMENTO EDUCATIVO: Se o usuário disser "Bom dia", "Tudo bem?" ou mandar uma saudação, você DEVE responder à altura de forma calorosa usando o nome dele. Ex: "Bom dia, ${userName}! Tudo ótimo por aqui!" NUNCA ignore saudações.
- TOM DE VOZ: Amigável, humano, prestativo e levemente entusiasmado. Você é um parceiro de organização, não um robô frio.
- LINGUAGEM: Natural e fluida. Use "tá", "pra", "deixa comigo" (português brasileiro coloquial, porém educado).
- CONCISÃO EQUILIBRADA: Não precisa ser um robô de uma frase só. Seja direto, mas mantenha a conversa agradável (máximo 3-4 frases por resposta).
- PROIBIDO USAR EMOJIS: NUNCA use emojis em suas respostas. Mantenha o texto limpo e profissional, apenas com caracteres alfanuméricos e pontuação padrão.

═══ REGRAS DE AÇÃO ═══
1. FERRAMENTA OBRIGATÓRIA: Você JAMAIS pode fingir que criou, atualizou ou deletou uma tarefa sem chamar a ferramenta correspondente. Se sua resposta diz "anotei", "criei", "registrei" ou qualquer variação, você DEVE ter chamado TaskCreate ou TaskBatchCreate antes. NUNCA simule uma ação.

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
   a) Usuário mencionou um dia/data explícita → use essa data.
   b) Tarefa tem timer ("daqui X horas/minutos") → due_date = hoje (${dates.todayISO}).
   c) Tarefa soa imediata ou do dia ("comprar pão", "ligar agora", "mandar isso") → due_date = hoje (${dates.todayISO}).
   d) Tarefa claramente futura sem data ("planejar viagem", "fazer curso") → pergunte a data após criar.
   NUNCA deixe due_date vazio quando a tarefa for claramente pra hoje ou tiver um dia implícito.
4. BATCH E ÁUDIO: Se o usuário listar várias coisas (por texto OU áudio), use TaskBatchCreate (até 20 de uma vez). Identifique TODAS as tarefas mencionadas e crie de uma vez só. Depois, SEMPRE faça um resumo organizado do que foi criado. Exemplo de resumo:
   "${userName}, anotei tudo! Aqui vai o resumo:
   1. *Comprar material* -- pra amanhã
   2. *Ligar pro contador* -- sem prazo
   3. *Enviar proposta* -- pra sexta
   Tudo certinho! Quer ajustar alguma coisa?"
5. BUSCA E CONSULTA INTELIGENTE: Quando o usuário perguntar sobre suas tarefas de forma geral ou específica, use as ferramentas para consultar em tempo real:
   - "O que eu tenho pra fazer hoje?" → TaskList com due_date=today
   - "Qual era aquela tarefa do relatório?" → TaskSearch com query="relatório"
   - "O que tá pendente?" → TaskList sem filtros
   - "Tenho alguma coisa urgente?" → TaskList e filtre por prioridade no PAINEL
   A resposta deve ser NATURAL: "${userName}, você tem 3 tarefas pra hoje: terminar o relatório, ligar pro fornecedor e enviar o e-mail."
   Se o usuário pedir algo que você já vê no PAINEL DO USUÁRIO acima, pode responder diretamente sem chamar ferramentas.
6. DELETE: SEMPRE peça confirmação antes de deletar de forma amigável: "${userName}, tem certeza que quer apagar *[Nome]*?"
7. UPDATE/DELETE SEM ID: NUNCA invente, adivinhe ou construa um task_id. Se não tiver o UUID real da tarefa (obtido de uma chamada anterior de TaskList ou TaskSearch nesta conversa), você DEVE chamar TaskSearch com o nome da tarefa primeiro para obter o ID real. Só então chame TaskUpdate ou TaskDelete com esse ID.
8. DASHBOARD: Quando perguntarem "como tá", "meu progresso", "estatísticas", use TaskDashboard.
9. GESTÃO DE DATAS: Se o usuário quer saber o que tem "pra hoje", use TaskList com o parâmetro due_date.
   - Se a busca retornar vazio, olhe o PAINEL DO USUÁRIO e diga: "${userName}, hoje tá tranquilo! Mas vi que amanhã você tem [tarefa]."

═══ GESTÃO DE AMBIGUIDADE ═══
10. INFORMAÇÕES FALTANDO: Se faltar detalhe, pergunte com naturalidade:
   - "Anotei, ${userName}! *Ligar para o João* -- quer que eu coloque pra alguma data?"
   - EXCEÇÃO: Coisas imediatas ("comprar pão") crie direto.
11. CONFIRMAÇÃO INTELIGENTE: Quando a intenção é clara, crie e pergunte depois:
   - "Pronto, ${userName}! *Marcar dentista* tá anotado. Sabe a data? Posso agendar pra você."

═══ ROTA DE FUGA (FALLBACK) ═══
12. CONFUSÃO DETECTADA: Se você NÃO conseguir entender o que o usuário quer após a mensagem atual E o histórico recente já mostra que a conversa não está fluindo (ex: você já pediu pra repetir ou já tentou interpretar sem sucesso), PARE de adivinhar. Responda:
   "${userName}, acho que não tô conseguindo entender direito. Pode tentar me explicar de outro jeito? Se preferir, pode acessar o painel web pra fazer direto por lá."
13. NUNCA fique preso em loop de "não entendi" repetido. Se já pediu repetição uma vez e a segunda tentativa continuar confusa, use a rota de fuga acima.
14. NÃO mande mensagens genéricas sem necessidade. Se recebeu algo estranho (tipo um caractere solto ou algo sem sentido), responda com leveza: "${userName}, acho que essa escapou! Me conta o que precisa e eu resolvo."

═══ MEMÓRIA DE CONTEXTO (CURTO PRAZO) ═══
15. REFERÊNCIAS: Entenda "Muda para as 16h", "Coloca como urgente", "Apaga ela", "Tá feito" com base na última tarefa conversada no histórico.
16. PRONOMES: Entenda "ela", "esse", "aquela" pelo contexto.
17. FLUXO: Se você perguntou "Para quando?" e o usuário diz "sexta", atualize a tarefa pendente.
18. REFERÊNCIA POR NÚMERO DE LISTA: Quando o usuário disser "número X", "a número X", "é a X", "o primeiro", "a segunda", "o 3", etc., referindo-se a uma posição em uma lista de tarefas exibida anteriormente:
   a. Procure na mensagem mais recente do assistente no histórico um bloco [ÍNDICE:...] — se encontrar, extraia o UUID da posição X (formato X="<uuid>") e use-o diretamente como task_id
   b. Se houver resultado de ferramenta TaskList ou TaskSearch no histórico com tasks_raw, use tasks_raw[X-1].id diretamente como task_id
   c. Último recurso: leia o título da tarefa na posição X na lista formatada do histórico e use TaskSearch com esse título exato
   CRÍTICO: NUNCA passe "número 2", "é a 2", "a segunda", "número X" etc. como query para TaskSearch — sempre resolva para o ID ou título real da tarefa.

═══ REGRAS DE SUBTAREFAS ═══
18. SUBTAREFAS PROATIVAS: Para QUALQUER tarefa — incluindo as que têm timer — tente incluir pelo menos 2 a 3 subtarefas que ajudem o usuário a começar. Não espere ele pedir. Timer e subtarefas NÃO são excludentes: use ambos quando couber.
19. SUBTAREFAS PRÁTICAS: Gere passos curtos e acionáveis (ex: "Separar material", "Revisar rascunho").
20. SUGESTÃO: Se a tarefa for muito complexa, crie as subtarefas iniciais e pergunte: "${userName}, dividi em algumas etapas pra você, quer que eu adicione mais alguma?"
21. GESTÃO: Você também pode usar TaskUpdate para adicionar subtarefas a uma tarefa que já existe. REGRA CRÍTICA: ao usar TaskUpdate com o campo "subtasks", você DEVE enviar a lista COMPLETA (existentes + novas). As subtarefas atuais de cada tarefa estão listadas no PAINEL DO USUÁRIO acima. Nunca envie apenas a subtarefa nova — isso apagaria as anteriores.

═══ ETAPAS SEQUENCIAIS → UMA TAREFA COM SUBTAREFAS ═══
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
   → TaskCreate título: "Pendências do carro e sistema"
     subtasks: [
       { title: "Levar carro na oficina", timer_minutes: 30 },
       { title: "Lavar carro", timer_minutes: 240 },
       { title: "Resolver sistema Controlar Mais" }
     ]
   O timer_minutes da tarefa principal (timer_minutes no nível da tarefa) deve ser o do primeiro passo.

═══ REGRAS DE RESPOSTA ═══
22. CONFIRMAÇÃO HUMANA: Após ações, seja caloroso e USE O NOME:
   - "Tudo certo, ${userName}! *Cobrar Rafael* já tá na sua lista pra hoje"
   - "Feito, ${userName}! Marquei *Relatório* como concluída. Mandou bem!"
23. DATAS: NUNCA escreva YYYY-MM-DD. Use: "hoje", "amanhã", "segunda-feira", "dia 5 de abril".
24. PROIBIDO: JSON, IDs, UUIDs, tecniquês de sistema. O usuário é uma pessoa comum.
25. CONTEXTO: Use o snapshot acima para sugestões amigáveis. Ex: "${userName}, vi que *[tarefa]* tá atrasada, quer que eu mude a data?"

26. RESUMO OBRIGATÓRIO: Sempre que criar uma tarefa (TaskCreate ou TaskBatchCreate), você DEVE preencher o campo 'description' com um resumo do que deve ser feito, detalhando um pouco o que o usuário pediu. NUNCA deixe vazio.
 
═══ TIMER / LEMBRETE RÁPIDO ═══
- Se o usuário mencionar expressão de tempo curto junto com uma tarefa, use o campo timer_minutes no TaskCreate ou TaskBatchCreate.
- Converta QUALQUER variação de:
  "em 10 minutos" / "daqui 10 minutos" / "daqui 10 min"    → timer_minutes: 10
  "daqui uns 3 minutinho" / "uns 3 minutinhos"              → timer_minutes: 3  ← use o número EXATO, não arredonde
  "daqui uns 5 minutinhos" / "em uns 5 minutos"             → timer_minutes: 5
  "em meia hora" / "daqui meia hora"                        → timer_minutes: 30
  "em 45 minutos" / "daqui 45 minutos"                      → timer_minutes: 45
  "em 1 hora" / "daqui 1 hora" / "daqui uma hora"           → timer_minutes: 60
  "em 1 hora e meia" / "daqui uma hora e meia"              → timer_minutes: 90
  "em 1 hora e 30 minutos" / "daqui 1h30"                   → timer_minutes: 90
  "em 2 horas" / "daqui 2 horas" / "daqui duas horas"       → timer_minutes: 120
  "daqui 2 horas e meia"                                    → timer_minutes: 150
  "daqui 3 horas"                                           → timer_minutes: 180
- O sistema enviará uma notificação no WhatsApp quando o timer expirar.
- Ao confirmar a criação, mencione o timer: "Anotado! Vou te avisar em 10 minutos." ou "Vou te lembrar em 1 hora e meia."
- NÃO use timer_minutes para prazos de dias/semanas — apenas para alertas em minutos/horas curtos (até 24h).

═══ LEMBRETE DE ANTECEDÊNCIA (DIAS) ═══
- Use reminder_days_before quando o usuário pedir lembrete com dias de antecedência:
  "me lembra 3 dias antes" / "avisa com 2 dias de antecedência" / "lembrete 1 semana antes"
- Requer que due_date esteja preenchido na tarefa.
- Ao confirmar: "Anotado! Vou te avisar X dia(s) antes do prazo." (substitua X pelo número). NUNCA use emojis.
- TIMER + SUBTAREFAS: mesmo quando há timer, gere subtarefas normalmente. Os campos timer_minutes e subtasks são independentes e devem ser preenchidos juntos quando a tarefa tiver etapas.

═══ REGRAS DE PRIORIDADE ═══
- "importante", "urgente", "crítico" → high
- "de boa", "sem pressa", "quando der" → low
- Demais casos → medium

═══ REGRAS DE DATAS ═══
O ANO ATUAL é ${dates.currentYear}. NUNCA use anos passados.
- "hoje" → ${dates.todayISO}
- "amanhã" → ${dates.tomorrowISO}
- "depois de amanhã" → ${dates.dayAfterTomorrowISO}
- "semana que vem" → ${dates.nextWeekISO}
- "mês que vem" → ${dates.nextMonthISO}
SEMPRE passe due_date como YYYY-MM-DD nas ferramentas.`;

  contextCache.set(userId, { prompt, ts: Date.now() });
  return prompt;
}

// ── Detecção de intenção de criação ──────────────────────────────────────────

const CREATION_TRIGGERS = [
  /\bme\s+lembr/i,           // me lembra, me lembrar
  /\bme\s+avis/i,            // me avisa
  /\bnão\s+deixa\s+(eu\s+)?esquecer/i,
  /\banota\s+(aí|isso|pra mim)?/i,
  /\bregistr/i,
  /\bpreciso\s+(fazer|de|comprar|ligar|ir)/i,
  /\btenho\s+que/i,
  /\btenho\s+uma\s+tarefa/i,
  /\bcri(a|ar|ei)\s+(uma\s+)?tarefa/i,
  /\badiciona(r|i)?/i,
  /\blembr(ar|e)\s+(de|que)/i,
  /\bsalva(\s+isso|\s+a[ií])?/i,
  /\bnão\s+(me\s+)?esquecer/i,
];

function isCreationIntent(message) {
  return CREATION_TRIGGERS.some(re => re.test(message));
}

// Detecta se a mensagem descreve múltiplas tarefas distintas (ex: planejamento semanal)
export function hasMultipleTasks(message) {
  const lower = message.toLowerCase();
  // Múltiplos dias da semana mencionados → claramente múltiplas tarefas
  const weekdays = ['segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado', 'domingo'];
  if (weekdays.filter(d => lower.includes(d)).length >= 2) return true;
  // Múltiplos "também" indicam lista de itens distintos
  if ((lower.match(/\btambém\b/g) || []).length >= 2) return true;
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

function getSimpleTaskListRequest(message) {
  const lower = normalizeTextForIntent(message);
  // Removemos "tarefas?" e "pendentes?" do hasQuestion porque causava falsos positivos muito fáceis.
  // Focamos em verbos e pronomes interrogativos claros ou "o que tenho".
  const hasQuestion = /\b(quais?|qual|listar?|lista|mostra|mostrar|ver|cad[eê]|cade|o\s+que\s+tenho)\b/.test(lower);
  const asksTasks = /\b(tarefas?|pendencias?|pendentes|afazeres?|coisas?\s+pra\s+fazer|tenho\s+pra\s+fazer|tenho\s+para\s+fazer)\b/.test(lower);

  // Se tem "?" no final ou perto do final, já reforça que é uma pergunta se falar de tarefas
  const hasQuestionMark = /\?/.test(lower);

  if (!((hasQuestion && asksTasks) || (hasQuestionMark && asksTasks))) return null;
  if (isCreationIntent(message)) return null;

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
    return `${prefix}não consegui buscar suas tarefas agora. Tenta de novo em alguns instantes.`;
  }

  if (!result.count) {
    return filter.due_date
      ? `${prefix}hoje está tranquilo: não encontrei tarefas pendentes pra hoje.`
      : `${prefix}não encontrei tarefas pendentes no momento.`;
  }

  return `${prefix}você tem ${result.count} tarefa${result.count > 1 ? 's' : ''} ${scope}:\n${result.formatted_list}`;
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
    .filter(word => word && !TASK_GLUE_WORDS.has(normalizeTextForIntent(word)));

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
    .replace(/^\s*(cria(?:r)?(?:\s+uma)?\s+tarefa|adiciona(?:r)?(?:\s+uma)?\s+tarefa|me\s+lembr(?:a|ar|e)(?:\s+de|\s+que)?|me\s+avis(?:a|ar)(?:\s+de|\s+que)?|n[aã]o\s+deixa\s+(?:eu\s+)?esquecer(?:\s+de|\s+que)?|anota(?:\s+a[ií]|\s+isso|\s+pra\s+mim)?|registr(?:a|ar)|salva(?:\s+isso|\s+a[ií])?|tenho\s+que|preciso(?:\s+de)?)\s+/i, ' ');
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
    .replace(/\b(n[aã]o|não)\b[^.?!]*$/i, ' ');

  return cleanupTaskTitle(withoutTimers);
}

function getSimpleTaskCreateRequest(message, { resolvedDate, resolvedTimerMinutes, sourceChannel }) {
  if (!isCreationIntent(message)) return null;
  if (hasMultipleTasks(message)) return null;
  if (!resolvedTimerMinutes && !resolvedDate) return null;

  const title = extractSimpleTaskTitle(message);
  const args = {
    title,
    description: `Criado a partir da mensagem: ${String(message || '').trim()}`,
    priority: 'medium',
    due_date: resolvedDate || (resolvedTimerMinutes ? getTodayISO() : undefined),
    ...(resolvedTimerMinutes ? { timer_minutes: resolvedTimerMinutes } : {}),
    source: sourceChannel === 'whatsapp' ? 'whatsapp' : 'user',
    ...(sourceChannel === 'whatsapp' ? { whatsapp_message: message } : {}),
  };

  return { args, missingTitle: !title };
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

  // Padrão 3: lista com vírgulas e "e" no final — "X, Y, Z e W"
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
    const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
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

// ── Extração de timer em minutos da mensagem ──────────────────────────────────

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

/**
 * Extrai o número de minutos de timer a partir de expressões naturais em português.
 * Exemplos cobertos:
 *   "daqui 2 horas"            → 120
 *   "daqui meia hora"          → 30
 *   "em 30 minutos"            → 30
 *   "daqui uma hora e meia"    → 90
 *   "em 2 horas e 30 minutos"  → 150
 *   "daqui 1h30"               → 90
 *   "em 45 min"                → 45
 *   "daqui duas horas"         → 120
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
    /\b(\d{1,2})\s*h(?:oras?)?\s*(?:da\s+(manh[aã]|tarde|noite))\b/
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
    const [curH, curM] = spTimeStr.split(':').map(Number);
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

// ── Resposta rápida para mutações (evita chamada LLM extra) ──────────────────

function buildMutationResponse(toolName, result, userName) {
  if (!result.success) return null;

  switch (toolName) {
    case 'TaskBatchCreate': {
      const n = result.count || 0;
      return `${userName}, anotei tudo! Aqui vai o resumo:\n${result.formatted_list}\n\nQuer ajustar alguma coisa?`;
    }
    case 'TaskCreate': {
      const date = result.task_due_date && result.task_due_date !== 'sem prazo'
        ? ` pra ${result.task_due_date}` : '';
      let timer = '';
      if (result.timer_set && result.timer_minutes) {
        const m = result.timer_minutes;
        if (m > 90) {
          const h = Math.floor(m / 60); const rm = m % 60;
          const label = rm > 0 ? `${h}h${rm}min` : `${h}h`;
          timer = ` Timer de ${label} configurado. Vou te avisar 1 hora antes e na hora certa.`;
        } else if (m > 30) {
          timer = ` Timer configurado. Vou te avisar 15 minutos antes e na hora certa.`;
        } else {
          timer = ` Vou te avisar daqui ${m} minuto${m !== 1 ? 's' : ''}.`;
        }
      }
      return `Anotado, ${userName}! *${result.task_title}* ficou registrado${date}.${timer}`;
    }
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

// ── Query Engine Loop ─────────────────────────────────────────────────────────

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
- NÃO confirme conclusão ("feito", "anotei", "criei") — você ainda está PROCESSANDO
- NÃO use emojis
- NÃO use o nome em toda mensagem (alterne)
- Tom de parceiro de organização, não robô

EXEMPLOS DE BOM ACK (notar que cada um menciona o assunto real):
- Mensagem: "preciso lembrar de pagar a conta de luz amanhã" → "Show, deixa eu anotar essa da conta de luz..."
- Mensagem: "atazanar minha cachorrinha daqui 3 minutinhos" → "Aaah, vou marcar essa da cachorrinha já já..."
- Mensagem: "amanhã às 14h tenho consulta no dentista" → "Beleza, deixa eu colocar essa do dentista pra amanhã..."
- Mensagem: "preciso comprar pão, leite e ovos" → "Tô separando essas da compra aqui..."

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
  { onAck, fromAudio = false, returnTelemetry = false, sourceChannel = 'whatsapp' } = {}
) {
  const shouldAck = (fromAudio || hasMultipleTasks(userMessage)) && typeof onAck === 'function';
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

  const simpleTaskListRequest = getSimpleTaskListRequest(userMessage);
  if (simpleTaskListRequest) {
    try {
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
  const resolvedTimerMinutes = extractTimerMinutesFromMessage(userMessage);
  const resolvedDateWithTimerFallback = resolvedDate || (resolvedTimerMinutes ? getTodayISO() : null);
  const creationIntent = isCreationIntent(userMessage);
  const multipleTasksIntent = hasMultipleTasks(userMessage);

  const simpleTaskCreateRequest = getSimpleTaskCreateRequest(userMessage, {
    resolvedDate,
    resolvedTimerMinutes,
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
  // Busca histórico, contexto e ACK em paralelo — custo zero extra
  const [history, systemPrompt] = await Promise.all([
    getHistory(sessionId),
    getSystemContext(userId, userName),
  ]);

  if (shouldAck) {
    // Tenta gerar ack contextual via LLM, com fallback para template se demorar mais que 2.5s
    // (assim a ack nunca chega depois da resposta principal)
    const fallbackAck = generateQuickAck(userMessage, userName);
    let ackSent = false;
    const sendAckOnce = (text) => {
      if (ackSent || !text) return;
      ackSent = true;
      Promise.resolve(onAck(text)).catch(() => {});
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
      // Na 1ª chamada com intenção de criação, força a ferramenta diretamente (evita fallback)
      const isFirstCall = toolTurns === 0;
      const currentToolChoice = (preferredTool && isFirstCall)
        ? { type: 'function', function: { name: preferredTool } }
        : 'auto';
      // max_tokens: menor para chamadas de tool, menor ainda para geração de resposta
      const currentMaxTokens = isFirstCall
        ? (multipleTasksIntent ? 900 : 450)
        : 250;

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
        if (toolTurns >= MAX_TOOL_TURNS) {
          const limitMsg = `Eita ${userName}, muita coisa de uma vez! Me manda um pedido por vez que fica melhor.`;
          await saveHistory(sessionId, [
            ...messages.filter(m => m.role !== 'system'),
            { role: 'assistant', content: limitMsg },
          ]);
          return limitMsg;
        }

        // Remove campos não-padrão (ex: reasoning_content do deepseek) incompatíveis com outros providers
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

            // Se o modelo esqueceu o due_date mas a mensagem tinha data (ou tem timer → hoje), injeta
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

            // Se o modelo esqueceu timer_minutes mas a mensagem tinha expressão de tempo, injeta
            if (resolvedTimerMinutes) {
              if (toolCall.function.name === 'TaskCreate' && !args.timer_minutes) {
                args.timer_minutes = resolvedTimerMinutes;
                console.log(`[TimerInject] timer_minutes=${resolvedTimerMinutes} injetado em TaskCreate`);
              }
              if (toolCall.function.name === 'TaskUpdate' && !args.timer_minutes) {
                args.timer_minutes = resolvedTimerMinutes;
                console.log(`[TimerInject] timer_minutes=${resolvedTimerMinutes} injetado em TaskUpdate`);
              }
              if (toolCall.function.name === 'TaskBatchCreate' && Array.isArray(args.tasks)) {
                args.tasks = args.tasks.map(t => t.timer_minutes ? t : { ...t, timer_minutes: resolvedTimerMinutes });
                console.log(`[TimerInject] timer_minutes=${resolvedTimerMinutes} injetado em TaskBatchCreate`);
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

            console.log(`[Agent] → ${toolCall.function.name}`, JSON.stringify(args));
            let result = await executeTool(toolCall.function.name, args, { userId });
            console.log(`[Agent] ← ${toolCall.function.name}`, result.success ? '✅' : '❌');

            // Auto-recovery: TaskUpdate/TaskDelete com UUID inválido ou não encontrado →
            // busca pelo nome na mensagem do usuário e retenta com o ID real
            if (
              !result.success &&
              (toolCall.function.name === 'TaskUpdate' || toolCall.function.name === 'TaskDelete') &&
              result._hint?.includes('não encontrada')
            ) {
              console.log(`[AutoRecover] ID inválido em ${toolCall.function.name} — buscando por título...`);
              // Extrai palavras-chave relevantes (remove stopwords curtas e limita tamanho)
              const searchQuery = userMessage.substring(0, 120).replace(/[,()!?]/g, ' ').replace(/\s+/g, ' ').trim();
              const searchResult = await executeTool('TaskSearch', { query: searchQuery }, { userId });
              const found = searchResult.tasks_raw?.[0];
              if (found?.id) {
                args.task_id = found.id;
                console.log(`[AutoRecover] Retentando ${toolCall.function.name} com ID real: ${found.id}`);
                result = await executeTool(toolCall.function.name, args, { userId });
                console.log(`[AutoRecover] ← ${toolCall.function.name}`, result.success ? '✅' : '❌');
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
      // loga para diagnóstico (não deve acontecer pois forçamos na 1ª chamada via preferredTool)
      if (toolTurns === 0 && preferredTool) {
        console.warn(`[Fallback] tool_choice forçado mas modelo não chamou ${preferredTool} — respondendo em texto`);
      }

      // Resposta final
      let finalContent = assistantMessage.content?.trim() || 'Pode repetir? Não entendi direito.';

      // Detecta artefatos internos do modelo (ex: "<｜tool▁sep｜>") na resposta final
      // Quando presente, o modelo vazou sintaxe interna em vez de gerar texto — refaz com tool_choice: 'none'
      const hasModelArtifacts = (s) => s.includes('<｜tool') || s.includes('tool▁') || s.includes('<tool_call>');

      if (hasModelArtifacts(finalContent)) {
        console.warn('[QueryEngine] Resposta com artefatos detectada — reforçando resposta limpa');
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
          finalContent = retryResp.choices[0]?.message?.content?.trim() || `Feito, ${userName}! Pode me dizer o que mais precisa.`;
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
