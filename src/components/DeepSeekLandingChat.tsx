import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X } from 'lucide-react'
import { apiFetch } from '../lib/api'
import finloz from '../assets/logo/finloz.png'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const WHATSAPP_NUMBER = '5518996239335'
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`

const SYSTEM_PROMPT = `Você é o Lui, assistente virtual oficial do **Flui** — um sistema de produtividade e gestão de tarefas premium, feito para quem busca clareza e foco total.

Seja breve, direto, amigável e profissional. Responda sempre em Português do Brasil. Use parágrafos curtos e formatação clara com **negrito** quando necessário.

---

## SOBRE O FLUI

O Flui é uma plataforma completa de gestão de tarefas e produtividade pessoal/profissional. A proposta central é: "Organize tudo com extrema clareza". Ele foi projetado para eliminar o atrito da produtividade — interface minimalista, sem distrações, apenas foco.

**Funcionalidades principais:**
- **Kanban Intuitivo**: Quadro visual de tarefas com arrastar e soltar (To-Do, Em Progresso, Concluído)
- **Calendário Visual**: Visualize sua semana e planeje seus próximos passos com clareza
- **Lui (Assistente IA via WhatsApp)**: Crie tarefas por áudio ou texto direto pelo celular. O Lui processa áudios descritivos, quebra planos de ação, localiza datas e injeta cards categorizados no Kanban automaticamente
- **Sincronização em Nuvem**: Dados sincronizados em tempo real entre todos os dispositivos (desktop, tablet, celular, WhatsApp)
- **Inteligência Artificial nativa**: IA integrada ao sistema para potencializar a produtividade
- **Projetos Ilimitados**: Organize por projetos, categorias e prioridades

---

## PLANOS E PREÇOS

### Plano Gratuito — R$ 0 (para sempre)
- Tarefas manuais ilimitadas
- Painel e calendário
- Organização básica
- **NÃO inclui**: Lui Assistant (WhatsApp), Sincronização em Nuvem, Suporte Prioritário

### Plano Flow — R$ 9,90/mês (cobrança mensal recorrente)
- Tudo do Gratuito, mais:
- Tarefas e Projetos Ilimitados
- Lui (Áudios & Mensagens via WhatsApp)
- Sincronização em Nuvem em tempo real
- Sem limites ou amarras
- Suporte Prioritário
- **Garantia de reembolso em até 7 dias**

---

## PAGAMENTOS E COBRANÇA

- Todos os pagamentos são processados pela **Stripe**, a maior provedora de pagamentos do mundo
- Aceita cartões de crédito e débito
- **Cancelamento**: Pode ser feito a qualquer momento com um clique nas configurações. Sem contratos, sem multas, sem telefonemas de retenção
- **Reembolso**: Garantia de 7 dias — se não gostar, devolução total

---

## FAQ / PERGUNTAS FREQUENTES

**O que torna o Flui diferente?**
O Flui não é apenas uma lista de tarefas — é um ecossistema completo. Com a integração do Lui no WhatsApp, você cria e gerencia tarefas com apenas um áudio. A interface minimalista elimina o excesso de usabilidade.

**Posso acessar meus dados em qualquer lugar?**
Sim. Desktop, tablet ou WhatsApp — tudo sincronizado instantaneamente em nuvem.

**Como o Lui afeta minha produtividade?**
O Lui elimina o atrito de entrada. Enquanto você dirige, pode enviar um áudio descritivo e a IA processa, quebra em ações, localiza datas e cria os cards no Kanban automaticamente.

**Meus dados sincronizam em tempo real?**
Sim! Tecnologia reativa de ponta — mudanças refletem em milissegundos entre dispositivos.

**A assinatura pode ser cancelada?**
Sim, sem letras miúdas. Cancele e revogue em segundos nas configurações. Sem multas ou contratos amarrados.

---

## REGRAS DE COMPORTAMENTO

1. Nunca invente funcionalidades que NÃO existem no Flui
2. Se não souber algo específico, diga que vai encaminhar para o time
3. Seja sempre objetivo e direto — evite respostas longas demais
4. Se o usuário perguntar sobre preço, sempre mencione a garantia de 7 dias
5. Se o usuário parecer interessado, incentive-o a criar uma conta ou assinar o Flow

IMPORTANTE: Quando o usuário pedir para falar com um humano, atendente, suporte humano, pessoa real, ou qualquer variação disso, responda EXATAMENTE com:
"Claro! Vou te conectar com nosso time.
[WHATSAPP_HUMANO]"
Não adicione mais nada depois do marcador. Use esse marcador exatamente como está.`

// Card de contato WhatsApp
const WhatsAppCard = () => (
  <a
    href={WHATSAPP_LINK}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-2 mt-2 px-3 py-2 bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl hover:border-[#37352f]/20 transition-all no-underline"
  >
    <svg className="w-3.5 h-3.5 text-[#37352f]/40 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
    <span className="text-[11px] font-semibold text-[#37352f]/50">Falar com o time</span>
    <svg className="w-3 h-3 text-[#37352f]/15 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  </a>
)

// Formata o texto da IA com negrito, quebras de linha e card de WhatsApp
const formatMessage = (text: string) => {
  // Detecta marcador de WhatsApp humano
  if (text.includes('[WHATSAPP_HUMANO]')) {
    const [before] = text.split('[WHATSAPP_HUMANO]')
    return (
      <>
        {before.trim() && formatTextParts(before.trim())}
        <WhatsAppCard />
      </>
    )
  }
  return formatTextParts(text)
}

const BUBBLE_TEXTS = [
  'Precisa de ajuda?',
  'Alguma dúvida?',
  'Posso te ajudar!',
  'Fale com a IA',
  'Estou aqui ✨',
]

const formatTextParts = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-[#37352f]">{part.slice(2, -2)}</strong>
    }
    return part.split('\n').map((line, j) => (
      <React.Fragment key={`${i}-${j}`}>
        {j > 0 && <br />}
        {line}
      </React.Fragment>
    ))
  })
}

// Componente de "digitando..." com efeito shine
const TypingIndicator = () => (
  <div className="flex items-start gap-2.5">
    <img src={finloz} alt="" className="w-5 h-5 mt-0.5 rounded-full flex-shrink-0" />
    <div className="relative overflow-hidden bg-[#f7f7f5] rounded-2xl rounded-tl-md px-4 py-3">
      <div className="flex items-center gap-1">
        <motion.span
          className="w-1.5 h-1.5 rounded-full bg-[#37352f]/20"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
        />
        <motion.span
          className="w-1.5 h-1.5 rounded-full bg-[#37352f]/20"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
        />
        <motion.span
          className="w-1.5 h-1.5 rounded-full bg-[#37352f]/20"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
        />
      </div>
      {/* Shine overlay */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  </div>
)

const DeepSeekLandingChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou o Lui, assistente do Flui. Como posso ajudar?' }
  ])
  const [isLoading, setIsLoading] = useState(false)
  const [bubbleIndex, setBubbleIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Ciclar textos do balão
  useEffect(() => {
    if (isOpen) return
    const interval = setInterval(() => {
      setBubbleIndex(prev => (prev + 1) % BUBBLE_TEXTS.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [isOpen])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(scrollToBottom, 50)
      return () => clearTimeout(timer)
    }
  }, [messages, isOpen])

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const data = await apiFetch<any>('/api/chat', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...[...messages, userMessage].map(m => ({
              role: m.role,
              content: m.content
            }))
          ]
        })
      })

      if (data.choices?.[0]?.message?.content) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.choices[0].message.content
        }])
      } else {
        throw new Error('Sem resposta')
      }
    } catch (error) {
      console.error(error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Ops, tente novamente.'
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end pointer-events-none">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="pointer-events-auto w-[340px] h-[480px] bg-white border border-[#e9e9e7] rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden mb-4"
          >
            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-[#e9e9e7]">
              <div className="flex items-center gap-2">
                <img src={finloz} alt="Lui" className="w-5 h-5 rounded-full" />
                <span className="text-[10px] font-bold text-[#37352f] tracking-widest">Lui · Assistente</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#37352f]/20 hover:text-[#37352f] transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto px-5 py-2 space-y-4 hide-scrollbar">
              {messages.map((m, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' ? (
                    <div className="flex items-start gap-2.5 max-w-[90%]">
                      <img src={finloz} alt="" className="w-5 h-5 mt-0.5 rounded-full flex-shrink-0" />
                      <div className="bg-[#f7f7f5] rounded-2xl rounded-tl-md p-3 text-[12px] font-medium leading-relaxed text-[#37352f]/70">
                        {formatMessage(m.content)}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[85%] bg-[#202020] text-white rounded-2xl rounded-tr-md p-3 text-[12px] font-medium leading-relaxed">
                      {m.content}
                    </div>
                  )}
                </motion.div>
              ))}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <TypingIndicator />
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Pergunte algo..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="w-full bg-[#f7f7f5] border-none rounded-xl py-2.5 px-4 text-[12px] font-semibold text-[#37352f] placeholder-[#37352f]/20 outline-none"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 text-[#37352f]/10 hover:text-[#37352f] disabled:opacity-0 transition-all"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Balão com texto rotativo - efeito char-by-char + shimmer */}
      <div className="pointer-events-none flex items-center gap-3">
        <AnimatePresence mode="wait">
          {!isOpen && (
            <motion.div
              key="bubble-container"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3 }}
              className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl rounded-br-md px-3.5 py-2 shadow-sm overflow-hidden"
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={bubbleIndex}
                  className="relative inline-flex overflow-hidden"
                >
                  {/* Camada base */}
                  <span className="text-[#37352f]/80 flex text-[11px] font-semibold leading-snug whitespace-nowrap">
                    {BUBBLE_TEXTS[bubbleIndex].split('').map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.02, ease: [0.2, 0.65, 0.3, 0.9] }}
                        className="inline-block"
                        style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </span>

                  {/* Camada de brilho */}
                  <motion.span
                    className="absolute inset-0 flex pointer-events-none select-none"
                    style={{
                      WebkitMaskImage: 'linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)',
                      WebkitMaskSize: '200% 100%',
                      maskImage: 'linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)',
                      maskSize: '200% 100%',
                    }}
                    initial={{ WebkitMaskPosition: '150%', opacity: 0 } as any}
                    animate={{ WebkitMaskPosition: '-150%', opacity: [0, 1, 0] } as any}
                    transition={{
                      WebkitMaskPosition: { delay: 0.4, duration: 1.2, ease: 'easeInOut' },
                      opacity: { delay: 0.4, duration: 1.2, times: [0, 0.15, 1], ease: 'linear' },
                    }}
                  >
                    {BUBBLE_TEXTS[bubbleIndex].split('').map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.02, ease: [0.2, 0.65, 0.3, 0.9] }}
                        className="inline-block text-[11px] font-semibold leading-snug text-white"
                        style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </motion.span>
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => setIsOpen(!isOpen)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="pointer-events-auto w-12 h-12 rounded-2xl rounded-br-md bg-[#f7f7f5] border border-[#e9e9e7] flex items-center justify-center shadow-sm hover:shadow-md transition-all p-2.5"
        >
          <motion.img
            animate={{ scale: isOpen ? 0.9 : 1 }}
            src={finloz}
            alt="Chat"
            className="w-full h-full object-contain"
          />
        </motion.button>
      </div>
    </div>
  )
}

export default DeepSeekLandingChat
