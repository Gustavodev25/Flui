import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import lovingDoodle from '../assets/doodles/LovingDoodle.png'

interface ThankYouModalProps {
  isOpen: boolean
  onClose: () => void
  onGoToDashboard?: () => void
}

const ThankYouModal: React.FC<ThankYouModalProps> = ({ isOpen, onClose, onGoToDashboard }) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = user?.user_metadata?.full_name?.split(' ')[0]
    || user?.user_metadata?.name?.split(' ')[0]
    || null

  const providers = user?.app_metadata?.providers || []
  const isGoogleUser = providers.includes('google') && !providers.includes('email')

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose, isGoogleUser])

  const handleDismiss = () => {
    onClose()
    console.log('[ThankYouModal] Dismissing, isGoogleUser:', isGoogleUser)
    if (isGoogleUser && onGoToDashboard) {
      console.log('[ThankYouModal] Triggering mandatory WhatsApp flow')
      onGoToDashboard()
    }
  }

  const handleGoToDashboard = () => {
    onClose()
    if (isGoogleUser && onGoToDashboard) {
      onGoToDashboard()
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/30 backdrop-blur-[12px]"
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-[#e9e9e7] overflow-hidden"
          >
            {/* Fechar */}
            <button
              onClick={handleDismiss}
              className="absolute top-3.5 right-3.5 z-10 p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/25 hover:text-[#37352f]"
            >
              <X size={16} />
            </button>

            {/* Doodle */}
            <div className="flex justify-center pt-8 pb-6 bg-[#fafafa]">
              <img
                src={lovingDoodle}
                alt=""
                className="w-36 h-36 object-contain select-none"
                draggable={false}
              />
            </div>

            {/* Divisor */}
            <div className="h-px bg-[#f1f1f0]" />

            {/* Texto */}
            <div className="px-7 pt-6 pb-7 flex flex-col items-start gap-3">
              <h2 className="text-[22px] font-black text-[#37352f] tracking-tight leading-tight">
                {firstName ? `Que bom ter você aqui, ${firstName}!` : 'Que bom ter você aqui!'}
              </h2>
              <p className="text-[13px] text-[#37352f]/50 font-medium leading-relaxed">
                Seu plano <span className="font-semibold text-[#37352f]/70">Flow</span> está ativo.
                Agora é hora de organizar, focar e conquistar um dia de cada vez.
              </p>

              <button
                onClick={handleGoToDashboard}
                className="mt-2 w-full py-3 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all active:scale-[0.98]"
              >
                Começar agora
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default ThankYouModal
