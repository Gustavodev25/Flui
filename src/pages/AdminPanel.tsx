import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { AdminChatSimulator } from './AdminChatSimulator';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldAlert, Search, Users, LogOut, ArrowRight,
  MessageSquare, CheckSquare, MessageCircle, Bot, User as UserIcon,
  ChevronLeft, ChevronRight, Globe, Smartphone,
  Filter, RefreshCw, Route, MapPin, Activity, BookOpen, AlertTriangle, TrendingUp
} from 'lucide-react';
import Avvvatars from 'avvvatars-react';
import logo from '../assets/logo/logo.svg';
import luiLogo from '../assets/logo/lui.svg';
import flowLogo from '../assets/logo/flow.svg';
import pulseLogo from '../assets/logo/pulse.svg';
import gratisLogo from '../assets/logo/gratis.svg';
import { motion, AnimatePresence } from 'framer-motion';
import PixelBlast from '../components/ui/PixelBlast';

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
  if (channel === 'web') return 'Web';
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

function AdminDashboardStats({ stats }: { stats: AdminStats }) {
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
              <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
              {icon}
            </div>
            <span className="text-3xl font-bold text-[#202020]">{formatMetric(value)}</span>
          </div>
        ))}

        <div className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
          <div className="flex items-center justify-between text-[#37352f]/30">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Consumo Wpp / mês</span>
            <MessageCircle size={16} />
          </div>
          <div className="flex items-end gap-1.5">
            <span className="text-3xl font-bold text-[#202020]">{formatMetric(stats.wppConversationsUsed)}</span>
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
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#37352f]/30">
              {stats.analytics?.routeTrackingStatus === 'active' ? 'Ativo' : 'Aguardando'}
            </span>
          </div>

          {stats.analytics?.routes?.length ? (
            <div className="space-y-4">
              {stats.analytics.routes.map((route) => (
                <div key={route.path} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#202020] truncate">{route.label}</p>
                      <p className="text-[11px] font-medium text-[#37352f]/35 truncate">{route.path} • {formatShortDate(route.lastSeenAt)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-[#202020]">{formatMetric(route.visits)}</p>
                      <p className="text-[10px] font-bold text-[#37352f]/30">{formatMetric(route.uniqueUsers)} usuários</p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#f3f3f1] overflow-hidden">
                    <div className="h-full bg-[#202020] rounded-full" style={{ width: `${Math.max(route.percentage, 4)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex items-start gap-3 text-[#37352f]/45">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">
                {stats.analytics?.routeTrackingStatus === 'not_configured'
                  ? 'A coleta de rotas já foi adicionada, mas a tabela site_route_events ainda precisa existir no Supabase.'
                  : 'Ainda não há eventos de rota suficientes. As próximas navegações começarão a aparecer aqui.'}
              </p>
            </div>
          )}
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
                    <p className="text-[11px] font-medium text-[#37352f]/35 truncate">{state.country} • {formatMetric(state.visits)} visitas • {formatMetric(state.messages)} msgs</p>
                  </div>
                  <span className="text-lg font-black text-[#202020]">{formatMetric(state.users)}</span>
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
            <p className="text-xs text-[#37352f]/40 mt-1">Volume, canais e sinais técnicos das conversas recentes.</p>
          </div>
          <span className="text-[11px] font-bold text-[#37352f]/35">
            Última mensagem: {formatShortDate(stats.analytics?.conversations.lastMessageAt)}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Conversas', value: stats.analytics?.conversations.totalThreads || 0 },
            { label: 'Mensagens hoje', value: stats.analytics?.conversations.messagesToday || 0 },
            { label: 'Usuários 7d', value: stats.analytics?.conversations.activeUsers7d || 0 },
            { label: 'Chamadas de ferramentas', value: stats.analytics?.conversations.toolCalls || 0 },
          ].map((metric) => (
            <div key={metric.label} className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#37352f]/35">{metric.label}</p>
              <p className="text-2xl font-black text-[#202020] mt-1">{formatMetric(metric.value)}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.8fr] gap-5">
          <div className="space-y-3">
            {stats.analytics?.channels?.length ? stats.analytics.channels.map((channel) => (
              <div key={channel.channel} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {channel.channel === 'whatsapp' ? <Smartphone size={14} className="text-green-600" /> : <Globe size={14} className="text-[#37352f]/50" />}
                    <span className="text-sm font-bold text-[#202020]">{channelLabel(channel.channel)}</span>
                  </div>
                  <span className="text-xs font-bold text-[#37352f]/40">{formatMetric(channel.messages)} mensagens</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#f3f3f1] overflow-hidden">
                  <div className="h-full bg-[#202020] rounded-full" style={{ width: `${Math.max(channel.percentage, 4)}%` }} />
                </div>
              </div>
            )) : (
              <p className="text-sm text-[#37352f]/40">Sem canais recentes para exibir.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-[#37352f]/30">Latência</p>
              <p className="text-lg font-black text-[#202020]">{formatMetric(stats.analytics?.conversations.avgLatencyMs)}ms</p>
            </div>
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-[#37352f]/30">Fallback</p>
              <p className="text-lg font-black text-[#202020]">{formatMetric(stats.analytics?.conversations.fallbackRate)}%</p>
            </div>
            <div className="rounded-xl border border-[#e9e9e7] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-[#37352f]/30">Não lidas</p>
              <p className="text-lg font-black text-[#202020]">{formatMetric(stats.analytics?.conversations.unreadThreads)}</p>
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
                  <span className="text-lg font-black text-[#202020]">{formatMetric(signal.count)}</span>
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

type AdminTab = 'dashboard' | 'users' | 'messages' | 'simulator';

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
  const [messagesChannel, setMessagesChannel] = useState<string>('all');
  const [messagesSearch, setMessagesSearch] = useState('');
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const [selectedUserMessages, setSelectedUserMessages] = useState<User | null>(null);
  const [messagesMode, setMessagesMode] = useState<'all' | 'by-user'>('by-user');

  const adminFetch = useCallback(<T,>(
    path: string,
    init?: RequestInit,
    query?: Record<string, string | number | boolean | undefined | null>
  ) => {
    if (!accessToken) {
      throw new Error('Sessao Supabase ausente.');
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

    return apiFetch<T>(path, { ...init, headers }, query);
  }, [accessToken]);

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
        channel: messagesChannel,
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
  }, [adminFetch, isAuthenticated, messagesPage, messagesChannel, messagesSearch, selectedUserMessages]);

  useEffect(() => {
    if (activeTab === 'messages' && isAuthenticated) {
      fetchMessages();
    }
  }, [activeTab, fetchMessages]);

  // Reset page when filters change
  useEffect(() => {
    setMessagesPage(1);
  }, [messagesChannel, messagesSearch, selectedUserMessages, messagesMode]);

  // ---------------------------------------------
  // LOADER — validando sessão
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

  const getRoleBadge = (role: string) => {
    if (role === 'assistant') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 border border-purple-500/20">
          <Bot size={10} /> IA
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/20">
        <UserIcon size={10} /> Usuário
      </span>
    );
  };

  const getChannelBadge = (channel: string) => {
    if (channel === 'whatsapp') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-500/10 text-green-600 border border-green-500/20">
          <Smartphone size={10} /> WhatsApp
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#37352f]/5 text-[#37352f]/60 border border-[#e9e9e7]">
        <Globe size={10} /> Web
      </span>
    );
  };

  return (
    <div className="h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative overflow-hidden flex flex-col">
      {/* Background Decoration - Only at the top */}
      <div className="absolute inset-x-0 top-0 h-[500px] z-0 pointer-events-none overflow-hidden bg-[#f7f7f5]">
        <PixelBlast 
          count={12}
          color="#202020"
          size={120}
          speed={0.2}
          className="opacity-[0.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#f7f7f5]/50 to-white" />
      </div>

      {/* ═══════════ TOP BAR ═══════════ */}
      <header className="sticky top-0 z-50 bg-white/10 backdrop-blur-md border-b border-[#e9e9e7]">
        <div className={`${activeTab === 'simulator' ? 'w-full px-6' : 'max-w-6xl mx-auto px-6'} py-4 transition-all duration-300`}>
          <div className="flex items-center justify-between">
            {/* Left: Logo (Igual LP) */}
            <div className="flex items-center gap-2">
              <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
              <span className="text-xl font-bold tracking-tight text-[#202020]">flui.</span>
            </div>

            {/* Center: Navigation Tabs (Style refined) - More robust than absolute position */}
            <nav className="hidden lg:flex items-center gap-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl p-1">
              {([
                { id: 'dashboard', label: 'Painel', icon: <CheckSquare size={14} /> },
                { id: 'users',     label: 'Usuários', icon: <Users size={14} /> },
                { id: 'messages',  label: 'Mensagens', icon: <MessageSquare size={14} /> },
                { id: 'simulator', label: 'Simulador', icon: <Bot size={14} /> },
              ] as { id: AdminTab; label: string; icon: React.ReactNode }[]).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === id
                      ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                      : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
            </nav>

            {/* Right: name + Logout & Mobile Menu */}
            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-xs font-medium text-[#37352f]/40">
                {user?.user_metadata?.name?.split(' ')[0] || user?.email?.split('@')[0]}
              </span>
              {/* Mobile menu */}
              <div className="lg:hidden flex items-center gap-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-lg p-1 mr-2">
                {([
                  { id: 'dashboard', icon: <CheckSquare size={15} /> },
                  { id: 'users',     icon: <Users size={15} /> },
                  { id: 'messages',  icon: <MessageSquare size={15} /> },
                  { id: 'simulator', icon: <Bot size={15} /> },
                ] as { id: AdminTab; icon: React.ReactNode }[]).map(({ id, icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`p-1.5 rounded-md transition-all ${activeTab === id ? 'bg-white shadow-sm text-[#202020]' : 'text-[#37352f]/40'}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>

              <button 
                onClick={() => {
                  setIsAuthenticated(false);
                  signOut();
                }}
                className="px-4 py-2 bg-[#202020] text-white text-[11px] font-bold uppercase tracking-wider rounded-xl hover:bg-[#30302E] shadow-sm transition-all flex items-center gap-2"
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
        activeTab === 'simulator' ? 'w-full px-0' :
        activeTab === 'users' ? 'w-full max-w-6xl mx-auto px-6 py-8 flex flex-col' :
        'w-full max-w-6xl mx-auto px-6 py-8 overflow-y-auto custom-scrollbar'
      }`}>
        
        <AnimatePresence mode="wait">
          {/* ═══════════ ABA USUÁRIOS ═══════════ */}
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
                  <h2 className="text-xl font-bold text-[#202020] tracking-tight">Usuários</h2>
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
                <div className="flex-1 min-h-0 overflow-y-auto bg-white border border-[#e9e9e7] rounded-2xl shadow-sm [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#e9e9e7] text-[#37352f]/40 text-[10px] font-semibold uppercase tracking-widest">
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
                                <p className="text-sm font-semibold text-[#202020] leading-tight">{user.name || '—'}</p>
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

          {/* ═══════════ ABA PAINEL ═══════════ */}
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-8">
                <p className="text-xs font-semibold text-[#37352f]/30 uppercase tracking-widest mb-1">
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
                        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
                        {icon}
                      </div>
                      <span className="text-3xl font-bold text-[#202020]">{value}</span>
                    </div>
                  ))}

                  {/* WhatsApp card com barra */}
                  <div className="bg-white border border-[#e9e9e7] rounded-2xl p-5 flex flex-col gap-3 hover:border-[#d0d0ce] transition-all">
                    <div className="flex items-center justify-between text-[#37352f]/30">
                      <span className="text-[11px] font-semibold uppercase tracking-wider">Consumo Wpp / mês</span>
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

          {/* ═══════════ ABA SIMULADOR ═══════════ */}
          {activeTab === 'simulator' && (
            <motion.div
              key="simulator"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full h-full"
            >
              <AdminChatSimulator isEmbedded={true} />
            </motion.div>
          )}

          {/* ═══════════ ABA MENSAGENS ═══════════ */}
          {activeTab === 'messages' && (
            <motion.div
              key="messages"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              {/* Header da seção */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-[#202020]">Log de Mensagens</h2>
                  <p className="text-[#37352f]/50 font-medium text-sm mt-1">
                    {messagesTotal} mensagens registradas — Conversas de usuários e respostas da IA
                  </p>
                </div>
                <button
                  onClick={fetchMessages}
                  disabled={messagesLoading}
                  className="px-4 py-2.5 bg-white text-[#37352f] text-sm font-bold rounded-xl hover:bg-[#f7f7f5] border border-[#e9e9e7] shadow-sm transition-all flex items-center gap-2"
                >
                  <RefreshCw size={14} className={messagesLoading ? 'animate-spin' : ''} />
                  Atualizar
                </button>
              </div>

              {/* Subtabs for Messages */}
              <div className="flex items-center gap-4 mb-6 border-b border-[#e9e9e7]">
                <button
                  onClick={() => {
                    setMessagesMode('by-user');
                    if (selectedUserMessages) setSelectedUserMessages(null);
                  }}
                  className={`pb-3 text-sm font-bold transition-all relative ${
                    messagesMode === 'by-user' ? 'text-[#202020]' : 'text-[#37352f]/40 hover:text-[#37352f]/60'
                  }`}
                >
                  Por Usuário
                  {messagesMode === 'by-user' && (
                    <motion.div layoutId="msgTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-[#202020]" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setMessagesMode('all');
                    setSelectedUserMessages(null);
                  }}
                  className={`pb-3 text-sm font-bold transition-all relative ${
                    messagesMode === 'all' ? 'text-[#202020]' : 'text-[#37352f]/40 hover:text-[#37352f]/60'
                  }`}
                >
                  Todos os Logs
                  {messagesMode === 'all' && (
                    <motion.div layoutId="msgTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-[#202020]" />
                  )}
                </button>
              </div>

              {/* View: User List for selection */}
              {messagesMode === 'by-user' && !selectedUserMessages && (
                <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setMessages([]);
                          setSelectedUserMessages(u);
                          setMessagesPage(1);
                        }}
                        className="flex items-center gap-3 p-4 bg-white border border-[#e9e9e7] rounded-2xl hover:border-[#202020] hover:shadow-md transition-all text-left group"
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#37352f]/5 to-[#37352f]/10 flex items-center justify-center font-bold text-[#37352f]/40 shrink-0 group-hover:from-[#202020]/5 group-hover:to-[#202020]/10 transition-colors">
                          {u.name?.[0]?.toUpperCase() || u.email[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-[#202020] truncate">{u.name || 'Sem nome'}</p>
                          <p className="text-[11px] font-medium text-[#37352f]/40 truncate">{u.email}</p>
                        </div>
                        <ArrowRight size={14} className="ml-auto text-[#37352f]/20 group-hover:text-[#202020] transition-colors" />
                      </button>
                    ))}
                    {filteredUsers.length === 0 && (
                      <div className="col-span-full py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Users className="w-10 h-10 text-[#e9e9e7]" />
                          <span className="text-[#37352f]/40 font-medium text-sm">Nenhum usuário encontrado para selecionar.</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Filters (only show if viewed something) */}
              {(messagesMode === 'all' || selectedUserMessages) && (
                <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
                  {/* Back button if single user */}
                  {selectedUserMessages && (
                    <button
                      onClick={() => setSelectedUserMessages(null)}
                      className="flex items-center gap-2 px-3 py-2 bg-white border border-[#e9e9e7] rounded-lg text-sm font-bold text-[#37352f]/60 hover:text-[#202020] transition-colors"
                    >
                      <ChevronLeft size={16} />
                      Voltar
                    </button>
                  )}
                  
                  {/* Selected user badge */}
                  {selectedUserMessages && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#202020] text-white rounded-lg text-sm font-bold shadow-sm">
                      <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                        {selectedUserMessages.name?.[0]?.toUpperCase() || selectedUserMessages.email[0].toUpperCase()}
                      </div>
                      <span className="truncate max-w-[150px]">{selectedUserMessages.name || selectedUserMessages.email}</span>
                    </div>
                  )}

                  {/* Channel filter */}
                  <div className="flex items-center gap-2">
                    <Filter size={14} className="text-[#37352f]/40" />
                    <select
                      value={messagesChannel}
                      onChange={(e) => setMessagesChannel(e.target.value)}
                      className="bg-white border border-[#e9e9e7] rounded-lg px-3 py-2 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] shadow-sm"
                    >
                      <option value="all">Todos os canais</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="web">Web</option>
                    </select>
                  </div>

                  {/* Search */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#37352f]/40 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Buscar por nome, email ou conteúdo..."
                      value={messagesSearch}
                      onChange={(e) => setMessagesSearch(e.target.value)}
                      className="w-full bg-white border border-[#e9e9e7] rounded-lg pl-9 pr-4 py-2 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] shadow-sm transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Messages List (only show if viewed something) */}
              {(messagesMode === 'all' || selectedUserMessages) && (
                <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl shadow-sm overflow-hidden">
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
                    <div className="p-6 flex flex-col gap-10">
                      {(() => {
                        const groups: { [key: string]: typeof messages } = {};
                        messages.forEach(msg => {
                          const date = new Date(msg.created_at);
                          const dateKey = date.toLocaleDateString('pt-BR');
                          if (!groups[dateKey]) groups[dateKey] = [];
                          groups[dateKey].push(msg);
                        });

                        return Object.entries(groups).map(([dateKey, groupMessages]) => {
                          const today = new Date().toLocaleDateString('pt-BR');
                          const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR');
                          
                          let displayDate = dateKey;
                          if (dateKey === today) displayDate = 'Hoje';
                          else if (dateKey === yesterday) displayDate = 'Ontem';

                          return (
                            <div key={dateKey} className="flex flex-col gap-6">
                              {/* Date Header - Ultra Minimal */}
                              <div className="flex justify-center py-4">
                                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#37352f]/20">
                                  {displayDate}
                                </span>
                              </div>

                              <div className="flex flex-col gap-6">
                                {groupMessages.map((msg) => {
                                  const isExpanded = expandedMessage === msg.id;
                                  const isAI = msg.role === 'assistant';
                                  
                                  return (
                                    <div
                                      key={msg.id}
                                      className={`flex w-full ${isAI ? 'justify-start' : 'justify-end'}`}
                                    >
                                      <div className={`max-w-[75%] flex flex-col ${isAI ? 'items-start' : 'items-end'}`}>
                                        {/* Sender Header - With Avatars */}
                                        <div className={`flex items-center gap-2 mb-1.5 px-0.5 ${isAI ? 'flex-row' : 'flex-row-reverse'}`}>
                                          <div className={`w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0 ${
                                            isAI ? 'bg-[#202020]' : 'bg-[#37352f]/10'
                                          }`}>
                                            {isAI ? (
                                              <img src={luiLogo} alt="Lui" className="w-2.5 h-2.5 object-cover" />
                                            ) : msg.user.avatar ? (
                                              <img src={msg.user.avatar} alt={msg.user.name} className="w-full h-full object-cover" />
                                            ) : (
                                              <span className="text-[7px] font-black text-[#37352f]/40 uppercase">
                                                {msg.user.name?.[0] || 'U'}
                                              </span>
                                            )}
                                          </div>
                                          
                                          <div className={`flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity ${isAI ? 'flex-row' : 'flex-row-reverse'}`}>
                                            <span className="text-[10px] font-black tracking-widest uppercase text-[#37352f]">
                                              {isAI ? 'Lui' : msg.user.name.split(' ')[0]}
                                            </span>
                                            <span className="text-[8px] font-bold text-[#37352f]/30 uppercase">
                                              {msg.channel}
                                            </span>
                                          </div>
                                        </div>

                                        {/* Message Bubble - Defined & Minimal */}
                                        <div 
                                          onClick={() => setExpandedMessage(isExpanded ? null : msg.id)}
                                          className={`px-5 py-3.5 rounded-2xl transition-all cursor-pointer ${
                                            isAI 
                                              ? 'bg-[#efefee] text-[#37352f]/90 rounded-tl-none border border-[#e9e9e7]/50' 
                                              : 'bg-[#202020] text-white/90 rounded-tr-none'
                                          }`}
                                        >
                                          <p className="text-[13px] leading-relaxed font-medium whitespace-pre-wrap break-words">
                                            {msg.content || '(sem conteúdo)'}
                                          </p>

                                          {/* Metadata - Ultra Minimalist Technical Details */}
                                          <AnimatePresence>
                                            {isExpanded && (
                                              <motion.div
                                                initial={{ opacity: 0, y: -5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -5 }}
                                                className={`mt-3 flex gap-3 text-[7px] font-black uppercase tracking-[0.2em] ${
                                                  isAI ? 'text-[#37352f]/20' : 'text-white/20'
                                                }`}
                                              >
                                                {msg.model && <span>{msg.model}</span>}
                                                {msg.latency_ms && <span>{msg.latency_ms}ms</span>}
                                                <span className="ml-auto opacity-50">Ref: {msg.id.substring(0, 6)}</span>
                                              </motion.div>
                                            )}
                                          </AnimatePresence>
                                        </div>

                                        {/* Time - Subtle */}
                                        <div className="mt-1.5 px-1 opacity-20">
                                          <span className="text-[8px] font-black uppercase tracking-tighter">
                                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {/* Pagination */}
                  {messagesTotalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-[#e9e9e7]">
                      <span className="text-sm font-medium text-[#37352f]/50">
                        Página {messagesPage} de {messagesTotalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMessagesPage(p => Math.max(1, p - 1))}
                          disabled={messagesPage <= 1}
                          className="p-2 rounded-lg bg-[#f7f7f5] border border-[#e9e9e7] text-[#37352f]/60 hover:bg-[#e9e9e7] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={() => setMessagesPage(p => Math.min(messagesTotalPages, p + 1))}
                          disabled={messagesPage >= messagesTotalPages}
                          className="p-2 rounded-lg bg-[#f7f7f5] border border-[#e9e9e7] text-[#37352f]/60 hover:bg-[#e9e9e7] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
