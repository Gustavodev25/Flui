import {
  appendConversationMessage,
  findBindingByUserId,
  getOrCreateThread,
  getThreadForUser,
  listThreadsForUser,
  queueOutboundJob,
} from './conversationStore.js';
import { queryEngineLoop } from './queryEngine.js';
import { sanitizeWhatsAppText } from './textFormatter.js';

async function resolveThread(userId, threadId, preferredChannel = 'whatsapp', externalUserId = null, userName = 'Você') {
  if (threadId) {
    const existing = await getThreadForUser(userId, threadId);
    if (existing) return existing;
  }

  const threads = await listThreadsForUser(userId);
  const preferred = threads.find((thread) => thread.channel === preferredChannel) || threads[0];
  if (preferred) return preferred;

  const binding = externalUserId
    ? { external_user_id: externalUserId, display_name: userName }
    : await findBindingByUserId(userId, preferredChannel);

  return getOrCreateThread({
    userId,
    channel: preferredChannel,
    externalUserId: binding?.external_user_id || externalUserId || null,
    title: binding?.display_name || userName,
    metadata: { preferredChannel },
  });
}

export async function enqueueOutboundConversationMessage({
  userId,
  threadId,
  content,
  externalUserId,
  channel = 'whatsapp',
  role = 'assistant',
  messageType = 'assistant_text',
  metadata = {},
}) {
  const thread = await resolveThread(userId, threadId, channel, externalUserId);
  const safeContent = channel === 'whatsapp' ? sanitizeWhatsAppText(content) : content;
  const binding = externalUserId
    ? { external_user_id: externalUserId }
    : await findBindingByUserId(userId, channel);

  const message = await appendConversationMessage({
    threadId: thread.id,
    userId,
    channel,
    direction: 'outbound',
    role,
    messageType,
    content: safeContent,
    status: channel === 'whatsapp' ? 'queued' : 'sent',
    metadata,
  });

  let job = null;
  if (channel === 'whatsapp' && binding?.external_user_id) {
    job = await queueOutboundJob({
      threadId: thread.id,
      messageId: message.id,
      userId,
      channel,
      target: binding.external_user_id,
      payload: metadata.template
        ? { type: 'template', template: metadata.template }
        : { type: 'text', text: safeContent },
    });
  }

  return { thread, message, job };
}

export async function processConversationTurn({
  userId,
  userName = 'Você',
  threadId = null,
  content,
  incomingChannel = 'web',
  preferredThreadChannel = 'whatsapp',
  externalUserId = null,
  externalMessageId = null,
  messageType = 'user_text',
  fromAudio = false,
  onAck,
  mirrorAssistantToWhatsApp = false,
  sseId = null,
}) {
  const thread = await resolveThread(userId, threadId, preferredThreadChannel, externalUserId, userName);

  const inboundMessage = await appendConversationMessage({
    threadId: thread.id,
    userId,
    channel: incomingChannel,
    direction: 'inbound',
    role: 'user',
    messageType,
    content,
    status: 'sent',
    externalMessageId,
    metadata: { fromAudio },
  });

  const result = await queryEngineLoop(content, thread.id, userId, userName, {
    onAck,
    fromAudio,
    returnTelemetry: true,
    sourceChannel: incomingChannel === 'whatsapp' ? 'whatsapp' : 'web',
    sseId,
  });
  const assistantContent = sanitizeWhatsAppText(result.content);

  const shouldQueueToWhatsApp = thread.channel === 'whatsapp' && (incomingChannel === 'whatsapp' || mirrorAssistantToWhatsApp);
  const binding = shouldQueueToWhatsApp
    ? await findBindingByUserId(userId, 'whatsapp')
    : null;

  const assistantMessage = await appendConversationMessage({
    threadId: thread.id,
    userId,
    channel: shouldQueueToWhatsApp ? 'whatsapp' : incomingChannel,
    direction: 'outbound',
    role: 'assistant',
    messageType: 'assistant_text',
    content: assistantContent,
    status: shouldQueueToWhatsApp ? 'queued' : 'sent',
    telemetry: result.telemetry,
  });

  let job = null;
  if (shouldQueueToWhatsApp && binding?.external_user_id) {
    job = await queueOutboundJob({
      threadId: thread.id,
      messageId: assistantMessage.id,
      userId,
      channel: 'whatsapp',
      target: binding.external_user_id,
      payload: { type: 'text', text: assistantContent },
    });
  }

  return {
    thread,
    inboundMessage,
    assistantMessage,
    reply: assistantContent,
    telemetry: result.telemetry,
    job,
  };
}

export async function getDefaultThreadForUser(userId) {
  return resolveThread(userId, null, 'whatsapp');
}
