import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { ShieldAlert, CheckCircle, Search, Users, LogOut, ArrowRight, ShieldCheck, MessageSquare, CheckSquare, MessageCircle } from 'lucide-react';
import logo from '../assets/logo/logo.png';
import { motion } from 'framer-motion';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSignIn: string;
  hasFlow: boolean;
  subscriptionStatus: string;
}

interface AdminStats {
  totalMessages: number;
  totalTasks: number;
  firstMessageUsers: number;
  wppConversationsUsed: number;
  wppFreeLimit: number;
}

export function AdminPanel() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

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

  const handleGrantAccess = async (userId: string) => {
    if (!window.confirm('Tem certeza que deseja conceder acesso "Flow" para este usuário?')) return;
    
    try {
      await apiFetch('/api/admin/users/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, userId })
      });
      // Atualiza localmente
      setUsers(users.map(u => 
        u.id === userId 
          ? { ...u, hasFlow: true, subscriptionStatus: 'active' } 
          : u
      ));
      alert('Acesso concedido com sucesso!');
    } catch (err: any) {
      alert('Erro ao conceder acesso: ' + err.message);
    }
  };

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
  // TELA ADMIN (Estilo Landing Page)
  // ---------------------------------------------
  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

      <div className="max-w-6xl mx-auto px-6 py-10 relative z-10">
        
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl flex items-center justify-center shadow-sm -rotate-3">
              <ShieldCheck className="text-[#202020] w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-[#202020]">Painel Admin.</h1>
              <p className="text-[#37352f]/60 font-medium mt-1">Gerencie usuários e concessões de plano</p>
            </div>
          </div>
          <button 
            onClick={() => { setIsAuthenticated(false); setPassword(''); }}
            className="px-5 py-2.5 bg-white text-[#37352f] text-sm font-bold rounded-xl hover:bg-[#f7f7f5] border border-[#e9e9e7] shadow-sm transition-all flex items-center gap-2 w-fit"
          >
            <LogOut className="w-4 h-4" />
            Sair do painel
          </button>
        </div>

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
                  <th className="py-4 px-6 font-bold uppercase tracking-wider text-[10px]">Acesso Flow</th>
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
                      {user.hasFlow ? (
                        <span className="flex items-center gap-1.5 text-sm font-bold text-[#28c840]">
                          <CheckCircle size={16} /> Ativo
                        </span>
                      ) : (
                        <span className="text-sm font-bold text-[#37352f]/30 flex items-center gap-1.5">
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {!user.hasFlow ? (
                        <button
                          onClick={() => handleGrantAccess(user.id)}
                          className="px-4 py-2 bg-[#202020] text-white text-[11px] uppercase tracking-wide font-bold rounded-lg hover:bg-[#30302E] shadow-sm transition-all hover:scale-[1.02]"
                        >
                          Conceder Acesso
                        </button>
                      ) : (
                        <button
                          disabled
                          className="px-4 py-2 bg-[#f1f1f0] text-[#37352f]/30 text-[11px] uppercase tracking-wide font-bold rounded-lg cursor-not-allowed border border-[#e9e9e7]"
                        >
                          Acesso Ativado
                        </button>
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
      </div>
    </div>
  );
}
