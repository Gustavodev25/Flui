import React from 'react'
import Modal from './ui/Modal'
import { ExternalLink } from 'lucide-react'
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
      hideScrollbar={true}
      headerActions={
        <button
          onClick={handleMaximize}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[#37352f]/40 hover:text-[#37352f]/70 hover:bg-[#f1f1f0] rounded-md transition-all text-[11px] font-medium"
        >
          <ExternalLink size={13} />
          Ver em tela cheia
        </button>
      }
      footer={
        <div className="w-full flex items-center justify-end">
          <button
            onClick={handleConfirm}
            className="px-8 py-2 bg-[#202020] text-white text-xs font-medium rounded-lg hover:bg-black transition-all shadow-sm active:scale-95"
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
