import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import {
  ShieldAlert, Search, Users, LogOut, ArrowRight, ShieldCheck,
  MessageSquare, CheckSquare, MessageCircle, Bot, User as UserIcon,
  ChevronLeft, ChevronRight, Clock, Zap, Globe, Smartphone,
  Filter, RefreshCw
} from 'lucide-react';
import logo from '../assets/logo/logo.svg';
import { motion, AnimatePresence } from 'framer-motion';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSignIn: string;
  hasFlow: boolean;
  planId: string | null;
  subscriptionStatus: string;
}

interface AdminStats {
  totalMessages: number;
  totalTasks: number;
  firstMessageUsers: number;
  wppConversationsUsed: number;
  wppFreeLimit: number;
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

type AdminTab = 'users' | 'messages';

export function AdminPanel() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Messages state
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesTotalPages, setMessagesTotalPages] = useState(1);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesChannel, setMessagesChannel] = useState<string>('all');
  const [messagesSearch, setMessagesSearch] = useState('');
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const resp = await apiFetch<{ users: User[] }>(`/api/admin/users`, undefined, { password });
      setUsers(resp.users || []);

      try {
        const statsResp = await apiFetch<AdminStats>(`/api/admin/stats`, undefined, { password });
        setStats(statsResp);
      } catch (e) {
        console.error("Falha ao buscar estatísticas:", e);
      }

      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || 'Senha incorreta.');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async (userId: string, plan: 'flow' | 'pulse') => {
    const planLabel = plan === 'pulse' ? 'Pulse' : 'Flow';
    if (!window.confirm(`Tem certeza que deseja conceder o plano "${planLabel}" para este usuário?`)) return;

    try {
      await apiFetch('/api/admin/users/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, userId, plan })
      });
      // Atualiza localmente
      setUsers(users.map(u =>
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
      const resp = await apiFetch<MessagesResponse>('/api/admin/messages', undefined, {
        password,
        page: messagesPage,
        limit: 50,
        channel: messagesChannel,
        search: messagesSearch || undefined,
      });
      setMessages(resp.messages || []);
      setMessagesTotalPages(resp.totalPages || 1);
      setMessagesTotal(resp.total || 0);
    } catch (err) {
      console.error('Erro ao buscar mensagens:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [isAuthenticated, password, messagesPage, messagesChannel, messagesSearch]);

  useEffect(() => {
    if (activeTab === 'messages' && isAuthenticated) {
      fetchMessages();
    }
  }, [activeTab, fetchMessages]);

  // Reset page when filters change
  useEffect(() => {
    setMessagesPage(1);
  }, [messagesChannel, messagesSearch]);

  // ---------------------------------------------
  // TELA DE LOGIN (Estilo Landing Page)
  // ---------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative overflow-hidden flex flex-col">
        {/* Background Grid Moderno */}
        <div className="absolute top-0 left-0 w-full h-[1000px] pointer-events-none z-0 overflow-hidden opacity-50">
          <div className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(55, 53, 47, 0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(55, 53, 47, 0.05) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)'
            }}
          />
        </div>

        {/* Header Minimalista */}
        <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
            <span className="text-xl font-bold tracking-tight">flui.</span>
          </div>
          <Link to="/" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">
            Voltar ao início
          </Link>
        </header>

        {/* Login Area */}
        <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-6 py-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="w-full max-w-[420px]"
          >
            <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-10 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-full h-full opacity-[0.03]"
                style={{ backgroundImage: 'radial-gradient(#37352f 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

              <div className="flex items-center justify-center mb-6 relative z-10">
                <div className="w-16 h-16 bg-white border border-[#e9e9e7] rounded-2xl shadow-sm flex items-center justify-center rotate-3">
                  <ShieldAlert className="text-[#37352f]/80 w-8 h-8" />
                </div>
              </div>
              
              <div className="text-center mb-8 relative z-10">
                <h1 className="text-3xl font-extrabold tracking-tight text-[#202020] mb-2">Painel Restrito</h1>
                <p className="text-[#37352f]/60 font-medium text-sm">Insira sua senha de administração para gerenciar a plataforma.</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5 relative z-10">
                <div>
                  <label className="block text-sm font-bold text-[#37352f]/80 mb-2">
                    Senha Administrativa
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-[#e9e9e7] rounded-xl px-4 py-3.5 text-[#37352f] font-medium shadow-sm focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] transition-all"
                    placeholder="Sua senha segura"
                    required
                  />
                </div>

                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 text-sm font-medium text-center">
                    {error}
                  </motion.p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-[#202020] text-white text-sm font-bold rounded-xl hover:bg-[#30302E] transition-all flex items-center justify-center gap-2 shadow-md shadow-[#202020]/10 hover:shadow-[#202020]/20 disabled:opacity-50"
                >
                  {loading ? 'Acessando...' : 'Entrar na área segura'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>
            </div>
          </motion.div>
        </main>
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
    <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative">
      
      {/* Background Decorativo */}
      <div className="fixed top-0 left-0 w-full h-[600px] pointer-events-none z-0 opacity-30">
        <div className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to bottom, rgba(55, 53, 47, 0.05) 1px, transparent 1px)`,
            backgroundSize: '100% 40px',
            maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)'
          }}
        />
      </div>

      {/* ═══════════ TOP BAR ═══════════ */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-[#e9e9e7]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Logo + Title */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl flex items-center justify-center shadow-sm -rotate-3">
                <ShieldCheck className="text-[#202020] w-4.5 h-4.5" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold tracking-tight text-[#202020] leading-none">Painel Admin</h1>
              </div>
            </div>

            {/* Center: Navigation Tabs */}
            <nav className="flex items-center gap-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl p-1">
              <button
                onClick={() => setActiveTab('users')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'users'
                    ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                    : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                }`}
              >
                <Users size={15} />
                Usuários
              </button>
              <button
                onClick={() => setActiveTab('messages')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'messages'
                    ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                    : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                }`}
              >
                <MessageSquare size={15} />
                Mensagens
              </button>
            </nav>

            {/* Right: Logout */}
            <button 
              onClick={() => { setIsAuthenticated(false); setPassword(''); }}
              className="px-4 py-2 bg-white text-[#37352f] text-sm font-bold rounded-xl hover:bg-[#f7f7f5] border border-[#e9e9e7] shadow-sm transition-all flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 relative z-10">
        
        <AnimatePresence mode="wait">
          {/* ═══════════ ABA USUÁRIOS ═══════════ */}
          {activeTab === 'users' && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              {/* Dashboard Content */}
              <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm flex flex-col">
                
                {/* Controls Bar */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                  <div className="flex items-center gap-2 text-[#37352f] bg-white px-5 py-2.5 rounded-xl border border-[#e9e9e7] shadow-sm">
                    <Users size={18} className="text-[#37352f]/40"/> 
                    <span className="font-bold text-sm">{users.length} usuários na base</span>
                  </div>
                  
                  <div className="relative w-full sm:w-[400px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#37352f]/40 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Buscar por nome ou email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-white border border-[#e9e9e7] rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-[#37352f] focus:outline-none focus:border-[#202020] focus:ring-1 focus:ring-[#202020] shadow-sm transition-all"
                    />
                  </div>
                </div>

                {/* Table Container */}
                <div className="overflow-x-auto bg-white border border-[#e9e9e7] rounded-2xl shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#e9e9e7] bg-[#fcfcfc] text-[#37352f]/60 text-sm">
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Usuário</th>
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Email</th>
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Cadastrado em</th>
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Status</th>
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Plano</th>
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px] text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e9e9e7]">
                      {filteredUsers.map((user) => (
                        <tr key={user.id} className="text-[#37352f] hover:bg-[#fcfcfc] transition-colors">
                          <td className="py-4 px-6 font-bold text-sm">{user.name || 'Sem nome definido'}</td>
                          <td className="py-4 px-6 text-sm font-medium text-[#37352f]/70">{user.email}</td>
                          <td className="py-4 px-6 text-sm text-[#37352f]/60">{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                          <td className="py-4 px-6">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                              user.subscriptionStatus === 'active' 
                                ? 'bg-[#28c840]/10 text-[#28c840]' 
                                : 'bg-[#37352f]/5 text-[#37352f]/40'
                            }`}>
                              {user.subscriptionStatus}
                            </span>
                          </td>
                          <td className="py-4 px-6">
                            {user.planId === 'pulse' ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest bg-[#37352f]/5 text-[#37352f]/50 border border-[#e9e9e7]">
                                Pulse
                              </span>
                            ) : user.planId === 'flow' ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest bg-[#37352f]/5 text-[#37352f]/50 border border-[#e9e9e7]">
                                Flow
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-[#37352f]/25 uppercase tracking-widest">
                                —
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-6 text-right">
                            {!user.hasFlow ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleGrantAccess(user.id, 'flow')}
                                  className="px-3 py-1.5 bg-white border border-[#e9e9e7] text-[#37352f] text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-[#f1f1f0] transition-all"
                                >
                                  Flow
                                </button>
                                <button
                                  onClick={() => handleGrantAccess(user.id, 'pulse')}
                                  className="px-3 py-1.5 bg-white border border-[#e9e9e7] text-[#37352f] text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-[#f1f1f0] transition-all"
                                >
                                  Pulse
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                {user.planId !== 'pulse' && (
                                  <button
                                    onClick={() => handleGrantAccess(user.id, 'pulse')}
                                    className="px-3 py-1.5 bg-white border border-[#e9e9e7] text-[#37352f] text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-[#f1f1f0] transition-all"
                                  >
                                    Pulse
                                  </button>
                                )}
                                {user.planId !== 'flow' && (
                                  <button
                                    onClick={() => handleGrantAccess(user.id, 'flow')}
                                    className="px-3 py-1.5 bg-white border border-[#e9e9e7] text-[#37352f] text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-[#f1f1f0] transition-all"
                                  >
                                    Flow
                                  </button>
                                )}
                                <span className="text-[10px] font-bold text-[#37352f]/25 uppercase tracking-widest">
                                  {user.planId === 'pulse' ? 'Pulse ativo' : 'Flow ativo'}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Users className="w-10 h-10 text-[#e9e9e7]" />
                              <span className="text-[#37352f]/50 font-medium text-sm">Nenhum usuário encontrado na busca.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dashboard Statistics */}
              {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
                  <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all hover:shadow-md hover:border-[#d9d9d7]">
                    <div className="flex items-center justify-between text-[#37352f]/60 mb-2">
                      <span className="text-sm font-bold tracking-tight uppercase">Mensagens Enviadas</span>
                      <MessageSquare size={18} />
                    </div>
                    <span className="text-4xl font-extrabold text-[#202020]">{stats.totalMessages}</span>
                  </div>
                  
                  <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all hover:shadow-md hover:border-[#d9d9d7]">
                    <div className="flex items-center justify-between text-[#37352f]/60 mb-2">
                      <span className="text-sm font-bold tracking-tight uppercase">Tarefas Criadas</span>
                      <CheckSquare size={18} />
                    </div>
                    <span className="text-4xl font-extrabold text-[#202020]">{stats.totalTasks}</span>
                  </div>
                  
                  <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all hover:shadow-md hover:border-[#d9d9d7]">
                    <div className="flex items-center justify-between text-[#37352f]/60 mb-2">
                      <span className="text-sm font-bold tracking-tight uppercase">Usuários C/ Interação</span>
                      <Users size={18} />
                    </div>
                    <span className="text-4xl font-extrabold text-[#202020]">{stats.firstMessageUsers}</span>
                  </div>
                  
                  <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all hover:shadow-md hover:border-[#d9d9d7]">
                    <div className="flex items-center justify-between text-[#37352f]/60 mb-2">
                      <span className="text-sm font-bold tracking-tight uppercase text-truncate">Consumo Wpp Mês</span>
                      <MessageCircle size={18} className="shrink-0" />
                    </div>
                    <div className="flex items-end gap-2 text-[#202020]">
                      <span className="text-4xl font-extrabold">{stats.wppConversationsUsed}</span>
                      <span className="text-lg font-bold text-[#37352f]/40 mb-1">/ {stats.wppFreeLimit}</span>
                    </div>
                    <div className="w-full bg-[#e9e9e7] h-2 mt-2 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          (stats.wppConversationsUsed / stats.wppFreeLimit) > 0.9 ? 'bg-red-500' : 'bg-[#202020]'
                        }`}
                        style={{ width: `${Math.min((stats.wppConversationsUsed / stats.wppFreeLimit) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
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

              {/* Filters */}
              <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
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

              {/* Messages List */}
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
                  <div className="divide-y divide-[#e9e9e7]">
                    {messages.map((msg) => {
                      const isExpanded = expandedMessage === msg.id;
                      const isAI = msg.role === 'assistant';
                      
                      return (
                        <div
                          key={msg.id}
                          className={`group relative transition-colors cursor-pointer ${
                            isAI ? 'bg-purple-50/30 hover:bg-purple-50/60' : 'bg-white hover:bg-[#fcfcfc]'
                          }`}
                          onClick={() => setExpandedMessage(isExpanded ? null : msg.id)}
                        >
                          <div className="px-6 py-4">
                            {/* Top Row: User info + Badges + Time */}
                            <div className="flex items-center gap-3 mb-2">
                              {/* User avatar */}
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold ${
                                isAI ? 'bg-gradient-to-br from-purple-500 to-purple-700' : 'bg-gradient-to-br from-blue-500 to-blue-700'
                              }`}>
                                {isAI ? <Bot size={14} /> : (msg.user.name?.[0]?.toUpperCase() || 'U')}
                              </div>

                              {/* User name + email */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-[#202020] truncate">
                                    {isAI ? 'Lui (Assistente IA)' : msg.user.name}
                                  </span>
                                  {!isAI && (
                                    <span className="text-[11px] font-medium text-[#37352f]/40 truncate">
                                      {msg.user.email}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Badges */}
                              <div className="flex items-center gap-2 shrink-0">
                                {getRoleBadge(msg.role)}
                                {getChannelBadge(msg.channel)}
                              </div>

                              {/* Timestamp */}
                              <div className="flex items-center gap-1 text-[#37352f]/35 shrink-0">
                                <Clock size={11} />
                                <span className="text-[11px] font-semibold">{formatDate(msg.created_at)}</span>
                              </div>
                            </div>

                            {/* Message Content */}
                            <div className="pl-11">
                              <p className={`text-sm font-medium text-[#37352f]/80 ${!isExpanded ? 'line-clamp-2' : ''} whitespace-pre-wrap break-words`}>
                                {msg.content || '(sem conteúdo)'}
                              </p>

                              {/* Expanded Metadata */}
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-3 pt-3 border-t border-[#e9e9e7]/60 flex flex-wrap gap-4 text-[11px] font-semibold text-[#37352f]/40">
                                      {msg.provider && (
                                        <span className="flex items-center gap-1">
                                          <Zap size={10} className="text-amber-500" />
                                          Provider: <span className="text-[#37352f]/60">{msg.provider}</span>
                                        </span>
                                      )}
                                      {msg.model && (
                                        <span>
                                          Modelo: <span className="text-[#37352f]/60">{msg.model}</span>
                                        </span>
                                      )}
                                      {msg.latency_ms != null && (
                                        <span>
                                          Latência: <span className="text-[#37352f]/60">{msg.latency_ms}ms</span>
                                        </span>
                                      )}
                                      {msg.tool_count > 0 && (
                                        <span>
                                          Tools usadas: <span className="text-[#37352f]/60">{msg.tool_count}</span>
                                        </span>
                                      )}
                                      {msg.fallback_used && (
                                        <span className="text-amber-600">⚠ Fallback usado</span>
                                      )}
                                      <span>
                                        Tipo: <span className="text-[#37352f]/60">{msg.message_type}</span>
                                      </span>
                                      <span>
                                        Status: <span className="text-[#37352f]/60">{msg.status}</span>
                                      </span>
                                      <span className="text-[#37352f]/25">
                                        ID: {msg.id.substring(0, 12)}…
                                      </span>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
