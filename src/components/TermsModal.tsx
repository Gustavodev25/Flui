import React from 'react'
import Modal from './ui/Modal'
import { Maximize2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import TermsContent from './TermsContent'

interface TermsModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm?: () => void
}

const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const navigate = useNavigate()

  const handleConfirm = () => {
    if (onConfirm) onConfirm()
    onClose()
  }

  const handleMaximize = () => {
    navigate('/terms')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Termos e Privacidade"
      maxWidth="max-w-2xl"
      headerActions={
        <button
          onClick={handleMaximize}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[#37352f]/40 hover:text-[#202020] hover:bg-[#f1f1f0] rounded-md transition-all group"
        >
          <Maximize2 size={12} className="group-hover:scale-110 transition-transform" />
          Abrir em tela cheia
        </button>
      }
      footer={
        <div className="w-full flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <p className="text-[10px] font-bold text-[#37352f]/30 uppercase tracking-[0.2em]">
              Flui
            </p>
            <p className="text-[10px] text-[#37352f]/40">
              Versão 1.0.0 • Atualizado em {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <button
            onClick={handleConfirm}
            className="w-full md:w-auto px-6 py-2 bg-[#202020] text-white text-xs font-bold rounded-lg hover:bg-black transition-colors shadow-sm"
          >
            Entendido
          </button>
        </div>
      }
    >
      <TermsContent />
    </Modal>
  )
}

export default TermsModal
