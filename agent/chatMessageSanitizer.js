const TEXT_ROLES = new Set(['system', 'user', 'developer']);

function normalizeContent(content, fallback = '') {
  if (content === undefined || content === null) return fallback;
  if (typeof content === 'string' || Array.isArray(content)) return content;
  return JSON.stringify(content);
}

function sanitizeFunctionCall(functionCall) {
  if (!functionCall || typeof functionCall !== 'object') return null;
  if (typeof functionCall.name !== 'string' || !functionCall.name) return null;

  return {
    name: functionCall.name,
    arguments: typeof functionCall.arguments === 'string'
      ? functionCall.arguments
      : JSON.stringify(functionCall.arguments ?? {}),
  };
}

function sanitizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;

  const fn = sanitizeFunctionCall(toolCall.function);
  if (!fn || typeof toolCall.id !== 'string' || !toolCall.id) return null;

  return {
    id: toolCall.id,
    type: 'function',
    function: fn,
  };
}

export function sanitizeChatMessageForInput(message) {
  if (!message || typeof message !== 'object' || typeof message.role !== 'string') {
    return null;
  }

  const { role } = message;
  const clean = { role };

  if (typeof message.name === 'string' && message.name) {
    clean.name = message.name;
  }

  if (TEXT_ROLES.has(role)) {
    clean.content = normalizeContent(message.content);
    return clean;
  }

  if (role === 'assistant') {
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map(sanitizeToolCall).filter(Boolean)
      : [];

    clean.content = normalizeContent(message.content, toolCalls.length ? null : '');

    if (toolCalls.length) {
      clean.tool_calls = toolCalls;
    }

    const functionCall = sanitizeFunctionCall(message.function_call);
    if (functionCall) {
      clean.function_call = functionCall;
    }

    return clean;
  }

  if (role === 'tool') {
    if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) {
      return null;
    }
    clean.tool_call_id = message.tool_call_id;
    clean.content = normalizeContent(message.content);
    return clean;
  }

  if (role === 'function') {
    if (typeof message.name !== 'string' || !message.name) {
      return null;
    }
    clean.name = message.name;
    clean.content = normalizeContent(message.content);
    return clean;
  }

  return null;
}

export function sanitizeChatMessagesForInput(messages) {
  if (!Array.isArray(messages)) return [];

  const fieldClean = messages
    .map(sanitizeChatMessageForInput)
    .filter(Boolean);

  const clean = [];

  for (let i = 0; i < fieldClean.length; i++) {
    const message = fieldClean[i];

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const expectedToolIds = new Set(message.tool_calls.map((toolCall) => toolCall.id));
      const seenToolIds = new Set();
      const toolMessages = [];
      let cursor = i + 1;

      while (cursor < fieldClean.length && fieldClean[cursor].role === 'tool') {
        const toolMessage = fieldClean[cursor];
        if (expectedToolIds.has(toolMessage.tool_call_id) && !seenToolIds.has(toolMessage.tool_call_id)) {
          seenToolIds.add(toolMessage.tool_call_id);
          toolMessages.push(toolMessage);
        }
        cursor++;
      }

      const hasAllToolResults = [...expectedToolIds].every((id) => seenToolIds.has(id));
      if (hasAllToolResults) {
        clean.push(message, ...toolMessages);
      }

      i = cursor - 1;
      continue;
    }

    if (message.role === 'tool') {
      continue;
    }

    clean.push(message);
  }

  return clean;
}
