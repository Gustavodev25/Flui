import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Portal from './Portal'

interface DeleteConfirmationProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

const DeleteConfirmation: React.FC<DeleteConfirmationProps> = ({
  isOpen,
  onConfirm,
  onCancel,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <Portal>
          <div className="fixed inset-0 z-[9998] bg-[#37352f]/05" onClick={onCancel} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
            animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.95, y: 10, x: '-50%' }}
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
            className="fixed bottom-10 left-1/2 z-[9999] bg-white border border-[#e9e9e7] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.12)] w-[260px] overflow-hidden"
          >
            <div className="p-5 pb-4">
              <h3 className="text-[13px] font-bold text-[#37352f] mb-1.5">Excluir esta tarefa?</h3>
              <p className="text-[11px] text-[#37352f]/45 leading-relaxed font-medium">
                Esta ação apagará os dados permanentemente e não poderá ser desfeita.
              </p>
            </div>
            
            <div className="h-[1px] bg-[#f1f1f0]" />
            
            <div className="p-3 flex items-center justify-end gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] hover:bg-[#f7f7f5] transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-[#eb5757] hover:bg-[#fff5f5] active:bg-[#ffebeb] transition-all"
              >
                Excluir
              </button>
            </div>
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  )
}

export default DeleteConfirmation
