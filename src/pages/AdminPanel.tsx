import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';

import { useAuth } from '../contexts/AuthContext';
import {
  ShieldAlert, Search, Users, LogOut, ArrowRight,
  MessageSquare, CheckSquare, MessageCircle, User as UserIcon,
  ChevronLeft, ChevronRight, Smartphone,
  RefreshCw, Route, MapPin, Activity, BookOpen, AlertTriangle, TrendingUp,
  Globe
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
              {stats.analytics.routes.map((route) => (
                <div key={route.path} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#202020] truncate">{route.label}</p>
                      <p className="text-[11px] font-medium text-[#37352f]/35 truncate">{route.path} • {formatShortDate(route.lastSeenAt)}</p>
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
              Última mensagem: {formatShortDate(stats.analytics?.conversations.lastMessageAt)}
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

type AdminTab = 'dashboard' | 'users' | 'messages';

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

  // Reset page when filters change
  useEffect(() => {
    setMessagesPage(1);
  }, [messagesSearch, selectedUserMessages, messagesMode]);

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

      {/* ═══════════ TOP BAR ═══════════ */}
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
              {(['dashboard', 'users', 'messages'] as AdminTab[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`text-xs font-bold transition-all ${
                    activeTab === id
                      ? 'text-[#202020]'
                      : 'text-[#37352f]/40 hover:text-[#37352f]/80'
                  }`}
                >
                  {id === 'dashboard' ? 'Painel' : id === 'users' ? 'Usuários' : 'Mensagens'}
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
                {(['dashboard', 'users', 'messages'] as AdminTab[]).map((id) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`text-[10px] font-bold transition-all ${
                      activeTab === id ? 'text-[#202020]' : 'text-[#37352f]/40'
                    }`}
                  >
                    {id === 'dashboard' ? 'Painel' : id === 'users' ? 'Usuários' : 'Mensagens'}
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



          {/* ═══════════ ABA MENSAGENS ═══════════ */}
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
                                <p className="text-sm font-semibold text-[#202020] leading-tight">{u.name || '—'}</p>
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
                                      className={`${hoveredMessageId === msg.id ? '' : 'line-clamp-1'}`}
                                    >
                                      {msg.content || '(sem conteúdo)'}
                                    </motion.p>
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
                                    <span className="text-[10px] text-[#37352f]/20">—</span>
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
                                      
                                        <div className="flex flex-wrap gap-x-8 gap-y-4 pt-2">
                                          {msg.model && (
                                            <div className="flex flex-col gap-0.5">
                                              <span className="text-[9px] font-semibold text-[#37352f]/20">Modelo</span>
                                              <span className="text-[11px] font-bold text-[#37352f]/60">{msg.model}</span>
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
        </AnimatePresence>
      </div>
    </div>
  );
}
