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

interface DropdownItemProps {
  icon?: React.ReactNode
  label: string
  onClick?: () => void
  variant?: 'default' | 'danger'
}

export const DropdownItem: React.FC<DropdownItemProps> = ({ icon, label, onClick, variant = 'default' }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-[12.5px] font-medium rounded-[8px] transition-all text-left ${variant === 'danger'
        ? 'text-[#eb5757] hover:bg-[#eb5757]/[0.05]'
        : 'text-[#37352f] hover:bg-[#000000]/[0.02]'
        }`}
    >
      {icon && <span className={`flex-shrink-0 ${variant === 'danger' ? 'text-[#eb5757]' : 'text-[#37352f]/40'}`}>{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  )
}

export const DropdownDivider = () => <div className="h-[1px] bg-[#f1f1f0] my-1 mx-1" />