import { apiFetch } from './api'

export async function syncTaskWithGoogleCalendar(taskId: string, userId?: string | null) {
  if (!taskId || !userId) return

  try {
    await apiFetch('/api/integrations/google/sync-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, userId }),
    })
  } catch (error) {
    console.warn('[GoogleCalendar] Falha ao sincronizar tarefa:', error)
  }
}

export async function unlinkTaskFromGoogleCalendar(taskId: string, userId?: string | null) {
  if (!taskId || !userId) return

  try {
    await apiFetch('/api/integrations/google/sync-task', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, userId }),
    })
  } catch (error) {
    console.warn('[GoogleCalendar] Falha ao remover evento sincronizado:', error)
  }
}
