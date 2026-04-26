export const SIMPLE_CONVERSATION_RULES = `REGRAS DE CONVERSA SIMPLES E DIRETA:
- Responda primeiro com a solucao, acao feita ou proximo passo.
- Use portugues simples, de uso comum. Evite jargao, termo dificil e frase de manual.
- Nao enrole: corte introducoes como "claro", "com certeza", "vou explicar" quando nao agregarem.
- Na maioria das respostas, use 1 ou 2 frases curtas. So use lista quando ajudar de verdade.
- Quando houver passos, mostre no maximo 3 por vez.
- Se faltar informacao, faca so uma pergunta curta.
- Nao repita o pedido do usuario antes de responder.
- Nao termine com frase generica tipo "estou a disposicao" ou "posso ajudar em mais alguma coisa".`;

const CANNED_OPENING_PATTERNS = [
  /^(claro|com certeza|certamente|perfeito|entendi|entendido|sem problemas)[,!.\s]+/i,
  /^(vou te ajudar(?: com isso)?|posso te ajudar(?: com isso)?)[,!.\s]+/i,
  /^(vou te explicar|vamos la|vamos lá)[,!.\s]+/i,
];

const CANNED_CLOSING_PATTERNS = [
  /\s*(se precisar de mais alguma coisa,?\s*)?(estou|fico)\s+(a|à)\s+disposi(?:cao|ção)\.?$/i,
  /\s*se precisar de mais alguma coisa,?\s*(e so|é só)\s+(me\s+)?chamar\.?$/i,
  /\s*posso ajudar (em|com) mais alguma coisa\??$/i,
  /\s*quer que eu explique (melhor|o passo a passo)\??$/i,
  /\s*espero ter ajudado\.?$/i,
];

export function polishAssistantText(text) {
  let output = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!output) return output;

  for (const pattern of CANNED_OPENING_PATTERNS) {
    output = output.replace(pattern, '').trimStart();
  }

  for (const pattern of CANNED_CLOSING_PATTERNS) {
    output = output.replace(pattern, '').trimEnd();
  }

  return output
    .replace(/[!?]{2,}/g, (match) => match[0])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
