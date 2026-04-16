import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Send, X, Bot, User, Loader2, Minimize2, Maximize2, Bell } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isReminder?: boolean
}

const formatMessage = (text: string) => {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Bullet: lines starting with "* " or "- "
    const bulletMatch = line.match(/^[\*\-]\s+(.*)/)
    if (bulletMatch) {
      const bulletItems: string[] = []
      while (i < lines.length) {
        const bl = lines[i].match(/^[\*\-]\s+(.*)/)
        if (bl) { bulletItems.push(bl[1]); i++ }
        else break
      }
      result.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-1">
          {bulletItems.map((item, j) => (
            <li key={j}>{formatInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }
    // Empty line = spacer
    if (line.trim() === '') {
      result.push(<br key={`br-${i}`} />)
    } else {
      result.push(<p key={`p-${i}`} className="mb-0.5">{formatInline(line)}</p>)
    }
    i++
  }
  return <>{result}</>
}

const formatInline = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

// Controla se já buscou lembrete nesta sessão (evita repetição ao minimizar/maximizar)
const reminderSessionKey = () => {
  const today = new Date().toISOString().split('T')[0]
  const hour = new Date().getHours()
  // Divide o dia em 3 períodos para não repetir no mesmo período
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `reminder_${today}_${period}`
}

const AIChatAssistant: React.FC = () => {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou seu assistente de IA. Como posso ajudar com suas tarefas hoje?' }
  ])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingReminder, setIsFetchingReminder] = useState(false)
  const [hasNewReminder, setHasNewReminder] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasFetchedReminder = useRef(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // ── Buscar Lembretes Proativos ──────────────────────────────────────
  const fetchReminder = useCallback(async () => {
    if (!user?.id || hasFetchedReminder.current) return

    // Verifica se já buscou neste período
    const sessionKey = reminderSessionKey()
    const alreadyFetched = sessionStorage.getItem(sessionKey)
    if (alreadyFetched) {
      hasFetchedReminder.current = true
      return
    }

    hasFetchedReminder.current = true
    setIsFetchingReminder(true)

    try {
      const data = await apiFetch<{ message?: string | null }>('/api/reminders', undefined, {
        userId: user.id,
      })

      if (data.message) {
        // Substitui a mensagem padrão pelo lembrete proativo
        setMessages([
          {
            role: 'assistant',
            content: data.message,
            isReminder: true
          }
        ])

        // Se o chat está fechado, mostra indicador visual
        if (!isOpen) {
          setHasNewReminder(true)
        }

        // Marca como já buscado neste período
        sessionStorage.setItem(sessionKey, 'true')
      }
    } catch (error) {
      console.error('[Reminders] Erro ao buscar lembretes:', error)
      // Não substitui a mensagem padrão se deu erro
    } finally {
      setIsFetchingReminder(false)
    }
  }, [user?.id, isOpen])

  // Busca lembrete assim que o componente monta (usuário carrega a página)
  useEffect(() => {
    // Delay de 2s para não competir com o carregamento da página
    const timer = setTimeout(() => {
      fetchReminder()
    }, 2000)

    return () => clearTimeout(timer)
  }, [fetchReminder])

  // Quando abre o chat, limpa o indicador de novo lembrete
  useEffect(() => {
    if (isOpen && hasNewReminder) {
      setHasNewReminder(false)
    }
  }, [isOpen, hasNewReminder])

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const data = await apiFetch<{ content?: string }>('/api/chat-agent', {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          userId: user?.id,
          userName: user?.user_metadata?.name || user?.email?.split('@')[0] || 'você',
        })
      })

      if (data.content) {
        const assistantContent = data.content
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: assistantContent
        }])
      } else {
        throw new Error('Resposta inválida da IA')
      }
    } catch (error) {
      console.error('Erro na IA:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Desculpe, tive um problema ao processar sua solicitação. Tente novamente em instantes.'
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed bottom-8 right-8 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              height: isMinimized ? '80px' : '600px',
              width: isMinimized ? '300px' : '400px'
            }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="bg-white border border-[#e9e9e7] rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden mb-4"
          >
            {/* Header */}
            <div className="p-5 border-b border-[#f1f1f0] flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center text-white shadow-lg">
                  <Sparkles size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#37352f]">Assistente IA</h3>
                  {!isMinimized && <p className="text-[10px] text-[#25D366] font-bold tracking-widest">Kimi K2.5 Ativo</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-1.5 hover:bg-[#f7f7f5] rounded-lg transition-colors text-[#37352f]/40"
                >
                  {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-[#f7f7f5] rounded-lg transition-colors text-[#37352f]/40"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-[#fbfbfb]/50">
                  {messages.map((m, i) => (
                    <motion.div
                      initial={{ opacity: 0, x: m.role === 'user' ? 10 : -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={i}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border ${m.role === 'user'
                            ? 'bg-white border-[#e9e9e7] text-[#37352f]'
                            : m.isReminder
                              ? 'bg-amber-50 border-amber-200 text-amber-600'
                              : 'bg-black border-black text-white'
                          }`}>
                          {m.role === 'user' ? <User size={14} /> : m.isReminder ? <Bell size={14} /> : <Bot size={14} />}
                        </div>
                        <div className={`p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user'
                            ? 'bg-black text-white shadow-lg'
                            : m.isReminder
                              ? 'bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/60 text-[#37352f] shadow-sm'
                              : 'bg-white border border-[#e9e9e7] text-[#37352f] shadow-sm'
                          }`}>
                          {m.isReminder && (
                            <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-amber-200/40">
                              <Bell size={11} className="text-amber-500" />
                              <span className="text-[10px] font-bold text-amber-600/80 tracking-wider">Lembrete Proativo</span>
                            </div>
                          )}
                          {m.role === 'assistant' ? formatMessage(m.content) : <span className="whitespace-pre-wrap">{m.content}</span>}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {(isLoading || isFetchingReminder) && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-[#e9e9e7] p-4 rounded-2xl flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-[#37352f]/40" />
                        <span className="text-xs font-medium text-[#37352f]/40 italic">
                          {isFetchingReminder ? 'Verificando seus lembretes...' : 'A IA está pensando...'}
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-[#f1f1f0]">
                  <div className="relative group">
                    <input
                      type="text"
                      placeholder="Pergunte qualquer coisa..."
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl py-3.5 px-5 pr-14 text-sm font-medium text-[#37352f] placeholder-[#37352f]/30 outline-none focus:bg-white focus:border-black transition-all"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!input.trim() || isLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-30 disabled:scale-100 transition-all shadow-lg shadow-black/10"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <p className="text-[9px] text-center mt-3 text-[#37352f]/30 font-bold tracking-tighter">
                    Powered by NVIDIA NIM & Kimi-K2.5
                  </p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-16 h-16 bg-black text-white rounded-2xl flex items-center justify-center shadow-[0_15px_30px_rgba(0,0,0,0.3)] group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        {isOpen ? <X size={28} /> : <Sparkles size={28} className="animate-pulse" />}

        {/* Badge de notificação de lembrete */}
        <AnimatePresence>
          {hasNewReminder && !isOpen && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
            >
              <Bell size={10} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pulse ring quando tem lembrete */}
        {hasNewReminder && !isOpen && (
          <div className="absolute inset-0 rounded-2xl animate-ping bg-amber-500/20 pointer-events-none" />
        )}
      </motion.button>
    </div>
  )
}

export default AIChatAssistant
