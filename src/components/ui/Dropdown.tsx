import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface DropdownProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  anchor?: React.RefObject<HTMLElement | null>
  className?: string
}

export const Dropdown: React.FC<DropdownProps> = ({ isOpen, onClose, children, className }) => {
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target as Node)) {
        return
      }
      onClose()
    }

    if (isOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 0)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: -8, scale: 0.95, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, scale: 0.95, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 350, damping: 25, mass: 0.8 }}
          style={{ originX: 1, originY: 0 }}
          className={`absolute right-0 top-full mt-2 w-[220px] bg-white rounded-xl border border-[#e9e9e7] shadow-[0_10px_30px_rgba(0,0,0,0.08),0_4px_8px_rgba(0,0,0,0.04)] z-[100] p-1 overflow-hidden ${className || ''}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

import NumberFlow from '@number-flow/react'

interface DropdownItemProps {
  icon?: React.ReactNode
  label: string
  onClick?: () => void
  variant?: 'default' | 'danger'
  holdDuration?: number // Duração em ms para confirmar segurando
}

export const DropdownItem: React.FC<DropdownItemProps> = ({ icon, label, onClick, variant = 'default', holdDuration }) => {
  const [holdProgress, setHoldProgress] = React.useState(0)
  const [isHolding, setIsHolding] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = React.useRef<number>(0)

  const startHold = (e: React.PointerEvent) => {
    if (!holdDuration) return
    e.stopPropagation()
    setIsHolding(true)
    startTimeRef.current = Date.now()
    setHoldProgress(0)

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current
      const progress = Math.min((elapsed / holdDuration) * 100, 100)
      setHoldProgress(progress)

      if (progress >= 100) {
        if (timerRef.current) clearInterval(timerRef.current)
        setIsHolding(false)
        setHoldProgress(0)
        onClick?.()
      }
    }, 16)
  }

  const cancelHold = () => {
    if (!holdDuration) return
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsHolding(false)
    setHoldProgress(0)
  }

  const secondsRemaining = holdDuration ? Math.max(0, Math.ceil((holdDuration - (holdProgress / 100) * holdDuration) / 1000)) : 0

  return (
    <button
      onPointerDown={holdDuration ? startHold : undefined}
      onPointerUp={holdDuration ? cancelHold : undefined}
      onPointerLeave={holdDuration ? cancelHold : undefined}
      onClick={!holdDuration ? (e) => { e.stopPropagation(); onClick?.() } : undefined}
      className={`relative w-full flex items-center gap-2 px-3 py-2 text-[12.5px] font-medium rounded-[8px] transition-all text-left overflow-hidden select-none touch-none ${variant === 'danger'
        ? 'text-[#eb5757] hover:bg-[#eb5757]/[0.05]'
        : 'text-[#37352f] hover:bg-[#000000]/[0.02]'
        }`}
    >
      {/* Preenchimento de fundo rítmico e minimalista */}
      {holdDuration && (
        <motion.div 
          initial={false}
          animate={{ 
            width: `${Math.ceil(holdProgress / (100 / 5)) * (100 / 5)}%`,
            opacity: isHolding ? 1 : 0 
          }}
          transition={{
            width: { type: "spring", stiffness: 300, damping: 25 },
            opacity: { duration: 0.2 }
          }}
          className="absolute inset-y-0 left-0 bg-green-500/10 pointer-events-none"
        />
      )}

      <AnimatePresence mode="wait">
        {isHolding ? (
          <motion.div 
            key="holding"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex items-center justify-center gap-1 z-10"
          >
            <span className="text-[11px] font-semibold text-green-600/80">Segure</span>
            <NumberFlow 
              value={secondsRemaining} 
              className="text-[12px] font-bold text-green-600 tabular-nums"
            />
          </motion.div>
        ) : (
          <motion.div 
            key="normal"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex items-center gap-2 min-w-0 z-10"
          >
            {icon && <span className={`flex-shrink-0 ${variant === 'danger' ? 'text-[#eb5757]' : 'text-[#37352f]/40'}`}>{icon}</span>}
            <span className="truncate">{label}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  )
}

export const DropdownDivider = () => <div className="h-[1px] bg-[#f1f1f0] my-1" />