import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { AdminChatSimulator } from './AdminChatSimulator';
import {
  ShieldAlert, Search, Users, LogOut, ArrowRight, ShieldCheck,
  MessageSquare, CheckSquare, MessageCircle, Bot, User as UserIcon,
  ChevronLeft, ChevronRight, Clock, Zap, Globe, Smartphone,
  Filter, RefreshCw
} from 'lucide-react';
import logo from '../assets/logo/logo.svg';
import luiLogo from '../assets/logo/lui.svg';
import { motion, AnimatePresence } from 'framer-motion';
import PixelBlast from '../components/ui/PixelBlast';

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

type AdminTab = 'users' | 'messages' | 'simulator';

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
  const [selectedUserMessages, setSelectedUserMessages] = useState<User | null>(null);
  const [messagesMode, setMessagesMode] = useState<'all' | 'by-user'>('by-user');

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
  }, [isAuthenticated, password, messagesPage, messagesChannel, messagesSearch, selectedUserMessages]);

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
  // TELA DE LOGIN (Estilo Landing Page)
  // ---------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative overflow-hidden flex flex-col">
        {/* Background Pixel Blast Moderno no Topo */}
        <div className="absolute top-0 left-0 w-full h-[800px] pointer-events-none z-0 overflow-hidden opacity-40"
          style={{
            maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)'
          }}
        >
          <PixelBlast
            variant="square"
            pixelSize={3}
            color="#cdcdc9"
            patternScale={4}
            patternDensity={0.6}
            enableRipples
            rippleSpeed={0.3}
            speed={0.3}
            transparent
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
            <div className="relative z-10">
              <div className="mb-8 p-3 w-14 h-14 bg-white border border-[#e9e9e7] rounded-xl flex items-center justify-center shadow-sm">
                <ShieldAlert className="text-[#37352f]/40 w-7 h-7" />
              </div>
              
              <div className="mb-6 flex flex-col items-start text-left">
                <h1 className="text-2xl font-bold tracking-tight mb-2 text-[#202020]">
                  Painel Restrito
                </h1>
                <p className="text-sm text-[#37352f]/40 font-medium leading-relaxed">
                  Insira sua senha de administração para gerenciar a plataforma com segurança.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-[#37352f]/40">Senha Administrativa</label>
                  <input
                    type="password"
                    placeholder="Sua senha segura"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2.5 px-3.5 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                    required
                  />
                </div>

                {error && (
                  <motion.p 
                    initial={{ opacity: 0, y: -4 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    className="text-red-500 text-[12px] font-medium"
                  >
                    {error}
                  </motion.p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#202020] hover:bg-[#202020]/90 disabled:opacity-70 text-white font-medium py-2.5 rounded-[6px] transition-all mt-4 shadow-md shadow-black/5 flex items-center justify-center h-[38px] relative overflow-hidden"
                >
                  <span className="text-sm font-medium">
                    {loading ? 'Acessando...' : 'Acessar Painel'}
                  </span>
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
              <button
                onClick={() => setActiveTab('users')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'users'
                    ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                    : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                }`}
              >
                <Users size={14} />
                Usuários
              </button>
              <button
                onClick={() => setActiveTab('messages')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'messages'
                    ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                    : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                }`}
              >
                <MessageSquare size={14} />
                Mensagens
              </button>
              <button
                onClick={() => setActiveTab('simulator')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'simulator'
                    ? 'bg-white text-[#202020] shadow-sm border border-[#e9e9e7]'
                    : 'text-[#37352f]/50 hover:text-[#37352f]/80'
                }`}
              >
                <Bot size={14} />
                Simulador
              </button>
            </nav>

            {/* Right: Logout & Mobile Menu */}
            <div className="flex items-center gap-3">
              {/* Mobile menu (tabs) simplified for admin */}
              <div className="lg:hidden flex items-center gap-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-lg p-1 mr-2">
                <button 
                  onClick={() => setActiveTab('users')}
                  className={`p-1.5 rounded-md ${activeTab === 'users' ? 'bg-white shadow-sm' : 'text-[#37352f]/40'}`}
                >
                  <Users size={16} />
                </button>
                <button 
                  onClick={() => setActiveTab('messages')}
                  className={`p-1.5 rounded-md ${activeTab === 'messages' ? 'bg-white shadow-sm' : 'text-[#37352f]/40'}`}
                >
                  <MessageSquare size={16} />
                </button>
                <button 
                  onClick={() => setActiveTab('simulator')}
                  className={`p-1.5 rounded-md ${activeTab === 'simulator' ? 'bg-white shadow-sm' : 'text-[#37352f]/40'}`}
                >
                   <Bot size={16} />
                </button>
              </div>

              <button 
                onClick={() => { setIsAuthenticated(false); setPassword(''); }}
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
      <div className={`flex-1 overflow-hidden ${activeTab === 'simulator' ? 'w-full px-0' : 'w-full max-w-6xl mx-auto px-6 py-8 overflow-y-auto custom-scrollbar'} relative z-10 transition-all duration-300`}>
        
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
                            <div className="flex items-center justify-end gap-2">
                              {/* New Button to view logs */}
                              <button
                                onClick={() => {
                                  setSelectedUserMessages(user);
                                  setMessagesMode('by-user');
                                  setActiveTab('messages');
                                  setMessagesPage(1);
                                }}
                                className="p-1.5 bg-[#f7f7f5] border border-[#e9e9e7] text-[#37352f]/40 hover:text-[#202020] hover:border-[#202020] rounded-lg transition-all"
                                title="Ver Logs de Mensagens"
                              >
                                <MessageSquare size={14} />
                              </button>
                              
                              {!user.hasFlow ? (
                                <div className="flex items-center gap-2">
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
                                  <span className="text-[10px] font-bold text-[#37352f]/25 uppercase tracking-widest whitespace-nowrap">
                                    {user.planId === 'pulse' ? 'Pulse ativo' : 'Flow ativo'}
                                  </span>
                                </div>
                              )}
                            </div>
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
