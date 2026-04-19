import { Queue } from 'bullmq';
import { createBullMQConnection } from './redisClient.js';

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
    console.warn('[WhatsAppQueue] UPSTASH_REDIS_URL não configurado — fila desativada, processamento direto ativo');
    return null;
  }
  _queue = new Queue('whatsapp-messages', { connection, defaultJobOptions: JOB_OPTIONS });
  console.log('[WhatsAppQueue] Fila BullMQ inicializada');
  return _queue;
}

// Enfileira uma mensagem de texto ou áudio para processamento assíncrono.
// Retorna o Job criado, ou null se a fila não estiver disponível.
export async function enqueueWhatsAppMessage(data) {
  const queue = getWhatsAppQueue();
  if (!queue) return null;
  return queue.add('process', data, JOB_OPTIONS);
}
