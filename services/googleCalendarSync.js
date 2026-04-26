import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://flui.ia.br' : 'http://localhost:5173');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DEFAULT_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const GOOGLE_DEFAULT_TIME_ZONE = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'America/Sao_Paulo';
const GOOGLE_API_TIMEOUT_MS = Number(process.env.GOOGLE_API_TIMEOUT_MS || 15_000);

let defaultSupabaseAdmin = null;

function getDefaultSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase admin nao configurado para sincronizar Google Calendar.');
  }

  if (!defaultSupabaseAdmin) {
    defaultSupabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }

  return defaultSupabaseAdmin;
}

function getSupabaseAdmin(client) {
  return client || getDefaultSupabaseAdmin();
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

function normalizeClockTime(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':').map(part => Number(part));
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  const [hours, minutes, seconds = 0] = parts;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`;
}

function addMinutesToLocalDateTime(dateStr, timeStr, minutesToAdd) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const normalizedTime = normalizeClockTime(timeStr);
  if (!year || !month || !day || !normalizedTime) return null;
  const [hours, minutes, seconds] = normalizedTime.split(':').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  const shifted = new Date(base.getTime() + minutesToAdd * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${padTime(shifted.getUTCMonth() + 1)}-${padTime(shifted.getUTCDate())}T${padTime(shifted.getUTCHours())}:${padTime(shifted.getUTCMinutes())}:${padTime(shifted.getUTCSeconds())}`;
}

function addDaysToDate(dateStr, daysToAdd) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return null;
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + daysToAdd);
  return `${base.getUTCFullYear()}-${padTime(base.getUTCMonth() + 1)}-${padTime(base.getUTCDate())}`;
}

function formatDateTimeForTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const mapped = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  if (!mapped.year || !mapped.month || !mapped.day || !mapped.hour || !mapped.minute || !mapped.second) {
    return null;
  }

  return `${mapped.year}-${mapped.month}-${mapped.day}T${mapped.hour}:${mapped.minute}:${mapped.second}`;
}

function resolveGoogleCalendarSchedule(task, timeZone) {
  const dueTime = normalizeClockTime(task?.due_time);
  if (task?.due_date && dueTime) {
    const startDateTime = `${task.due_date}T${dueTime}`;
    return {
      kind: 'dateTime',
      startDateTime,
      endDateTime: addMinutesToLocalDateTime(task.due_date, dueTime, 60) || startDateTime,
      timeZone,
    };
  }

  if (task?.due_date) {
    return {
      kind: 'date',
      startDate: task.due_date,
      endDate: addDaysToDate(task.due_date, 1) || task.due_date,
    };
  }

  if (task?.timer_at && !task?.timer_fired) {
    const start = new Date(task.timer_at);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const startDateTime = formatDateTimeForTimeZone(start, timeZone);
      const endDateTime = formatDateTimeForTimeZone(end, timeZone);

      if (startDateTime && endDateTime) {
        return { kind: 'dateTime', startDateTime, endDateTime, timeZone };
      }
    }
  }

  return null;
}

export async function googleApiFetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_API_TIMEOUT_MS);
  const response = await fetch(url, { ...options, signal: options.signal || controller.signal }).finally(() => {
    clearTimeout(timeout);
  });
  const raw = await response.text();
  const payload = raw ? (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  })() : null;

  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.error?.message || payload?.message || `Google request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function getGoogleIntegration(userId, supabaseClient) {
  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  const { data, error } = await supabaseAdmin
    .from('google_integrations')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function setGoogleIntegrationError(userId, message, supabaseClient) {
  if (!userId) return;
  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  await supabaseAdmin
    .from('google_integrations')
    .update({
      last_error: String(message || '').slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

export async function refreshGoogleAccessToken(integration, supabaseClient) {
  if (!integration?.refresh_token) {
    throw new Error('Refresh token do Google Calendar ausente.');
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: integration.refresh_token,
    grant_type: 'refresh_token',
  });

  const tokenPayload = await googleApiFetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const expiresAt = tokenPayload?.expires_in
    ? new Date(Date.now() + Math.max(tokenPayload.expires_in - 60, 0) * 1000).toISOString()
    : null;

  const updates = {
    access_token: tokenPayload.access_token,
    refresh_token: tokenPayload.refresh_token || integration.refresh_token,
    token_type: tokenPayload.token_type || integration.token_type,
    scope: tokenPayload.scope || integration.scope,
    expires_at: expiresAt,
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  const { data, error } = await supabaseAdmin
    .from('google_integrations')
    .update(updates)
    .eq('user_id', integration.user_id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function ensureGoogleAccess(integration, supabaseClient) {
  if (!integration) throw new Error('Integracao Google Calendar nao encontrada.');
  if (!integration.expires_at) return integration;

  const expiresAt = new Date(integration.expires_at).getTime();
  if (Number.isNaN(expiresAt) || expiresAt > Date.now() + 60_000) {
    return integration;
  }

  return refreshGoogleAccessToken(integration, supabaseClient);
}

async function getGoogleTaskLink(userId, taskId, supabaseClient) {
  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  const { data, error } = await supabaseAdmin
    .from('google_calendar_task_links')
    .select('*')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function buildGoogleCalendarEvent(task, integration) {
  const timeZone = integration?.time_zone || GOOGLE_DEFAULT_TIME_ZONE;
  const schedule = resolveGoogleCalendarSchedule(task, timeZone);
  if (!schedule) return null;

  const event = {
    summary: task.title,
    description: [task.description?.trim(), 'Criado no Flui.']
      .filter(Boolean)
      .join('\n\n'),
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
    source: {
      title: 'Flui',
      url: FRONTEND_URL,
    },
    extendedProperties: {
      private: {
        fluiTaskId: task.id,
        fluiUserId: task.user_id,
        fluiStatus: task.status || 'todo',
      },
    },
  };

  if (schedule.kind === 'date') {
    event.start = { date: schedule.startDate };
    event.end = { date: schedule.endDate || schedule.startDate };
  } else {
    event.start = {
      dateTime: schedule.startDateTime,
      timeZone: schedule.timeZone,
    };
    event.end = {
      dateTime: schedule.endDateTime || schedule.startDateTime,
      timeZone: schedule.timeZone,
    };
  }

  return event;
}

export async function removeGoogleCalendarSyncForTask({ userId, taskId, supabaseClient }) {
  const link = await getGoogleTaskLink(userId, taskId, supabaseClient);
  if (!link) {
    return { success: true, status: 'not_linked' };
  }

  const integration = await getGoogleIntegration(userId, supabaseClient);
  if (integration?.access_token) {
    const activeIntegration = await ensureGoogleAccess(integration, supabaseClient);
    try {
      await googleApiFetchJson(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.calendar_id || activeIntegration.calendar_id || GOOGLE_DEFAULT_CALENDAR_ID)}/events/${encodeURIComponent(link.google_event_id)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${activeIntegration.access_token}`,
          },
        }
      );
    } catch (error) {
      if (!String(error.message || '').includes('404')) {
        throw error;
      }
    }
  }

  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  await supabaseAdmin
    .from('google_calendar_task_links')
    .delete()
    .eq('user_id', userId)
    .eq('task_id', taskId);

  return { success: true, status: 'removed' };
}

export async function syncGoogleCalendarTask({ userId, taskId, supabaseClient }) {
  const integration = await getGoogleIntegration(userId, supabaseClient);
  if (!integration) return { success: true, status: 'not_connected' };
  if (!integration.auto_sync_enabled) return { success: true, status: 'paused' };

  const supabaseAdmin = getSupabaseAdmin(supabaseClient);
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('id, user_id, title, description, due_date, due_time, timer_at, timer_fired, status')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  if (taskError) throw taskError;
  if (!task) return { success: true, status: 'task_not_found' };

  const hasDueSchedule = Boolean(task.due_date);
  const hasTimerSchedule = Boolean(
    !task.timer_fired &&
    task.timer_at &&
    !Number.isNaN(new Date(task.timer_at).getTime())
  );
  const shouldRemoveEvent =
    (!hasDueSchedule && !hasTimerSchedule) ||
    ['done', 'canceled'].includes(task.status);

  if (shouldRemoveEvent) {
    return removeGoogleCalendarSyncForTask({ userId, taskId, supabaseClient });
  }

  const activeIntegration = await ensureGoogleAccess(integration, supabaseClient);
  const eventPayload = buildGoogleCalendarEvent(task, activeIntegration);
  if (!eventPayload) return { success: true, status: 'missing_schedule' };

  const existingLink = await getGoogleTaskLink(userId, taskId, supabaseClient);
  const calendarId = activeIntegration.calendar_id || GOOGLE_DEFAULT_CALENDAR_ID;
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = existingLink?.google_event_id
    ? await googleApiFetchJson(`${baseUrl}/${encodeURIComponent(existingLink.google_event_id)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${activeIntegration.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      })
    : await googleApiFetchJson(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeIntegration.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });

  const linkPayload = {
    user_id: userId,
    task_id: taskId,
    google_event_id: response.id,
    calendar_id: calendarId,
    event_html_link: response.htmlLink || null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: linkError } = await supabaseAdmin
    .from('google_calendar_task_links')
    .upsert(linkPayload, { onConflict: 'user_id,task_id' });

  if (linkError) throw linkError;

  await supabaseAdmin
    .from('google_integrations')
    .update({
      last_error: null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return {
    success: true,
    status: existingLink?.google_event_id ? 'updated' : 'created',
    eventId: response.id,
    htmlLink: response.htmlLink || null,
  };
}

export async function autoSyncGoogleCalendarTask({ userId, taskId, action = 'sync', context = 'task mutation', supabaseClient }) {
  if (!userId || !taskId) {
    return { success: false, status: 'missing_context' };
  }

  try {
    return action === 'remove'
      ? await removeGoogleCalendarSyncForTask({ userId, taskId, supabaseClient })
      : await syncGoogleCalendarTask({ userId, taskId, supabaseClient });
  } catch (error) {
    console.warn(`[GoogleCalendar] Auto-sync falhou em ${context} task=${taskId}:`, error.message);
    try {
      await setGoogleIntegrationError(userId, error.message, supabaseClient);
    } catch (persistError) {
      console.warn('[GoogleCalendar] Falha ao registrar erro de auto-sync:', persistError.message);
    }
    return { success: false, status: 'error', error: error.message };
  }
}

export async function autoSyncGoogleCalendarTasks({ userId, taskIds, action = 'sync', context = 'task mutation', supabaseClient }) {
  const ids = [...new Set((taskIds || []).filter(Boolean))];
  if (!ids.length) return [];

  return Promise.all(ids.map(taskId =>
    autoSyncGoogleCalendarTask({ userId, taskId, action, context, supabaseClient })
  ));
}
