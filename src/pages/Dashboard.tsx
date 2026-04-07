import React, { useEffect, useState, useRef } from 'react'
import NumberFlow from '@number-flow/react'
import { motion } from 'framer-motion'
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
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import luiLogo from '../assets/logo/finloz.png'
import { apiFetch } from '../lib/api'

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
  const [hasFlow, setHasFlow] = useState<boolean>(false)
  const [stats, setStats] = useState<DashboardStats>({ todo: 0, doing: 0, done: 0 })
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [recentTasks, setRecentTasks] = useState<any[]>([])
  const [dailyQuote, setDailyQuote] = useState<string>(() => {
    const today = new Date().toISOString().split('T')[0]
    const cachedDate = localStorage.getItem('dailyQuoteDate')
    if (cachedDate === today) {
      return localStorage.getItem('dailyQuote') || ""
    }
    return ""
  })
  const [isLoadingQuote, setIsLoadingQuote] = useState<boolean>(() => {
    const today = new Date().toISOString().split('T')[0]
    return localStorage.getItem('dailyQuoteDate') !== today
  })

  const fullName = user?.user_metadata?.name || 'Companheiro(a) de Equipe'
  const firstName = fullName.split(' ')[0]

  useEffect(() => {
    const fetchSub = async () => {
      if (!user) return
      const { data } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle()
      setHasFlow(data?.status === 'active')
    }
    fetchSub()
  }, [user])

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const { data: tasks, error } = await supabase
          .from('tasks')
          .select('status, priority, created_at, title, due_date')
          .eq('user_id', user?.id)
          .order('created_at', { ascending: false })

        if (error) throw error

        if (tasks) {
          const newStats = {
            todo: tasks.filter(t => t.status === 'todo').length,
            doing: tasks.filter(t => t.status === 'doing').length,
            done: tasks.filter(t => t.status === 'done').length,
          }
          setStats(newStats)
          setRecentTasks(tasks.slice(0, 4))
        }
      } catch (err) {
        console.error('Erro no Dashboard:', err)
      } finally {
        setLoadingRecent(false)
      }
    }

    fetchDashboardData()
  }, [])

  useEffect(() => {
    const fetchAIGeneratedQuote = async () => {
      const today = new Date().toISOString().split('T')[0]
      if (localStorage.getItem('dailyQuoteDate') === today) {
        return
      }

      try {
        const data = await apiFetch<any>('/api/chat', {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Crie uma frase motivacional super curta (máximo 12 palavras) sobre foco, disciplina ou sucesso diário. Retorne EXATAMENTE APENAS a frase, sem aspas, sem introdução, sem nada extra.' }],
            temperature: 0.9,
            max_tokens: 50
          })
        })
        if (data.choices && data.choices[0]) {
          const generatedQuote = data.choices[0].message.content.replace(/^["']|["']$/g, '').trim()
          setDailyQuote(generatedQuote)
          localStorage.setItem('dailyQuote', generatedQuote)
          localStorage.setItem('dailyQuoteDate', today)
        }
      } catch (error) {
        console.error('Erro ao gerar frase com IA:', error)
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

            <motion.p
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
            </motion.p>
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
          <motion.div variants={itemVariants} className="bg-[#f7f7f5] border border-[#e9e9e7] p-5 rounded-2xl hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-white rounded-xl shadow-sm">
                <ClipboardList size={22} className="text-[#37352f]/70" />
              </div>
              <TrendingUp size={16} className="text-[#2383e2]" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[12px] font-bold text-[#37352f]/40 tracking-widest">Total Geral</p>
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
              <p className="text-[12px] font-bold text-[#37352f]/40 tracking-widest">Em Execução</p>
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
              <p className="text-[12px] font-bold text-[#37352f]/40 tracking-widest">Finalizadas</p>
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
              <p className="text-[12px] font-bold text-[#37352f]/40 tracking-widest">Frase do Dia</p>
              <h3 className="text-[13px] font-semibold text-[#37352f]/80 leading-relaxed min-h-[40px]">
                {isLoadingQuote ? (
                  <span className="animate-pulse text-[#37352f]/40 flex items-center h-full">Gerando IA...</span>
                ) : (
                  `"${dailyQuote}"`
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
            className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-6 sm:p-8 flex flex-col"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-lg font-bold text-[#37352f] tracking-tight">Itens Recentes</h2>
              <button
                onClick={() => navigate('/tasks')}
                className="text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] tracking-wider transition-colors"
              >
                Ver tudo
              </button>
            </div>

            <div className="space-y-2">
              {loadingRecent ? (
                [0, 1, 2, 3].map(i => (
                  <div key={i} className="flex gap-4 items-center">
                    <div className="w-2 h-2 rounded-full bg-[#e9e9e7] flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-[#e9e9e7] rounded animate-pulse w-4/5" />
                      <div className="h-2.5 bg-[#e9e9e7] rounded animate-pulse w-1/3" />
                    </div>
                  </div>
                ))
              ) : recentTasks.length === 0 ? (
                <div className="text-center py-10 space-y-2 opacity-50">
                  <p className="text-xs font-bold">Nada por aqui</p>
                  <p className="text-[11px]">Suas atividades aparecerão aqui.</p>
                </div>
              ) : (
                recentTasks.map((task, i) => (
                  <div key={task.id || i} className="flex gap-4 items-center group cursor-pointer" onClick={() => navigate('/tasks')}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${task.status === 'done' ? 'bg-[#25D366]' :
                        task.status === 'doing' ? 'bg-[#2383e2]' : 'bg-slate-300'
                      }`} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#37352f] line-clamp-1 group-hover:underline">
                        {task.title}
                      </p>
                      <p className="text-[11px] font-semibold text-[#37352f]/30 tracking-tight">
                        {task.priority === 'high' ? 'Crítica' : 'Normal'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  )
}

export default Dashboard
