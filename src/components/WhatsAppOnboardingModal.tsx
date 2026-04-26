import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'
import plantDoodle from '../assets/doodles/PlantDoodle.png'
import checkAnimationData from '../assets/check.json'

const LottieCheck: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let anim: any = null
    let isMounted = true
    import('lottie-web').then((lottie) => {
      if (!isMounted || !containerRef.current) return
      const lottieLib = lottie.default || lottie
      containerRef.current.innerHTML = ''
      anim = lottieLib.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: checkAnimationData,
      })
    })
    return () => { isMounted = false; anim?.destroy() }
  }, [])

  return <div ref={containerRef} className="w-12 h-12" />
}

interface WhatsAppOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
}

const WhatsAppOnboardingModal: React.FC<WhatsAppOnboardingModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [phoneInput, setPhoneInput] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const [linked, setLinked] = useState(false)

  const handleLink = async () => {
    if (!user || phoneInput.replace(/\D/g, '').length < 10) return
    setIsLinking(true)
    try {
      await apiFetch<{ ok: boolean; phone: string }>('/api/whatsapp/link-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, phone: phoneInput.trim() }),
      })
      setLinked(true)
      setTimeout(() => {
        onClose()
        navigate('/dashboard', { replace: true })
      }, 1800)
    } catch (err: any) {
      alert('Erro ao vincular número: ' + (err.message || 'Tente novamente'))
    } finally {
      setIsLinking(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLink()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-[14px]"
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm bg-white rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#e9e9e7] overflow-hidden"
          >
            <div className="px-7 pt-7 pb-7 flex flex-col gap-4">
              {linked ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-2 py-4"
                >
                  <LottieCheck />
                  <div className="text-center">
                    <p className="text-[13px] font-bold text-[#37352f]">Número vinculado!</p>
                    <p className="text-[11px] text-[#37352f]/40 mt-0.5">Você receberá uma mensagem de confirmação no WhatsApp.</p>
                  </div>
                </motion.div>
              ) : (
                <>
                  <img
                    src={plantDoodle}
                    alt=""
                    className="w-28 h-28 object-contain select-none"
                    draggable={false}
                  />

                  <div>
                    <h2 className="text-[18px] font-black text-[#37352f] tracking-tight leading-tight">
                      Assistente WhatsApp
                    </h2>
                    <p className="text-[12px] text-[#37352f]/45 font-medium mt-1 leading-relaxed">
                      Vincule seu número para usar o assistente sem precisar de senha.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold text-[#37352f]/50 px-0.5">
                      Número do WhatsApp
                    </label>
                    <input
                      type="tel"
                      placeholder="Ex: 5511999998888 (com DDD e código do país)"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="w-full px-4 py-3.5 bg-[#fcfcfa] border border-[#e9e9e7] rounded-xl text-sm font-medium text-[#37352f] placeholder:text-[#37352f]/30 placeholder:font-normal focus:outline-none focus:border-[#37352f]/30 focus:ring-1 focus:ring-black/5 transition-all"
                    />
                  </div>

                  <button
                    onClick={handleLink}
                    disabled={isLinking || phoneInput.replace(/\D/g, '').length < 10}
                    className="w-full py-3 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isLinking ? 'Vinculando...' : 'Vincular WhatsApp'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default WhatsAppOnboardingModal
