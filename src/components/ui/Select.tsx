import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Portal from './Portal'

interface Option {
  value: string
  label: string
}

interface SelectProps {
  label?: React.ReactNode | string
  options: Option[]
  value: string
  onChange: (value: string) => void
  containerClassName?: string
}

const Select: React.FC<SelectProps> = ({
  label,
  options,
  value,
  onChange,
  containerClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value)

  // Force close dropdown on unmount to prevent orphaned Portal elements
  useEffect(() => {
    return () => {
      setIsOpen(false)
      setShouldRender(false)
    }
  }, [])

  // Sync shouldRender with isOpen — open immediately, close after exit animation
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    }
  }, [isOpen])

  const handleExitComplete = () => {
    if (!isOpen) {
      setShouldRender(false)
    }
  }

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top,
        left: rect.left,
        width: rect.width
      })
    }
  }

  useEffect(() => {
    if (isOpen) {
      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div className={`space-y-1.5 relative ${containerClassName}`} ref={containerRef}>
      {label && (
        <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">
          {label}
        </label>
      )}
      <div className="relative">
        {/* Trigger Button */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between bg-white border ${isOpen ? 'border-[#000000] ring-1 ring-[#000000]/5' : 'border-[#e9e9e7]'} rounded-lg py-2.5 px-4 text-xs font-medium text-[#37352f] cursor-pointer outline-none transition-all`}
        >
          <span className={`truncate ${!selectedOption ? 'text-[#37352f]/50 font-normal' : ''}`}>{selectedOption?.label || 'Selecione...'}</span>
          <ChevronDown 
            size={14} 
            className={`text-[#37352f]/30 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
          />
        </button>

        {/* Custom Dropdown Content via Portal */}
        {shouldRender && (
          <Portal>
            <AnimatePresence onExitComplete={handleExitComplete}>
              {isOpen && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  style={{
                    position: 'fixed',
                    top: coords.top + 45,
                    left: coords.left,
                    width: coords.width,
                    zIndex: 10001,
                  }}
                  className="bg-white border border-[#e9e9e7] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] py-1.5 px-1.5 overflow-hidden flex flex-col gap-0.5"
                >
                  {options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors text-left rounded-lg ${
                        option.value === value 
                          ? 'text-[#000000] font-medium bg-[#000000]/[0.04]' 
                          : 'text-[#37352f]/70 font-medium hover:bg-[#000000]/[0.03]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </Portal>
        )}
      </div>
    </div>
  )
}

export default Select
