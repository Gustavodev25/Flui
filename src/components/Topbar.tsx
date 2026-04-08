import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import Avvvatars from 'avvvatars-react'
import { Menu, User, CreditCard, LifeBuoy, LogOut, Star, ChevronRight } from 'lucide-react'
import { Dropdown, DropdownItem, DropdownDivider } from './ui/Dropdown'
import { SettingsModal } from './SettingsModal'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useLocation, Link } from 'react-router-dom'
import { useSidebar } from '../contexts/SidebarContext'
import { motion } from 'framer-motion'
import { FeedbackWidget } from './FeedbackWidget'

export const Topbar: React.FC = () => {
  const { user, signOut } = useAuth()
  const { toggleMobileMenu } = useSidebar()
  const location = useLocation()
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'profile' | 'subscription'>('profile')
  const profileRef = useRef<HTMLDivElement>(null)
  const { hasFlow, planId, isWorkspaceMember, workspaceMembership } = useSubscription()
  const [avatarError, setAvatarError] = useState(false)

  useEffect(() => {
    setAvatarError(false)
  }, [user?.user_metadata?.avatar_url])
  
  const routeLabels: { [key: string]: string } = {
    '/dashboard': 'Painel',
    '/tasks': 'Tarefas',
    '/calendar': 'Calendário',
    '/whatsapp': 'WhatsApp',
    '/subscription': 'Assinatura',
    '/checkout-preview': 'Checkout'
  }

  const isCalendarPage = location.pathname === '/calendar'
  const currentLabel = routeLabels[location.pathname] || 'Painel'
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Gestor'
  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Gestor'
  
  return (
    <header className="h-[56px] flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40 bg-[#f7f7f5]">
      {/* Esquerda: Breadcrumbs ou Título */}
      <div className="flex items-center gap-3 flex-1 lg:flex-none">
        <button 
          onClick={toggleMobileMenu}
          className="lg:hidden p-1.5 hover:bg-[#e9e9e7] rounded-md transition-colors -ml-1 sm:mr-1 shrink-0"
        >
          <Menu size={18} className="text-[#37352f]/60" />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium text-[#37352f]/40">
           {!isCalendarPage && (
             <>
               <Link to="/dashboard" className="hover:text-[#37352f]/60 cursor-pointer flex items-center transition-colors">
                 <span>Início</span>
               </Link>
               <ChevronRight size={12} className="opacity-30 mt-0.5 flex-shrink-0" />
             </>
           )}
            <span className="text-[#37352f] font-semibold truncate max-w-[100px] sm:max-w-none">
              {currentLabel}
            </span>
        </div>
      </div>

      {/* Badge de Validação - Versão Desktop (Hanging) */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute inset-x-0 top-[56px] hidden xl:flex justify-center pointer-events-none z-[35]"
      >
        <div className="flex items-center gap-4 px-6 py-2 bg-[#f7f7f5] border border-[#e9e9e7] border-t-0 rounded-b-2xl shadow-xl shadow-black/[0.03] max-w-[70%]">
          <motion.div
            animate={{
              rotate: [0, 15, -15, 0],
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: 4,
              ease: "easeInOut",
              repeat: Infinity
            }}
            className="shrink-0"
          >
            <Star
              size={10}
              className="text-amber-400 fill-amber-400"
              strokeWidth={2.5}
            />
          </motion.div>
          <span className="text-[11px] text-[#37352f]/60 font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
            Sistema na versão inicial de validação • Futuramente se transformará em um produto gigante
          </span>
        </div>
      </motion.div>

      {/* Direita: Ações e Perfil */}
      <div className="flex items-center gap-2 sm:gap-3 flex-1 lg:flex-none justify-end">
        {/* Desktop: mostra no calendário apenas */}
        {isCalendarPage && <div className="hidden lg:block"><FeedbackWidget variant="topbar" /></div>}
        {/* Mobile: mostra em todas as páginas */}
        <div className="lg:hidden"><FeedbackWidget variant="topbar" /></div>
        <div className="relative" ref={profileRef}>
          <div 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-3 cursor-pointer group py-1.5 px-3 rounded-full hover:bg-[#f1f1f0] transition-all duration-200 active:scale-95 select-none"
          >
            <div className="flex flex-col items-end hidden xs:flex">
                <span className="text-[13px] font-bold leading-tight text-[#37352f] truncate max-w-[80px] sm:max-w-[120px]">
                  {firstName}
                </span>
                <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#37352f]/40 font-bold tracking-wider group-hover:text-[#37352f] transition-colors leading-none">
                  {isWorkspaceMember
                    ? `Workspace · ${planId === 'pulse' ? 'Pulse' : 'Flow'}`
                    : hasFlow
                      ? (planId === 'pulse' ? 'Pulse' : 'Flow')
                      : 'Gratuito'}
                  </span>
                </div>
            </div>
            <div className="w-9 h-9 rounded-full border-2 border-white shadow-md overflow-hidden flex-shrink-0 relative transition-transform duration-300 group-hover:scale-105">
               {user?.user_metadata?.avatar_url && !avatarError ? (
                 <img
                    src={user.user_metadata.avatar_url}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    onError={() => setAvatarError(true)}
                 />
               ) : (
                 <div className="w-full h-full flex items-center justify-center">
                   <Avvvatars value={user?.email || 'guest'} size={36} style="character" />
                 </div>
               )}
            </div>
          </div>

          <Dropdown 
            isOpen={isDropdownOpen} 
            onClose={() => setIsDropdownOpen(false)} 
            anchor={profileRef}
            className="mt-2"
          >
            <div className="px-3 py-2.5 mb-1 flex flex-col gap-0.5">
              <span className="text-[10px] font-bold text-[#37352f]/30 tracking-widest px-0.5">
                {isWorkspaceMember
                  ? `Workspace de ${workspaceMembership?.ownerName}`
                  : hasFlow
                    ? 'Assinatura Ativa'
                    : 'Conta Gratuita'}
              </span>
              <div className="flex flex-col mt-0.5 px-0.5">
                <span className="text-sm font-bold text-[#37352f] leading-none">{fullName}</span>
                <span className="text-[11px] text-[#37352f]/50 truncate mt-0.5">{user?.email}</span>
              </div>
            </div>
            
            <DropdownDivider />
            
            <DropdownItem 
              icon={<User size={14} />}
              label="Meu Perfil" 
              onClick={() => { setIsDropdownOpen(false); setSettingsTab('profile'); setIsSettingsModalOpen(true) }} 
            />
            <DropdownItem 
              icon={<CreditCard size={14} />}
              label="Assinatura" 
              onClick={() => { setIsDropdownOpen(false); setSettingsTab('subscription'); setIsSettingsModalOpen(true) }} 
            />
            <DropdownItem 
              icon={<LifeBuoy size={14} />}
              label="Suporte" 
              onClick={() => { setIsDropdownOpen(false); window.open('https://wa.me/5511925870754?text=Olá,%20tenho%20uma%20dúvida.', '_blank') }} 
            />
            
            <DropdownDivider />
            
            <DropdownItem 
              icon={<LogOut size={14} />}
              label="Sair da conta" 
              variant="danger" 
              onClick={() => {
                setIsDropdownOpen(false)
                signOut()
              }} 
            />
          </Dropdown>
        </div>
      </div>

      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsTab}
      />
    </header>
  )
}
