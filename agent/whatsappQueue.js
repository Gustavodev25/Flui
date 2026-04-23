import { Queue } from 'bullmq';
import { createBullMQConnection, disableBullMQ } from './redisClient.js';

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

let _queue = null;

export function getWhatsAppQueue() {
  if (_queue) return _queue;
  const connection = createBullMQConnection();
  if (!connection) {
    console.warn('[WhatsAppQueue] Fila desativada — processamento direto ativo');
    return null;
  }
  _queue = new Queue('whatsapp-messages', { connection, defaultJobOptions: JOB_OPTIONS });
  _queue.on('error', (error) => {
    if (error?.message?.includes('max requests limit exceeded')) {
      disableBullMQ(`Limite de requisicoes do Redis excedido: ${error.message}`);
      void _queue?.close().catch(() => {});
      _queue = null;
      return;
    }
    console.error('[WhatsAppQueue] Erro na fila:', error.message);
  });
  console.log('[WhatsAppQueue] Fila BullMQ inicializada');
  return _queue;
}

// Enfileira uma mensagem de texto ou áudio para processamento assíncrono.
// Retorna o Job criado, ou null se a fila não estiver disponível.
export async function enqueueWhatsAppMessage(data) {
  const queue = getWhatsAppQueue();
  if (!queue) return null;
  try {
    return await queue.add('process', data, JOB_OPTIONS);
  } catch (error) {
    if (error?.message?.includes('max requests limit exceeded')) {
      disableBullMQ(`Limite de requisicoes do Redis excedido: ${error.message}`);
      await queue.close().catch(() => {});
      _queue = null;
      return null;
    }
    throw error;
  }
}
