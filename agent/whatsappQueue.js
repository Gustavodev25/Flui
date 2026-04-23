import { Queue } from 'bullmq';
import { createBullMQConnection, disableBullMQ } from './redisClient.js';

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

let _queue = null;
let _queueUnavailableLogged = false;

function isRedisQuotaError(error) {
  const message = error?.message ?? '';
  return (
    message.includes('max requests limit exceeded') ||
    message.includes('ERR max requests limit exceeded')
  );
}

export function getWhatsAppQueue() {
  if (_queue) return _queue;

  const connection = createBullMQConnection();
  if (!connection) {
    if (!_queueUnavailableLogged) {
      console.warn('[WhatsAppQueue] Fila desativada; processamento direto ativo');
      _queueUnavailableLogged = true;
    }
    return null;
  }

  _queueUnavailableLogged = false;
  _queue = new Queue('whatsapp-messages', { connection, defaultJobOptions: JOB_OPTIONS });
  _queue.on('error', (error) => {
    if (isRedisQuotaError(error)) {
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

export async function enqueueWhatsAppMessage(data) {
  const queue = getWhatsAppQueue();
  if (!queue) return null;

  try {
    return await queue.add('process', data, JOB_OPTIONS);
  } catch (error) {
    if (isRedisQuotaError(error)) {
      disableBullMQ(`Limite de requisicoes do Redis excedido: ${error.message}`);
      await queue.close().catch(() => {});
      _queue = null;
      return null;
    }
    throw error;
  }
}
