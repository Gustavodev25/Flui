import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import Modal from './ui/Modal'

const PHRASES = [
  'Deu algum bug aí?',
  'Tem alguma sugestão?',
  'Algo não funcionou?',
  'Quer dar um feedback?',
]

interface FeedbackWidgetProps {
  variant?: 'floating' | 'topbar'
}

export const FeedbackWidget = ({ variant = 'floating' }: FeedbackWidgetProps) => {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  const handleOpen = () => {
    setName(user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '')
    setEmail(user?.email ?? '')
    setMotivo('')
    setOpen(true)
  }

  const handleSend = () => {
    if (!motivo.trim()) return
    const msg = `*Feedback do App*\n\n👤 Nome: ${name || 'Não informado'}\n📧 Email: ${email || 'Não informado'}\n\n💬 Mensagem:\n${motivo}`
    const url = `https://wa.me/5518996239335?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
    setOpen(false)
  }

  const phrase = PHRASES[phraseIndex]

  return (
    <>
      {/* Botão flutuante colado na direita inferior */}
      {variant === 'floating' ? (
        <div
          className="fixed right-0 bottom-6 z-50 cursor-pointer select-none overflow-hidden"
          onClick={handleOpen}
          style={{ borderRadius: '10px 0 0 10px' }}
        >
          <div
            className="bg-[#f7f7f5] text-[#37352f] text-[12px] font-medium px-4 py-2.5 shadow-md border border-[#e9e9e7] border-r-0 hover:bg-[#efefed] active:scale-95 transition-colors duration-200"
            style={{ borderRadius: '10px 0 0 10px', minWidth: '140px' }}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIndex}
                className="relative inline-flex flex-wrap overflow-hidden"
                style={{ display: 'inline-flex', flexWrap: 'wrap' }}
              >
                {/* Camada base - texto escuro */}
                <span className="text-[#37352f] flex flex-wrap">
                  {phrase.split('').map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.018,
                        ease: [0.2, 0.65, 0.3, 0.9],
                      }}
                      className="inline-block"
                      style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </span>

                {/* Camada de brilho */}
                <motion.span
                  className="absolute inset-0 flex flex-wrap text-white pointer-events-none select-none"
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
                  {phrase.split('').map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.018,
                        ease: [0.2, 0.65, 0.3, 0.9],
                      }}
                      className="inline-block"
                      style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </motion.span>
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <button
          onClick={handleOpen}
          className="flex items-center justify-center px-2.5 py-1 sm:px-4 sm:py-2 rounded-full bg-[#f8f8f7] border border-[#e9e9e7] hover:bg-[#efefed] transition-all group active:scale-95 shadow-sm overflow-hidden"
          style={{ maxWidth: '160px' }}
        >
          <div className="flex items-center justify-center overflow-hidden w-full">
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIndex}
                className="relative inline-flex overflow-hidden whitespace-nowrap"
                style={{ display: 'inline-flex' }}
              >
                {/* Camada base - texto escuro */}
                <span className="text-[#37352f]/60 group-hover:text-[#37352f] flex text-[9px] sm:text-[11px] font-bold tracking-tight uppercase leading-none whitespace-nowrap">
                  {phrase.split('').map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.018,
                        ease: [0.2, 0.65, 0.3, 0.9],
                      }}
                      className="inline-block"
                      style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </span>

                {/* Camada de brilho */}
                <motion.span
                  className="absolute inset-0 flex flex-wrap text-white pointer-events-none select-none"
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
                  {phrase.split('').map((char, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.018,
                        ease: [0.2, 0.65, 0.3, 0.9],
                      }}
                      className="inline-block text-[11px] font-bold tracking-tight uppercase leading-none"
                      style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                    >
                      {char}
                    </motion.span>
                  ))}
                </motion.span>
              </motion.span>
            </AnimatePresence>
          </div>
        </button>
      )}

      {/* Modal igual ao de criar tarefa */}
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Enviar feedback"
        maxWidth="max-w-md"
        hideScrollbar
        footer={
          <button
            type="button"
            onClick={handleSend}
            disabled={!motivo.trim()}
            className="bg-[#202020] text-white px-6 py-2.5 rounded-lg text-xs font-medium hover:bg-[#202020]/90 transition-all shadow-md shadow-[#202020]/10 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Enviar no WhatsApp
          </button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-[#37352f]/70">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className="w-full bg-white border border-[#e9e9e7] rounded-lg py-2.5 px-4 text-sm font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000]/5 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-[#37352f]/70">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full bg-white border border-[#e9e9e7] rounded-lg py-2.5 px-4 text-sm font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000]/5 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-[#37352f]/70">
              Motivo <span className="text-red-400">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o bug, sugestão ou dúvida..."
              rows={4}
              className="w-full bg-white border border-[#e9e9e7] rounded-lg py-2.5 px-4 text-sm font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000]/5 transition-all resize-none"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
