import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, Terminal, RefreshCw, MessageCircle
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface LogEntry {
  type: string;
  status: string;
  data: any;
  timestamp: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export function AdminChatSimulator({ isEmbedded = false }: { isEmbedded?: boolean }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [sseId] = useState(() => Math.random().toString(36).substring(2, 11));
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);

  const adminFetch = useCallback(<T,>(path: string, init?: RequestInit) => {
    if (!accessToken) {
      throw new Error('Sessao Supabase ausente.');
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

    return apiFetch<T>(path, { ...init, headers });
  }, [accessToken]);

  const fetchModelInfo = useCallback(async () => {
    try {
      const info = await adminFetch<any>('/api/admin/model-info');
      setModelInfo(info);
    } catch (err) {
      console.error('Falha ao carregar modelo:', err);
    }
  }, [adminFetch]);

  useEffect(() => {
    if (!accessToken) return;

    fetchModelInfo();
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const apiBase = isLocal ? 'http://localhost:3001' : (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const streamUrl = new URL(`/api/admin/chat/stream/${sseId}`, apiBase || window.location.origin);
    streamUrl.searchParams.set('access_token', accessToken);
    const eventSource = new EventSource(streamUrl.toString());
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLogs(prev => [...prev, data]);
      } catch (e) {
        console.warn('Failed to parse SSE data:', e);
      }
    };
    return () => eventSource.close();
  }, [accessToken, fetchModelInfo, sseId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
  }, [logs]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toLocaleTimeString() }]);
    setLoading(true);

    try {
      const response = await adminFetch<any>('/api/admin/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'admin-sim',
          userName: 'Admin Master',
          content: userMsg,
          sseId
        })
      });

      if (response.success && response.content) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: response.content, 
          timestamp: new Date().toLocaleTimeString() 
        }]);
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: response.content || response.message || "⚠️ Resposta vazia da IA.", 
          timestamp: new Date().toLocaleTimeString() 
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `❌ Erro: ${err.message}`, 
        timestamp: new Date().toLocaleTimeString() 
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!accessToken) {
    return (
      <div className={`${isEmbedded ? 'h-full' : 'min-h-screen'} flex items-center justify-center bg-white text-[#37352f] font-sans`}>
        <div className="max-w-sm px-6 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-[#202020] text-white flex items-center justify-center">
            <Terminal className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-[#202020]">Acesso restrito</h1>
          <p className="text-sm text-[#37352f]/50 mt-2">
            Entre com uma conta admin para usar o simulador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex w-full h-full bg-white overflow-hidden font-sans transition-all`}>
      
      {/* ─────────────────────────────────────────────────────────────────────────
          LADO ESQUERDO: ENGINE MONITOR (LOGS) - Estilo WhatsApp Web Sidebar
          ───────────────────────────────────────────────────────────────────────── */}
      <div className="w-[380px] border-r border-[#e9e9e7] bg-[#f7f7f5] flex flex-col shrink-0">
        <div className="h-16 px-6 border-b border-[#e9e9e7] flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#202020] flex items-center justify-center">
              <Terminal className="w-4 h-4 text-white" />
            </div>
            <h2 className="font-bold text-[11px] tracking-tight text-[#202020]">Engine Monitor</h2>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white border border-[#e9e9e7] shadow-sm">
             <div className="w-1.5 h-1.5 rounded-full bg-[#C8FF00]" />
             <span className="text-[9px] font-semibold opacity-40">Live</span>
          </div>
        </div>
        
        <div ref={logScrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-0 custom-scrollbar">
          {logs.length === 0 && (
            <p className="text-[10px] font-semibold opacity-30 px-2">Motor inativo</p>
          )}
          {logs.map((log, i) => (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, x: -10 }} 
              animate={{ opacity: 1, x: 0 }}
              className="py-4 border-b border-[#e9e9e7]/50 group last:border-b-0"
            >
              <div className="flex items-start gap-4">
                <div className="mt-1 flex flex-col items-center">
                   <div className={`w-1.5 h-1.5 rounded-full ${log.status.toLowerCase().includes('erro') ? 'bg-red-500' : 'bg-[#202020]/20'}`} />
                   <div className="w-[1px] h-full bg-[#e9e9e7] mt-2 opacity-50" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                     <span className="text-[8px] font-semibold text-[#202020]/30">{log.type}</span>
                     <span className="text-[8px] font-medium opacity-20 tracking-tighter">
                       {new Date(log.data?.timestamp || Date.now()).toLocaleTimeString()}
                     </span>
                  </div>
                  <div className="text-[11px] font-medium text-[#202020]/70 leading-relaxed group-hover:text-black transition-colors">{log.status}</div>
                  
                  {(log.data?.tools || log.data?.latency_ms) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {log.data?.tools?.map((t: string, ti: number) => (
                        <span key={ti} className="text-[7px] font-semibold px-2 py-0.5 rounded bg-[#f0f2f5] text-[#37352f]/40">
                          {t}
                        </span>
                      ))}
                      {log.data?.latency_ms && (
                         <span className="text-[7px] font-bold text-[#37352f]/20 ml-auto">
                           {log.data.latency_ms}ms
                         </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          LADO DIREITO: CHAT SIMULATOR - Estilo WhatsApp Web Chat
          ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative bg-[#f0f2f5]/50 overflow-hidden">
        {/* Chat Header */}
        <header className="h-16 px-6 border-b border-[#e9e9e7] flex items-center justify-between z-10 bg-white/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#f0f2f5] overflow-hidden flex items-center justify-center p-2 border border-[#e9e9e7]">
              <img src="/src/assets/logo/lui.svg" alt="LUI" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="font-bold text-[13px] tracking-tight text-[#202020]">Simulador Flui</h1>
               <div className="flex items-center gap-1.5 text-[10px] opacity-30 font-bold">
                <span>{loading ? 'Processando...' : 'Online'}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end">
                 <span className="text-[10px] font-semibold text-[#202020]/20">Modelo</span>
                 <span className="text-[10px] font-bold text-[#202020]/40">{modelInfo?.modelId || 'Lui-2.5'}</span>
              </div>
             <div className="w-px h-6 bg-[#e9e9e7] mx-1" />
             <button className="p-2 text-[#202020]/30 hover:text-[#202020] transition-colors rounded-lg hover:bg-[#f7f7f5]">
                <RefreshCw size={18} />
             </button>
          </div>
        </header>

        {/* Messages Container with Pattern Background */}
        <div 
          ref={scrollRef} 
          className="flex-1 overflow-y-auto p-6 space-y-6 relative"
          style={{
            backgroundImage: `url("https://wweb.dev/assets/whatsapp-chat-back.png")`,
            backgroundBlendMode: 'soft-light',
            backgroundColor: '#efeae2'
          }}
        >
          <div className="absolute inset-0 bg-[#efeae2] opacity-80 pointer-events-none" />
          
          <AnimatePresence>
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center max-w-sm mx-auto relative z-10">
                 <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-xl shadow-black/5">
                   <MessageCircle className="w-10 h-10 text-black" />
                 </div>
                 <h3 className="font-bold text-lg text-black mb-2">Simulador Flui</h3>
                 <p className="text-xs font-medium leading-relaxed">Envie uma mensagem para testar a inteligência da Flui e ver os logs de processamento no painel lateral.</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className={`flex relative z-10 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] shadow-sm relative ${
                    isUser 
                      ? 'bg-[#dcf8c6] text-black rounded-tr-none' 
                      : 'bg-white text-black rounded-tl-none'
                  }`}>
                    {/* Tiny triangle for WhatsApp style bubbles */}
                    <div className={`absolute top-0 w-2 h-2 ${
                      isUser 
                        ? 'right-[-8px] border-l-[8px] border-l-[#dcf8c6] border-b-[8px] border-b-transparent' 
                        : 'left-[-8px] border-r-[8px] border-r-white border-b-[8px] border-b-transparent'
                    }`} />
                    
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    <div className="text-[9px] mt-1 text-right opacity-40 font-bold">
                      {msg.timestamp}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Input Bar */}
        <div className="p-6 relative z-10 bg-[#efeae2]/80 backdrop-blur-sm">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto flex items-center gap-3">
             <div className="flex-1 bg-white rounded-xl px-5 h-12 flex items-center shadow-lg shadow-black/[0.03] border border-[#e9e9e7]">
               <input 
                 autoFocus
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 placeholder="Digite uma mensagem para a Flui..."
                 className="flex-1 bg-transparent border-none text-[14px] focus:outline-none placeholder:text-gray-400 font-medium"
                 disabled={loading}
               />
             </div>
             <button 
               type="submit"
               disabled={loading || !input.trim()}
               className={`h-12 w-12 rounded-xl bg-[#202020] text-white flex items-center justify-center transition-all shadow-xl shadow-black/10 ${
                 loading ? 'opacity-50' : 'hover:scale-105 active:scale-95'
               }`}
             >
               <Send className="w-5 h-5 ml-0.5" />
             </button>
          </form>
        </div>
      </div>
    </div>
  );
}
