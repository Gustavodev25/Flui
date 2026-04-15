import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  headerActions?: React.ReactNode
  maxWidth?: string // e.g. 'max-w-md', 'max-w-sm'
  hideScrollbar?: boolean
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  footer, 
  headerActions,
  maxWidth = 'max-w-lg',
  hideScrollbar = false
}) => {
  // Fecha o modal ao pressionar Esc
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEsc)
      // Impede o scroll do body quando o modal está aberto
      document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          key="modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            onClick={onClose}
            className="absolute inset-0 bg-[#000000]/30 backdrop-blur-[12px]"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`relative w-full ${maxWidth} bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-[#e9e9e7] flex flex-col max-h-[90vh] overflow-visible`}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#f1f1f0]">
              <h3 className="text-base font-bold text-[#37352f] tracking-tight">{title}</h3>
              <div className="flex items-center gap-2">
                {headerActions}
                <button 
                  onClick={onClose}
                  className="p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className={`flex-1 overflow-y-auto p-6 ${hideScrollbar ? 'hide-scrollbar' : 'scrollbar-thin scrollbar-thumb-[#f1f1f0]'}`}>
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 bg-[#fcfcfa] border-t border-[#f1f1f0] flex justify-end items-center gap-3 rounded-b-2xl">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default Modal
