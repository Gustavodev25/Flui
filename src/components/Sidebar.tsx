import { LayoutDashboard, Folder, ChevronLeft, ExternalLink, Calendar, Flame, BarChart2, ArrowRight } from 'lucide-react'
import painelIcon from '../assets/icones/painel.svg'
import tarefasIcon from '../assets/icones/tarefas.svg'
import calendarioIcon from '../assets/icones/caledario.svg'
import criarIcon from '../assets/icones/criar.svg'
import breveIcon from '../assets/icones/breve.svg'
import { Link, useLocation } from 'react-router-dom'
import { useSidebar } from '../contexts/SidebarContext'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import logo from '../assets/logo/logo.svg'
import luiLogo from '../assets/logo/lui.svg'
import flowLogo from '../assets/logo/flow.svg'
import { useAuth } from '../contexts/AuthContext'
import Avvvatars from 'avvvatars-react'
import { WorkspaceModal } from './WorkspaceModal'
import { apiFetch } from '../lib/api'
import { useState, useEffect, useRef } from 'react'
import { useSubscription } from '../contexts/SubscriptionContext'

const WHATSAPP_NUMBER = '5511925870754'
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`
const QR_CODE_URL = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(WHATSAPP_LINK)}&bgcolor=f7f7f5&color=37352f&margin=2`

import { useMediaQuery } from '../hooks/useMediaQuery'

/* ── Tooltip Card ────────────────────────────────────────────────── */
const TooltipCard: React.FC<{ label: string; subLabel?: string; disabled?: boolean }> = ({ label, subLabel, disabled }) => (
  <motion.div
    initial={{ opacity: 0, x: -10, y: '-50%', scale: 0.98 }}
    animate={{ opacity: 1, x: 0, y: '-50%', scale: 1 }}
    exit={{ opacity: 0, x: -10, y: '-50%', scale: 0.98 }}
    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
    className="absolute left-full top-1/2 ml-5 z-[100] px-3 py-1.5 bg-white border border-[#e9e9e7] rounded-xl shadow-[0_8px_20px_rgba(0,0,0,0.06)] pointer-events-none whitespace-nowrap"
  >
    <div className="flex flex-col items-start text-left">
       <div className="flex items-center gap-2">
         <span className="text-[12px] font-bold text-[#37352f] tracking-tight">{label}</span>
         {disabled && (
           <span className="text-[8px] font-medium text-[#37352f]/35 tracking-wide">em breve</span>
         )}
       </div>
       {subLabel && !disabled && (
         <span className="text-[9px] font-bold text-[#37352f]/40 mt-0.5">{subLabel}</span>
       )}
    </div>
  </motion.div>
)

/* ── Componente de borda colapsável ─────────────────────────────── */
interface CollapseEdgeProps {
  isCollapsed: boolean
  onToggle: () => void
}

// Fases do pill:
// 'idle'      → colado na borda (sidebar ainda animando ou expandido)
// 'attention' → saltou para fora, piscando (sidebar já fechou)
// 'settled'   → voltou discreto perto da borda
type PillPhase = 'idle' | 'attention' | 'settled'

const CollapseEdge: React.FC<CollapseEdgeProps> = ({ isCollapsed, onToggle }) => {
  const [phase, setPhase] = useState<PillPhase>('idle')
  const [isHovered, setIsHovered] = useState(false)
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (t1.current) clearTimeout(t1.current)
    if (t2.current) clearTimeout(t2.current)

    if (isCollapsed) {
      // Espera o sidebar terminar de fechar (spring ~450ms) antes de pular
      setPhase('idle')
      t1.current = setTimeout(() => {
        setPhase('attention')
        // Após 6s de atenção, assenta
        t2.current = setTimeout(() => setPhase('settled'), 6000)
      }, 450)
    } else {
      setPhase('idle')
    }

    return () => {
      if (t1.current) clearTimeout(t1.current)
      if (t2.current) clearTimeout(t2.current)
    }
  }, [isCollapsed])

  const rightPos =
    phase === 'attention' ? -16 :
    phase === 'settled'   ? -10 :
    -5 // idle: colado na borda

  const isAttention = phase === 'attention'

  return (
    <motion.div
      onClick={onToggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="absolute top-1/2 -translate-y-1/2 z-[60] cursor-pointer hidden lg:flex items-center justify-center group/collapse w-4 h-8"
      animate={{ right: rightPos }}
      transition={{ right: { type: 'spring', stiffness: 400, damping: 32 } }}
      whileTap={{ scale: 0.9 }}
    >
      <motion.div
        className="rounded-full bg-[#d1d1ce]"
        style={{ width: 5, height: 32, transformOrigin: 'center' }}
        animate={{
          backgroundColor: isAttention
            ? ['#d1d1ce', '#8a8a85', '#d1d1ce']
            : (phase === 'settled' ? '#c8c8c5' : '#d1d1ce'),
          scaleY: isAttention ? [1, 1.7, 0.85, 1.05, 1] : 1,
          scaleX: isAttention ? [1, 0.4, 1.3, 0.95, 1] : 1,
        }}
        whileHover={{
          backgroundColor: '#8a8a85',
          scaleY: 1.1,
          scaleX: 1.3,
        }}
        transition={
          isAttention
            ? {
                duration: 1.4,
                times: [0, 0.35, 0.5, 0.7, 1],
                repeat: 3,
                ease: [0.32, 0.72, 0, 1], // iOS Dynamic Island style curve
                repeatDelay: 0.4
              }
            : { 
                type: 'spring', 
                stiffness: 500, 
                damping: 30,
              }
        }
      />
      
      <AnimatePresence>
        {isHovered && (
          <TooltipCard label={isCollapsed ? 'Expandir' : 'Recolher'} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}



export const Sidebar: React.FC = () => {
  const { user } = useAuth()
  const { isCollapsed, toggleCollapse, isMobileOpen, closeMobileMenu } = useSidebar()
  const { hasFlow, hasPulse, isWorkspaceMember, workspaceModeActive, workspaceMembership: ctxMembership, loading: subLoading } = useSubscription()
  const navigate = useNavigate()
  const location = useLocation()
  const [dataLoaded, setDataLoaded] = useState(false)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [ownerWorkspaceName, setOwnerWorkspaceName] = useState<string | null>(null)
  // membership enriquecida com workspaceName (não está no contexto)
  const [workspaceMembership, setWorkspaceMembership] = useState<{ ownerName: string; ownerEmail: string; planId: string; workspaceName?: string } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isMobile = !isDesktop

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      const [membershipResult, wsNameResult] = await Promise.allSettled([
        apiFetch<{ membership: { ownerName: string; ownerEmail: string; planId: string; workspaceName?: string } | null }>(
          '/api/workspace/my-membership',
          undefined,
          { userId: user.id }
        ),
        apiFetch<{ name: string | null }>('/api/workspace/name', undefined, { userId: user.id })
      ])

      if (membershipResult.status === 'fulfilled') setWorkspaceMembership(membershipResult.value.membership)
      if (wsNameResult.status === 'fulfilled') setOwnerWorkspaceName(wsNameResult.value.name || null)
      setDataLoaded(true)
    }
    fetchData()
  }, [user])

  // dataLoaded sincronizado com o contexto também
  const isReady = dataLoaded && !subLoading

  // Fecha o menu mobile quando muda de rota
  useEffect(() => {
    closeMobileMenu()
  }, [location.pathname, closeMobileMenu])

  const navItems = [
    { icon: LayoutDashboard, iconSvg: painelIcon, label: 'Painel', path: '/dashboard' },
    { icon: Folder, iconSvg: tarefasIcon, label: 'Tarefas', path: '/tasks' },
    { icon: Calendar, iconSvg: calendarioIcon, label: 'Calendário', path: '/calendar' },
    { icon: Flame, iconSvg: breveIcon, label: 'Hábitos', path: '#', disabled: true },
    { icon: BarChart2, iconSvg: breveIcon, label: 'Relatórios', path: '#', disabled: true },
  ]

  return (
    <motion.aside
      initial={false}
      animate={{
        width: isMobile ? 240 : (isCollapsed ? 70 : 240),
        x: isMobile ? (isMobileOpen ? 0 : -280) : 0
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`bg-[#f7f7f5] h-screen flex flex-col p-3 fixed left-0 top-0 z-50 group border-r border-[#e9e9e7] lg:border-none shadow-2xl lg:shadow-none ${isMobile ? 'flex' : 'hidden lg:flex'}`}
    >
      {/* Linha de Toggle (Desktop) */}
      <CollapseEdge isCollapsed={isCollapsed} onToggle={toggleCollapse} />

      {/* Botão de Fechar (Mobile) */}
      <button
        onClick={closeMobileMenu}
        className="lg:hidden absolute right-4 top-5 p-1.5 hover:bg-[#e9e9e7] rounded-md transition-colors"
      >
        <ChevronLeft size={18} className="text-[#37352f]/60" />
      </button>

      {/* Logo */}
      <div className={`flex items-center gap-3 px-2 py-3 mb-6 ${isCollapsed && !isMobile ? 'justify-center' : ''}`}>
        <motion.div 
          key={isCollapsed ? 'collapsed' : 'expanded'}
          initial={false}
          animate={{ 
            scale: [1, 1.12, 1],
            rotate: [0, isCollapsed ? 15 : -15, 0]
          }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-9 h-9 flex-shrink-0 flex items-center justify-center"
        >
          <img src={logo} alt="Logo" className="w-full h-full object-contain" />
        </motion.div>

        <AnimatePresence mode="wait">
          {(!isCollapsed || isMobile) && (
            <motion.div
              key="flui-text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="flex items-center overflow-hidden whitespace-nowrap"
            >
              {"flui.".split("").map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.25,
                    delay: i * 0.08,
                    ease: "easeOut"
                  }}
                  className="font-bold text-sm tracking-tight text-[#37352f]"
                >
                  {char}
                </motion.span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item, index) => {
          const isActive = location.pathname === item.path

          const Content = (
            <>
              {item.iconSvg
                ? <img src={item.iconSvg} alt="" className={`w-[18px] h-[18px] flex-shrink-0 ${item.disabled ? 'opacity-20' : isActive ? 'opacity-100' : 'opacity-60'}`} />
                : <item.icon size={18} className="flex-shrink-0" />
              }
              <AnimatePresence>
                {(!isCollapsed || isMobile) && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap flex-1 flex items-center justify-between"
                  >
                    <motion.span layoutId={item.path === '/calendar' ? "calendar-title" : undefined}>{item.label}</motion.span>
                    {item.disabled && (
                      <span className="ml-2 text-[9px] font-medium text-[#37352f]/30 tracking-wide">
                        em breve
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )

          const baseClasses = `w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium rounded-md transition-colors ${isCollapsed && !isMobile ? 'justify-center' : ''}`

          if (item.disabled) {
            return (
              <div
                key={index}
                onMouseEnter={() => isCollapsed && !isMobile && setHoveredId(`nav-${index}`)}
                onMouseLeave={() => setHoveredId(null)}
                className={`${baseClasses} relative text-[#37352f]/20 cursor-not-allowed`}
              >
                {Content}
                <AnimatePresence>
                  {isCollapsed && !isMobile && hoveredId === `nav-${index}` && (
                    <TooltipCard label={item.label} disabled={true} />
                  )}
                </AnimatePresence>
              </div>
            )
          }

          return (
            <Link
              key={index}
              to={item.path}
              onMouseEnter={() => isCollapsed && !isMobile && setHoveredId(`nav-${index}`)}
              onMouseLeave={() => setHoveredId(null)}
              className={`${baseClasses} relative ${isActive
                  ? 'bg-[#e9e9e7] text-[#37352f]'
                  : 'text-[#37352f]/70 hover:bg-[#e9e9e7]'
                }`}
            >
              {Content}
              <AnimatePresence>
                {isCollapsed && !isMobile && hoveredId === `nav-${index}` && (
                  <TooltipCard label={item.label} disabled={item.disabled} />
                )}
              </AnimatePresence>
            </Link>
          )
        })}

        <AnimatePresence>
          {(!isCollapsed || isMobile) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-2 pt-2 text-[10px] text-[#37352f]/30 font-medium"
            >
              E muito mais futuramente...
            </motion.p>
          )}
        </AnimatePresence>
      </nav>

      {/* Card inferior */}
      <div className="mt-auto mb-1 flex flex-col gap-2">
        <AnimatePresence mode="wait">
          {location.pathname !== '/dashboard' && isReady && (
            hasFlow ? (
              /* ── Usuário Flow: card do Lui ── */
              (isCollapsed && !isMobile) ? (
                <motion.button
                  key="lui-collapsed"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                  onMouseEnter={() => isCollapsed && !isMobile && setHoveredId('lui')}
                  onMouseLeave={() => setHoveredId(null)}
                  className="w-full flex justify-center cursor-pointer relative"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm hover:shadow-md transition-shadow">
                    <motion.img
                      src={luiLogo}
                      alt="Lui"
                      className="w-6 h-6 object-contain"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                    />
                  </div>
                  <AnimatePresence>
                    {isCollapsed && !isMobile && hoveredId === 'lui' && (
                      <TooltipCard label="Lui Assistant" subLabel="WhatsApp IA" />
                    )}
                  </AnimatePresence>
                </motion.button>
              ) : (
                <motion.div
                  key="lui-expanded"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-xl border border-[#e9e9e7] bg-white overflow-hidden shadow-sm"
                >
                  <button
                    onClick={() => window.open(WHATSAPP_LINK, '_blank')}
                    className="w-full p-3 flex items-center gap-3 hover:bg-[#f7f7f5] transition-colors cursor-pointer text-left"
                  >
                    <div className="bg-[#f7f7f5] rounded-lg p-1.5 border border-[#e9e9e7] flex-shrink-0">
                      <img
                        src={QR_CODE_URL}
                        alt="QR Code WhatsApp"
                        className="w-[52px] h-[52px] rounded"
                        loading="lazy"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <motion.img
                          src={luiLogo}
                          alt="Lui"
                          className="w-3.5 h-3.5 object-contain"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                        />
                        <p className="text-[11px] font-semibold text-[#37352f]">Lui</p>
                      </div>
                      <p className="text-[9.5px] text-[#37352f]/50 leading-snug">Escaneie para abrir no WhatsApp</p>
                      <p className="text-[9.5px] font-medium text-[#25d366] mt-1 flex items-center gap-0.5">
                        Abrir <ExternalLink size={9} />
                      </p>
                    </div>
                  </button>
                </motion.div>
              )
            ) : (
              /* ── Usuário Gratuito: card de upgrade ── */
              (isCollapsed && !isMobile) ? (
                <motion.button
                  key="upgrade-collapsed"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => navigate('/checkout-preview')}
                  onMouseEnter={() => isCollapsed && !isMobile && setHoveredId('upgrade')}
                  onMouseLeave={() => setHoveredId(null)}
                  className="w-full flex justify-center cursor-pointer px-1 relative"
                  title="Ativar Flow"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm hover:shadow-md transition-all">
                    <img src={flowLogo} alt="Flow" className="w-6 h-6 object-contain" />
                  </div>
                  <AnimatePresence>
                    {isCollapsed && !isMobile && hoveredId === 'upgrade' && (
                      <TooltipCard label="Plano Flow" subLabel="Upgrade" />
                    )}
                  </AnimatePresence>
                </motion.button>
              ) : (
                <motion.div
                  key="upgrade-expanded"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.25 }}
                  className="mx-1 rounded-2xl border border-[#e9e9e7] bg-white overflow-hidden shadow-sm flex flex-col group transition-all duration-300"
                >
                  <div className="p-3">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-8 h-8 rounded-lg bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm flex-shrink-0">
                        <img src={flowLogo} alt="Flow" className="w-5 h-5 object-contain" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-[#37352f] leading-tight">Plano Flow</p>
                        <p className="text-[9px] text-[#37352f]/40 font-bold uppercase tracking-wider mt-0.5">R$ 9,90/mês</p>
                      </div>
                    </div>

                    <p className="text-[10px] text-[#37352f]/45 font-semibold leading-[1.4] mb-4">
                      IA no WhatsApp, tarefas ilimitadas e sincronização total para seu dia.
                    </p>

                    <button
                      onClick={() => navigate('/checkout-preview')}
                      className="w-full h-9 bg-[#1a1a1a] text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-black transition-all active:scale-[0.98] shadow-sm"
                    >
                      Assinar Agora
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </motion.div>
              )
            )
          )}
        </AnimatePresence>

        {/* Divisor full-width */}
        <div className="-mx-3 h-px bg-[#e9e9e7]" />

        {/* Card de Membro Convidado do Workspace */}
        {workspaceModeActive && (workspaceMembership || ctxMembership) && (() => {
          const membership = workspaceMembership || ctxMembership!
          const planLabel = membership.planId === 'pulse' ? 'Pulse' : 'Flow'
          const ownerName = membership.ownerName
          const displayName = (workspaceMembership?.workspaceName) || ownerName
          const avatarValue = membership.ownerEmail || ownerName

          return (
            <AnimatePresence mode="wait">
              {(isCollapsed && !isMobile) ? (
                <motion.div 
                  key="wsm-collapsed" 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }} 
                  onMouseEnter={() => isCollapsed && !isMobile && setHoveredId('wsm')}
                  onMouseLeave={() => setHoveredId(null)}
                  className="flex justify-center py-1 relative"
                >
                  <div className="cursor-pointer">
                    <Avvvatars value={avatarValue} style="shape" size={32} radius={8} />
                  </div>
                  <AnimatePresence>
                    {isCollapsed && !isMobile && hoveredId === 'wsm' && (
                      <TooltipCard label={displayName} subLabel={`Workspace · ${planLabel}`} />
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div key="wsm-expanded" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 px-1 py-1.5 rounded-lg">
                  <Avvvatars value={avatarValue} style="shape" size={28} radius={7} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] text-[#37352f]/35 font-medium uppercase tracking-wider leading-tight">
                      Workspace · {planLabel}
                    </p>
                    <p className="text-[11px] font-semibold text-[#37352f] truncate leading-tight">{displayName}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )
        })()}

        {/* Workspace Card - Only for Pulse owners */}
        {hasPulse && !isWorkspaceMember && (() => {
          const defaultName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário'
          const wsName = ownerWorkspaceName || defaultName
          const avatarValue = user?.email || defaultName

          return (
            <AnimatePresence mode="wait">
              {(isCollapsed && !isMobile) ? (
                <motion.div 
                  key="ws-collapsed" 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }} 
                  onMouseEnter={() => isCollapsed && !isMobile && setHoveredId('ws-owner')}
                  onMouseLeave={() => setHoveredId(null)}
                  className="flex justify-center py-1 relative" 
                  onClick={() => setIsWorkspaceOpen(true)}
                >
                  <div className="cursor-pointer hover:opacity-80 transition-opacity">
                    <Avvvatars value={avatarValue} style="shape" size={32} radius={8} />
                  </div>
                  <AnimatePresence>
                    {isCollapsed && !isMobile && hoveredId === 'ws-owner' && (
                      <TooltipCard label={wsName} subLabel="Seu Workspace" />
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div key="ws-expanded" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsWorkspaceOpen(true)} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-[#e9e9e7]/60 cursor-pointer transition-colors">
                  <Avvvatars value={avatarValue} style="shape" size={28} radius={7} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] text-[#37352f]/35 font-medium uppercase tracking-wider leading-tight">
                      Workspace
                    </p>
                    <p className="text-[11px] font-semibold text-[#37352f] truncate leading-tight">{wsName}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )
        })()}
      </div>

      <WorkspaceModal
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
        onWorkspaceNameChange={name => setOwnerWorkspaceName(name)}
      />
    </motion.aside>
  )
}
