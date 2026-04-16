import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { countries } from '../constants/countries'
import type { Country } from '../constants/countries'
import { ChevronDown, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface CountrySelectorProps {
  selectedCountry: Country;
  onSelect: (country: Country) => void;
}

const CountrySelector: React.FC<CountrySelectorProps> = ({ selectedCountry, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredCountries = countries.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.code.includes(search)
  )

  const updateCoords = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }
  }

  useEffect(() => {
    if (isOpen) {
      updateCoords()
      window.addEventListener('scroll', updateCoords)
      window.addEventListener('resize', updateCoords)
    }
    return () => {
      window.removeEventListener('scroll', updateCoords)
      window.removeEventListener('resize', updateCoords)
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const isInsideButton = dropdownRef.current?.contains(target)
      const isInsideList = listRef.current?.contains(target)

      if (!isInsideButton && !isInsideList) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-black/5 rounded-lg transition-colors group"
      >
        <img 
          src={`https://flagcdn.com/w40/${selectedCountry.iso.toLowerCase()}.png`}
          alt={selectedCountry.name}
          className="w-5 h-3.5 object-cover rounded-[3px] border border-black/5 flex-shrink-0"
        />
        <span className="text-sm font-bold text-[#37352f]/60 group-hover:text-[#37352f]">+{selectedCountry.code}</span>
        <ChevronDown size={14} className={`text-[#37352f]/30 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && createPortal(
        <AnimatePresence mode="wait">
          <motion.div
            ref={listRef}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{ 
              position: 'absolute',
              top: coords.top + 8,
              left: coords.left,
              zIndex: 9999
            }}
            className="w-64 bg-white rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-[#e9e9e7] overflow-hidden"
          >
            <div className="p-2 border-b border-[#f1f1f0] bg-[#fcfcfa]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#37352f]/30" size={12} />
                <input
                  type="text"
                  placeholder="Buscar país ou código..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#e9e9e7] rounded-lg text-xs focus:outline-none focus:border-[#37352f]/20 transition-all font-medium"
                />
              </div>
            </div>
            
            <div className="max-h-60 overflow-y-auto pt-1 pb-1 custom-scrollbar">
              {filteredCountries.map((country) => (
                <button
                  key={`${country.code}-${country.iso}`}
                  type="button"
                  onClick={() => {
                    onSelect(country)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-[#f1f1f0] transition-colors ${selectedCountry.iso === country.iso ? 'bg-[#f1f1f0]' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <img 
                      src={`https://flagcdn.com/w40/${country.iso.toLowerCase()}.png`}
                      alt={country.name}
                      className="w-5 h-3.5 object-cover rounded-[3px] border border-black/5 flex-shrink-0"
                    />
                    <span className="text-xs font-medium text-[#37352f]">{country.name}</span>
                  </div>
                  <span className="text-[11px] font-bold text-[#37352f]/30">+{country.code}</span>
                </button>
              ))}
              {filteredCountries.length === 0 && (
                <div className="px-3 py-4 text-center">
                  <p className="text-[11px] text-[#37352f]/40">Nenhum país encontrado</p>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

export default CountrySelector
