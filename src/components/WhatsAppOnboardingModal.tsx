import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiFetch } from '../lib/api'
import plantDoodle from '../assets/doodles/PlantDoodle.png'
import checkAnimationData from '../assets/check.json'
import CountrySelector from './CountrySelector'
import { countries } from '../constants/countries'
import type { Country } from '../constants/countries'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

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
  mandatory?: boolean
}

const WhatsAppOnboardingModal: React.FC<WhatsAppOnboardingModalProps> = ({ isOpen, onClose, mandatory = false }) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]) // Brasil (+55) default
  const [phone, setPhone] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus ao abrir
  useEffect(() => {
    if (isOpen && !linked) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, linked])

  // Sincroniza o phoneInput para o backend (apenas dígitos)
  const phoneDigits = phone.replace(/\D/g, '')
  const phoneInput = `${selectedCountry.code}${phoneDigits}`

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    let val = e.target.value.replace(/\D/g, '')

    // Tratamentos para leigos:
    // 1. Remove 0 inicial se o usuário digitar 011...
    if (val.startsWith('0')) val = val.slice(1)
    
    // 2. Remove 55 inicial se o usuário digitar o DDI por engano (considerando que BR tem 10-11 dígitos)
    if (selectedCountry.iso === 'BR' && val.startsWith('55') && val.length > 10) {
      val = val.slice(2)
    }

    const raw = val.slice(0, 11)
    let formatted = raw

    if (raw.length > 0) {
      if (raw.length <= 2) {
        formatted = `(${raw}`
      } else if (raw.length <= 6) {
        formatted = `(${raw.slice(0, 2)}) ${raw.slice(2)}`
      } else if (raw.length <= 10) {
        // Formato (XX) XXXX-XXXX (fixo)
        formatted = `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`
      } else {
        // Formato (XX) XXXXX-XXXX (celular)
        formatted = `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`
      }
    }
    
    setPhone(formatted)
  }

  // Lista de DDDs válidos no Brasil
  const VALID_DDDS = [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68,
    69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95,
    96, 97, 98, 99
  ]

  // Validação "Real" (Formato + DDD + Estrutura)
  useEffect(() => {
    const raw = phone.replace(/\D/g, '')
    if (raw.length >= 10) {
      const timer = setTimeout(() => {
        setIsValidating(true)
        setIsValid(null)
        
        const ddd = parseInt(raw.slice(0, 2))
        const isBR = selectedCountry.iso === 'BR'
        
        let validFormat = false
        if (isBR) {
          const hasValidDdd = VALID_DDDS.includes(ddd)
          const isMobile = raw.length === 11 && raw[2] === '9'
          const isFixed = raw.length === 10 && ['2', '3', '4', '5'].includes(raw[2])
          
          // Bloquear sequências repetidas (ex: 111111111, 222222222...)
          const isRepeated = /^(\d)\1+$/.test(raw)
          
          validFormat = hasValidDdd && (isMobile || isFixed) && !isRepeated
        } else {
          validFormat = raw.length >= 8
        }

        setTimeout(() => {
          setIsValid(validFormat)
          setIsValidating(false)
          if (!validFormat && raw.length >= 10) {
            const isBR = selectedCountry.iso === 'BR'
            let msg = 'Número inválido'
            if (isBR) {
              if (!VALID_DDDS.includes(ddd)) msg = 'DDD inválido'
              else if (raw.length === 11 && raw[2] !== '9') msg = 'Celular deve começar com 9'
              else msg = 'Formato de número inválido'
            }
            setError(msg)
          }
        }, 1000)
      }, 500)
      return () => clearTimeout(timer)
    } else {
      setIsValid(null)
      setIsValidating(false)
    }
  }, [phone, selectedCountry])

  const handleLink = async () => {
    if (!user || phoneDigits.length < 10) return
    setIsLinking(true)
    setError(null)
    try {
      await apiFetch('/api/whatsapp/link-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, phone: phoneInput })
      })
      setLinked(true)
      setTimeout(() => {
        onClose()
        navigate('/dashboard', { replace: true })
      }, 1800)
    } catch (err: any) {
      setError(err.message || 'Não conseguimos validar esse número')
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
            className="relative w-full max-w-sm bg-white rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] border border-[#e9e9e7]"
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
                    <h2 className="text-[17px] font-bold text-[#37352f] leading-tight">
                      Assistente WhatsApp
                    </h2>
                    <p className="text-[12px] text-[#37352f]/45 font-medium mt-1 leading-relaxed">
                      {mandatory
                        ? 'Como sua conta foi criada com o Google, vincule seu número para usar o Lui sem precisar de senha.'
                        : 'Vincule seu número para usar o assistente sem precisar de senha.'
                      }
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className={`w-full p-2 bg-[#f7f7f5] rounded-xl flex items-center gap-1 border transition-all overflow-hidden ${error ? 'border-red-100' : isValid === true ? 'border-green-100' : 'border-[#e9e9e7]'}`}>
                      <CountrySelector 
                        selectedCountry={selectedCountry} 
                        onSelect={setSelectedCountry} 
                      />
                      <div className="h-4 w-[1px] bg-[#e9e9e7] mx-1 flex-shrink-0" />
                      <div className="flex-1 flex items-center min-w-0">
                        <input
                          ref={inputRef}
                          type="tel"
                          placeholder="(11) 91234-5678"
                          value={phone}
                          onChange={handlePhoneChange}
                          onKeyDown={handleKeyDown}
                          className="w-full text-sm font-bold bg-transparent border-none focus:outline-none text-[#37352f] placeholder:text-[#37352f]/20 p-0"
                        />
                      </div>
                      
                      {/* Validação no lado direito - Garantido dentro do container */}
                      <div className="flex items-center px-1 animate-in fade-in zoom-in duration-200 flex-shrink-0">
                        {isValidating ? (
                          <Loader2 size={13} className="animate-spin text-[#37352f]/20" />
                        ) : isValid === true ? (
                          <CheckCircle2 size={13} className="text-green-500" />
                        ) : isValid === false ? (
                          <XCircle size={13} className="text-red-500" />
                        ) : null}
                      </div>
                    </div>
                    {error && (
                      <p className="px-1 text-[10px] text-red-500 font-medium -mt-2">
                        {error}
                      </p>
                    )}
                    <p className="px-1 text-[11px] text-[#37352f]/45 leading-relaxed">
                      O código <span className="font-bold text-[#37352f]/60">+{selectedCountry.code}</span> já está incluído. Digite seu DDD e o número sequencialmente.
                    </p>
                  </div>

                  <button
                    onClick={handleLink}
                    disabled={isLinking || phoneDigits.length < 10}
                    className="w-full py-3 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isLinking ? 'Vinculando...' : 'Vincular WhatsApp'}
                  </button>

                  {!mandatory && (
                    <button
                      onClick={onClose}
                      className="w-full py-2 text-[11px] font-medium text-[#37352f]/35 hover:text-[#37352f]/60 transition-colors"
                    >
                      Pular por agora
                    </button>
                  )}
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
