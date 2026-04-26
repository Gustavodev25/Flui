import React, { useState, useRef, useEffect } from 'react'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Calendar from './Calendar'
import Portal from './Portal'

interface DatePickerProps {
  label?: string
  value: Date | null
  onChange: (date: Date | null) => void
}

const DatePicker: React.FC<DatePickerProps> = ({ label, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Force close on unmount to prevent orphaned Portal elements
  useEffect(() => {
    return () => {
      setIsOpen(false)
      setShouldRender(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) setShouldRender(true)
  }, [isOpen])

  const handleExitComplete = () => {
    if (!isOpen) setShouldRender(false)
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

  const formatDate = (date: Date | null) => {
    if (!date) return ''
    const day = date.getDate()
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    return `${day} ${months[date.getMonth()]}`
  }

  return (
    <div className="space-y-1.5 relative group" ref={containerRef}>
      {label && <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">{label}</label>}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between bg-white border ${
            isOpen ? 'border-[#000000] ring-1 ring-[#000000]/5' : 'border-[#e9e9e7]'
          } rounded-lg py-2.5 px-4 text-xs font-medium text-[#37352f] cursor-pointer outline-none transition-all text-left group`}
        >
          <div className="flex items-center gap-2">
            <CalendarIcon size={14} className="text-[#37352f]/30" />
            <span className={!value ? 'text-[#37352f]/50 font-normal' : ''}>
              {value ? formatDate(value) : 'Selecione um prazo...'}
            </span>
          </div>
          {value && (
            <button
               onClick={(e) => {
                  e.stopPropagation()
                  onChange(null)
                  setIsOpen(false)
               }}
               className="p-0.5 hover:bg-[#000000]/[0.05] rounded-full transition-colors text-[#37352f]/30 hover:text-[#37352f]"
            >
               <X size={12} />
            </button>
          )}
        </button>

        {shouldRender && (
          <Portal>
            <AnimatePresence onExitComplete={handleExitComplete}>
              {isOpen && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  style={{
                    position: 'fixed',
                    top: coords.top + 45,
                    left: coords.left,
                    zIndex: 10001,
                  }}
                  className="bg-white border border-[#e9e9e7] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden"
                >
                  <Calendar
                    selectedDate={value}
                    onSelect={(date) => {
                      onChange(date)
                      setIsOpen(false)
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Portal>
        )}
      </div>
    </div>
  )
}

export default DatePicker
