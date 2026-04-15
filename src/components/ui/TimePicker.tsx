import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Clock, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import NumberFlow from '@number-flow/react'

interface TimePickerProps {
  label?: string
  value: string | null // "HH:MM:SS" or null
  onChange: (time: string | null) => void
}

type Segment = 'hours' | 'minutes' | 'seconds'

const pad = (n: number) => String(n).padStart(2, '0')

const TimePicker: React.FC<TimePickerProps> = ({ label, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [activeSegment, setActiveSegment] = useState<Segment>('hours')
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartValue = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Parse value from parent into local state
  useEffect(() => {
    if (value) {
      const parts = value.split(':')
      setHours(parseInt(parts[0]) || 0)
      setMinutes(parseInt(parts[1]) || 0)
      setSeconds(parseInt(parts[2]) || 0)
    } else {
      setHours(0)
      setMinutes(0)
      setSeconds(0)
    }
  }, [value])

  // Propagate local changes to parent in real-time
  const propagate = useCallback((h: number, m: number, s: number) => {
    if (h === 0 && m === 0 && s === 0) {
      onChange(null)
    } else {
      onChange(`${pad(h)}:${pad(m)}:${pad(s)}`)
    }
  }, [onChange])

  const getMax = (segment: Segment) => {
    if (segment === 'hours') return 23
    return 59
  }

  const clampValue = (val: number, segment: Segment) => {
    const max = getMax(segment)
    if (val < 0) return max + 1 + (val % (max + 1))
    if (val > max) return val % (max + 1)
    return val
  }

  const getSegmentValue = useCallback((segment: Segment) => {
    switch (segment) {
      case 'hours': return hours
      case 'minutes': return minutes
      case 'seconds': return seconds
    }
  }, [hours, minutes, seconds])

  const setSegmentAndPropagate = useCallback((segment: Segment, val: number) => {
    const clamped = clampValue(val, segment)
    const newH = segment === 'hours' ? clamped : hours
    const newM = segment === 'minutes' ? clamped : minutes
    const newS = segment === 'seconds' ? clamped : seconds
    if (segment === 'hours') setHours(clamped)
    if (segment === 'minutes') setMinutes(clamped)
    if (segment === 'seconds') setSeconds(clamped)
    propagate(newH, newM, newS)
  }, [hours, minutes, seconds, propagate])

  const handlePointerDown = useCallback((e: React.PointerEvent, segment: Segment) => {
    e.preventDefault()
    setActiveSegment(segment)
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartValue.current = getSegmentValue(segment)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [getSegmentValue])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaX = e.clientX - dragStartX.current
    const sensitivity = 20
    const rawDelta = deltaX / sensitivity
    const newValue = dragStartValue.current + Math.round(rawDelta)
    setSegmentAndPropagate(activeSegment, newValue)
  }, [isDragging, activeSegment, setSegmentAndPropagate])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsDragging(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent, segment: Segment) => {
    e.preventDefault()
    const direction = e.deltaY > 0 ? -1 : 1
    const current = getSegmentValue(segment)
    setSegmentAndPropagate(segment, current + direction)
  }, [getSegmentValue, setSegmentAndPropagate])

  const handlePreset = useCallback((h: number, m: number, s: number) => {
    setHours(h)
    setMinutes(m)
    setSeconds(s)
    propagate(h, m, s)
  }, [propagate])

  const handleClear = useCallback(() => {
    setHours(0)
    setMinutes(0)
    setSeconds(0)
    onChange(null)
    setIsOpen(false)
  }, [onChange])

  const hasNonZero = hours > 0 || minutes > 0 || seconds > 0
  const hasValue = (value && value !== '00:00:00') || hasNonZero || isOpen

  const segmentLabels: Record<Segment, string> = {
    hours: 'Horas',
    minutes: 'Min',
    seconds: 'Seg',
  }

  const segments: Segment[] = ['hours', 'minutes', 'seconds']

  return (
    <div className="space-y-1.5 relative" ref={containerRef}>
      {label && <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between bg-white border ${
            isOpen ? 'border-[#000000] ring-1 ring-[#000000]/5' : 'border-[#e9e9e7]'
          } rounded-lg py-2.5 px-4 text-xs font-medium text-[#37352f] cursor-pointer outline-none transition-all text-left group`}
        >
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-[#37352f]/30" />
            {hasValue ? (
              <span className="flex items-center tabular-nums">
                <NumberFlow value={hours} format={{ minimumIntegerDigits: 2 }} className="font-semibold" transformTiming={{ duration: 300, easing: 'ease-out' }} spinTiming={{ duration: 300, easing: 'ease-out' }} />
                <span className="text-[#37352f]/30 mx-[1px]">:</span>
                <NumberFlow value={minutes} format={{ minimumIntegerDigits: 2 }} className="font-semibold" transformTiming={{ duration: 300, easing: 'ease-out' }} spinTiming={{ duration: 300, easing: 'ease-out' }} />
                <span className="text-[#37352f]/30 mx-[1px]">:</span>
                <NumberFlow value={seconds} format={{ minimumIntegerDigits: 2 }} className="font-semibold" transformTiming={{ duration: 300, easing: 'ease-out' }} spinTiming={{ duration: 300, easing: 'ease-out' }} />
              </span>
            ) : (
              <span className="text-[#37352f]/50 font-normal">Definir timer...</span>
            )}
          </div>
          {hasNonZero && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              className="p-0.5 hover:bg-[#000000]/[0.05] rounded-full transition-colors text-[#37352f]/30 hover:text-[#37352f]"
            >
              <X size={12} />
            </button>
          )}
        </button>

        <AnimatePresence>
          {isOpen && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />

              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-[61] bg-white border border-[#e9e9e7] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden min-w-0"
              >
                {/* Header */}
                <div className="px-3 pt-3 pb-1.5">
                  <div className="text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest">
                    Arraste para ajustar
                  </div>
                </div>

                {/* Time Segments */}
                <div className="px-3 pb-2.5">
                  <div className="flex items-center justify-center gap-0.5">
                    {segments.map((segment, idx) => (
                      <React.Fragment key={segment}>
                        <div className="flex flex-col items-center gap-0.5">
                          <motion.div
                            onPointerDown={(e) => handlePointerDown(e, segment)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onWheel={(e) => handleWheel(e, segment)}
                            onClick={() => setActiveSegment(segment)}
                            className={`
                              relative flex items-center justify-center
                              w-[48px] h-[48px] rounded-xl cursor-grab select-none
                              transition-all duration-200
                              ${activeSegment === segment 
                                ? 'bg-[#37352f] text-white shadow-md shadow-black/10'
                                : 'bg-[#f7f7f5] text-[#37352f] hover:bg-[#efefed] border border-[#e9e9e7]'
                              }
                              ${isDragging && activeSegment === segment ? 'cursor-grabbing scale-105' : ''}
                            `}
                            whileTap={{ scale: 0.97 }}
                          >
                            {/* Drag indicator dots */}
                            <AnimatePresence>
                              {activeSegment === segment && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="absolute top-1.5 left-0 right-0 flex justify-center gap-[2px]"
                                >
                                  {[0, 1, 2].map(i => (
                                    <motion.div
                                      key={i}
                                      className="w-[2.5px] h-[2.5px] rounded-full bg-white/30"
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      transition={{ delay: i * 0.05 }}
                                    />
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <div className="text-center">
                              <NumberFlow
                                value={getSegmentValue(segment)}
                                format={{ minimumIntegerDigits: 2 }}
                                className="text-[20px] font-bold tabular-nums leading-none"
                                transformTiming={{ duration: 350, easing: 'ease-out' }}
                                spinTiming={{ duration: 350, easing: 'ease-out' }}
                                opacityTiming={{ duration: 200, easing: 'ease-out' }}
                              />
                            </div>

                            {/* Drag direction hints */}
                            <AnimatePresence>
                              {isDragging && activeSegment === segment && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className="absolute bottom-1 left-0 right-0 flex justify-center"
                                >
                                  <div className="flex items-center gap-0.5 text-[7px] text-white/40 font-bold">
                                    <span>◂</span>
                                    <span>▸</span>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                          <span className={`text-[8px] font-bold uppercase tracking-wider transition-colors ${
                            activeSegment === segment ? 'text-[#37352f]' : 'text-[#37352f]/30'
                          }`}>
                            {segmentLabels[segment]}
                          </span>
                        </div>
                        {idx < 2 && (
                          <div className="flex flex-col items-center gap-1 mb-3 mx-0.5">
                            <div className={`w-1 h-1 rounded-full transition-colors ${
                              activeSegment === segments[idx] || activeSegment === segments[idx + 1]
                                ? 'bg-[#37352f]'
                                : 'bg-[#37352f]/15'
                            }`} />
                            <div className={`w-1 h-1 rounded-full transition-colors ${
                              activeSegment === segments[idx] || activeSegment === segments[idx + 1]
                                ? 'bg-[#37352f]'
                                : 'bg-[#37352f]/15'
                            }`} />
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="px-3 pb-2">
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: '15m', h: 0, m: 15, s: 0 },
                      { label: '30m', h: 0, m: 30, s: 0 },
                      { label: '1h', h: 1, m: 0, s: 0 },
                      { label: '2h', h: 2, m: 0, s: 0 },
                    ].map(preset => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handlePreset(preset.h, preset.m, preset.s)}
                        className={`py-1 rounded-md text-[9px] font-bold transition-all border ${
                          hours === preset.h && minutes === preset.m && seconds === preset.s
                            ? 'bg-[#37352f]/5 border-[#37352f]/20 text-[#37352f]'
                            : 'bg-[#f7f7f5] border-[#e9e9e7] text-[#37352f]/40 hover:text-[#37352f]/70 hover:border-[#d3d3d1]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 px-3 pb-3">
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold text-[#37352f]/40 hover:text-[#37352f] bg-[#f7f7f5] border border-[#e9e9e7] hover:border-[#d3d3d1] transition-all"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold text-white bg-[#37352f] hover:bg-[#202020] transition-all shadow-sm active:scale-[0.97]"
                  >
                    OK
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default TimePicker
