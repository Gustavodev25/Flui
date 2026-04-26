import React, { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CalendarProps {
  selectedDate: Date | null
  onSelect: (date: Date) => void
}

const Calendar: React.FC<CalendarProps> = ({ selectedDate, onSelect }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const firstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay()

  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ]

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const renderDays = () => {
    const days = []
    const totalDays = daysInMonth(currentMonth)
    const firstDay = firstDayOfMonth(currentMonth)

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8" />)
    }

    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d)
      const isSelected = selectedDate?.toDateString() === date.toDateString()
      const isToday = new Date().toDateString() === date.toDateString()

      days.push(
        <button
          key={d}
          onClick={() => onSelect(date)}
          className={`h-8 w-8 text-[11px] font-semibold rounded-md flex items-center justify-center transition-colors ${
            isSelected 
              ? 'bg-[#000000] text-white shadow-sm' 
              : isToday 
                ? 'bg-[#000000]/[0.03] text-[#000000] border border-[#e9e9e7]' 
                : 'text-[#37352f]/70 hover:bg-[#000000]/[0.03]'
          }`}
        >
          {d}
        </button>
      )
    }
    return days
  }

  return (
    <div className="p-3 w-64 bg-white">
      <div className="flex items-center justify-between mb-4 px-1">
        <h4 className="text-xs font-bold text-[#37352f]">
          {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </h4>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-1 hover:bg-[#000000]/[0.03] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]">
            <ChevronLeft size={14} />
          </button>
          <button onClick={nextMonth} className="p-1 hover:bg-[#000000]/[0.03] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, i) => (
          <div key={i} className="h-8 w-8 flex items-center justify-center text-[10px] font-bold text-[#37352f]/20">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {renderDays()}
      </div>
    </div>
  )
}

export default Calendar
