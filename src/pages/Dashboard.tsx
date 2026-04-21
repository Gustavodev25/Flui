import React, { useEffect, useState, useRef } from 'react'
import NumberFlow from '@number-flow/react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  MessageCircleMore,
  TrendingUp,
  ExternalLink,
  CalendarDays,
  Sparkles,
  Zap,
} from 'lucide-react'
import handAnimationData from '../assets/hand.json'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useNavigate } from 'react-router-dom'
import luiLogo from '../assets/logo/lui.svg'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import Avvvatars from 'avvvatars-react'

// Componente que usa lottie-web diretamente via ref
const LottieHand: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let anim: any = null;
    let isMounted = true;

    import('lottie-web').then((lottie) => {
      if (!isMounted || !containerRef.current) return;

      const lottieLib = lottie.default || lottie;

      containerRef.current.innerHTML = '';

      anim = lottieLib.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: handAnimationData,
      });

      anim.addEventListener('complete', () => {
        setTimeout(() => {
          if (isMounted) anim?.goToAndPlay(0, true);
        }, 5000);
      });
    });

    return () => {
      isMounted = false;
      if (anim) {
        anim.destroy();
      }
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

interface DashboardStats {
  todo: number
  doing: number
  done: number
}

const WHATSAPP_NUMBER = '5511925870754'
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`
const QR_CODE_URL = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(WHATSAPP_LINK)}&bgcolor=f7f7f5&color=37352f&margin=4`

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
};

const Dashboard: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { hasFlow } = useSubscription()
  const [stats, setStats] = useState<DashboardStats>({ todo: 0, doing: 0, done: 0 })
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [recentTasks, setRecentTasks] = useState<any[]>([])
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [dailyQuote, setDailyQuote] = useState<string>(() => {
    const today = new Date().toISOString().split('T')[0]
    const cachedDate = localStorage.getItem('dailyQuoteDate')
    if (cachedDate === today) {
      const cached = localStorage.getItem('dailyQuote') || ""
      // Invalida cache se parece um prompt/prefácio corrompido
      if (cached.length > 120 || cached.includes('?') && cached.length > 60) {
        localStorage.removeItem('dailyQuoteDate')
        return ""
      }
      return cached
    }
    return ""
  })
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(() => {
    const today = new Date().toISOString().split('T')[0]
    const dateMatch = localStorage.getItem('dailyQuoteDate') === today
    const hasQuote = !!(localStorage.getItem('dailyQuote') || '').trim()
    return !dateMatch || !hasQuote
  })

  const fullName = user?.user_metadata?.name || 'Companheiro(a) de Equipe'
  const firstName = fullName.split(' ')[0]


  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const { data: personalTasks, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user?.id)
          .eq('visibility', 'personal')
          .order('created_at', { ascending: false })

        if (error) throw error

        let sharedTasks: any[] = []
        try {
          const result = await apiFetch<any>('/api/workspace/shared-tasks', undefined, { userId: user?.id })
          if (result && result.tasks) {
            sharedTasks = result.tasks
          }
        } catch (e) {
          console.error('Erro ao buscar tarefas do workspace', e)
        }

        const allRawTasks = [...(personalTasks || []), ...sharedTasks]
        const uniqueMap = new Map()
        allRawTasks.forEach(t => uniqueMap.set(t.id, t))
        const allTasks = Array.from(uniqueMap.values())

        const mappedTasks = allTasks.map(dbTask => {
          const isAssignedToMe = (dbTask.assigned_to === user?.id) || (dbTask.assignee?.id === user?.id)
          return {
            id: dbTask.id,
            title: dbTask.title,
            status: dbTask.status,
            priority: dbTask.priority,
            created_at: dbTask.created_at,
            visibility: dbTask.visibility || 'personal',
            assignedToId: isAssignedToMe ? user?.id : (dbTask.assigned_to || dbTask.assignee?.id || undefined),
            assignedToName: isAssignedToMe ? (user?.user_metadata?.name || 'Eu') : (dbTask.assignee?.name || undefined),
            assignedToAvatar: isAssignedToMe ? user?.user_metadata?.avatar_url : (dbTask.assignee?.avatar || undefined),
            assignedToEmail: isAssignedToMe ? user?.email : (dbTask.assignee?.email || undefined),
            authorName: dbTask.author?.name || undefined,
            userId: dbTask.user_id
          }
        })

        const newStats = {
          todo: mappedTasks.filter(t => t.status === 'todo').length,
          doing: mappedTasks.filter(t => t.status === 'doing').length,
          done: mappedTasks.filter(t => t.status === 'done').length,
        }
        setStats(newStats)

        mappedTasks.sort((a, b) => {
          const aIsAssignedToMe = a.assignedToId === user?.id
          const bIsAssignedToMe = b.assignedToId === user?.id
          if (aIsAssignedToMe && !bIsAssignedToMe) return -1
          if (!aIsAssignedToMe && bIsAssignedToMe) return 1

          const dateA = new Date(a.created_at).getTime()
          const dateB = new Date(b.created_at).getTime()
          return dateB - dateA
        })

        setRecentTasks(mappedTasks)
      } catch (err) {
        console.error('Erro no Dashboard:', err)
      } finally {
        setLoadingRecent(false)
      }
    }

    fetchDashboardData()
  }, [user])

  useEffect(() => {
    const FALLBACK_QUOTES = [
      'Foco hoje, sucesso amanhã',
      'Disciplina transforma sonhos em realidade',
      'Pequenos passos constantes constroem grandes conquistas',
      'Sua determinação é o seu maior recurso',
      'Cada dia é uma nova oportunidade de crescer',
      'Consistência supera intensidade',
      'O sucesso começa com a decisão de tentar',
    ]

    const saveFallback = (today: string) => {
      const quote = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)]
      setDailyQuote(quote)
      localStorage.setItem('dailyQuote', quote)
      localStorage.setItem('dailyQuoteDate', today)
    }

    const fetchAIGeneratedQuote = async () => {
      const today = new Date().toISOString().split('T')[0]
      const cachedQuote = (localStorage.getItem('dailyQuote') || '').trim()
      if (localStorage.getItem('dailyQuoteDate') === today && cachedQuote) {
        setDailyQuote(cachedQuote)
        setIsLoadingQuote(false)
        return
      }

      try {
        const data = await apiFetch<any>('/api/chat', {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content: 'Você responde APENAS com a frase solicitada. Sem introdução, sem aspas, sem explicação, sem pontuação extra. Somente a frase.'
              },
              {
                role: 'user',
                content: 'Crie uma frase motivacional curta (máximo 10 palavras) em português sobre foco, disciplina ou sucesso. Responda só com a frase.'
              }
            ],
            temperature: 0.85,
            max_tokens: 80
          })
        })
        if (data.choices && data.choices[0]) {
          let raw: string = data.choices[0].message.content || ''
          raw = raw.replace(/^[^:：]+[:：]\s*/u, '').trim()
          raw = raw.split('\n')[0].trim()
          raw = raw.replace(/["'"'«»]/g, '').trim()
          raw = raw.split('. ')[0].trim()
          raw = raw.replace(/[.!?]+$/, '').trim()
          if (raw && raw.length <= 120) {
            setDailyQuote(raw)
            localStorage.setItem('dailyQuote', raw)
            localStorage.setItem('dailyQuoteDate', today)
          } else {
            saveFallback(today)
          }
        } else {
          saveFallback(today)
        }
      } catch {
        saveFallback(today)
      } finally {
        setIsLoadingQuote(false)
      }
    }

    fetchAIGeneratedQuote()
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as any } }
  }

  return (
    <>
    <div className="flex-1 overflow-y-auto bg-white p-4 sm:p-8 lg:p-12 xl:px-20">
      <div className="max-w-[1400px] mx-auto space-y-8 sm:space-y-12">

        {/* Header Section */}
        <motion.header
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6"
        >
          <div className="space-y-1">
            <h1 className="text-[20px] xs:text-[22px] sm:text-[30px] md:text-[34px] font-bold tracking-tight overflow-hidden leading-tight flex flex-wrap items-center">
              <span className="relative inline-flex items-center">
                {/* 1. Camada Base (Texto Escuro Sólido - Sempre Visível) */}
                <span className="text-[#37352f] flex flex-wrap">
                  {(`${getGreeting()}, ${firstName}!`).split("").map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: "100%", opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.01,
                        ease: [0.2, 0.65, 0.3, 0.9]
                      }}
                      className="inline-block"
                      style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </span>

                {/* 2. Camada de Brilho (Texto Branco com Opacidade Controlada) */}
                <motion.span
                  className="absolute inset-0 flex flex-wrap text-white pointer-events-none select-none"
                  style={{
                    WebkitMaskImage: "linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)",
                    WebkitMaskSize: "200% 100%",
                    maskImage: "linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)",
                    maskSize: "200% 100%",
                  }}
                  initial={{ maskPosition: "150%", opacity: 0 }}
                  animate={{
                    maskPosition: "-150%",
                    opacity: [0, 1, 0]
                  }}
                  transition={{
                    maskPosition: { delay: 0.3, duration: 1.2, ease: "easeInOut" },
                    opacity: { delay: 0.3, duration: 1.2, times: [0, 0.15, 1], ease: "linear" }
                  }}
                >
                  {(`${getGreeting()}, ${firstName}!`).split("").map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: "100%", opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.01,
                        ease: [0.2, 0.65, 0.3, 0.9]
                      }}
                      className="inline-block"
                      style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </motion.span>
              </span>

              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
                className="w-[30px] h-[30px] xs:w-[36px] xs:h-[36px] sm:w-[46px] sm:h-[46px] inline-flex items-center justify-center align-middle ml-2 opacity-90"
              >
                <LottieHand />
              </motion.div>
            </h1>

            <motion.div
              className="text-[#72706a] text-sm sm:text-lg font-medium flex items-center gap-2"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6, duration: 0.4 }}
                className="shrink-0"
              >
                <CalendarDays size={16} className="text-[#37352f]/20 shrink-0" />
              </motion.div>
              <span className="flex flex-wrap leading-tight">
                {"Hoje é um ótimo dia para realizar grandes tarefas.".split("").map((char, i) => (
                  <motion.span
                    key={i}
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{
                      duration: 0.3,
                      delay: 0.6 + (i * 0.005),
                      ease: [0.2, 0.65, 0.3, 0.9]
                    }}
                    className="inline-block"
                    style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                  >
                    {char}
                  </motion.span>
                ))}
              </span>
            </motion.div>
          </div>
        </motion.header>

        {/* Stats Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6"
        >
          {/* Card: Total */}
          <motion.div variants={itemVariants} className="bg-[#f7f7f5] border border-[#e9e9e7] p-5 rounded-2xl">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-white rounded-xl shadow-sm">
                <ClipboardList size={22} className="text-[#37352f]/70" />
              </div>
              <TrendingUp size={16} className="text-[#2383e2]" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium text-[#37352f]/65 tracking-widest">Total Geral</p>
              <h3 className="text-3xl font-black text-[#37352f] tracking-tight">
                <NumberFlow value={stats.todo + stats.doing + stats.done} />
              </h3>
            </div>
          </motion.div>

          {/* Card: Doing */}
          <motion.div variants={itemVariants} className="bg-[#f7f7f5] border border-[#e9e9e7] p-5 rounded-2xl">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-white rounded-xl shadow-sm">
                <Clock size={22} className="text-[#2383e2]" />
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium text-[#37352f]/65 tracking-widest">Em Execução</p>
              <h3 className="text-3xl font-black text-[#37352f] tracking-tight">
                <NumberFlow value={stats.doing} />
              </h3>
            </div>
          </motion.div>

          {/* Card: Done */}
          <motion.div variants={itemVariants} className="bg-[#f7f7f5] border border-[#e9e9e7] p-5 rounded-2xl">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-white rounded-xl shadow-sm">
                <CheckCircle2 size={22} className="text-[#25D366]" />
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium text-[#37352f]/65 tracking-widest">Finalizadas</p>
              <h3 className="text-3xl font-black text-[#37352f] tracking-tight">
                <NumberFlow value={stats.done} />
              </h3>
            </div>
          </motion.div>

          {/* Card: Frase do Dia (Minimalist) */}
          <motion.div variants={itemVariants} className="bg-[#f7f7f5] border border-[#e9e9e7] p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-white rounded-xl shadow-sm">
                <Sparkles size={22} className="text-[#f59e0b]" />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-[#37352f]/65 tracking-widest">Frase do Dia</p>
              <h3 className="text-[13px] font-semibold text-[#37352f]/80 leading-relaxed min-h-[40px]">
                {isLoadingQuote ? (
                  <span className="animate-pulse text-[#37352f]/40 flex items-center h-full">Gerando IA...</span>
                ) : dailyQuote ? (
                  `"${dailyQuote}"`
                ) : (
                  <span className="text-[#37352f]/30">—</span>
                )}
              </h3>
            </div>
          </motion.div>
        </motion.div>

        {/* Main Content Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10">

          {/* Lui Integration Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-2 bg-[#fcfcfa] border-2 border-[#e9e9e7]/50 rounded-3xl p-8 sm:p-10 flex flex-col md:flex-row gap-10 items-center overflow-hidden relative group"
          >
            <div className="flex-1 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#f7f7f5] flex items-center justify-center border border-[#e9e9e7]">
                  <img src={luiLogo} alt="Lui" className="w-6 h-6 object-contain" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#37352f] tracking-tight">Gestão via WhatsApp</h2>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[#37352f]/60 text-base leading-relaxed max-w-sm">
                  O Lui é seu assistente pessoal no WhatsApp. Crie, busque e gerencie processos apenas enviando uma mensagem de voz ou texto.
                </p>

              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => hasFlow && window.open(WHATSAPP_LINK, '_blank')}
                  disabled={!hasFlow}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    hasFlow
                      ? 'border-[#37352f]/20 text-[#37352f] hover:bg-[#37352f]/5 cursor-pointer'
                      : 'border-[#e9e9e7] text-[#37352f]/25 cursor-not-allowed'
                  }`}
                >
                  Conectar com Lui
                </button>

                {!hasFlow && (
                  <button
                    onClick={() => navigate('/checkout-preview')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border border-[#37352f]/15 text-[#37352f]/50 hover:text-[#37352f] hover:border-[#37352f]/30 transition-all cursor-pointer"
                  >
                    Assinar Flow
                  </button>
                )}
              </div>
            </div>

            <div className={`relative z-10 p-2 bg-white rounded-2xl shadow-2xl shadow-black/5 ring-1 ring-black/5 rotate-2 group-hover:rotate-0 transition-all duration-500 ${!hasFlow ? 'overflow-hidden' : ''}`}>
              <img
                src={QR_CODE_URL}
                alt="QR Code"
                className={`w-[140px] h-[140px] sm:w-[180px] sm:h-[180px] transition-all duration-300 ${!hasFlow ? 'blur-md grayscale opacity-30 select-none pointer-events-none' : ''}`}
              />
              {!hasFlow && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-[#37352f]/40 tracking-widest bg-white/80 px-2.5 py-1 rounded-full">
                    Flow
                  </span>
                </div>
              )}
              <p className="text-[10px] text-[#37352f]/30 font-bold text-center mt-2">Acesso Direto</p>
            </div>

            <div className="absolute top-0 right-0 p-8 text-[#37352f]/5 opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink size={100} />
            </div>
          </motion.div>

          {/* Recent Activity Mini-List */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <p className="text-[10px] font-medium text-[#37352f]/50 tracking-widest uppercase">Itens Recentes</p>
              <button
                onClick={() => navigate('/tasks')}
                className="text-[10px] text-[#37352f]/35 hover:text-[#37352f]/70 transition-colors"
              >
                ver tudo
              </button>
            </div>

            <div className="border-t border-[#e9e9e7]" />

            <div className="pb-2">
              {loadingRecent ? (
                [0, 1, 2, 3].map(i => (
                  <div key={i} className="px-5 py-3 border-b border-[#e9e9e7]">
                    <div className="h-2.5 bg-[#e9e9e7] rounded animate-pulse w-3/4" />
                  </div>
                ))
              ) : recentTasks.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-[11px] text-[#37352f]/35">Nenhuma atividade ainda.</p>
                </div>
              ) : (
                <>
                  {recentTasks.slice(0, 5).map((task, i) => (
                    <div
                      key={task.id || i}
                      className="flex items-center gap-2.5 px-5 py-3 border-b border-[#e9e9e7] last:border-0 cursor-pointer group"
                      onClick={() => navigate('/tasks')}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        task.status === 'done' ? 'bg-[#25D366]' :
                        task.status === 'doing' ? 'bg-[#2383e2]' : 'bg-[#d3d3cf]'
                      }`} />
                      <p className="text-[13px] text-[#37352f]/70 group-hover:text-[#37352f] line-clamp-1 transition-colors flex-1">
                        {task.title}
                      </p>
                    </div>
                  ))}
                    {recentTasks.length > 5 && (
                      <button
                        onClick={() => setShowAllTasks(true)}
                        className="w-full px-5 py-3 text-[11px] text-[#37352f]/40 hover:text-[#37352f]/70 transition-colors text-left"
                      >
                        ver mais {recentTasks.length - 5}
                      </button>
                    )}
                </>
              )}
            </div>
          </motion.div>

        </div>
      </div>
    </div>

    {/* Modal — todos os itens recentes */}
    <AnimatePresence>
      {showAllTasks && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowAllTasks(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18 }}
            className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <p className="text-[10px] font-medium text-[#37352f]/50 tracking-widest uppercase">Todos os Itens</p>
              <button
                onClick={() => setShowAllTasks(false)}
                className="text-[10px] text-[#37352f]/35 hover:text-[#37352f]/70 transition-colors"
              >
                fechar
              </button>
            </div>
            <div className="border-t border-[#e9e9e7]" />
            <div className="overflow-y-auto max-h-[60vh]">
              {recentTasks.map((task, i) => (
                <div
                  key={task.id || i}
                  className="flex items-center gap-2.5 px-5 py-3 border-b border-[#e9e9e7] last:border-0 cursor-pointer group"
                  onClick={() => { setShowAllTasks(false); navigate('/tasks') }}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    task.status === 'done' ? 'bg-[#25D366]' :
                    task.status === 'doing' ? 'bg-[#2383e2]' : 'bg-[#d3d3cf]'
                  }`} />
                  <p className="text-[13px] text-[#37352f]/70 group-hover:text-[#37352f] line-clamp-1 transition-colors flex-1">
                    {task.title}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}

export default Dashboard
