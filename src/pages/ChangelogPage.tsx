import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import PixelBlast from '../components/ui/PixelBlast'
import logo from '../assets/logo/logo.svg'
import { ArrowLeft } from 'lucide-react'
import novidadeIcon from '../assets/icones/novidades.svg'
import melhoriaIcon from '../assets/icones/melhoria.svg'
import correcaoIcon from '../assets/icones/correcao.svg'
import atencaoIcon from '../assets/icones/atencao.svg'
import MarkdownRenderer from '../components/ui/MarkdownRenderer'

interface ChangelogEntry {
  id: string
  title: string
  description: string
  type: 'feature' | 'fix' | 'improvement' | 'breaking'
  version: string | null
  published_at: string
}

const TYPE_CONFIG = {
  feature: {
    label: 'Novidade',
    icon: <img src={novidadeIcon} className="w-5 h-5" />,
    className: 'text-[#37352f]/40',
  },
  improvement: {
    label: 'Melhoria',
    icon: <img src={melhoriaIcon} className="w-5 h-5" />,
    className: 'text-[#37352f]/40',
  },
  fix: {
    label: 'Correção',
    icon: <img src={correcaoIcon} className="w-5 h-5" />,
    className: 'text-[#37352f]/40',
  },
  breaking: {
    label: 'Atenção',
    icon: <img src={atencaoIcon} className="w-5 h-5" />,
    className: 'text-red-500/60',
  },
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export default function ChangelogPage() {
  const { user, session } = useAuth()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  // Verifica se é admin para mostrar rascunhos
  useEffect(() => {
    if (!session?.access_token) return

    // Tenta verificar se é admin
    apiFetch<any>('/api/admin/stats', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(() => {
        console.log('Admin detectado, habilitando rascunhos');
        setIsAdmin(true);
      })
      .catch((err) => {
        console.log('Não é admin ou erro na verificação:', err);
      })
  }, [session])

  useEffect(() => {
    async function fetchEntries() {
      setLoading(true)
      const query = supabase
        .from('changelogs')
        .select('*')
        .order('published_at', { ascending: false })

      // Se não for admin, filtra apenas os publicados
      if (!isAdmin) {
        query.eq('status', 'published')
      }

      const { data, error } = await query
      if (error) {
        console.error('Erro ao buscar changelogs:', error)
      } else {
        setEntries((data as ChangelogEntry[]) || [])
      }
      setLoading(false)
    }

    fetchEntries()
  }, [isAdmin])

  return (
    <div className="min-h-screen bg-white text-[#37352f] font-sans relative overflow-x-hidden">
      {/* Hero background igual landing */}
      <div
        className="absolute top-0 left-0 w-full h-[500px] pointer-events-none z-0 overflow-hidden"
        style={{
          maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
        }}
      >
        <div className="absolute inset-0">
          <PixelBlast
            variant="square"
            pixelSize={3}
            color="#e2e2e2"
            patternScale={4}
            patternDensity={0.6}
            enableRipples
            rippleSpeed={0.3}
            rippleThickness={0.1}
            rippleIntensityScale={1}
            speed={0.3}
            transparent
            edgeFade={0}
          />
        </div>
      </div>

      {/* Navbar Minimalista (Igual Landing Page) */}
      <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between relative z-10">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
          <span className="text-xl font-bold tracking-tight">flui.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          <Link to="/#features" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Funcionalidades</Link>
          <Link to="/#pricing" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Planos</Link>
          <Link to="/#faq" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Dúvidas</Link>
        </nav>

        <div className="flex items-center gap-4">
          {user ? (
            <Link to="/checkout-preview" className="bg-[#202020] text-white text-sm font-medium px-4 py-2 rounded-[6px] shadow-sm hover:bg-[#202020]/90 transition-all">
              Acessar Painel
            </Link>
          ) : (
            <>
              <Link to="/login?mode=login" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors hidden sm:block">
                Fazer login
              </Link>
              <Link to="/login?mode=signup" className="bg-[#202020] text-white text-sm font-medium px-4 py-2 rounded-[6px] shadow-md shadow-black/5 hover:bg-[#202020]/90 transition-all">
                Criar conta
              </Link>
            </>
          )}
        </div>
      </header>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        {/* Header Content */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-16"
        >
          <h1 className="text-4xl font-bold text-[#202020] tracking-tight">Changelog</h1>
          <p className="text-[#37352f]/50 mt-2 text-sm">
            O que há de novo no Flui. Atualizações, melhorias e correções.
          </p>
        </motion.div>

        {/* Entries */}
        {loading ? (
          <div className="flex flex-col gap-12">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex gap-8 animate-pulse">
                <div className="w-28 h-4 bg-[#f0f0ef] rounded mt-1" />
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f0f0ef] mt-1.5" />
                  <div className="flex-1 w-px bg-[#f0f0ef] mt-2" />
                </div>
                <div className="flex-1">
                  <div className="w-48 h-5 bg-[#f0f0ef] rounded mb-2" />
                  <div className="w-full h-20 bg-[#f0f0ef] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-12 h-12 bg-[#f7f7f5] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#e9e9e7]">
              <img src={novidadeIcon} className="w-6 h-6 opacity-20" />
            </div>
            <p className="text-[#37352f]/40 text-sm font-medium">Nenhuma atualização publicada ainda.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline Vertical Line (Ultra-minimalist) */}
            <div
              className="absolute left-[118px] top-0 bottom-0 w-[1px] bg-[#e9e9e7]/40 hidden md:block"
              style={{ transform: 'translateX(-50%)' }}
            />

            <div className="space-y-12">
              {entries.map((entry, i) => {
                const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.feature
                const isDraft = (entry as any).status === 'draft'

                return (
                  <motion.article
                    key={entry.id}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className="flex flex-col md:flex-row gap-4 md:gap-0 relative group"
                  >
                    {/* Date column (Fixed width) */}
                    <div className="shrink-0 w-full md:w-[100px] pt-1.5 text-start md:text-right">
                      <time className="text-[10px] font-bold text-[#37352f]/30 tracking-wide">
                        {formatDate(entry.published_at)}
                      </time>
                    </div>

                    {/* Dot column (Ultra-minimalist) */}
                    <div className="hidden md:flex shrink-0 w-[36px] justify-center relative z-10">
                      <div className={`w-1 h-1 rounded-full mt-[13.5px] transition-all duration-300 ${
                        isDraft 
                          ? 'bg-amber-400' 
                          : 'bg-[#e9e9e7] group-hover:bg-[#202020]'
                      }`} />
                    </div>

                    {/* Content (Minimalist) */}
                    <div className="flex-1 pb-8 md:pl-4">
                      <div className="flex items-center flex-wrap gap-3 mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="scale-75 opacity-40">{config.icon}</span>
                          <span className={`text-[10px] font-bold ${config.className}`}>
                            {config.label}
                          </span>
                        </div>

                        {entry.version && (
                          <span className="text-[10px] font-mono font-medium text-[#37352f]/20">
                            v{entry.version}
                          </span>
                        )}

                        {isDraft && (
                          <span className="text-[9px] font-bold text-amber-500/60">
                            • Rascunho
                          </span>
                        )}
                      </div>

                      <h2 className="text-base font-bold text-[#202020] tracking-tight mb-2 group-hover:text-black transition-colors">
                        {entry.title}
                      </h2>
                      <MarkdownRenderer content={entry.description} className="text-sm text-[#37352f]/50 leading-relaxed max-w-xl" />
                    </div>
                  </motion.article>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
