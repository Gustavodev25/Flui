import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';

import { useAuth } from '../contexts/AuthContext';
import {
  ShieldAlert, Search, Users, LogOut, ArrowRight,
  MessageSquare, CheckSquare, MessageCircle, User as UserIcon,
  ChevronLeft, ChevronRight, Smartphone,
  RefreshCw, Route, MapPin, Activity, BookOpen, TrendingUp,
  Globe, Plus, Trash2, ScrollText, Pencil, Eye, EyeOff, X
} from 'lucide-react';
import ChangelogEditor from '../components/ui/ChangelogEditor';
import Avvvatars from 'avvvatars-react';
import logo from '../assets/logo/logo.svg';
import luiLogo from '../assets/logo/lui.svg';
import flowLogo from '../assets/logo/flow.svg';
import pulseLogo from '../assets/logo/pulse.svg';
import gratisLogo from '../assets/logo/gratis.svg';
import { motion, AnimatePresence } from 'framer-motion';
import PixelBlast from '../components/ui/PixelBlast';
import Modal from '../components/ui/Modal';
import novidadeIcon from '../assets/icones/novidades.svg';
import melhoriaIcon from '../assets/icones/melhoria.svg';
import correcaoIcon from '../assets/icones/correcao.svg';
import atencaoIcon from '../assets/icones/atencao.svg';


interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  lastSignIn: string;
  hasFlow: boolean;
  planId: string | null;
  subscriptionStatus: string;
  activeRecently: boolean;
}

interface AdminStats {
  totalMessages: number;
  totalTasks: number;
  firstMessageUsers: number;
  wppConversationsUsed: number;
  wppFreeLimit: number;
  analytics?: AdminAnalytics;
}

type RouteTrackingStatus = 'active' | 'empty' | 'not_configured' | 'error';

interface AdminRouteInsight {
  path: string;
  label: string;
  visits: number;
  uniqueUsers: number;
  percentage: number;
  lastSeenAt: string | null;
}

interface AdminStateInsight {
  state: string;
  country: string;
  users: number;
  visits: number;
  conversations: number;
  messages: number;
  lastSeenAt: string | null;
}

interface AdminChannelInsight {
  channel: string;
  messages: number;
  inbound: number;
  outbound: number;
  users: number;
  percentage: number;
}

interface AdminConversationAnalytics {
  totalThreads: number;
  messagesToday: number;
  activeUsers7d: number;
  assistantResponses: number;
  avgLatencyMs: number;
  fallbackRate: number;
  toolCalls: number;
  unreadThreads: number;
  lastMessageAt: string | null;
}

interface AdminTrainingSignal {
  topic: string;
  count: number;
  sample: string;
  recommendation: string;
}

interface AdminAnalytics {
  routeTrackingStatus: RouteTrackingStatus;
  routes: AdminRouteInsight[];
  states: AdminStateInsight[];
  channels: AdminChannelInsight[];
  conversations: AdminConversationAnalytics;
  trainingSignals: AdminTrainingSignal[];
}

interface MessageUser {
  name: string;
  email: string;
  avatar: string | null;
}

interface ConversationMessage {
  id: string;
  thread_id: string;
  user_id: string;
  channel: string;
  direction: string;
  role: string;
  message_type: string;
  content: string;
  status: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  fallback_used: boolean;
  tool_count: number;
  error_class: string | null;
  artifact_recovery: boolean;
  ai_diagnostics?: {
    provider: string | null;
    error_class: string | null;
    artifact_recovery: boolean;
    fallback_used: boolean;
  };
  created_at: string;
  user: MessageUser;
}

interface MessagesResponse {
  messages: ConversationMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const numberFormatter = new Intl.NumberFormat('pt-BR');

function formatMetric(value: number | null | undefined) {
  return numberFormatter.format(value || 0);
}

function channelLabel(channel: string) {
  if (channel === 'whatsapp') return 'WhatsApp';
  return channel || 'Outro';
}

function formatShortDate(dateStr: string | null | undefined) {
  if (!dateStr) return 'Sem registro';
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessageDiagnostics(msg: ConversationMessage) {
  const diagnostics = msg.ai_diagnostics || {
    provider: msg.provider,
    error_class: msg.error_class,
    artifact_recovery: msg.artifact_recovery,
    fallback_used: msg.fallback_used,
  };

  return {
    provider: diagnostics.provider || msg.provider,
    errorClass: diagnostics.error_class || msg.error_class,
    artifactRecovery: Boolean(diagnostics.artifact_recovery || msg.artifact_recovery),
    fallbackUsed: Boolean(diagnostics.fallback_used || msg.fallback_used),
  };
}

function getDiagnosticBadges(msg: ConversationMessage) {
  const diagnostics = getMessageDiagnostics(msg);
  const badges: Array<{ key: string; label: string; className: string; title: string }> = [];

  if (diagnostics.provider) {
    badges.push({
      key: 'provider',
      label: diagnostics.provider,
      title: 'Provider usado',
      className: 'bg-[#f3f3f1] text-[#37352f]/55 border-[#e9e9e7]',
    });
  }

  if (diagnostics.fallbackUsed) {
    badges.push({
      key: 'fallback',
      label: 'retry/fallback',
      title: 'Resposta saiu pelo fallback depois de uma tentativa anterior',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    });
  }

  if (diagnostics.artifactRecovery) {
    badges.push({
      key: 'artifact',
      label: 'artefatos limpos',
      title: 'A resposta foi regenerada para remover artefatos internos',
      className: 'bg-sky-50 text-sky-700 border-sky-200',
    });
  }

  if (diagnostics.errorClass) {
    badges.push({
      key: 'error',
      label: diagnostics.errorClass,
      title: 'Classe do erro registrada na chamada da IA',
      className: 'bg-red-50 text-red-700 border-red-200',
    });
  }

  return badges;
}

function AdminDashboardStats({ stats }: { stats: AdminStats }) {
  const [showAllRoutesModal, setShowAllRoutesModal] = useState(false);

  const renderRoute = (route: AdminRouteInsight) => (
    <div key={route.path} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#202020] truncate">{route.label}</p>
          <p className="text-[11px] font-medium text-[#37352f]/35 truncate">{route.path} ⬢ {formatShortDate(route.lastSeenAt)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-[#202020]">{formatMetric(route.visits)}</p>
          <p className="text-[10px] font-bold text-[#37352f]/30">{formatMetric(route.uniqueUsers)} usuários</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-[#f3f3f1] overflow-hidden">
        <div className="h-full bg-[#202020] rounded-full" style={{ width: `${Math.max(route.percentage, 4)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Mensagens enviadas', value: stats.totalMessages, icon: <MessageSquare size={16} /> },
          { label: 'Tarefas criadas', value: stats.totalTasks, icon: <CheckSquare size={16} /> },
          { label: 'Usuários com interação', value: stats.firstMessageUsers, icon: <Users size={16} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
            <div className="flex items-center justify-between text-[#37352f]/30">
              <span className="text-[11px] font-semibold text-[#37352f]/40">{label}</span>
              {icon}
            </div>
            <span className="text-3xl font-semibold text-[#202020]">{formatMetric(value)}</span>
          </div>
        ))}

        <div className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
          <div className="flex items-center justify-between text-[#37352f]/30">
            <span className="text-[11px] font-semibold text-[#37352f]/40">Consumo Wpp / mês</span>
            <MessageCircle size={16} />
          </div>
          <div className="flex items-end gap-1.5">
            <span className="text-3xl font-semibold text-[#202020]">{formatMetric(stats.wppConversationsUsed)}</span>
            <span className="text-sm font-semibold text-[#37352f]/30 mb-0.5">/ {formatMetric(stats.wppFreeLimit)}</span>
          </div>
          <div className="w-full bg-[#f3f3f1] h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${(stats.wppConversationsUsed / Math.max(stats.wppFreeLimit, 1)) > 0.9 ? 'bg-red-400' : 'bg-[#202020]'}`}
              style={{ width: `${Math.min((stats.wppConversationsUsed / Math.max(stats.wppFreeLimit, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.9fr] gap-5">
        <section className="bg-white border border-[#e9e9e7] rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-2 text-[#202020]">
                <Route size={16} />
                <h3 className="text-sm font-bold">Rotas acessadas</h3>
              </div>
              <p className="text-xs text-[#37352f]/40 mt-1">Páginas mais visitadas desde os últimos eventos registrados.</p>
            </div>
            <span className="text-[10px] font-semibold text-[#37352f]/30">
              {stats.analytics?.routeTrackingStatus === 'active' ? 'Ativo' : 'Aguardando'}
            </span>
          </div>

          {stats.analytics?.routes?.length ? (
            <div className="space-y-4">
              {stats.analytics.routes.slice(0, 4).map((route) => renderRoute(route))}

              {stats.analytics.routes.length > 4 && (
                <button 
                  onClick={() => setShowAllRoutesModal(true)}
                  className="w-full mt-4 py-2.5 text-[11px] font-bold text-[#37352f]/40 hover:text-[#202020] hover:bg-[#f3f3f1] rounded-xl transition-all flex items-center justify-center gap-2 border border-dashed border-[#e9e9e7] hover:border-[#d0d0ce]"
                >
                  Ver todas as rotas
                  <ArrowRight size={12} />
                </button>
              )}
            </div>
          ) : (
            <div className="py-8 flex items-start gap-3 text-[#37352f]/45">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">
                {stats.analytics?.routeTrackingStatus === 'not_configured'
                  ? 'A coleta de rotas já foi adicionada, mas a tabela site_route_events ainda precisa existir no Supabase.'
                  : 'Ainda não há eventos de rota suficientes. As próximas navegações começarão a aparecer aqui.'}
              </p>
            </div>
          )}

          <Modal
            isOpen={showAllRoutesModal}
            onClose={() => setShowAllRoutesModal(false)}
            title="Rotas acessadas"
            subtitle="Lista completa de páginas visitadas e métricas de acesso."
            headerIcon={<Route size={16} />}
            maxWidth="max-w-xl"
          >
            <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {stats.analytics?.routes?.map((route) => renderRoute(route))}
            </div>
          </Modal>
        </section>

        <section className="bg-white border border-[#e9e9e7] rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="flex items-center gap-2 text-[#202020]">
                <MapPin size={16} />
                <h3 className="text-sm font-bold">Estados e origem</h3>
              </div>
              <p className="text-xs text-[#37352f]/40 mt-1">Localização detectada por headers de hospedagem e metadados de usuários.</p>
            </div>
          </div>

          {stats.analytics?.states?.length ? (
            <div className="space-y-3">
              {stats.analytics.states.map((state) => (
                <div key={`${state.country}-${state.state}`} className="flex items-center justify-between gap-3 border-b border-[#f3f3f1] last:border-b-0 pb-3 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#202020] truncate">{state.state}</p>
                    <p className="text-[11px] font-medium text-[#37352f]/35 truncate">{state.country} ⬢ {formatMetric(state.visits)} visitas ⬢ {formatMetric(state.messages)} msgs</p>
                  </div>
                  <span className="text-lg font-bold text-[#202020]">{formatMetric(state.users)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center text-center gap-2 text-[#37352f]/35">
              <MapPin size={24} />
              <p className="text-sm font-medium">Sem estado identificado nos dados atuais.</p>
            </div>
          )}
        </section>
      </div>

      <section className="bg-white border border-[#e9e9e7] rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-[#202020]">
              <Activity size={16} />
              <h3 className="text-sm font-bold">Conversas e IA</h3>
            </div>
            <span className="text-[11px] font-semibold text-[#37352f]/35">
              �altima mensagem: {formatShortDate(stats.analytics?.conversations.lastMessageAt)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Conversas', value: stats.analytics?.conversations.totalThreads || 0 },
            { label: 'Mensagens hoje', value: stats.analytics?.conversations.messagesToday || 0 },
            { label: 'Usuários 7d', value: stats.analytics?.conversations.activeUsers7d || 0 },
            { label: 'Chamadas de ferramentas', value: stats.analytics?.conversations.toolCalls || 0 },
          ].map((metric) => (
            <div key={metric.label} className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl p-4">
              <p className="text-[10px] font-semibold text-[#37352f]/35">{metric.label}</p>
              <p className="text-2xl font-bold text-[#202020] mt-1">{formatMetric(metric.value)}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-5">
          <div className="grid grid-cols-3 gap-3 flex-1">
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-semibold text-[#37352f]/30">Latência</p>
              <p className="text-lg font-semibold text-[#202020]">{formatMetric(stats.analytics?.conversations.avgLatencyMs)}ms</p>
            </div>
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-semibold text-[#37352f]/30">Fallback</p>
              <p className="text-lg font-semibold text-[#202020]">{formatMetric(stats.analytics?.conversations.fallbackRate)}%</p>
            </div>
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-semibold text-[#37352f]/30">Não lidas</p>
              <p className="text-lg font-semibold text-[#202020]">{formatMetric(stats.analytics?.conversations.unreadThreads)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-[#e9e9e7] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-[#202020]">
              <BookOpen size={16} />
              <h3 className="text-sm font-bold">Treinamentos sugeridos para IA</h3>
            </div>
            <p className="text-xs text-[#37352f]/40 mt-1">Temas detectados nas mensagens recentes que podem virar exemplos, intents ou ajustes de prompt.</p>
          </div>
          <TrendingUp size={16} className="text-[#37352f]/25" />
        </div>

        {stats.analytics?.trainingSignals?.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {stats.analytics.trainingSignals.map((signal) => (
              <div key={signal.topic} className="border border-[#e9e9e7] rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-[#202020]">{signal.topic}</p>
                    <p className="text-[11px] font-bold text-[#37352f]/35 mt-0.5">{formatMetric(signal.count)} mensagens relacionadas</p>
                  </div>
                  <span className="text-lg font-bold text-[#202020]">{formatMetric(signal.count)}</span>
                </div>
                {signal.sample && (
                  <p className="mt-3 text-xs leading-relaxed text-[#37352f]/55 line-clamp-2">"{signal.sample}"</p>
                )}
                <p className="mt-3 text-xs font-medium leading-relaxed text-[#37352f]/45">{signal.recommendation}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 flex flex-col items-center text-center gap-2 text-[#37352f]/35">
            <BookOpen size={24} />
            <p className="text-sm font-medium">Ainda não há volume suficiente para sugerir treinamentos.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type AdminTab = 'dashboard' | 'users' | 'messages' | 'changelog'

interface ChangelogEntry {
  id: string
  title: string
  description: string
  type: 'feature' | 'fix' | 'improvement' | 'breaking'
  status: 'draft' | 'published'
  version: string | null
  published_at: string
  created_at: string
}

const CHANGELOG_TYPE_CONFIG = {
  feature: {
    label: 'Novidade',
    icon: <img src={novidadeIcon} className="w-6 h-6" />,
    className: 'text-[#37352f]/40',
  },
  improvement: { 
    label: 'Melhoria', 
    icon: <img src={melhoriaIcon} className="w-6 h-6" />, 
    className: 'text-[#37352f]/30' 
  },
  fix: { 
    label: 'Correção', 
    icon: <img src={correcaoIcon} className="w-6 h-6" />, 
    className: 'text-[#37352f]/30' 
  },
  breaking: { 
    label: 'Atenção', 
    icon: <img src={atencaoIcon} className="w-6 h-6" />, 
    className: 'text-red-500/40' 
  },
};

export function AdminPanel() {
  const { user, session, isLoading: authLoading, signOut } = useAuth();
  const accessToken = session?.access_token;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [avatarErrors, setAvatarErrors] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');

  // Messages state
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesTotalPages, setMessagesTotalPages] = useState(1);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesSearch, setMessagesSearch] = useState('');
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const [selectedUserMessages, setSelectedUserMessages] = useState<User | null>(null);
  const [messagesMode, setMessagesMode] = useState<'all' | 'by-user'>('by-user');

  // Changelog state
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([])
  const [changelogLoading, setChangelogLoading] = useState(false)
  const [changelogForm, setChangelogForm] = useState({ title: '', description: '', type: 'feature' as ChangelogEntry['type'], version: '' })
  const [changelogSubmitting, setChangelogSubmitting] = useState(false)
  const [showChangelogForm, setShowChangelogForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ChangelogEntry | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', type: 'feature' as ChangelogEntry['type'], version: '' })
  const [editSubmitting, setEditSubmitting] = useState(false)

  const adminFetch = useCallback(async <T,>(
    path: string,
    init?: RequestInit,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> => {
    // Sempre busca token fresco do Supabase para evitar 401 com token expirado
    const { data: { session: freshSession } } = await supabase.auth.getSession();
    const token = freshSession?.access_token;

    if (!token) {
      throw new Error('Sessao Supabase ausente.');
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    return apiFetch<T>(path, { ...init, headers }, query);
  }, []);

  const loadAdminData = useCallback(async () => {
    if (!accessToken) return;

    setLoading(true);
    setError('');

    try {
      const [usersResp, statsResp] = await Promise.all([
        adminFetch<{ users: User[] }>('/api/admin/users'),
        adminFetch<AdminStats>('/api/admin/stats').catch((e) => {
          console.error("Falha ao buscar estatisticas:", e);
          return null;
        }),
      ]);

      setUsers(usersResp.users || []);
      setStats(statsResp);
      setIsAuthenticated(true);
    } catch (err: any) {
      setUsers([]);
      setStats(null);
      setIsAuthenticated(false);
      setError(err.message || 'Usuario sem permissao de administrador.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, adminFetch]);

  const loadChangelogs = useCallback(async () => {
    setChangelogLoading(true)
    const { data } = await supabase.from('changelogs').select('*').order('published_at', { ascending: false })
    setChangelogEntries((data as ChangelogEntry[]) || [])
    setChangelogLoading(false)
  }, [])

  const handleCreateChangelog = async (status: 'draft' | 'published') => {
    if (!changelogForm.title.trim() || !changelogForm.description.trim()) return
    setChangelogSubmitting(true)
    const { error } = await supabase.from('changelogs').insert({
      title: changelogForm.title.trim(),
      description: changelogForm.description.trim(),
      type: changelogForm.type,
      status,
      version: changelogForm.version.trim() || null,
    })
    if (!error) {
      setChangelogForm({ title: '', description: '', type: 'feature', version: '' })
      setShowChangelogForm(false)
      await loadChangelogs()
      // Dispara preview para o admin
      window.dispatchEvent(new CustomEvent('changelog-preview'))
    }
    setChangelogSubmitting(false)
  }

  const handlePublishChangelog = async (id: string) => {
    await supabase.from('changelogs').update({ status: 'published' }).eq('id', id)
    setChangelogEntries(prev => prev.map(e => e.id === id ? { ...e, status: 'published' } : e))
    // Dispara preview para o admin
    window.dispatchEvent(new CustomEvent('changelog-preview'))
  }

  const handleDeleteChangelog = async (id: string) => {
    if (!window.confirm('Deletar esta entrada do changelog?')) return
    await supabase.from('changelogs').delete().eq('id', id)
    setChangelogEntries(prev => prev.filter(e => e.id !== id))
  }

  const openEditEntry = (entry: ChangelogEntry) => {
    setEditingEntry(entry)
    setEditForm({ title: entry.title, description: entry.description, type: entry.type, version: entry.version || '' })
  }

  const handleUpdateChangelog = async (statusOverride?: 'draft' | 'published') => {
    if (!editingEntry || !editForm.title.trim() || !editForm.description.trim()) return
    setEditSubmitting(true)
    const { error } = await supabase.from('changelogs').update({
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      type: editForm.type,
      version: editForm.version.trim() || null,
      status: statusOverride || editingEntry.status,
    }).eq('id', editingEntry.id)
    if (!error) {
      setEditingEntry(null)
      await loadChangelogs()
      // Dispara preview para o admin
      window.dispatchEvent(new CustomEvent('changelog-preview'))
    }
    setEditSubmitting(false)
  }

  useEffect(() => {
    if (authLoading) return;

    if (!user || !accessToken) {
      setIsAuthenticated(false);
      setUsers([]);
      setStats(null);
      setLoading(false);
      setError('Entre com sua conta para verificar o acesso administrativo.');
      return;
    }

    loadAdminData();
  }, [authLoading, user, accessToken, loadAdminData]);

  const retryAdminAccess = async () => {
    await loadAdminData();
  };

  const handleGrantAccess = async (userId: string, plan: 'flow' | 'pulse') => {
    const planLabel = plan === 'pulse' ? 'Pulse' : 'Flow';
    if (!window.confirm(`Tem certeza que deseja conceder o plano "${planLabel}" para este usuário?`)) return;

    try {
      await adminFetch('/api/admin/users/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan })
      });
      // Atualiza localmente
      setUsers(prev => prev.map(u =>
        u.id === userId
          ? { ...u, hasFlow: true, planId: plan, subscriptionStatus: 'active' }
          : u
      ));
      alert(`Plano ${planLabel} concedido com sucesso!`);
    } catch (err: any) {
      alert('Erro ao conceder acesso: ' + err.message);
    }
  };

  const fetchMessages = useCallback(async () => {
    if (!isAuthenticated) return;
    setMessagesLoading(true);
    try {
      const resp = await adminFetch<MessagesResponse>('/api/admin/messages', undefined, {
        page: messagesPage,
        limit: 50,
        search: messagesSearch || undefined,
        userId: selectedUserMessages?.id || undefined,
      });
      setMessages(resp.messages || []);
      setMessagesTotalPages(resp.totalPages || 1);
      setMessagesTotal(resp.total || 0);
    } catch (err) {
      console.error('Erro ao buscar mensagens:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [adminFetch, isAuthenticated, messagesPage, messagesSearch, selectedUserMessages]);

  useEffect(() => {
    if (activeTab === 'messages' && isAuthenticated) {
      fetchMessages();
    }
  }, [activeTab, fetchMessages]);

  useEffect(() => {
    if (activeTab === 'changelog' && isAuthenticated) {
      loadChangelogs()
    }
  }, [activeTab, isAuthenticated, loadChangelogs])

  // Reset page when filters change
  useEffect(() => {
    setMessagesPage(1);
  }, [messagesSearch, selectedUserMessages, messagesMode]);

  // ---------------------------------------------
  // LOADER � validando sessão
  // ---------------------------------------------
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-5">
        <img src={logo} alt="Flui" className="w-7 h-7 object-contain opacity-30" />
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[#37352f]/20"
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------
  // TELA DE ACESSO NEGADO / LOGIN
  // ---------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-[360px] flex flex-col items-start gap-5"
        >
          <div className="w-10 h-10 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl flex items-center justify-center">
            <ShieldAlert className="text-[#37352f]/30 w-5 h-5" />
          </div>

          <div>
            <h1 className="text-lg font-bold text-[#202020] tracking-tight">Acesso restrito</h1>
            <p className="text-sm text-[#37352f]/40 mt-1">
              {user
                ? (error || 'Sua conta não tem permissão de administrador.')
                : 'Entre com sua conta para continuar.'}
            </p>
          </div>

          {user ? (
            <button
              onClick={retryAdminAccess}
              className="px-4 py-2 bg-[#202020] hover:bg-[#202020]/90 text-white text-sm font-medium rounded-lg transition-all"
            >
              Tentar novamente
            </button>
          ) : (
            <Link
              to="/login?redirect=/admin"
              className="px-4 py-2 bg-[#202020] hover:bg-[#202020]/90 text-white text-sm font-medium rounded-lg transition-all"
            >
              Entrar
            </Link>
          )}
        </motion.div>
      </div>
    );
  }

  // ---------------------------------------------
  // TELA ADMIN (Com TopBar e abas)
  // ---------------------------------------------
  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + 
      ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };


  return (
    <div className="h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative overflow-hidden flex flex-col hide-scrollbar">
      {/* Background Decoration - Sync with Landing Page Hero */}
      <div className="absolute top-0 left-0 w-full h-[800px] pointer-events-none z-0 overflow-hidden"
        style={{
          maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)'
        }}
      >
        <div className="absolute inset-0">
          <PixelBlast
            variant="square"
            pixelSize={3}
            color="#e2e2e2"
            patternScale={4}
            patternDensity={0.6}
            enableRipples
            rippleSpeed={0.3}
            rippleThickness={0.1}
            rippleIntensityScale={1}
            speed={0.3}
            transparent
            edgeFade={0}
          />
        </div>

        {/* Mockup Fragments Floating in Background - Subtly added to Admin */}
        <div className="absolute inset-0 opacity-[0.03] select-none">
          <motion.div
            animate={{ x: [0, 15, 0], y: [0, 20, 0], rotate: [-2, 2, -2] }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-[5%] left-[-5%] w-72 h-64 bg-[#37352f]/5 border border-[#37352f]/10 rounded-3xl p-4 flex flex-col gap-3"
          >
            <div className="flex justify-between items-center px-1">
              <div className="w-12 h-2 bg-[#37352f]/20 rounded-full" />
              <div className="flex gap-1"><div className="w-1 h-1 bg-[#37352f]/40 rounded-full" /><div className="w-1 h-1 bg-[#37352f]/40 rounded-full" /></div>
            </div>
            <div className="grid grid-cols-7 gap-2 flex-1">
              {Array.from({ length: 28 }).map((_, i) => (
                <div key={i} className="aspect-square border border-[#37352f]/10 rounded-md flex flex-col items-center justify-center p-0.5">
                  <div className={`w-full h-1 bg-[#37352f]/20 rounded-full ${[3, 8, 15, 22].includes(i) ? 'opacity-100' : 'opacity-0'}`} />
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            animate={{ x: [0, -20, 0], y: [0, -10, 0], rotate: [5, 8, 5] }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-[35%] right-[-8%] w-80 h-48 bg-[#37352f]/5 border border-[#37352f]/10 rounded-2xl p-6 flex flex-col gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md border-2 border-[#37352f]/40" />
              <div className="h-3 w-40 bg-[#37352f]/30 rounded-full" />
            </div>
            <div className="space-y-2 ml-9">
              <div className="h-1.5 w-full bg-[#37352f]/10 rounded-full" />
              <div className="h-1.5 w-[70%] bg-[#37352f]/10 rounded-full" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Decorative radial gradient - Sync with Landing Page */}
      <div 
        className="absolute top-0 left-0 w-full h-[1000px] pointer-events-none z-0"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(55, 53, 47, 0.03) 0%, transparent 70%)' }}
      />

      {/* �"��"��"��"��"��"��"��"��"��"��"� TOP BAR �"��"��"��"��"��"��"��"��"��"��"� */}
      <header className="sticky top-0 z-50 transition-all duration-300">
        <div className={`max-w-6xl mx-auto px-6 py-4 transition-all duration-300`}>
          <div className="flex items-center justify-between">
            {/* Left: Logo (Igual LP) */}
            <div className="flex items-center gap-2">
              <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
              <span className="text-xl font-bold tracking-tight text-[#202020]">Lui</span>
            </div>

            {/* Center: Navigation Tabs (Simple style) */}
            <nav className="hidden lg:flex items-center gap-6">
              {(['dashboard', 'users', 'messages', 'changelog'] as AdminTab[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`text-xs font-bold transition-all ${
                    activeTab === id
                      ? 'text-[#202020]'
                      : 'text-[#37352f]/40 hover:text-[#37352f]/80'
                  }`}
                >
                  {id === 'dashboard' ? 'Painel' : id === 'users' ? 'Usuários' : id === 'messages' ? 'Mensagens' : 'Changelog'}
                </button>
              ))}
            </nav>

            {/* Right: name + Logout & Mobile Menu */}
            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-xs font-medium text-[#37352f]/40">
                {user?.user_metadata?.name?.split(' ')[0] || user?.email?.split('@')[0]}
              </span>
              {/* Mobile menu - Simple text version */}
              <div className="lg:hidden flex items-center gap-4 mr-2">
                {(['dashboard', 'users', 'messages', 'changelog'] as AdminTab[]).map((id) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`text-[10px] font-bold transition-all ${
                      activeTab === id ? 'text-[#202020]' : 'text-[#37352f]/40'
                    }`}
                  >
                    {id === 'dashboard' ? 'Painel' : id === 'users' ? 'Usuários' : id === 'messages' ? 'Mensagens' : 'Changelog'}
                  </button>
                ))}
              </div>

              <button 
                onClick={() => {
                  setIsAuthenticated(false);
                  signOut();
                }}
                className="px-4 py-2 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#30302E] shadow-sm transition-all flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className={`flex-1 overflow-hidden relative z-10 transition-all duration-300 ${
        (activeTab === 'users' || activeTab === 'messages') ? 'w-full max-w-6xl mx-auto px-6 py-8 flex flex-col' :
        'w-full max-w-6xl mx-auto px-6 py-8 overflow-y-auto hide-scrollbar'
      }`}>
        
        <AnimatePresence mode="wait">
          {/* �"��"��"��"��"��"��"��"��"��"��"� ABA USUÁRIOS �"��"��"��"��"��"��"��"��"��"��"� */}
          {activeTab === 'users' && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
                <div>
                  <h2 className="text-xl font-semibold text-[#202020] tracking-tight">Usuários</h2>
                  <p className="text-sm text-[#37352f]/40 mt-0.5">{users.length} contas registradas</p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#37352f]/30 w-3.5 h-3.5" />
                  <input
                    type="text"
                    placeholder="Buscar usuário..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-white border border-[#e9e9e7] rounded-xl pl-9 pr-4 py-2 text-sm text-[#37352f] placeholder:text-[#37352f]/30 focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                  />
                </div>
              </div>

                {/* Table Container */}
                <div className="flex-1 min-h-0 overflow-y-auto bg-white border border-[#e9e9e7] rounded-2xl shadow-sm hide-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#e9e9e7] text-[#37352f]/40 text-[10px] font-semibold tracking-tight">
                        <th className="py-3 px-5">Usuário</th>
                        <th className="py-3 px-5">Plano</th>
                        <th className="py-3 px-5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3f3f1]">
                      {filteredUsers.map((user) => (
                        <tr key={user.id} className="hover:bg-[#fafafa] transition-colors group">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center">
                                {user.avatar && !avatarErrors.has(user.id) ? (
                                  <img
                                    src={user.avatar}
                                    alt={user.name}
                                    className="w-full h-full object-cover"
                                    onError={() => setAvatarErrors(prev => new Set(prev).add(user.id))}
                                  />
                                ) : (
                                  <Avvvatars value={user.email} style="shape" size={28} radius={50} />
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-[#202020] leading-tight">{user.name || '�'}</p>
                                <p className="text-[11px] text-[#37352f]/40 leading-tight">{user.email}</p>
                              </div>
                              {user.activeRecently && (
                                <span title="Ativo nas últimas 24h" className="shrink-0">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#75a23f">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M12.01 2.011a3.2 3.2 0 0 1 2.113 .797l.154 .145l.698 .698a1.2 1.2 0 0 0 .71 .341l.135 .008h1a3.2 3.2 0 0 1 3.195 3.018l.005 .182v1c0 .27 .092 .533 .258 .743l.09 .1l.697 .698a3.2 3.2 0 0 1 .147 4.382l-.145 .154l-.698 .698a1.2 1.2 0 0 0 -.341 .71l-.008 .135v1a3.2 3.2 0 0 1 -3.018 3.195l-.182 .005h-1a1.2 1.2 0 0 0 -.743 .258l-.1 .09l-.698 .697a3.2 3.2 0 0 1 -4.382 .147l-.154 -.145l-.698 -.698a1.2 1.2 0 0 0 -.71 -.341l-.135 -.008h-1a3.2 3.2 0 0 1 -3.195 -3.018l-.005 -.182v-1a1.2 1.2 0 0 0 -.258 -.743l-.09 -.1l-.697 -.698a3.2 3.2 0 0 1 -.147 -4.382l.145 -.154l.698 -.698a1.2 1.2 0 0 0 .341 -.71l.008 -.135v-1l.005 -.182a3.2 3.2 0 0 1 3.013 -3.013l.182 -.005h1a1.2 1.2 0 0 0 .743 -.258l.1 -.09l.698 -.697a3.2 3.2 0 0 1 2.269 -.944zm3.697 7.282a1 1 0 0 0 -1.414 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z"/>
                                  </svg>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-2">
                              {user.planId === 'flow' ? (
                                <>
                                  <img src={flowLogo} alt="Flow" className="h-4 w-auto opacity-70" />
                                  <span className="text-xs font-semibold text-[#37352f]/60">Flow</span>
                                </>
                              ) : user.planId === 'pulse' ? (
                                <>
                                  <img src={pulseLogo} alt="Pulse" className="h-4 w-auto opacity-70" />
                                  <span className="text-xs font-semibold text-[#37352f]/60">Pulse</span>
                                </>
                              ) : (
                                <>
                                  <img src={gratisLogo} alt="Grátis" className="h-4 w-auto opacity-40" />
                                  <span className="text-xs font-semibold text-[#37352f]/30">Grátis</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  setSelectedUserMessages(user);
                                  setMessagesMode('by-user');
                                  setActiveTab('messages');
                                  setMessagesPage(1);
                                }}
                                className="p-1.5 text-[#37352f]/25 hover:text-[#202020] hover:bg-[#f3f3f1] rounded-lg transition-all"
                                title="Ver mensagens"
                              >
                                <MessageSquare size={13} />
                              </button>
                              {user.planId !== 'flow' && (
                                <button
                                  onClick={() => handleGrantAccess(user.id, 'flow')}
                                  className="p-1 hover:bg-[#f3f3f1] rounded-lg transition-all opacity-30 hover:opacity-100"
                                  title="Conceder Flow"
                                >
                                  <img src={flowLogo} alt="Flow" className="h-4 w-auto" />
                                </button>
                              )}
                              {user.planId !== 'pulse' && (
                                <button
                                  onClick={() => handleGrantAccess(user.id, 'pulse')}
                                  className="p-1 hover:bg-[#f3f3f1] rounded-lg transition-all opacity-30 hover:opacity-100"
                                  title="Conceder Pulse"
                                >
                                  <img src={pulseLogo} alt="Pulse" className="h-4 w-auto" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-12 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Users className="w-8 h-8 text-[#e9e9e7]" />
                              <span className="text-[#37352f]/40 text-sm">Nenhum usuário encontrado.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

            </motion.div>
          )}

          {/* �"��"��"��"��"��"��"��"��"��"��"� ABA PAINEL �"��"��"��"��"��"��"��"��"��"��"� */}
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-8">
                <p className="text-xs font-semibold text-[#37352f]/30 mb-1">
                  Bem-vindo de volta
                </p>
                <h2 className="text-2xl font-bold text-[#202020] tracking-tight">
                  {user?.user_metadata?.name?.split(' ')[0]
                    ? `Olá, ${user.user_metadata.name.split(' ')[0]}.`
                    : `Olá, ${user?.email?.split('@')[0]}.`}
                </h2>
                <p className="text-sm text-[#37352f]/40 mt-1">Visão geral da plataforma Flui.</p>
              </div>

              {stats ? (
                <>
                  <AdminDashboardStats stats={stats} />
                  <div className="hidden">
                  {[
                    { label: 'Mensagens enviadas', value: stats.totalMessages, icon: <MessageSquare size={16} /> },
                    { label: 'Tarefas criadas', value: stats.totalTasks, icon: <CheckSquare size={16} /> },
                    { label: 'Usuários com interação', value: stats.firstMessageUsers, icon: <Users size={16} /> },
                  ].map(({ label, value, icon }) => (
                    <div key={label} className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
                      <div className="flex items-center justify-between text-[#37352f]/30">
                        <span className="text-[11px] font-semibold tracking-wider">{label}</span>
                        {icon}
                      </div>
                      <span className="text-3xl font-bold text-[#202020]">{value}</span>
                    </div>
                  ))}

                  {/* WhatsApp card com barra */}
                  <div className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
                    <div className="flex items-center justify-between text-[#37352f]/30">
                      <span className="text-[11px] font-semibold tracking-wider">Consumo Wpp / mês</span>
                      <MessageCircle size={16} />
                    </div>
                    <div className="flex items-end gap-1.5">
                      <span className="text-3xl font-bold text-[#202020]">{stats.wppConversationsUsed}</span>
                      <span className="text-sm font-semibold text-[#37352f]/30 mb-0.5">/ {stats.wppFreeLimit}</span>
                    </div>
                    <div className="w-full bg-[#f3f3f1] h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${(stats.wppConversationsUsed / stats.wppFreeLimit) > 0.9 ? 'bg-red-400' : 'bg-[#202020]'}`}
                        style={{ width: `${Math.min((stats.wppConversationsUsed / stats.wppFreeLimit) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  </div>
                </>
              ) : (
                <div className="py-20 flex flex-col items-center gap-2 text-[#37352f]/30">
                  <CheckSquare size={28} />
                  <span className="text-sm">Carregando estatísticas...</span>
                </div>
              )}
            </motion.div>
          )}



          {/* �"��"��"��"��"��"��"��"��"��"��"� ABA MENSAGENS �"��"��"��"��"��"��"��"��"��"��"� */}
          {activeTab === 'messages' && (
            <motion.div
              key="messages"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {/* Header da seção */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-[#202020] tracking-tight">Log de mensagens</h2>
                  <p className="text-sm text-[#37352f]/40 mt-0.5">
                    {messagesTotal} mensagens registradas
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#37352f]/30 w-3.5 h-3.5" />
                    <input
                      type="text"
                      placeholder={messagesMode === 'by-user' && !selectedUserMessages ? "Buscar usuário..." : "Buscar conteúdo..."}
                      value={messagesMode === 'by-user' && !selectedUserMessages ? searchTerm : messagesSearch}
                      onChange={(e) => {
                        if (messagesMode === 'by-user' && !selectedUserMessages) {
                          setSearchTerm(e.target.value);
                        } else {
                          setMessagesSearch(e.target.value);
                        }
                      }}
                      className="w-full bg-white border border-[#e9e9e7] rounded-xl pl-9 pr-4 py-2 text-sm text-[#37352f] placeholder:text-[#37352f]/30 focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                    />
                  </div>
                  <button
                    onClick={fetchMessages}
                    disabled={messagesLoading}
                    className="p-2 bg-white text-[#37352f]/40 hover:text-[#202020] rounded-xl border border-[#e9e9e7] transition-all"
                    title="Atualizar"
                  >
                    <RefreshCw size={16} className={messagesLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* View: User List for selection */}
              {messagesMode === 'by-user' && !selectedUserMessages && (
                <div className="flex-1 min-h-0 overflow-y-auto bg-white border border-[#e9e9e7] rounded-2xl shadow-sm hide-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#e9e9e7] text-[#37352f]/40 text-[10px] font-semibold tracking-tight">
                        <th className="py-3 px-5">Usuário</th>
                        <th className="py-3 px-5">Plano</th>
                        <th className="py-3 px-5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3f3f1]">
                      {(searchTerm ? filteredUsers : users).map((u) => (
                        <tr key={u.id} className="hover:bg-[#fafafa] transition-colors group">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center">
                                {u.avatar && !avatarErrors.has(u.id) ? (
                                  <img
                                    src={u.avatar}
                                    alt={u.name}
                                    className="w-full h-full object-cover"
                                    onError={() => setAvatarErrors(prev => new Set(prev).add(u.id))}
                                  />
                                ) : (
                                  <Avvvatars value={u.email} style="shape" size={28} radius={50} />
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-[#202020] leading-tight">{u.name || '�'}</p>
                                <p className="text-[11px] text-[#37352f]/40 leading-tight">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-2">
                              {u.planId === 'flow' ? (
                                <>
                                  <img src={flowLogo} alt="Flow" className="h-4 w-auto opacity-70" />
                                  <span className="text-xs font-semibold text-[#37352f]/60">Flow</span>
                                </>
                              ) : u.planId === 'pulse' ? (
                                <>
                                  <img src={pulseLogo} alt="Pulse" className="h-4 w-auto opacity-70" />
                                  <span className="text-xs font-semibold text-[#37352f]/60">Pulse</span>
                                </>
                              ) : (
                                <>
                                  <img src={gratisLogo} alt="Grátis" className="h-4 w-auto opacity-40" />
                                  <span className="text-xs font-semibold text-[#37352f]/30">Grátis</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex items-center justify-end">
                              <button
                                onClick={() => {
                                  setMessages([]);
                                  setSelectedUserMessages(u);
                                  setMessagesPage(1);
                                }}
                                className="p-1.5 text-[#37352f]/25 hover:text-[#202020] hover:bg-[#f3f3f1] rounded-lg transition-all"
                                title="Ver mensagens"
                              >
                                <ArrowRight size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(searchTerm ? filteredUsers : users).length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-12 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Users className="w-8 h-8 text-[#e9e9e7]" />
                              <span className="text-[#37352f]/40 text-sm">Nenhum usuário encontrado.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedUserMessages && (
                <motion.div 
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between mb-8"
                >
                  <div className="flex items-center gap-3 px-4 py-2 bg-white border border-[#e9e9e7] rounded-2xl shadow-sm h-[42px] w-[200px] shrink-0">
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-[#e9e9e7] bg-white flex items-center justify-center">
                      <Avvvatars value={selectedUserMessages.email} style="shape" size={28} radius={50} />
                    </div>
                    <span className="text-xs font-semibold text-[#202020] tracking-tight truncate">
                      {selectedUserMessages.name || selectedUserMessages.email.split('@')[0]}
                    </span>
                  </div>

                  <button
                    onClick={() => setSelectedUserMessages(null)}
                    className="group flex items-center gap-2 px-6 py-2 bg-white border border-[#e9e9e7] rounded-2xl text-xs font-semibold text-[#37352f]/40 hover:text-[#202020] hover:border-[#202020]/20 hover:shadow-xl hover:shadow-black/5 transition-all active:scale-95 shadow-sm h-[42px] w-[200px] justify-center"
                  >
                    <ChevronLeft size={14} strokeWidth={3} className="group-hover:-translate-x-0.5 transition-transform" />
                    Voltar
                  </button>
                </motion.div>
              )}

              {/* Messages List (only show if viewed something) */}
              {(messagesMode === 'all' || selectedUserMessages) && (
                <div className="flex-1 min-h-0 overflow-y-auto bg-white border border-[#e9e9e7] rounded-2xl shadow-sm hide-scrollbar">
                  {messagesLoading ? (
                    <div className="py-20 flex flex-col items-center gap-3">
                      <RefreshCw size={24} className="text-[#37352f]/30 animate-spin" />
                      <span className="text-[#37352f]/40 font-medium text-sm">Carregando mensagens...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-20 flex flex-col items-center gap-3">
                      <MessageSquare size={32} className="text-[#e9e9e7]" />
                      <span className="text-[#37352f]/40 font-medium text-sm">Nenhuma mensagem encontrada.</span>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#e9e9e7] text-[#37352f]/40 text-[10px] font-semibold tracking-tight">
                          <th className="py-3 px-5">Data e hora</th>
                          <th className="py-3 px-5">Ator</th>
                          <th className="py-3 px-5">Mensagem</th>
                          <th className="py-3 px-5 text-right">Latência</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f3f3f1]">
                        {messages.map((msg) => {
                          const isAI = msg.role === 'assistant';
                          const diagnosticBadges = isAI ? getDiagnosticBadges(msg) : [];
                          const diagnostics = getMessageDiagnostics(msg);
                          return (
                            <React.Fragment key={msg.id}>
                                <motion.tr 
                                  layout
                                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                                  onMouseLeave={() => setHoveredMessageId(null)}
                                  onClick={() => setExpandedMessage(expandedMessage === msg.id ? null : msg.id)}
                                  initial={false}
                                  animate={{ 
                                    backgroundColor: expandedMessage === msg.id ? '#fcfcfb' : (hoveredMessageId === msg.id ? '#fafafa' : '#ffffff'),
                                    scale: hoveredMessageId === msg.id ? 0.995 : 1
                                  }}
                                  transition={{ 
                                    type: "spring",
                                    stiffness: 300,
                                    damping: 30
                                  }}
                                  className={`cursor-pointer group relative`}
                                >
                                <td className="py-3 px-5 whitespace-nowrap">
                                  <span className="text-[11px] font-medium text-[#37352f]/40">
                                    {formatShortDate(msg.created_at)}
                                  </span>
                                </td>
                                <td className="py-3 px-5">
                                  <div className="flex items-center gap-2">
                                    {isAI ? (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-lg bg-white flex items-center justify-center border border-purple-500/10 overflow-hidden shrink-0">
                                          <img src={luiLogo} alt="Lui" className="w-3.5 h-3.5 object-contain" />
                                        </div>
                                        <span className="text-xs font-bold text-black tracking-tight">
                                          Lui
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-[#e9e9e7]">
                                          <Avvvatars value={msg.user.email} style="shape" size={20} radius={4} />
                                        </div>
                                        <span className="text-xs font-semibold text-[#202020] truncate max-w-[80px]">
                                          {msg.user.name?.split(' ')[0] || msg.user.email.split('@')[0]}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <motion.td layout className="py-3 px-5 w-full relative">
                                  <motion.div 
                                    layout
                                    className={`text-xs text-[#37352f]/80 flex items-center justify-between gap-2 ${expandedMessage === msg.id ? 'opacity-0' : 'opacity-100'}`}
                                    transition={{ duration: 0.2 }}
                                  >
                                    <motion.p
                                      layoutId={`content-${msg.id}`}
                                      className={`min-w-0 flex-1 ${hoveredMessageId === msg.id ? '' : 'line-clamp-1'}`}
                                    >
                                      {msg.content || '(sem conteúdo)'}
                                    </motion.p>
                                    {diagnosticBadges.length > 0 && !expandedMessage && (
                                      <div className="hidden lg:flex items-center gap-1 shrink-0">
                                        {diagnosticBadges.map((badge) => (
                                          <span
                                            key={badge.key}
                                            title={badge.title}
                                            className={`max-w-[110px] truncate rounded-full border px-2 py-0.5 text-[8px] font-bold ${badge.className}`}
                                          >
                                            {badge.label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {msg.latency_ms && !expandedMessage && (
                                      <span className="text-[9px] font-bold text-[#37352f]/20 whitespace-nowrap">
                                        {msg.latency_ms}ms
                                      </span>
                                    )}
                                  </motion.div>
                                </motion.td>
                                <motion.td layout className="py-3 px-5 text-right whitespace-nowrap">
                                  {msg.latency_ms ? (
                                    <span className="text-[10px] font-bold text-[#37352f]/40">
                                      {formatMetric(msg.latency_ms)}ms
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-[#37352f]/20">�</span>
                                  )}
                                </motion.td>
                              </motion.tr>
                              <AnimatePresence mode="popLayout">
                                {expandedMessage === msg.id && (
                                  <motion.tr
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="bg-[#fcfcfb]"
                                  >
                                    <td colSpan={4} className="py-6 px-10">
                                      <motion.div 
                                        layout
                                        className="space-y-4"
                                      >
                                        <motion.div 
                                          layout
                                          initial={{ scale: 0.95, opacity: 0 }}
                                          animate={{ scale: 1, opacity: 1 }}
                                          exit={{ scale: 0.95, opacity: 0 }}
                                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                          className="bg-white border border-[#e9e9e7] rounded-xl p-5 shadow-sm"
                                        >
                                          <motion.p 
                                            layoutId={`content-${msg.id}`}
                                            className="text-sm text-[#37352f] leading-relaxed whitespace-pre-wrap"
                                          >
                                            {msg.content}
                                          </motion.p>
                                        </motion.div>
                                        {diagnosticBadges.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {diagnosticBadges.map((badge) => (
                                              <span
                                                key={badge.key}
                                                title={badge.title}
                                                className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[10px] font-bold ${badge.className}`}
                                              >
                                                {badge.label}
                                              </span>
                                            ))}
                                          </div>
                                        )}

                                        <div className="flex flex-wrap gap-x-8 gap-y-4 pt-2">
                                          {diagnostics.provider && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Provider</span>
                                              <span className="text-[11px] font-bold text-[#37352f]/60">{diagnostics.provider}</span>
                                            </div>
                                          )}
                                          {msg.model && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Modelo</span>
                                              <span className="text-[11px] font-bold text-[#37352f]/60">{msg.model}</span>
                                            </div>
                                          )}
                                          {diagnostics.errorClass && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Error class</span>
                                              <span className="text-[11px] font-bold text-red-700">{diagnostics.errorClass}</span>
                                            </div>
                                          )}
                                          {(diagnostics.fallbackUsed || diagnostics.artifactRecovery) && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Recuperação</span>
                                              <span className="text-[11px] font-bold text-[#37352f]/60">
                                                {[
                                                  diagnostics.fallbackUsed ? 'fallback' : null,
                                                  diagnostics.artifactRecovery ? 'artefatos' : null,
                                                ].filter(Boolean).join(' + ')}
                                              </span>
                                            </div>
                                          )}
                                          {msg.latency_ms && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Latência</span>
                                              <span className="text-[11px] font-bold text-[#37352f]/60">{formatMetric(msg.latency_ms)}ms</span>
                                            </div>
                                          )}
                                          <div className="flex flex-col gap-0.5">
                                            <span className="text-[9px] font-semibold text-[#37352f]/20">Direção</span>
                                            <span className="text-[11px] font-bold text-[#37352f]/60">{msg.direction}</span>
                                          </div>
                                          <div className="flex flex-col gap-0.5 ml-auto">
                                            <span className="text-[9px] font-semibold text-[#37352f]/20">Id da mensagem</span>
                                            <span className="text-[10px] font-mono text-[#37352f]/40">{msg.id}</span>
                                          </div>
                                        </div>
                                    </motion.div>
                                  </td>
                                </motion.tr>
                              )}
                            </AnimatePresence>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Pagination */}
                  {messagesTotalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-[#e9e9e7]">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-semibold text-[#37352f]/20">Navegação</span>
                        <span className="text-[11px] font-bold text-[#37352f]/40">
                          Página {messagesPage} de {messagesTotalPages}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setMessagesPage(p => Math.max(1, p - 1))}
                          disabled={messagesPage <= 1}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-[#e9e9e7] text-[#37352f]/40 hover:text-[#202020] hover:border-[#d0d0ce] hover:shadow-sm transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft size={14} strokeWidth={3} />
                        </button>
                        <button
                          onClick={() => setMessagesPage(p => Math.min(messagesTotalPages, p + 1))}
                          disabled={messagesPage >= messagesTotalPages}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-[#e9e9e7] text-[#37352f]/40 hover:text-[#202020] hover:border-[#d0d0ce] hover:shadow-sm transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                          <ChevronRight size={14} strokeWidth={3} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
          {/* �"��"��"��"��"��"��"��"��"��"��"� ABA CHANGELOG �"��"��"��"��"��"��"��"��"��"��"� */}
          {activeTab === 'changelog' && (
            <motion.div
              key="changelog"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-[#202020] tracking-tight">Changelog</h2>
                  <p className="text-sm text-[#37352f]/40 mt-0.5">Publique atualizações visíveis para os usuários.</p>
                </div>
                <button
                  onClick={() => setShowChangelogForm(true)}
                  className="px-4 py-2 bg-[#202020] text-white text-xs font-bold rounded-xl hover:bg-[#30302e] transition-all flex items-center gap-1.5"
                >
                  <Plus size={13} />
                  Nova entrada
                </button>
              </div>

              {/* Modal de criação */}
              <Modal
                isOpen={showChangelogForm}
                onClose={() => setShowChangelogForm(false)}
                title="Nova entrada de changelog"
                subtitle="Será exibida publicamente na página /changelog"
                headerIcon={<ScrollText size={16} />}
                maxWidth="max-w-lg"
                footer={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCreateChangelog('draft')}
                      disabled={changelogSubmitting || !changelogForm.title.trim() || !changelogForm.description.trim()}
                      className="px-4 py-2 bg-[#f0f0ee] text-[#37352f] text-xs font-bold rounded-xl hover:bg-[#e9e9e7] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {changelogSubmitting ? <RefreshCw size={12} className="animate-spin" /> : <ScrollText size={12} />}
                      Salvar rascunho
                    </button>
                    <button
                      onClick={() => handleCreateChangelog('published')}
                      disabled={changelogSubmitting || !changelogForm.title.trim() || !changelogForm.description.trim()}
                      className="px-4 py-2 bg-[#202020] text-white text-xs font-bold rounded-xl hover:bg-[#30302e] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {changelogSubmitting ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                      Publicar agora
                    </button>
                  </div>
                }
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
                    <input
                      type="text"
                      placeholder="Título da atualização..."
                      value={changelogForm.title}
                      onChange={e => setChangelogForm(f => ({ ...f, title: e.target.value }))}
                      className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-4 py-2.5 text-sm text-[#37352f] placeholder:text-[#37352f]/30 focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                    />
                    <input
                      type="text"
                      placeholder="v1.0.0"
                      value={changelogForm.version}
                      onChange={e => setChangelogForm(f => ({ ...f, version: e.target.value }))}
                      className="w-24 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-3 py-2.5 text-sm text-[#37352f] placeholder:text-[#37352f]/30 focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all font-mono"
                    />
                    <select
                      value={changelogForm.type}
                      onChange={e => setChangelogForm(f => ({ ...f, type: e.target.value as ChangelogEntry['type'] }))}
                      className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-3 py-2.5 text-sm text-[#37352f] focus:outline-none focus:border-[#202020] transition-all"
                    >
                      <option value="feature">Novidade</option>
                      <option value="improvement">Melhoria</option>
                      <option value="fix">Correção</option>
                      <option value="breaking">Atenção</option>
                    </select>
                  </div>

                  <ChangelogEditor
                    value={changelogForm.description}
                    onChange={desc => setChangelogForm(f => ({ ...f, description: desc }))}
                  />
                </div>
              </Modal>

              {/* Lista de entradas */}
              <div className="space-y-3">
                {changelogLoading ? (
                  <div className="py-20 flex justify-center">
                    <RefreshCw size={24} className="text-[#37352f]/10 animate-spin" />
                  </div>
                ) : changelogEntries.length === 0 ? (
                  <div className="py-20 border border-dashed border-[#e9e9e7] rounded-[32px] flex flex-col items-center gap-3 text-[#37352f]/20 bg-[#fafafa]/50">
                    <ScrollText size={28} strokeWidth={1.5} />
                    <p className="text-sm font-medium tracking-tight">Nenhuma atualização encontrada.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {changelogEntries.map(entry => {
                      const config = CHANGELOG_TYPE_CONFIG[entry.type] || CHANGELOG_TYPE_CONFIG.feature
                      return (
                        <div key={entry.id} className="group relative flex items-center gap-6 p-6 bg-white border border-[#e9e9e7] rounded-[24px]">
                          {/* Icon container */}
                          <div className="shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl bg-[#f7f7f5] overflow-hidden">
                            {config.icon}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <h3 className="text-base font-bold text-[#202020] truncate tracking-tight">{entry.title}</h3>
                              <div className="flex items-center h-5">
                                {entry.version && (
                                  <span className={`h-full flex items-center text-[10px] font-mono font-bold text-[#37352f]/20 bg-[#f7f7f5] px-2 border border-[#e9e9e7]/50 ${entry.status === 'draft' ? 'rounded-l-full border-r-0' : 'rounded-full'}`}>
                                    {entry.version}
                                  </span>
                                )}
                                {entry.status === 'draft' && (
                                  <span className={`h-full flex items-center text-[10px] font-bold text-amber-500/80 bg-amber-50 px-2 border border-amber-200/30 ${entry.version ? 'rounded-r-full' : 'rounded-full'}`}>
                                    Rascunho
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 mt-2">
                              <span className="text-[11px] font-bold text-[#37352f]/30 tracking-tight">{config.label}</span>
                              <div className="w-1 h-1 rounded-full bg-[#37352f]/10" />
                              <span className="text-[11px] font-medium text-[#37352f]/20">
                                {new Date(entry.published_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pr-1">
                            <button
                              onClick={() => window.dispatchEvent(new CustomEvent('changelog-preview', { detail: entry }))}
                              className="p-2.5 text-[#37352f]/30 hover:text-[#202020] hover:bg-[#f7f7f5] rounded-xl transition-all"
                              title="Visualizar Modal"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={() => openEditEntry(entry)}
                              className="p-2.5 text-[#37352f]/30 hover:text-[#202020] hover:bg-[#f7f7f5] rounded-xl transition-all"
                              title="Editar"
                            >
                              <Pencil size={15} />
                            </button>
                            {entry.status === 'draft' && (
                              <button
                                onClick={() => handlePublishChangelog(entry.id)}
                                className="px-3.5 py-2 text-[10px] font-black text-white bg-[#202020] hover:bg-black rounded-xl transition-all shadow-sm active:scale-95"
                              >
                                Publicar
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteChangelog(entry.id)}
                              className="p-2.5 text-[#37352f]/15 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                              title="Deletar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══════════ MODAL: EDITAR CHANGELOG ═══════════ */}
      <AnimatePresence>
        {editingEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setEditingEntry(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white border border-[#e9e9e7] rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-[#e9e9e7]">
                <div>
                  <h2 className="text-lg font-extrabold text-[#202020]">Editar Changelog</h2>
                  <p className="text-xs text-[#37352f]/40 font-medium mt-0.5">
                    {editingEntry.status === 'published' ? 'Publicado' : 'Rascunho'} · criado em {new Date(editingEntry.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button onClick={() => setEditingEntry(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f7f7f5] text-[#37352f]/40 hover:text-[#202020] transition-all">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
                <div>
                  <label className="block text-xs font-bold text-[#37352f]/60 uppercase tracking-wider mb-1.5">Título *</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-4 py-3 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#37352f]/60 uppercase tracking-wider mb-1.5">Versão</label>
                    <input
                      type="text"
                      value={editForm.version}
                      onChange={e => setEditForm(f => ({ ...f, version: e.target.value }))}
                      placeholder="Ex: 2.1.0"
                      className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-4 py-3 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#37352f]/60 uppercase tracking-wider mb-1.5">Tipo</label>
                    <select
                      value={editForm.type}
                      onChange={e => setEditForm(f => ({ ...f, type: e.target.value as ChangelogEntry['type'] }))}
                      className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl px-4 py-3 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                    >
                      <option value="feature">Novidade</option>
                      <option value="improvement">Melhoria</option>
                      <option value="fix">Correção</option>
                      <option value="breaking">Atenção</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#37352f]/60 uppercase tracking-wider mb-1.5">Descrição *</label>
                  <ChangelogEditor
                    value={editForm.description}
                    onChange={desc => setEditForm(f => ({ ...f, description: desc }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e9e9e7] bg-[#fafafa]">
                <button
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2.5 text-sm font-bold text-[#37352f]/60 hover:text-[#202020] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleUpdateChangelog()}
                  disabled={editSubmitting || !editForm.title.trim() || !editForm.description.trim()}
                  className="px-4 py-2.5 bg-white text-[#37352f] text-sm font-bold rounded-xl border border-[#e9e9e7] hover:bg-[#f7f7f5] shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <EyeOff size={14} />
                  Salvar alterações
                </button>
                {editingEntry.status === 'draft' && (
                  <button
                    onClick={() => handleUpdateChangelog('published')}
                    disabled={editSubmitting || !editForm.title.trim() || !editForm.description.trim()}
                    className="px-4 py-2.5 bg-[#202020] text-white text-sm font-bold rounded-xl hover:bg-black shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Eye size={14} />
                    Salvar e publicar
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
