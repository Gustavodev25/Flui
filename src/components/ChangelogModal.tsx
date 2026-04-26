import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import PixelBlast from './ui/PixelBlast'

import novidadeIcon from '../assets/icones/novidades.svg'
import melhoriaIcon from '../assets/icones/melhoria.svg'
import correcaoIcon from '../assets/icones/correcao.svg'
import atencaoIcon from '../assets/icones/atencao.svg'

function stripMarkdown(text: string) {
  return text
    .replace(/#{1,6}\s+/g, '') // Remove headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.+?)\*/g, '$1') // Remove italic
    .replace(/`(.+?)`/g, '$1') // Remove inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
    .replace(/^[\s\t]*[-*+]\s+/gm, '') // Remove list bullets
    .replace(/\n+/g, ' ') // Texto corrido
    .trim()
}

interface ChangelogEntry {
  id: string
  title: string
  description: string
  type: 'feature' | 'fix' | 'improvement' | 'breaking'
  status: 'draft' | 'published'
  version: string | null
  published_at: string
}

const STORAGE_KEY = 'flui_last_seen_changelog'

const TYPE_ICON = {
  feature: <img src={novidadeIcon} className="w-5 h-5" />,
  improvement: <img src={melhoriaIcon} className="w-5 h-5" />,
  fix: <img src={correcaoIcon} className="w-5 h-5" />,
  breaking: <img src={atencaoIcon} className="w-5 h-5" />,
}

const TYPE_LABEL = {
  feature: 'Novidade',
  improvement: 'Melhoria',
  fix: 'Correção',
  breaking: 'Atenção',
}

export default function ChangelogModal() {
  const { session } = useAuth()
  const [entry, setEntry] = useState<ChangelogEntry | null>(null)
  const [visible, setVisible] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  // Verifica se é admin tentando o endpoint de admin
  useEffect(() => {
    if (!session?.access_token) return
    apiFetch<unknown>('/api/admin/stats', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(() => setIsAdmin(true))
      .catch(() => {})
  }, [session])

  useEffect(() => {
    const handlePreview = (e: any) => {
      // Apenas admins podem forçar preview ou ver rascunhos
      if (!isAdmin) return

      const data = e.detail
      if (data) {
        setEntry(data)
        setVisible(true)
      } else {
        // Busca o mais recente (incluindo rascunhos já que é admin)
        supabase
          .from('changelogs')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            if (!data) return
            setEntry(data as ChangelogEntry)
            setVisible(true)
          })
      }
    }

    window.addEventListener('changelog-preview', handlePreview)
    return () => window.removeEventListener('changelog-preview', handlePreview)
  }, [])

  useEffect(() => {
    const base = supabase
      .from('changelogs')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(1)

    const query = isAdmin ? base : base.eq('status', 'published')

    query.maybeSingle().then(({ data }) => {
      if (!data) return
      const lastSeen = localStorage.getItem(STORAGE_KEY)
      if (lastSeen === data.id) return
      setEntry(data as ChangelogEntry)
      setTimeout(() => setVisible(true), 1800)
    })
  }, [isAdmin])

  const dismiss = () => {
    if (entry) localStorage.setItem(STORAGE_KEY, entry.id)
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && entry && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl overflow-hidden shadow-2xl shadow-black/15 border border-[#e9e9e7] bg-white"
        >
          {/* Banner topo — fundo igual hero da landing */}
          <div className="relative overflow-hidden bg-white">
            {/* Banner Area */}
            <div className="relative h-20 overflow-hidden">
              {/* Fundo de padrão no topo */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  maskImage: 'radial-gradient(ellipse 120% 100% at 50% 0%, black 60%, transparent 100%)',
                  WebkitMaskImage: 'radial-gradient(ellipse 120% 100% at 50% 0%, black 60%, transparent 100%)',
                }}
              >
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

              {/* Layout de Pílula Única */}
              <div className="absolute inset-0 flex items-center justify-center pt-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f7f7f5] border border-[#e9e9e7] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                  {/* Ícone */}
                  <div className="flex items-center justify-center w-5 h-5 scale-90">
                    {TYPE_ICON[entry.type]}
                  </div>

                  {/* Texto */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[#37352f]/45 tracking-tight uppercase">
                      {TYPE_LABEL[entry.type]}
                    </span>

                    {entry.version && (
                      <>
                        <div className="w-[1px] h-3 bg-[#e9e9e7]" />
                        <span className="text-[10px] font-mono font-bold text-[#37352f]/25 tracking-tighter">
                          {entry.version}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Content Area - Alinhado à esquerda */}
            <div className="px-5 pt-4 pb-6">
              <h3 className="text-sm font-semibold text-[#202020] tracking-tight leading-snug mb-1.5 text-start">
                {entry.title}
              </h3>
              <p className="text-xs text-[#37352f]/40 leading-relaxed text-start line-clamp-6 overflow-hidden">
                {stripMarkdown(entry.description)}
              </p>
            </div>

            {/* Footer */}
            <div className="border-t border-[#e9e9e7] px-4 py-2.5 flex items-center justify-between bg-[#fcfcfb]/50">
              <Link
                to="/changelog"
                onClick={dismiss}
                className="px-3 py-1.5 text-xs font-semibold text-[#37352f]/60 hover:text-[#202020] hover:bg-[#f7f7f5] rounded-lg transition-all border border-transparent hover:border-[#e9e9e7]"
              >
                Ver changelog
              </Link>

              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-xs font-semibold text-[#37352f]/60 hover:text-[#202020] hover:bg-[#f7f7f5] rounded-lg transition-all border border-transparent hover:border-[#e9e9e7]"
              >
                Fechar
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
