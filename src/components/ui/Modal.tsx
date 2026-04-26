import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerIcon?: React.ReactNode;
  subtitle?: string;
  maxWidth?: string;
  hideScrollbar?: boolean;
  bodyClassName?: string;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerActions,
  headerIcon,
  subtitle,
  maxWidth = 'max-w-lg',
  hideScrollbar = false,
  bodyClassName
}) => {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    }
  }, [isOpen, onClose]);

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4"
          style={{ perspective: '1000px' }}
        >
          {/* Backdrop com blur em elemento separado — evita conflito com perspective 3D */}
          <motion.div
            initial={{ backdropFilter: 'blur(0px)' }}
            animate={{ backdropFilter: 'blur(12px)' }}
            exit={{ backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20"
          />

          {/* Modal Content */}
          <motion.div
            initial={
              isMobile
                ? { y: '100%' }
                // Animação minimalista com rotação sutil 3D e inclinação
                : { opacity: 0, scale: 0.92, y: 24, rotateX: 12, rotate: -2 }
            }
            animate={
              isMobile
                ? { y: 0 }
                : { opacity: 1, scale: 1, y: 0, rotateX: 0, rotate: 0 }
            }
            exit={
              isMobile
                ? { y: '100%' }
                : { opacity: 0, scale: 0.96, y: 16, rotateX: -8, rotate: 2 }
            }
            transition={
              isMobile
                ? { type: 'spring', bounce: 0, duration: 0.4 } // Suave para mobile
                : { type: 'spring', stiffness: 320, damping: 28, mass: 0.9 } // Elegante para desktop
            }
            style={{ transformOrigin: 'center center' }}
            className={`relative w-full ${isMobile ? '' : maxWidth} bg-white rounded-t-[28px] sm:rounded-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.08)] sm:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.15)] border border-[#e9e9e7] flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-visible`}
          >
            {/* Drag handle — mobile only */}
            <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 bg-[#e9e9e7] rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-[#f1f1f0]">
              <div className="flex items-center gap-3 min-w-0">
                {headerIcon && (
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-[#f7f7f5] to-[#efefed] border border-[#e9e9e7] flex items-center justify-center text-[#37352f]/70">
                    {headerIcon}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[#37352f] tracking-tight truncate">{title}</h3>
                  {subtitle && (
                    <p className="text-[11px] font-medium text-[#37352f]/50 mt-0.5 truncate">{subtitle}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {headerActions}
                <button
                  onClick={onClose}
                  aria-label="Fechar"
                  className="p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/40 hover:text-[#37352f]"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div
              className={`flex-1 overflow-y-auto p-5 sm:p-6 ${hideScrollbar ? 'hide-scrollbar' : 'scrollbar-thin scrollbar-thumb-[#f1f1f0]'} ${bodyClassName || ''}`}
              style={{ WebkitOverflowScrolling: 'touch' as any, overscrollBehavior: 'contain' }}
            >
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-[#f1f1f0] flex justify-end items-center gap-3 rounded-b-2xl bg-gray-50/50">
                {footer}
              </div>
            )}

            {/* Safe-area padding for iPhone home indicator */}
            <div className="sm:hidden flex-shrink-0" style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
};

export default Modal;