import React, { useState, useEffect, useRef } from 'react'
import luiLogo from '../assets/logo/lui.svg'
import { useAuth } from '../contexts/AuthContext'
import { motion, AnimatePresence, useAnimation } from 'framer-motion'
import { Dropdown, DropdownItem } from './ui/Dropdown'
import { EyeOff, MoreVertical } from 'lucide-react'

// Tempo visível (ms) | Tempo escondido (ms)
const HIDDEN_DURATION = 45000  // 45s some
const INITIAL_DELAY = 20000  // 20s antes da primeira aparição
const MSG_INTERVAL = 3500   // 3.5s por mensagem

export const FinlozBottomLogo: React.FC = () => {
  const { user } = useAuth()
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem('finloz_bottom_logo_dismissed') === 'true'
  })
  const [visible, setVisible] = useState(false)
  const [showBalloon, setShowBalloon] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const controls = useAnimation()
  const tagRef = useRef<HTMLButtonElement>(null)

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || 'amigo'

  const MESSAGES = [
    `Olá, ${firstName}! Como estão suas tarefas hoje?`,
    `Lembre-se: eu posso criar lembretes direto pelo WhatsApp!`,
    `Tente dizer: 'Lembre-me de pagar a conta às 15h, ${firstName}'`,
    `Ou apenas: 'Quais são meus pendentes para hoje?'`,
    `Estou aqui para automatizar sua rotina, ${firstName}! 🚀`
  ]

  useEffect(() => {
    if (isDismissed) return

    let cancelled = false

    const delay = (ms: number) => new Promise<void>(res => {
      const t = setTimeout(res, ms)
      return () => clearTimeout(t)
    })

    const run = async () => {
      await delay(INITIAL_DELAY)

      while (!cancelled) {
        // --- APARECER ---
        setMessageIndex(0)
        setVisible(true)

        // pequena pausa antes de mostrar o balão (deixa o logo subir primeiro)
        await delay(600)
        if (cancelled) break
        setShowBalloon(true)

        // ciclar as mensagens enquanto visível
        for (let i = 0; i < MESSAGES.length; i++) {
          if (cancelled) break
          setMessageIndex(i)
          await delay(MSG_INTERVAL)
        }

        // --- SUMIR ---
        setShowBalloon(false)
        await delay(400) // aguarda balão sair antes de descer o logo
        if (cancelled) break
        setVisible(false)

        await delay(HIDDEN_DURATION)
      }
    }

    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleIconClick = async () => {
    if (!showBalloon) {
      setShowBalloon(true)
      setMessageIndex(0)
    }

    await controls.start({
      x: [0, -3, 3, -2, 2, -1, 1, 0],
      rotate: [0, -1.5, 1.5, -1.5, 1.5, 0],
      transition: { duration: 0.4, ease: 'linear' }
    })
  }

  const currentMessage = MESSAGES[messageIndex]

  if (isDismissed) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="finloz-pill"
          className="fixed bottom-5 left-0 right-0 flex justify-center z-30 pointer-events-none"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 180, damping: 22 }}
        >
          <motion.div
            layout
            transition={{ layout: { type: 'spring', stiffness: 280, damping: 28 } }}
            className="flex items-center gap-3 bg-white border border-[#e9e9e7] rounded-2xl px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.07)] cursor-pointer hover:shadow-[0_10px_28px_rgba(0,0,0,0.1)] active:scale-[0.98] pointer-events-auto relative group"
            onClick={handleIconClick}
            style={{ borderRadius: 16 }}
          >
            {/* Container da Tag e Dropdown no Canto */}
            <div className="absolute -top-2 -right-1 z-50 pointer-events-auto">
              <button
                ref={tagRef}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDropdown(!showDropdown)
                }}
                className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-full px-2 py-0.5 flex items-center gap-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-white active:scale-90"
              >
                <span className="text-[9px] font-bold text-[#37352f]/50 uppercase tracking-tighter">Opções</span>
              </button>

              <Dropdown
                isOpen={showDropdown}
                onClose={() => setShowDropdown(false)}
                className="!w-[230px] !top-auto !bottom-full !mb-2 !right-0 !left-auto"
              >
                <div className="px-3 py-2 text-[11px] text-[#37352f]/60 font-medium leading-relaxed bg-[#f7f7f5]/50 border-b border-[#f1f1f0]">
                  Gostaria de não receber mais estes lembretes do Lui?
                </div>
                <div className="p-1">
                  <DropdownItem
                    icon={<EyeOff size={14} />}
                    label="Ocultar para sempre"
                    variant="danger"
                    onClick={() => {
                      localStorage.setItem('finloz_bottom_logo_dismissed', 'true')
                      setIsDismissed(true)
                      setShowDropdown(false)
                    }}
                  />
                </div>
              </Dropdown>
            </div>
            {/* Badge da logo */}
            <motion.div layout className="w-8 h-8 rounded-xl bg-[#f7f7f5] border border-[#e9e9e7] flex items-center justify-center shrink-0">
              <motion.img
                animate={controls}
                src={luiLogo}
                alt="Lui"
                className="w-5 h-5 object-contain"
              />
            </motion.div>

            {/* Texto rotativo com animação char-by-char + shimmer */}
            <motion.div layout className="overflow-hidden whitespace-nowrap">
              <AnimatePresence mode="wait">
                <motion.span
                  key={messageIndex}
                  className="relative inline-flex overflow-hidden"
                  style={{ display: 'inline-flex' }}
                >
                  {/* Camada base */}
                  <span className="text-[#37352f]/70 flex text-[12px] font-medium leading-snug">
                    {currentMessage.split('').map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.018, ease: [0.2, 0.65, 0.3, 0.9] }}
                        className="inline-block"
                        style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </span>

                  {/* Camada de brilho */}
                  <motion.span
                    className="absolute inset-0 flex text-white pointer-events-none select-none"
                    style={{
                      WebkitMaskImage: 'linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)',
                      WebkitMaskSize: '200% 100%',
                      maskImage: 'linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)',
                      maskSize: '200% 100%',
                    }}
                    initial={{ maskPosition: '150%', opacity: 0 }}
                    animate={{ maskPosition: '-150%', opacity: [0, 1, 0] }}
                    transition={{
                      maskPosition: { delay: 0.3, duration: 1.2, ease: 'easeInOut' },
                      opacity: { delay: 0.3, duration: 1.2, times: [0, 0.15, 1], ease: 'linear' },
                    }}
                  >
                    {currentMessage.split('').map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.018, ease: [0.2, 0.65, 0.3, 0.9] }}
                        className="inline-block text-[12px] font-medium leading-snug"
                        style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </motion.span>
                </motion.span>
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
