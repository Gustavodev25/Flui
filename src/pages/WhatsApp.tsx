import React, { useEffect, useRef, useState } from 'react'
import { Send, User, MoreVertical, Search, Check, CheckCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'

interface ApiMessage {
  id: string
  text: string
  from: string
  to: string
  timestamp: string
  sentByMe: boolean
  status: 'queued' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed'
  threadId?: string
}

interface Message extends Omit<ApiMessage, 'timestamp'> {
  timestamp: Date
}

const WhatsApp: React.FC = () => {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchMessages = async () => {
    if (!user?.id) return

    try {
      const data = await apiFetch<ApiMessage[]>('/api/whatsapp/messages', undefined, {
        userId: user.id,
      })

      const parsedMessages = data.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      }))

      setMessages(parsedMessages)
      if (data[0]?.threadId) setThreadId(data[0].threadId)
      if (data[0]?.to) setPhoneNumber(data[0].to)
    } catch (error) {
      console.error('Erro ao carregar mensagens do WhatsApp', error)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [user?.id])

  useEffect(() => {
    if (!threadId) return

    const channel = supabase
      .channel(`whatsapp-thread-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          fetchMessages()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, user?.id])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !phoneNumber.trim() || !user?.id) return

    const optimisticMessage: Message = {
      id: `optimistic-${Date.now()}`,
      text: input,
      from: 'me',
      to: phoneNumber,
      timestamp: new Date(),
      sentByMe: true,
      status: 'queued',
      threadId: threadId || undefined,
    }

    setMessages((prev) => [...prev, optimisticMessage])
    const currentInput = input
    setInput('')
    setIsLoading(true)

    try {
      const response = await apiFetch<{ threadId: string }>('/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          to: phoneNumber,
          message: currentInput,
        }),
      })

      setThreadId(response.threadId)
      await fetchMessages()
    } catch (error) {
      console.error('Erro ao enviar mensagem', error)
      alert('Erro ao enviar mensagem. Verifique se sua integração com o WhatsApp já está autenticada.')
      setMessages((prev) => prev.filter((message) => message.id !== optimisticMessage.id))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendTemplate = async () => {
    if (!phoneNumber.trim() || !user?.id) return
    setIsLoading(true)

    try {
      const response = await apiFetch<{ threadId: string }>('/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          to: phoneNumber,
          template: 'hello_world',
        }),
      })

      setThreadId(response.threadId)
      await fetchMessages()
    } catch (error) {
      console.error('Erro ao enviar template', error)
      alert('Erro ao enviar template. Confirme se o usuário já autenticou o número no WhatsApp.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] lg:h-[calc(100vh-110px)] max-w-5xl mx-auto bg-white lg:rounded-2xl shadow-sm lg:shadow-xl overflow-hidden border-b border-[#e9e9e7] lg:border">
      <div className="bg-[#f0f2f5] px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between border-b border-[#e9e9e7]">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#37352f]/10 rounded-full flex items-center justify-center text-[#37352f] shrink-0">
            <User size={18} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Número autenticado"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="bg-transparent font-bold text-xs sm:text-sm outline-none border-b border-transparent focus:border-[#25d366] transition-colors w-full sm:w-44"
              />
              <button
                onClick={handleSendTemplate}
                disabled={isLoading || !phoneNumber.trim()}
                className="text-[8px] sm:text-[9px] bg-[#25d366] text-white px-1.5 sm:px-2 py-0.5 sm:py-1 rounded font-bold hover:bg-[#128c7e] transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                TEMPLATE
              </button>
            </div>
            <span className="text-[9px] sm:text-[10px] text-[#37352f]/40 font-medium truncate">
              Thread sincronizada entre WhatsApp e plataforma Web
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[#37352f]/60">
          <Search size={20} className="cursor-pointer" />
          <MoreVertical size={20} className="cursor-pointer" />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 bg-[#efeae2] space-y-2 relative"
        style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }}
      >
        <div className="absolute inset-0 bg-[#efeae2]/10 pointer-events-none" />

        {!messages.length && (
          <div className="relative z-10 max-w-md mx-auto mt-8 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 text-center text-sm text-[#37352f]/60 shadow-sm">
            Abra o assistente no WhatsApp, autentique sua conta e a conversa passa a aparecer aqui em tempo real.
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sentByMe ? 'justify-end' : 'justify-start'} relative z-10`}
          >
            <div
              className={`max-w-[70%] px-3 py-1.5 rounded-lg shadow-sm text-sm relative ${
                msg.sentByMe ? 'bg-[#dcf8c6] rounded-tr-none' : 'bg-white rounded-tl-none'
              }`}
            >
              <p>{msg.text}</p>
              <div className="flex items-center justify-end gap-1 mt-1">
                <span className="text-[10px] text-[#37352f]/40">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.sentByMe && (
                  <span className={msg.status === 'read' ? 'text-blue-500' : 'text-[#37352f]/40'}>
                    {msg.status === 'sent' || msg.status === 'queued' || msg.status === 'processing'
                      ? <Check size={12} />
                      : <CheckCheck size={12} />}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSendMessage} className="bg-[#f0f2f5] p-3 flex items-center gap-3">
        <div className="flex-1 bg-white rounded-lg px-4 py-2 flex items-center shadow-sm">
          <input
            type="text"
            placeholder="Digite uma mensagem..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            className="flex-1 bg-transparent border-none outline-none text-sm py-1"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !input.trim() || !phoneNumber.trim() || !user?.id}
          className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-all ${
            isLoading || !input.trim() || !phoneNumber.trim() || !user?.id
              ? 'bg-gray-300'
              : 'bg-[#25d366] hover:bg-[#128c7e] shadow-md scale-105'
          }`}
        >
          <Send size={18} fill="currentColor" className="ml-1" />
        </button>
      </form>
    </div>
  )
}

export default WhatsApp
