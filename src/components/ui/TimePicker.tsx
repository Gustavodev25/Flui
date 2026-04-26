import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { Clock, X, Sun, Moon, Sunrise, Sunset, Timer, ChevronUp, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import NumberFlow from '@number-flow/react'
import Portal from './Portal'

interface TimePickerProps {
  label?: string
  value: string | null
  onChange: (time: string | null) => void
}

type Segment = 'hours' | 'minutes'
type Mode = 'at' | 'in'

const pad = (n: number) => String(n).padStart(2, '0')

const parseTimerValue = (value: string | null) => {
  if (!value) return null

  const parts = value.split(':')
  const rawHours = parseInt(parts[0] || '0', 10)
  const rawMinutes = parseInt(parts[1] || '0', 10)
  const rawSeconds = parseInt(parts[2] || '0', 10)

  if ([rawHours, rawMinutes, rawSeconds].some(Number.isNaN)) return null

  const totalMinutes = rawHours * 60 + rawMinutes + (rawSeconds > 0 ? 1 : 0)

  return {
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  }
}

const formatDurationValue = (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}:00`

const getDisplayPartsFromValue = (value: string | null, mode: Mode) => {
  const parsed = parseTimerValue(value)
  if (!parsed) return null

  if (mode === 'in') {
    return {
      hours: Math.min(parsed.hours, 99),
      minutes: parsed.minutes,
    }
  }

  const target = new Date(Date.now() + parsed.totalMinutes * 60 * 1000)
  return {
    hours: target.getHours(),
    minutes: target.getMinutes(),
  }
}

const TimePicker: React.FC<TimePickerProps> = ({ label, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [mode, setMode] = useState<Mode>('at')
  const [hours, setHours] = useState(9)
  const [minutes, setMinutes] = useState(0)
  const [activeSegment, setActiveSegment] = useState<Segment>('hours')
  const [isDragging, setIsDragging] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const [isMobile, setIsMobile] = useState(false)

  const dragStartX = useRef(0)
  const dragStartValue = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Track viewport width for mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (isOpen) setShouldRender(true)
  }, [isOpen])

  const handleExitComplete = () => {
    if (!isOpen) setShouldRender(false)
  }

  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const popoverWidth = 210
      const popoverHeight = 240
      const margin = 12

      // Clamp position so the popover never overflows the viewport
      let left = rect.left
      if (left + popoverWidth + margin > window.innerWidth) {
        left = window.innerWidth - popoverWidth - margin
      }
      if (left < margin) left = margin

      let top = rect.bottom + 8
      if (top + popoverHeight + margin > window.innerHeight) {
        // Flip above the trigger if not enough room below
        top = Math.max(margin, rect.top - popoverHeight - 8)
      }

      setCoords({ top, left, width: rect.width })
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (value && !isDragging) {
      const nextDisplay = getDisplayPartsFromValue(value, mode)
      if (!nextDisplay) return
      setHours(nextDisplay.hours)
      setMinutes(nextDisplay.minutes)
    }
  }, [value, mode, isDragging])

  const propagate = useCallback((h: number, m: number, currentMode: Mode) => {
    if (currentMode === 'in') {
      if (h === 0 && m === 0) onChange(null)
      else onChange(formatDurationValue(h, m))
    } else {
      const now = new Date()
      const target = new Date()
      target.setHours(h, m, 0, 0)
      let diff = target.getTime() - now.getTime()
      if (diff <= 0) {
        target.setDate(target.getDate() + 1)
        diff = target.getTime() - now.getTime()
      }
      const totalMinutes = Math.ceil(diff / 60000)
      const durationHours = Math.floor(totalMinutes / 60)
      const durationMinutes = totalMinutes % 60
      onChange(formatDurationValue(durationHours, durationMinutes))
    }
  }, [onChange])

  const setSegmentAndPropagate = useCallback((segment: Segment, val: number) => {
    const max = segment === 'hours' ? (mode === 'at' ? 23 : 99) : 59
    let clamped = val
    if (val < 0) clamped = max
    if (val > max) clamped = 0
    
    const newH = segment === 'hours' ? clamped : hours
    const newM = segment === 'minutes' ? clamped : minutes
    
    if (segment === 'hours') setHours(clamped)
    else setMinutes(clamped)
    
    propagate(newH, newM, mode)
  }, [hours, minutes, propagate, mode])

  const handlePointerDown = (e: React.PointerEvent, segment: Segment) => {
    e.preventDefault()
    setActiveSegment(segment)
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartValue.current = segment === 'hours' ? hours : minutes
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaX = e.clientX - dragStartX.current
    const newValue = dragStartValue.current + Math.round(deltaX / 15)
    setSegmentAndPropagate(activeSegment, newValue)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const getTimeIcon = (colored = true) => {
    if (mode === 'in') return <Timer size={14} className={colored ? "text-orange-500" : ""} />
    if (hours >= 5 && hours < 8) return <Sunrise size={14} className={colored ? "text-amber-500" : ""} />
    if (hours >= 8 && hours < 17) return <Sun size={14} className={colored ? "text-yellow-500" : ""} />
    if (hours >= 17 && hours < 19) return <Sunset size={14} className={colored ? "text-orange-600" : ""} />
    return <Moon size={14} className={colored ? "text-blue-500" : ""} />
  }

  const hasValue = value && value !== '00:00:00'

  return (
    <div className="space-y-1.5 relative group" ref={containerRef}>
      {label && <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">{label}</label>}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between bg-white border ${
          isOpen ? 'border-black ring-1 ring-black/5' : 'border-[#e9e9e7]'
        } rounded-lg py-2.5 px-4 text-xs font-medium text-[#37352f] cursor-pointer transition-all text-left outline-none`}
      >
        <div className="flex items-center gap-2">
          {getTimeIcon()}
          <span className={!hasValue ? 'text-[#37352f]/50 font-normal' : ''}>
            {hasValue ? (
              <span className="flex items-center gap-1">
                <span className="opacity-40 font-normal">{mode === 'at' ? 'às' : 'daqui a'}</span>
                <span className="tabular-nums font-semibold">{pad(hours)}:{pad(minutes)}</span>
              </span>
            ) : 'Adicionar timer...'}
          </span>
        </div>
        {hasValue && (
          <div 
            onClick={(e) => { e.stopPropagation(); onChange(null); setIsOpen(false); }}
            className="p-0.5 hover:bg-black/5 rounded-full text-[#37352f]/20 hover:text-red-500"
          >
            <X size={12} />
          </div>
        )}
      </button>

      {shouldRender && (
        <Portal>
          <AnimatePresence onExitComplete={handleExitComplete}>
            {isOpen && (<>
            {/* Visual backdrop (mobile only, non-interactive) */}
            {isMobile && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[10000] bg-black/30 pointer-events-none"
              />
            )}

            {/* Dropdown Content */}
            <motion.div
              ref={popoverRef}
              initial={isMobile ? { opacity: 0, y: '-40%', scale: 0.96, x: '-50%' } : { opacity: 0, scale: 0.98, y: 8 }}
              animate={isMobile ? { opacity: 1, scale: 1, y: '-50%', x: '-50%' } : { opacity: 1, scale: 1, y: 0 }}
              exit={isMobile ? { opacity: 0, y: '-40%', scale: 0.96, x: '-50%' } : { opacity: 0, scale: 0.98, y: 8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              style={
                isMobile
                  ? {
                      position: 'fixed',
                      left: '50%',
                      top: '50%',
                      width: 'calc(100vw - 32px)',
                      maxWidth: '360px',
                      zIndex: 10001,
                    }
                  : {
                      position: 'fixed',
                      top: coords.top,
                      left: coords.left,
                      minWidth: '210px',
                      zIndex: 10001,
                    }
              }
              className="bg-white border border-[#e9e9e7] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.18)] overflow-hidden"
            >
              <div className="flex flex-col">
                <div className="p-4 flex flex-col items-center gap-4">
                  {/* Mode Toggle (Pill style like Visibility) */}
                  <div className="w-full relative flex items-center bg-[#f7f7f5] rounded-full p-1 border border-[#e9e9e7]">
                    <button
                      type="button"
                      onClick={() => setMode('at')}
                      className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[9px] font-bold uppercase transition-colors duration-300 ${
                        mode === 'at' ? 'text-black' : 'text-[#37352f]/30 hover:text-[#37352f]/50'
                      }`}
                    >
                      <Clock size={12} strokeWidth={2.5} />
                      Horário
                      {mode === 'at' && (
                        <motion.div
                          layoutId="active-mode"
                          className="absolute inset-0 bg-white shadow-sm border border-[#e9e9e7] rounded-full -z-10"
                          transition={{ type: "spring", stiffness: 350, damping: 35, mass: 1 }}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('in')}
                      className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-[9px] font-bold uppercase transition-colors duration-300 ${
                        mode === 'in' ? 'text-black' : 'text-[#37352f]/30 hover:text-[#37352f]/50'
                      }`}
                    >
                      <Timer size={12} strokeWidth={2.5} />
                      Duração
                      {mode === 'in' && (
                        <motion.div
                          layoutId="active-mode"
                          className="absolute inset-0 bg-white shadow-sm border border-[#e9e9e7] rounded-full -z-10"
                          transition={{ type: "spring", stiffness: 350, damping: 35, mass: 1 }}
                        />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Up arrows */}
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setSegmentAndPropagate('hours', hours + 1)}
                        className="w-[42px] flex justify-center p-1 hover:bg-black/5 rounded-full transition-colors text-[#37352f]/20 hover:text-black active:scale-90"
                      >
                        <ChevronUp size={12} strokeWidth={3} />
                      </button>
                      <div className="w-[1px] mx-0" />
                      <button
                        type="button"
                        onClick={() => setSegmentAndPropagate('minutes', minutes + 1)}
                        className="w-[42px] flex justify-center p-1 hover:bg-black/5 rounded-full transition-colors text-[#37352f]/20 hover:text-black active:scale-90"
                      >
                        <ChevronUp size={12} strokeWidth={3} />
                      </button>
                    </div>
                  </div>

                  {/* Unified time box */}
                  <div className="flex items-center bg-[#f7f7f5] rounded-xl border border-[#e9e9e7] overflow-hidden">
                    <motion.div
                      onPointerDown={(e) => handlePointerDown(e, 'hours')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onClick={() => setActiveSegment('hours')}
                      className={`
                        w-[52px] h-12 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition-all touch-none select-none
                        ${activeSegment === 'hours' ? 'bg-black text-white' : 'text-[#37352f]/50'}
                      `}
                    >
                      <NumberFlow
                        value={hours}
                        format={{ minimumIntegerDigits: 2 }}
                        className="text-lg font-black tabular-nums"
                        transformTiming={{ duration: 400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
                      />
                    </motion.div>
                    <div className="text-base font-black text-[#37352f]/20 select-none">:</div>
                    <motion.div
                      onPointerDown={(e) => handlePointerDown(e, 'minutes')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onClick={() => setActiveSegment('minutes')}
                      className={`
                        w-[52px] h-12 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition-all touch-none select-none
                        ${activeSegment === 'minutes' ? 'bg-black text-white' : 'text-[#37352f]/50'}
                      `}
                    >
                      <NumberFlow
                        value={minutes}
                        format={{ minimumIntegerDigits: 2 }}
                        className="text-lg font-black tabular-nums"
                        transformTiming={{ duration: 400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
                      />
                    </motion.div>
                  </div>

                  {/* Labels + Down arrows */}
                  <div className="flex items-center">
                    <div className="w-[52px] flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setSegmentAndPropagate('hours', hours - 1)}
                        className="p-1 hover:bg-black/5 rounded-full transition-colors text-[#37352f]/20 hover:text-black active:scale-90"
                      >
                        <ChevronDown size={12} strokeWidth={3} />
                      </button>
                      <span className="text-[7px] font-black uppercase tracking-tighter opacity-40">Hora</span>
                    </div>
                    <div className="w-[13px]" />
                    <div className="w-[52px] flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setSegmentAndPropagate('minutes', minutes - 1)}
                        className="p-1 hover:bg-black/5 rounded-full transition-colors text-[#37352f]/20 hover:text-black active:scale-90"
                      >
                        <ChevronDown size={12} strokeWidth={3} />
                      </button>
                      <span className="text-[7px] font-black uppercase tracking-tighter opacity-40">Min</span>
                    </div>
                  </div>

                  <div className="text-[10px] font-semibold text-[#37352f]/40 italic flex items-center gap-1.5 text-center">
                    <div className="w-4 h-[1px] bg-[#e9e9e7]" />
                    lembrar {mode === 'at' ? 'às' : 'daqui a'} {pad(hours)}:{pad(minutes)}
                    <div className="w-4 h-[1px] bg-[#e9e9e7]" />
                  </div>
                </div>

                <div className="px-3 py-2.5 border-t border-[#f1f1f0] flex gap-2">

                  <button
                    type="button"
                    onClick={() => { onChange(null); setIsOpen(false); }}
                    className="flex-1 py-1.5 text-[9px] font-bold uppercase text-red-500/60 hover:text-red-500 active:bg-red-500/5 rounded-lg transition-colors"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-4 py-1.5 bg-black text-white text-[9px] font-bold uppercase rounded-lg shadow-lg shadow-black/10 active:scale-95 transition-all"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
            </>)}
          </AnimatePresence>
        </Portal>
      )}

    </div>
  )
}

export default TimePicker
