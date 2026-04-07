import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { ShieldAlert, CheckCircle, Search, Users } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSignIn: string;
  hasFlow: boolean;
  subscriptionStatus: string;
}

export function AdminPanel() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const resp = await apiFetch<{ users: User[] }>(`/api/admin/users`, undefined, { password });
      setUsers(resp.users || []);
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

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#1c1c1c] flex flex-col items-center justify-center p-4">
        <div className="bg-[#2a2a28] p-8 rounded-2xl w-full max-w-md border border-[#30302E]">
          <div className="flex items-center justify-center mb-6 text-[#E1FF01]">
            <ShieldAlert size={48} />
          </div>
          <h1 className="text-2xl font-semibold text-white text-center mb-8">
            Acesso Restrito
          </h1>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Senha Administrativa
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1c1c1c] border border-[#30302E] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#E1FF01]"
                placeholder="Insira a senha"
                required
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E1FF01] text-black font-medium py-3 rounded-xl hover:bg-[#d4f000] transition-colors disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
          <button 
            onClick={() => navigate('/')}
            className="w-full mt-4 text-gray-400 hover:text-white transition-colors"
          >
            Voltar para o Início
          </button>
        </div>
      </div>
    );
  }

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-[#1c1c1c] p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="text-[#E1FF01]" />
              Painel Admin
            </h1>
            <p className="text-gray-400 mt-1">Gerencie os usuários e acessos da plataforma</p>
          </div>
          <button 
            onClick={() => { setIsAuthenticated(false); setPassword(''); }}
            className="px-4 py-2 bg-[#2a2a28] text-white rounded-lg hover:bg-[#30302E] transition-colors border border-[#30302E]"
          >
            Sair
          </button>
        </div>

        <div className="bg-[#2a2a28] border border-[#30302E] rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
            <div className="flex items-center gap-2 text-white bg-[#1c1c1c] px-4 py-2 rounded-lg border border-[#30302E]">
              <Users size={20} className="text-[#E1FF01]"/> 
              <span className="font-medium">{users.length} Registrados</span>
            </div>
            
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar por nome ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#1c1c1c] border border-[#30302E] rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-[#E1FF01]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#30302E] text-gray-400">
                  <th className="py-3 px-4 font-medium">Usuário</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium">Criado em</th>
                  <th className="py-3 px-4 font-medium">Status Assinatura</th>
                  <th className="py-3 px-4 font-medium">Acesso Flow</th>
                  <th className="py-3 px-4 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30302E]">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="text-white hover:bg-[#30302E] transition-colors">
                    <td className="py-3 px-4 font-medium">{user.name || 'Sem nome'}</td>
                    <td className="py-3 px-4 text-gray-300">{user.email}</td>
                    <td className="py-3 px-4 text-gray-400">{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.subscriptionStatus === 'active' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {user.subscriptionStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {user.hasFlow ? (
                        <span className="flex items-center gap-1 text-[#E1FF01]">
                          <CheckCircle size={16} /> Ativo
                        </span>
                      ) : (
                        <span className="text-gray-500">Inativo</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!user.hasFlow ? (
                        <button
                          onClick={() => handleGrantAccess(user.id)}
                          className="px-3 py-1 bg-[#E1FF01] text-black text-sm font-medium rounded-lg hover:bg-[#d4f000] transition-colors"
                        >
                          Conceder Acesso
                        </button>
                      ) : (
                        <button
                          disabled
                          className="px-3 py-1 bg-gray-700 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed opacity-50"
                        >
                          Concedido
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
        </div>
      </div>
    </div>
  );
}
