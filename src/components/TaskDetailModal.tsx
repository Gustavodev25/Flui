import React, { useState, useEffect, useRef } from 'react'
import NumberFlow from '@number-flow/react'
import { motion } from 'framer-motion'
import { CheckCircle2, Circle, Edit2 } from 'lucide-react'
import Modal from './ui/Modal'

interface Subtask {
  id: string
  title: string
  completed: boolean
}

interface Task {
  id: string
  title: string
  description?: string
  status: 'todo' | 'doing' | 'done' | 'canceled'
  priority: 'low' | 'medium' | 'high'
  dueDate: string
  source: 'user' | 'whatsapp'
  progress: number
  subtasks?: Subtask[]
  timerAt?: string
  timerFired?: boolean
  whatsappMessage?: string
  reminderDaysBefore?: number
  reminderFired?: boolean
}

const statusMap: Record<Task['status'], string> = {
  todo: 'A Fazer',
  doing: 'Em Progresso',
  done: 'Concluído',
  canceled: 'Cancelado',
}

const statusDot: Record<Task['status'], string> = {
  todo: 'bg-slate-400',
  doing: 'bg-[#2383e2]',
  done: 'bg-[#6366f1]',
  canceled: 'bg-red-300',
}

const priorityMap: Record<Task['priority'], string> = {
  high: 'Crítica',
  medium: 'Média',
  low: 'Baixa',
}

function formatDate(dateStr: string) {
  if (!dateStr || dateStr === 'Sem prazo') return 'Sem prazo'
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return dateStr
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const taskDate = new Date(year, month - 1, day); taskDate.setHours(0, 0, 0, 0)
  if (taskDate.getTime() === today.getTime()) return 'Hoje'
  if (taskDate.getTime() === tomorrow.getTime()) return 'Amanhã'
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  return `${day} ${months[month - 1]} ${year}`
}

function getTimerParts(timerAt: string): { h: number; m: number; s: number } | null {
  const diff = new Date(timerAt).getTime() - Date.now()
  if (diff <= 0) return null
  const total = Math.floor(diff / 1000)
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  }
}

interface TaskDetailModalProps {
  task: Task | null
  isOpen: boolean
  onClose: () => void
  onToggleSubtask: (taskId: string, subtaskId: string) => void
  onStopTimer: (taskId: string) => void
  onEdit: (task: Task) => void
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  isOpen,
  onClose,
  onToggleSubtask,
  onStopTimer,
  onEdit,
}) => {
  if (!task) return null

  const hasTimer = task.timerAt && !task.timerFired
  const hasSubtasks = task.subtasks && task.subtasks.length > 0
  const hasDescription = task.description && task.description.trim().length > 0

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={task.title}
      maxWidth="max-w-md"
      headerActions={
        <button
          onClick={() => { onClose(); onEdit(task) }}
          className="p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
          title="Editar"
        >
          <Edit2 size={15} />
        </button>
      }
    >
      <div className="space-y-5">

        {/* Propriedades da tarefa */}
        <div className="space-y-2.5">
          <DetailRow label="Status">
            <div className="flex items-center gap-2">
              <span className={`w-[7px] h-[7px] rounded-full ${statusDot[task.status]}`} />
              <span className="text-[13px] text-[#37352f]">{statusMap[task.status]}</span>
            </div>
          </DetailRow>

          <DetailRow label="Prioridade">
            <span className="text-[13px] text-[#37352f]">{priorityMap[task.priority]}</span>
          </DetailRow>

          <DetailRow label="Prazo">
            <span className="text-[13px] text-[#37352f]">{formatDate(task.dueDate)}</span>
          </DetailRow>

          {hasTimer && (
            <DetailRow label="Timer">
              <TimerInline task={task} onStopTimer={onStopTimer} />
            </DetailRow>
          )}
        </div>

        {/* Descrição */}
        {hasDescription && (
          <div className="pt-1">
            <span className="text-[11px] font-semibold text-[#37352f]/25 uppercase tracking-wider">Descrição</span>
            <p className="text-[13px] text-[#37352f]/60 leading-relaxed whitespace-pre-wrap mt-1.5">
              {task.description}
            </p>
          </div>
        )}

        {/* Subtarefas */}
        {hasSubtasks && (
          <SubtasksSection task={task} onToggleSubtask={onToggleSubtask} />
        )}
      </div>
    </Modal>
  )
}

// ── Detail Row ──
const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between">
    <span className="text-[13px] text-[#37352f]/35">{label}</span>
    {children}
  </div>
)

// ── Timer Inline ──
const TimerInline: React.FC<{ task: Task; onStopTimer: (id: string) => void }> = ({ task, onStopTimer }) => {
  const HOLD_DURATION = 6000
  const [timerParts, setTimerParts] = useState<{ h: number; m: number; s: number } | null>(
    task.timerAt ? getTimerParts(task.timerAt) : null
  )
  const [holdProgress, setHoldProgress] = useState(0)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)

  useEffect(() => {
    if (!task.timerAt || task.timerFired) return
    const interval = setInterval(() => {
      const parts = getTimerParts(task.timerAt!)
      setTimerParts(parts)
      if (parts === null) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [task.timerAt, task.timerFired])

  const startHold = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    holdStartRef.current = Date.now()
    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current
      const pct = Math.min((elapsed / HOLD_DURATION) * 100, 100)
      setHoldProgress(pct)
      if (pct >= 100) {
        cancelHold()
        onStopTimer(task.id)
      }
    }, 16)
  }

  const cancelHold = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
    setHoldProgress(0)
  }

  if (!timerParts) return <span className="text-[13px] text-[#37352f]/30">Expirado</span>

  return (
    <div
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      className={`inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg transition-all select-none cursor-pointer ${
        holdProgress > 0 ? 'bg-red-50' : 'bg-[#f7f7f5] hover:bg-[#f1f1f0]'
      }`}
      title="Segure para parar o timer"
    >
      {holdProgress > 0 ? (
        <div className="flex items-center gap-1.5">
          <div className="w-12 h-1 bg-red-100 rounded-full overflow-hidden">
            <motion.div className="h-full bg-red-400 rounded-full" style={{ width: `${holdProgress}%` }} />
          </div>
        </div>
      ) : (
        <>
          {timerParts.h > 0 && (
            <>
              <NumberFlow value={timerParts.h} format={{ minimumIntegerDigits: 2 }} className="text-[13px] font-semibold text-[#37352f] tabular-nums" />
              <span className="text-[13px] text-[#37352f]/20">:</span>
            </>
          )}
          <NumberFlow value={timerParts.m} format={{ minimumIntegerDigits: 2 }} className="text-[13px] font-semibold text-[#37352f] tabular-nums" />
          <span className="text-[13px] text-[#37352f]/20">:</span>
          <NumberFlow value={timerParts.s} format={{ minimumIntegerDigits: 2 }} className="text-[13px] font-semibold text-[#37352f] tabular-nums" />
        </>
      )}
    </div>
  )
}

// ── Subtasks Section ──
const SubtasksSection: React.FC<{ task: Task; onToggleSubtask: (taskId: string, subtaskId: string) => void }> = ({ task, onToggleSubtask }) => {
  const subtasks = task.subtasks || []
  const completed = subtasks.filter(s => s.completed).length
  const total = subtasks.length
  const allDone = completed === total

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-semibold text-[#37352f]/25 uppercase tracking-wider">Subtarefas</span>
        <span className={`text-[11px] font-semibold tabular-nums transition-colors duration-500 ${allDone ? 'text-[#2b8a3e]' : 'text-[#37352f]/30'}`}>
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-[3px] bg-[#f1f1f0] rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full transition-colors duration-500 ${allDone ? 'bg-[#2b8a3e]' : 'bg-[#1a1a1a]'}`}
          initial={{ width: 0 }}
          animate={{ width: `${(completed / total) * 100}%` }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>

      <div className="space-y-0.5">
        {subtasks.map((subtask) => (
          <motion.div
            key={subtask.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => onToggleSubtask(task.id, subtask.id)}
            className="flex items-center gap-2.5 group/sub cursor-pointer py-2 px-2 hover:bg-[#f7f7f5] rounded-lg transition-all"
          >
            <div className={`transition-all duration-200 flex-shrink-0 ${
              subtask.completed ? 'text-[#1a1a1a]' : 'text-[#37352f]/15 group-hover/sub:text-[#37352f]/30'
            }`}>
              {subtask.completed ? <CheckCircle2 size={15} strokeWidth={2.5} /> : <Circle size={15} strokeWidth={1.5} />}
            </div>
            <span className={`text-[13px] transition-all ${
              subtask.completed ? 'text-[#37352f]/25 line-through' : 'text-[#37352f]/70'
            }`}>
              {subtask.title}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

export default TaskDetailModal
