import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Portal from './Portal'

interface CompleteConfirmationProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

const CompleteConfirmation: React.FC<CompleteConfirmationProps> = ({
  isOpen,
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <Portal>
          <div className="fixed inset-0 z-[9998]" onClick={onCancel} />
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: 20, scale: 0.95, x: '-50%' }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="fixed bottom-8 left-1/2 z-[9999] bg-white border border-[#e9e9e7] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] flex flex-col p-5 w-[90vw] max-w-[320px]"
          >
            <div className="mb-5">
              <h3 className="text-[13px] font-bold text-[#37352f] mb-1.5">Marcar como concluída?</h3>
              <p className="text-[11px] text-[#37352f]/50 leading-relaxed font-medium">
                Tem certeza que deseja mover esta tarefa para Concluído?
              </p>
            </div>

            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                onClick={onCancel}
                className="px-4 py-1.5 rounded-md text-[11px] font-bold text-[#37352f]/60 hover:text-[#37352f] hover:bg-[#000000]/[0.03] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-1.5 rounded-md text-[11px] font-bold text-[#25D366] bg-[#25D366]/10 hover:bg-[#25D366]/20 transition-colors"
              >
                Concluir
              </button>
            </div>
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  )
}

export default CompleteConfirmation
