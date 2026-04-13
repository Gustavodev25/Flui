import React, { useState, useEffect, useCallback, useRef } from 'react'
import NumberFlow from '@number-flow/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, MoreHorizontal, Layout, Table as TableIcon, Loader2, Edit2, Trash2, CheckCircle2, Circle, ChevronUp, Users, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import Avvvatars from 'avvvatars-react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import Modal from '../components/ui/Modal'
import TaskForm from '../components/TaskForm'
import TaskDetailModal from '../components/TaskDetailModal'
import { Dropdown, DropdownItem, DropdownDivider } from '../components/ui/Dropdown'
import DeleteConfirmation from '../components/ui/DeleteConfirmation'
import swingingDoodle from '../assets/doodles/SwingingDoodle.png'
import finlozLogo from '../assets/logo/lui.svg'
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  visibility?: 'personal' | 'workspace'
  workspaceOwnerId?: string
  authorName?: string
  authorAvatar?: string
  authorEmail?: string
}

const formatDate = (dateStr: string) => {
  if (!dateStr || dateStr === 'Sem prazo') return 'Sem prazo'

  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return dateStr

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const taskDate = new Date(year, month - 1, day)
  taskDate.setHours(0, 0, 0, 0)

  if (taskDate.getTime() === today.getTime()) return 'Hoje'
  if (taskDate.getTime() === tomorrow.getTime()) return 'Amanhã'

  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
  return `${day} ${months[month - 1]}`
}

/** Retorna quantos dias faltam para a data de vencimento (negativo = atrasado) */
function getDaysUntilDue(dateStr: string): number | null {
  if (!dateStr || dateStr === 'Sem prazo') return null
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const taskDate = new Date(year, month - 1, day); taskDate.setHours(0, 0, 0, 0)
  return Math.round((taskDate.getTime() - today.getTime()) / 86400000)
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

const getPriorityColor = (priority: Task['priority']) => {
  switch (priority) {
    case 'high': return 'bg-red-50 text-red-600 border-red-100'
    case 'medium': return 'bg-slate-50 text-slate-600 border-slate-200'
    default: return 'bg-slate-50 text-slate-400 border-slate-100'
  }
}



// Componente para o Card da Tarefa
const TaskCardUI = React.forwardRef<HTMLDivElement, {
  task: Task
  isDragging?: boolean
  isOverlay?: boolean
  dragHandleProps?: any
  style?: React.CSSProperties
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  activeDropdownId: string | null
  setActiveDropdownId: (id: string | null) => void
  userEmail?: string
  isPending?: boolean
  pendingTarget?: Task['status']
  onConfirm?: () => void
  onCancel?: () => void
  onToggleSubtask?: (taskId: string, subtaskId: string) => void
  onStopTimer?: (taskId: string) => void
  onCardClick?: (task: Task) => void
  isWorkspaceView?: boolean
}>(({ task, isDragging, isOverlay, dragHandleProps, style, onEdit, onDelete, activeDropdownId, setActiveDropdownId, userEmail, isPending, pendingTarget, onConfirm, onCancel, onToggleSubtask, onStopTimer, onCardClick, isWorkspaceView }, ref) => {

  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false)

  // Countdown em tempo real (tick a cada 1s)
  const [timerParts, setTimerParts] = useState<{ h: number; m: number; s: number } | null>(
    task.timerAt && !task.timerFired ? getTimerParts(task.timerAt) : null
  )
  useEffect(() => {
    if (!task.timerAt || task.timerFired) return
    const interval = setInterval(() => {
      const parts = getTimerParts(task.timerAt!)
      setTimerParts(parts)
      if (parts === null) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [task.timerAt, task.timerFired])

  // Hold-to-stop timer (pressionar e segurar por 700ms para encerrar o timer)
  const HOLD_DURATION = 6000
  const [holdProgress, setHoldProgress] = useState(0)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdStartRef = useRef<number>(0)

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
        onStopTimer?.(task.id)
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

  const isPlaceholder = isDragging && !isOverlay;

  // Estilos limpos e minimalistas baseados no estado (Arrastando vs Fixo vs Overlay)
  const cardStateClasses = isOverlay
    ? 'bg-white ring-1 ring-black/5 shadow-xl shadow-black/10 scale-[1.02] rotate-2 cursor-grabbing'
    : isPlaceholder
      ? 'bg-[#f7f7f5]/80 border-2 border-dashed border-[#d3d3d1]/60 opacity-50 shadow-none'
      : 'bg-white border border-[#e9e9e7] group-hover:border-[#d3d3d1] hover:shadow-md cursor-grab active:cursor-grabbing';

  return (
    <div
      ref={ref}
      style={style}
      className={`relative flex flex-col group w-full min-w-0 ${isOverlay ? 'z-50' : activeDropdownId === task.id ? 'z-[60]' : 'z-0'}`}
      {...dragHandleProps}
    >
      <motion.div
        initial={isOverlay ? false : { opacity: 0, y: 15 }}
        animate={isOverlay ? false : { opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={`w-full transition-all duration-200 ${isOverlay ? 'z-50' : ''}`}
      >
        {/* 1. CARD PRINCIPAL */}
        <div
          onClick={() => { if (!isDragging && !isOverlay && onCardClick) { onCardClick(task) } }}
          className={`relative z-10 p-4 rounded-2xl transition-all duration-200 ease-out ${cardStateClasses}`}>

          {/* Overlay de confirmação de alteração */}
          {isPending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-30 bg-white rounded-2xl flex items-center justify-center gap-6 px-4"
            >
              <span className="text-[13px] font-bold text-[#37352f] tracking-tight">
                {pendingTarget === 'done' ? 'Concluir?' : 'Mudar?'}
              </span>
              <div className="flex items-center gap-4">
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onCancel?.() }}
                  className="text-[11px] font-bold text-[#37352f]/30 hover:text-[#37352f]/60 transition-colors"
                >Não</button>
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onConfirm?.() }}
                  className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-white bg-[#202020] hover:bg-black transition-all"
                >Sim</button>
              </div>
            </motion.div>
          )}

          {/* Cabeçalho */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              {task.status === 'done' && (
                <CheckCircle2 size={16} className="text-[#1a1a1a] mt-0.5 flex-shrink-0" strokeWidth={2.5} />
              )}
              <h4 className={`text-[14px] font-semibold leading-snug line-clamp-2 transition-all ${task.status === 'done' ? 'text-[#37352f]/40' : 'text-[#37352f]'}`}>
                {task.title}
              </h4>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 -mt-0.5">
              <div className="relative -mr-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveDropdownId(activeDropdownId === task.id ? null : task.id)
                  }}
                  className="p-1 hover:bg-[#000000]/[0.05] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
                >
                  <MoreHorizontal size={16} className="flex-shrink-0" />
                </button>

                <Dropdown
                  isOpen={activeDropdownId === task.id}
                  onClose={() => setActiveDropdownId(null)}
                  className="w-[110px]"
                >
                  <DropdownItem
                    icon={<Edit2 size={12} />}
                    label="Editar"
                    onClick={() => onEdit(task)}
                  />
                  <DropdownDivider />
                  <DropdownItem
                    icon={<Trash2 size={12} />}
                    label="Excluir"
                    variant="danger"
                    onClick={() => onDelete(task.id)}
                  />
                </Dropdown>
              </div>
            </div>
          </div>

          {/* Tags e Fonte/Avatar */}
          <div className="flex items-center justify-between gap-2 mb-1">
            {/* Workspace badge (esquerda) */}
            {isWorkspaceView && task.visibility === 'workspace' && (
              <div className="flex items-center gap-1 opacity-50">
                <Users size={10} className="text-[#37352f]" />
                {task.authorName && task.authorEmail !== userEmail && (
                  <span className="text-[9px] font-semibold text-[#37352f]/60 truncate max-w-[80px]">{task.authorName}</span>
                )}
              </div>
            )}
            {!isWorkspaceView && task.visibility === 'workspace' && (
              <div className="flex items-center gap-1 opacity-40" title="Tarefa compartilhada no workspace">
                <Users size={10} className="text-[#37352f]" />
              </div>
            )}
            {task.visibility === 'personal' && <div />}

            {/* Fonte/Avatar (Direita) */}
            <div className="flex-shrink-0">
              {task.source === 'whatsapp' ? (
                <div className="flex items-center gap-1.5 opacity-30 grayscale hover:grayscale-0 transition-all cursor-help" title="Lui">
                  <img src={finlozLogo} alt="Finloz" className="w-3 h-3 object-contain" />
                  <span className="text-[8px] font-bold text-[#37352f] tracking-wider uppercase">Lui</span>
                </div>
              ) : isWorkspaceView && task.authorAvatar ? (
                <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden scale-90 flex items-center justify-center bg-white" title={task.authorName}>
                  <img src={task.authorAvatar} alt={task.authorName} className="w-[18px] h-[18px] object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                </div>
              ) : (
                <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden scale-90 flex items-center justify-center bg-white">
                  <Avvvatars value={isWorkspaceView && task.authorEmail ? task.authorEmail : (userEmail || 'guest')} size={18} style="character" />
                </div>
              )}
            </div>
          </div> 

          {/* 1.1 SUBTAREFAS EXPANDIDAS (Dentro do corpo do card) */}
          <AnimatePresence>
            {isSubtasksExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-2 pb-1 space-y-1.5 border-t border-[#e9e9e7]/60 mt-2">
                  <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[10px] font-bold text-[#37352f]/30 uppercase tracking-widest">Subtarefas</span>
                        <motion.span 
                          animate={task.subtasks?.every(s => s.completed) ? { scale: [1, 1.15, 1], transition: { duration: 0.4 } } : {}}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-all duration-500 ${task.subtasks?.every(s => s.completed) ? 'text-[#2b8a3e] bg-[#e7f5e9] ring-1 ring-[#2b8a3e]/20 shadow-sm' : 'text-white bg-[#1a1a1a]'}`}
                        >
                          {task.subtasks?.filter(s => s.completed).length}/{task.subtasks?.length}
                        </motion.span>
                  </div>
                  <div className="space-y-1">
                    {task.subtasks?.map((subtask) => (
                      <motion.div
                        key={subtask.id}
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleSubtask?.(task.id, subtask.id)
                        }}
                        className="flex items-center gap-2.5 group/sub cursor-pointer p-2 hover:bg-[#f7f7f5] rounded-xl transition-all border border-transparent hover:border-[#e9e9e7]/40"
                      >
                        <div className={`transition-all duration-200 flex-shrink-0 ${subtask.completed ? 'text-[#1a1a1a] scale-110' : 'text-[#37352f]/20 group-hover/sub:text-[#37352f]/40'}`}>
                          {subtask.completed ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <Circle size={16} strokeWidth={2} />}
                        </div>
                        <span className={`text-[11px] font-semibold transition-all line-clamp-2 ${subtask.completed ? 'text-[#37352f]/30 line-through font-medium' : 'text-[#37352f]'}`}>
                          {subtask.title}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 2. TAGS DE META INFO + Timer/Subtarefas (estrutura vertical quando timer ativo) */}
        {!isPlaceholder && (
          <div className={`flex flex-col items-center -mt-[1px] relative z-0 ${isOverlay ? 'scale-[1.02] rotate-2' : ''}`}>

            {/* 2A. LINHA 1: Priority | Timer (ou Subtarefas se timer inativo) | Date */}
            <motion.div
              layout
              className={`flex items-start justify-center px-4 relative gap-2 transition-opacity duration-200 w-full ${isOverlay ? 'opacity-100' : 'opacity-100'}`}
            >
              {/* Prioridade Esquerda */}
              <div
                className={`border border-[#e9e9e7] border-t-0 rounded-b-xl rounded-t-none px-3 py-0.5 bg-white transition-all flex items-center justify-center h-[22px] ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}
              >
                <span className="text-[10px] font-bold tracking-tight text-[#37352f]">
                  {task.priority === 'high' ? 'Crítica' : task.priority === 'medium' ? 'Média' : 'Baixa'}
                </span>
              </div>

              {/* Centro: grupo vertical Timer+Subtarefas fundidos OU apenas Subtarefas */}
              <div className="flex items-start gap-2">
                {timerParts ? (
                  /* ── Timer ativo: timer + subtarefas como bloco único ── */
                  <div className="flex flex-col items-stretch">
                  <div
                    onPointerDown={startHold}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onPointerCancel={cancelHold}
                    onMouseDown={startHold}
                    onMouseUp={cancelHold}
                    onMouseLeave={cancelHold}
                    onTouchStart={startHold}
                    onTouchEnd={cancelHold}
                    onTouchCancel={cancelHold}
                    style={{ userSelect: 'none' }}
                    className={`border border-t-0 py-0.5 flex items-center justify-center transition-all flex-shrink-0 h-[22px] cursor-pointer select-none overflow-hidden
                      ${task.subtasks && task.subtasks.length > 0 ? 'rounded-none border-b-0' : 'rounded-b-xl'}
                      ${holdProgress > 0 ? 'border-red-300 bg-red-50 px-3' : 'border-[#e9e9e7] bg-white px-2 gap-0.5'}
                      ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}
                  >
                    {holdProgress > 0 ? (
                      <NumberFlow
                        value={Math.floor(holdProgress / 10)}
                        className="text-[13px] font-normal text-red-500 tabular-nums w-[18px] text-center"
                      />
                    ) : (
                      <>
                        {timerParts.h > 0 && (
                          <>
                            <NumberFlow
                              value={timerParts.h}
                              format={{ minimumIntegerDigits: 2 }}
                              className="text-[10px] font-semibold text-[#37352f] tabular-nums"
                            />
                            <span className="text-[10px] font-medium text-[#37352f]/40 mx-0.5">:</span>
                          </>
                        )}
                        <NumberFlow
                          value={timerParts.m}
                          format={{ minimumIntegerDigits: 2 }}
                          className="text-[10px] font-semibold text-[#37352f] tabular-nums"
                        />
                        <span className="text-[10px] font-medium text-[#37352f]/40 mx-0.5">:</span>
                        <NumberFlow
                          value={timerParts.s}
                          format={{ minimumIntegerDigits: 2 }}
                          className="text-[10px] font-semibold text-[#37352f] tabular-nums"
                        />
                      </>
                    )}
                  </div>

                    {/* Subtarefas coladas abaixo do timer — mesmo bloco, border-t-0, rounded-b-xl */}
                    {task.subtasks && task.subtasks.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsSubtasksExpanded(!isSubtasksExpanded)
                        }}
                        className={`border border-[#e9e9e7] border-t-0 rounded-b-xl rounded-t-none bg-white transition-all duration-500 overflow-hidden flex items-center px-2 py-1 gap-1.5 justify-center h-[22px] w-full
                          ${isSubtasksExpanded ? (task.subtasks.every(s => s.completed) ? 'ring-1 ring-green-500/30 border-green-500/40 bg-[#f4fcf4]' : 'ring-1 ring-black/10 border-black/20') : ''}
                          ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}
                      >
                        <div className="relative w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
                          <svg className="w-full h-full -rotate-90 transform">
                            <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1 1" className="text-[#37352f]/10" />
                            <motion.circle
                              initial={{ strokeDashoffset: 2 * Math.PI * 6 }}
                              animate={{ 
                                strokeDashoffset: 2 * Math.PI * 6 * (1 - (task.subtasks.filter(s => s.completed).length / task.subtasks.length)),
                                color: task.subtasks.every(s => s.completed) ? '#40c057' : '#1a1a1a'
                              }}
                              cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeDasharray={2 * Math.PI * 6} strokeLinecap="round" 
                              className="transition-colors duration-500"
                            />
                          </svg>
                        </div>
                        <div className="flex items-center gap-1">
                          <motion.span 
                            animate={task.subtasks.every(s => s.completed) ? { scale: [1, 1.2, 1] } : {}}
                            className={`text-[10px] font-bold tabular-nums tracking-tight transition-all duration-500 ${task.subtasks.every(s => s.completed) ? 'text-[#2b8a3e]' : isSubtasksExpanded ? 'text-[#1a1a1a]' : 'text-[#37352f]'}`}
                          >
                            {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                          </motion.span>
                          <ChevronUp size={10} className={`text-[#37352f]/30 transition-transform duration-300 ${isSubtasksExpanded ? 'rotate-0' : 'rotate-180'}`} />
                        </div>
                      </button>
                    )}
                  </div>
                ) : (
                  /* ── Timer inativo/expirado: subtarefas viram tag independente no lugar do timer ── */
                  task.subtasks && task.subtasks.length > 0 && (
                    <motion.button
                      layout
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsSubtasksExpanded(!isSubtasksExpanded)
                      }}
                      className={`border border-[#e9e9e7] border-t-0 rounded-b-xl rounded-t-none bg-white transition-all duration-500 overflow-hidden flex items-center px-2 py-1 gap-1.5 group-hover:border-[#d3d1d1] min-w-0 max-w-[120px] justify-center h-[22px] 
                        ${isSubtasksExpanded ? (task.subtasks.every(s => s.completed) ? 'ring-1 ring-green-500/30 border-green-500/40 bg-[#f4fcf4]' : 'ring-1 ring-black/10 border-black/20') : ''} 
                        ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}
                    >
                      <div className="relative w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90 transform">
                          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1 1" className="text-[#37352f]/10" />
                          <motion.circle
                            initial={{ strokeDashoffset: 2 * Math.PI * 6 }}
                            animate={{ 
                              strokeDashoffset: 2 * Math.PI * 6 * (1 - (task.subtasks.filter(s => s.completed).length / task.subtasks.length)),
                              color: task.subtasks.every(s => s.completed) ? '#40c057' : '#1a1a1a'
                            }}
                            cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeDasharray={2 * Math.PI * 6} strokeLinecap="round" 
                            className="transition-colors duration-500"
                          />
                        </svg>
                      </div>
                      <div className="flex items-center gap-1">
                        <motion.span 
                          animate={task.subtasks.every(s => s.completed) ? { scale: [1, 1.2, 1] } : {}}
                          className={`text-[10px] font-bold tabular-nums tracking-tight transition-all duration-500 ${task.subtasks.every(s => s.completed) ? 'text-[#2b8a3e]' : isSubtasksExpanded ? 'text-[#1a1a1a]' : 'text-[#37352f]'}`}
                        >
                          {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                        </motion.span>
                        <ChevronUp size={10} className={`text-[#37352f]/30 transition-transform duration-300 ${isSubtasksExpanded ? 'rotate-0' : 'rotate-180'}`} />
                      </div>
                    </motion.button>
                  )
                )}

                {/* Badge "faltam X dias" */}
                {(() => {
                  const days = getDaysUntilDue(task.dueDate)
                  if (days === null || task.status === 'done' || task.status === 'canceled') return null
                  if (days > 7 || days <= 0) return null
                  const label = days === 1 ? 'Amanhã' : `faltam ${days}d`
                  const color = days === 1
                      ? 'border-orange-300 bg-orange-50 text-orange-600'
                      : days <= 3
                        ? 'border-amber-300 bg-amber-50 text-amber-600'
                        : 'border-yellow-200 bg-yellow-50 text-yellow-600'
                  return (
                    <div className={`border border-t-0 rounded-b-xl rounded-t-none px-2 py-0.5 flex items-center h-[22px] flex-shrink-0 ${color} ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}>
                      <span className="text-[10px] font-bold tracking-tight whitespace-nowrap">{label}</span>
                    </div>
                  )
                })()}

                {!timerParts && (!task.subtasks || task.subtasks.length === 0) && getDaysUntilDue(task.dueDate) === null && <div className="w-1" />}
              </div>

              {/* Data Direita */}
              <div
                className={`border border-[#e9e9e7] border-t-0 rounded-b-xl rounded-t-none px-1 py-1 bg-white transition-all flex-shrink-0 w-[76px] flex items-center justify-center h-[22px] ${isOverlay ? 'shadow-lg shadow-black/5' : ''}`}
              >
                <span className="text-[9px] font-bold text-[#37352f]/60 tracking-tight truncate block text-center whitespace-nowrap">
                  {formatDate(task.dueDate)}
                </span>
              </div>
            </motion.div>

          </div>
        )}
      </motion.div>
    </div>
  )
})

const SortableTaskCard: React.FC<{
  task: Task
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  activeDropdownId: string | null
  setActiveDropdownId: (id: string | null) => void
  userEmail?: string
  isPending?: boolean
  pendingTarget?: Task['status']
  onConfirm?: () => void
  onCancel?: () => void
  onToggleSubtask?: (taskId: string, subtaskId: string) => void
  onStopTimer?: (taskId: string) => void
  onCardClick?: (task: Task) => void
  isWorkspaceView?: boolean
}> = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id })

  // Usar translate invés de transform previne o achatamento e distorção durante o drag
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transition || undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={`relative w-full min-w-0 ${isDragging ? 'z-50' : props.activeDropdownId === props.task.id ? 'z-[60]' : 'z-10'}`}>
      <TaskCardUI
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        activeDropdownId={props.activeDropdownId}
        setActiveDropdownId={props.setActiveDropdownId}
        userEmail={props.userEmail}
        task={props.task}
        isPending={props.isPending}
        pendingTarget={props.pendingTarget}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
        onToggleSubtask={props.onToggleSubtask}
        onStopTimer={props.onStopTimer}
        onCardClick={props.onCardClick}
        isWorkspaceView={props.isWorkspaceView}
      />
    </div>
  )
}

const DroppableContainer: React.FC<{
  id: string
  children: React.ReactNode
  className?: string
  isOver?: boolean
}> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`${className} rounded-2xl transition-all duration-300 ease-in-out overflow-hidden shadow-inner ${isOver ? 'bg-[#f1f1ef] ring-2 ring-inset ring-[#e9e9e7]' : 'bg-[#f9f9f8]/50 border border-[#f1f1f0]'
        }`}
    >
      {children}
    </div>
  )
}

const Tasks: React.FC = () => {
  const { user } = useAuth()
  const { isWorkspaceMember, workspaceMembership, hasPulse } = useSubscription()
  const isAdmin = hasPulse && !isWorkspaceMember
  const isGuest = isWorkspaceMember && !hasPulse
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board')
  const [taskView, setTaskView] = useState<'personal' | 'workspace'>(isGuest ? 'workspace' : 'personal')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
  const [pendingStatusTask, setPendingStatusTask] = useState<{ id: string; originalStatus: Task['status']; targetStatus: Task['status'] } | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const dragOriginalStatus = useRef<{ id: string; status: Task['status'] } | null>(null)
  const justDraggedRef = useRef(false)

  // Determina se o usuário tem acesso ao workspace (membro ou dono Pulse)
  const hasWorkspaceAccess = isWorkspaceMember || hasPulse

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Uma distância curta deixa o arrasto mais imediato (rápido)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const mapDbTask = useCallback((dbTask: any): Task => ({
    id: dbTask.id,
    title: dbTask.title,
    status: dbTask.status,
    priority: dbTask.priority,
    dueDate: dbTask.due_date,
    source: dbTask.source || 'user',
    progress: dbTask.progress || 0,
    description: dbTask.description || '',
    subtasks: dbTask.subtasks || [],
    timerAt: dbTask.timer_at || undefined,
    timerFired: dbTask.timer_fired || false,
    whatsappMessage: dbTask.whatsapp_message || undefined,
    reminderDaysBefore: dbTask.reminder_days_before ?? undefined,
    reminderFired: dbTask.reminder_fired || false,
    visibility: dbTask.visibility || 'personal',
    workspaceOwnerId: dbTask.workspace_owner_id || undefined,
    authorName: dbTask.author?.name || undefined,
    authorAvatar: dbTask.author?.avatar || undefined,
    authorEmail: dbTask.author?.email || undefined,
  }), [])

  const fetchTasks = useCallback(async (view?: 'personal' | 'workspace') => {
    const currentView = view ?? taskView
    try {
      setLoading(true)

      if (currentView === 'workspace') {
        // Busca tarefas compartilhadas via API (owner ou membro)
        const result = await apiFetch<{ tasks: any[]; workspaceOwnerId: string | null }>(
          `/api/workspace/shared-tasks`,
          undefined,
          { userId: user?.id }
        )
        const mappedTasks = (result.tasks || []).map(mapDbTask)
        setTasks(mappedTasks)
      } else {
        // Busca tarefas pessoais do usuário
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user?.id)
          .eq('visibility', 'personal')
          .order('created_at', { ascending: false })

        if (error) throw error

        const mappedTasks = (data || []).map(mapDbTask)
        setTasks(mappedTasks)
      }
    } catch (error) {
      console.error('Erro ao buscar tarefas:', error)
    } finally {
      setLoading(false)
    }
  }, [mapDbTask, user, taskView])

  // Recarrega quando muda de view
  useEffect(() => {
    fetchTasks(taskView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskView])

  useEffect(() => {
    fetchTasks()

    const channel = supabase
      .channel('tasks-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tasks' },
        (payload) => {
          const newTask = mapDbTask(payload.new)
          // Só adiciona se for da view atual
          const isPersonalView = taskView === 'personal'
          const taskIsPersonal = !newTask.visibility || newTask.visibility === 'personal'
          const taskIsWorkspace = newTask.visibility === 'workspace'
          if (isPersonalView && taskIsPersonal && payload.new.user_id === user?.id) {
            setTasks(prev => {
              if (prev.some(t => t.id === newTask.id)) return prev
              return [newTask, ...prev]
            })
          } else if (!isPersonalView && taskIsWorkspace) {
            setTasks(prev => {
              if (prev.some(t => t.id === newTask.id)) return prev
              return [newTask, ...prev]
            })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks' },
        (payload) => {
          const updatedTask = mapDbTask(payload.new)
          setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'tasks' },
        (payload) => {
          const deletedId = (payload.old as any).id
          setTasks(prev => prev.filter(t => t.id !== deletedId))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchTasks, mapDbTask])

  const columns = [
    { id: 'todo' as const, title: 'A Fazer', color: 'bg-slate-400' },
    { id: 'doing' as const, title: 'Em Progresso', color: 'bg-[#2383e2]' },
    { id: 'done' as const, title: 'Concluído', color: 'bg-[#6366f1]' },
    { id: 'canceled' as const, title: 'Cancelado', color: 'bg-red-200' },
  ]

  const tabs = [
    { id: 'board', label: 'Quadro', icon: Layout },
    { id: 'table', label: 'Tabela', icon: TableIcon, disabled: true },
  ]

  const handleAddTask = async (newTask: any) => {
    try {
      const isWorkspaceTask = newTask.visibility === 'workspace'

      if (editingTask) {
        const { error } = await supabase
          .from('tasks')
          .update({
            title: newTask.title,
            status: newTask.status,
            priority: newTask.priority,
            due_date: (newTask.dueDate && newTask.dueDate !== 'Sem prazo') ? newTask.dueDate : null,
            source: newTask.source,
            progress: newTask.progress,
            description: newTask.description,
            subtasks: newTask.subtasks,
            visibility: newTask.visibility || 'personal',
          })
          .eq('id', editingTask.id)

        if (error) throw error
        setTasks(tasks.map(t => t.id === editingTask.id ? { ...t, ...newTask } : t))
      } else if (isWorkspaceTask) {
        // Cria tarefa workspace via API (garante workspace_owner_id correto)
        const result = await apiFetch<{ task: any }>('/api/workspace/shared-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user?.id, task: newTask }),
        })
        if (result.task) {
          const newTaskWithId = { ...mapDbTask(result.task), authorName: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0], authorEmail: user?.email }
          setTasks([newTaskWithId, ...tasks])
        }
      } else {
        const { id, ...taskData } = newTask
        const { data, error } = await supabase
          .from('tasks')
          .insert([{
            user_id: user?.id,
            title: taskData.title, status: taskData.status, priority: taskData.priority,
            due_date: (taskData.dueDate && taskData.dueDate !== 'Sem prazo') ? taskData.dueDate : null, source: taskData.source, progress: taskData.progress,
            description: taskData.description, subtasks: taskData.subtasks,
            visibility: 'personal',
          }]).select()

        if (error) throw error
        if (data && data[0]) {
          const newTaskWithId = { ...newTask, id: data[0].id, visibility: 'personal' }
          setTasks([newTaskWithId, ...tasks])
        }
      }
      setIsModalOpen(false)
      setEditingTask(null)
    } catch (error) {
      console.error('Erro:', error)
      alert('Erro ao processar tarefa.')
    }
  }

  const handleDeleteTask = (id: string) => {
    setTaskToDelete(id)
    setActiveDropdownId(null)
  }

  const executeDelete = async () => {
    if (!taskToDelete) return
    const id = taskToDelete
    setTaskToDelete(null)

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
      setTasks(tasks.filter(t => t.id !== id))
    } catch (error) {
      console.error('Erro ao excluir:', error)
      alert('Erro ao excluir tarefa.')
    }
  }

  const openEditModal = (task: Task) => {
    setEditingTask(task)
    setIsModalOpen(true)
    setActiveDropdownId(null)
  }

  const openCreateModal = () => {
    setEditingTask(null)
    setIsModalOpen(true)
  }

  const handleCardClick = (task: Task) => {
    if (justDraggedRef.current) return
    setDetailTask(task)
  }

  const handleDragStart = (event: DragStartEvent) => {
    justDraggedRef.current = true
    const id = event.active.id as string
    setActiveId(id)
    setActiveDropdownId(null)
    const task = tasks.find(t => t.id === id)
    if (task) {
      dragOriginalStatus.current = { id: task.id, status: task.status }
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    const activeTask = tasks.find(t => t.id === activeId)
    const overTask = tasks.find(t => t.id === overId)

    const overContainer = overTask ? overTask.status : (overId as Task['status'])
    const activeContainer = activeTask ? activeTask.status : null

    const validStatuses = ['todo', 'doing', 'done', 'canceled']
    if (!validStatuses.includes(overContainer)) return

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return
    }

    setTasks((prev) => {
      const activeIndex = prev.findIndex((t) => t.id === activeId)
      if (activeIndex === -1) return prev

      const updatedTasks = [...prev]
      updatedTasks[activeIndex] = { ...updatedTasks[activeIndex], status: overContainer }
      return updatedTasks
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setTimeout(() => { justDraggedRef.current = false }, 50)

    const orig = dragOriginalStatus.current
    dragOriginalStatus.current = null

    if (!over) {
      if (orig) {
        setTasks(prev => prev.map(t => t.id === orig.id ? { ...t, status: orig.status } : t))
      }
      return
    }

    const activeId = active.id as string
    const overId = over.id as string

    // containerId vem do SortableContext quando o over é um item; caso contrário over.id é a coluna
    const overContainerId = (over.data.current?.sortable?.containerId ?? overId) as string
    const isValidColumn = columns.some(c => c.id === overContainerId)
    const overContainer = isValidColumn ? (overContainerId as Task['status']) : undefined

    if (!overContainer || !orig) {
      // fallback: sem info suficiente, apenas reordena localmente
      if (activeId !== overId) {
        setTasks(items => {
          const oldIndex = items.findIndex(t => t.id === activeId)
          const newIndex = items.findIndex(t => t.id === overId)
          if (oldIndex !== -1 && newIndex !== -1) return arrayMove(items, oldIndex, newIndex)
          return items
        })
      }
      return
    }

    if (orig.status !== overContainer) {
      // Pede confirmação no próprio card antes de persistir para QUALQUER mudança de status
      setPendingStatusTask({ id: activeId, originalStatus: orig.status, targetStatus: overContainer })
      if (activeId !== overId) {
        setTasks(items => {
          const oldIndex = items.findIndex(t => t.id === activeId)
          const newIndex = items.findIndex(t => t.id === overId)
          if (oldIndex !== -1 && newIndex !== -1) return arrayMove(items, oldIndex, newIndex)
          return items
        })
      }
      return
    }

    // Outros status: persiste imediatamente
    if (orig.status !== overContainer) {
      supabase
        .from('tasks')
        .update({ status: overContainer })
        .eq('id', activeId)
        .then(({ error }) => {
          if (error) {
            console.error('Erro ao atualizar status:', error)
            fetchTasks()
          }
        })
    }

    if (activeId !== overId) {
      setTasks(items => {
        const oldIndex = items.findIndex(t => t.id === activeId)
        const newIndex = items.findIndex(t => t.id === overId)
        if (oldIndex !== -1 && newIndex !== -1) return arrayMove(items, oldIndex, newIndex)
        return items
      })
    }
  }

  const confirmStatusChange = () => {
    if (!pendingStatusTask) return
    const { id, targetStatus } = pendingStatusTask
    setPendingStatusTask(null)
    const updates: Record<string, unknown> = { status: targetStatus }
    if (targetStatus === 'done' || targetStatus === 'canceled') {
      updates.timer_fired = true
    }
    supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .then(({ error }) => {
        if (error) {
          console.error('Erro ao atualizar status:', error)
          fetchTasks()
        }
      })
  }

  const cancelStatusChange = () => {
    if (!pendingStatusTask) return
    const { id, originalStatus } = pendingStatusTask
    setPendingStatusTask(null)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: originalStatus } : t))
  }

  const handleStopTimer = async (taskId: string) => {
    // Atualiza local imediatamente
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, timerFired: true } : t))
    // Persiste no banco
    await supabase
      .from('tasks')
      .update({ timer_fired: true })
      .eq('id', taskId)
  }

  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.subtasks) return

    const updatedSubtasks = task.subtasks.map(s =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    )

    const totalSubtasks = updatedSubtasks.length
    const completedSubtasks = updatedSubtasks.filter(s => s.completed).length
    const progress = Math.round((completedSubtasks / totalSubtasks) * 100)

    // Update local state immediately for snappy feel
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, subtasks: updatedSubtasks, progress } : t
    ))

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          subtasks: updatedSubtasks,
          progress: progress
        })
        .eq('id', taskId)

      if (error) throw error
    } catch (error) {
      console.error('Erro ao atualizar subtarefa:', error)
      // Revert on error
      fetchTasks()
    }
  }

  // Configuração sutil do drop (encaixe rápido e limpo ao soltar)
  const dropAnimationConfig = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.4',
        },
      },
    }),
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-10 pt-4 sm:pt-6 bg-white sticky top-0 z-10">
        <div className="max-w-full mx-auto w-full">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight mb-0.5 sm:mb-1">Tarefas</h1>
              <p className="text-xs sm:text-sm text-[#37352f]/50 font-medium truncate">
                {taskView === 'workspace'
                  ? (isWorkspaceMember ? `Workspace de ${workspaceMembership?.ownerName || 'Equipe'}` : 'Tarefas do seu workspace')
                  : 'Veja e organize seu fluxo de trabalho.'}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {!loading && tasks.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={openCreateModal}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 bg-[#202020] text-white rounded-[6px] text-[11px] sm:text-xs font-semibold hover:bg-[#202020]/90 transition-all shadow-md shadow-black/10 h-[34px] sm:h-[38px]"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  <span className="hidden sm:inline">Novo Item</span>
                  <span className="sm:hidden">Novo</span>
                </motion.button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 sm:gap-6">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => !tab.disabled && setViewMode(tab.id as any)}
                  disabled={tab.disabled}
                  className={`flex items-center gap-1.5 sm:gap-2 pb-3 text-xs sm:text-sm font-semibold transition-all relative ${viewMode === tab.id
                    ? 'text-[#37352f]'
                    : tab.disabled ? 'text-[#37352f]/20 cursor-not-allowed' : 'text-[#37352f]/40 hover:text-[#37352f]/60'
                    }`}
                >
                  <tab.icon size={16} strokeWidth={viewMode === tab.id ? 2.5 : 2} />
                  {tab.label}
                  {tab.disabled && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#f1f1ef] text-[#37352f]/40 text-[9px] font-bold tracking-wider">
                      Em breve
                    </span>
                  )}
                  {viewMode === tab.id && (
                    <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#37352f]" />
                  )}
                </button>
              ))}
            </div>

            {/* Toggle pessoal / workspace — somente para admin (dono), convidados ficam fixos em workspace */}
            {hasWorkspaceAccess && isAdmin && (
              <div className="flex items-center gap-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-lg p-0.5 mb-3">
                <button
                  onClick={() => setTaskView('personal')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                    taskView === 'personal'
                      ? 'bg-white text-[#37352f] shadow-sm border border-[#e9e9e7]'
                      : 'text-[#37352f]/40 hover:text-[#37352f]/70'
                  }`}
                >
                  <Lock size={11} strokeWidth={2.5} />
                  <span className="hidden sm:inline">Pessoal</span>
                </button>
                <button
                  onClick={() => setTaskView('workspace')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                    taskView === 'workspace'
                      ? 'bg-white text-[#37352f] shadow-sm border border-[#e9e9e7]'
                      : 'text-[#37352f]/40 hover:text-[#37352f]/70'
                  }`}
                >
                  <Users size={11} strokeWidth={2.5} />
                  <span className="hidden sm:inline">Workspace</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-white">
        {loading ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 opacity-40">
            <Loader2 className="animate-spin text-[#37352f]" size={24} />
            <p className="text-xs font-semibold">Carregando tarefas...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-8 sm:p-20 text-center bg-white">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md"
            >
              <motion.img
                src={swingingDoodle}
                alt="Nenhuma tarefa"
                className="w-28 sm:w-40 h-auto mx-auto mb-4 sm:mb-6 opacity-80"
              />
              <h2 className="text-lg sm:text-xl font-bold text-[#37352f] mb-2 sm:mb-3">
                {taskView === 'workspace' ? 'Nenhuma tarefa compartilhada!' : 'Tudo limpo por aqui!'}
              </h2>
              <p className="text-[#37352f]/50 text-xs sm:text-sm mb-6 sm:mb-10 leading-relaxed font-medium">
                {taskView === 'workspace'
                  ? 'Nenhuma tarefa foi compartilhada no workspace ainda. Crie uma tarefa e defina a visibilidade como Workspace para que todos vejam.'
                  : 'Você ainda não tem nenhuma tarefa cadastrada. Organize seu trabalho e acompanhe seu progresso criando sua primeira tarefa agora.'}
              </p>
              <motion.button
                onClick={openCreateModal}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 sm:gap-3 px-5 sm:px-8 py-3 bg-[#202020] text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-black/10 hover:bg-[#303030] transition-all"
              >
                <Plus size={18} strokeWidth={2.5} />
                Criar Primeira Tarefa
              </motion.button>
            </motion.div>
          </div>
        ) : (
          <>
            {viewMode === 'board' && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div className="p-4 sm:p-6 lg:p-10 flex flex-col md:flex-row gap-6 md:h-full md:min-w-max md:items-stretch">
                  {columns.map((column) => {
                    const columnTasks = tasks.filter(t => t.status === column.id)
                    return (
                      <div key={column.id} className="w-full md:w-72 lg:w-[320px] flex-shrink-0 flex flex-col min-w-0">
                        <div className="flex items-center justify-between px-1 mb-3 sm:mb-4">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2 h-2 rounded-full ${column.color}`}></span>
                            <h3 className="text-xs sm:text-sm font-bold text-[#37352f]/80 tracking-wider">{column.title}</h3>
                            <span className="text-[10px] sm:text-[11px] font-bold text-[#37352f]/30 bg-[#000000]/5 px-1.5 py-0.5 rounded">
                              {columnTasks.length}
                            </span>
                          </div>
                        </div>

                        <SortableContext id={column.id} items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                          <DroppableContainer id={column.id} className="flex-1 flex flex-col min-h-[120px] md:min-h-0 overflow-y-auto hide-scrollbar p-4">
                            <div className="flex-1 flex flex-col space-y-3 pb-4 sm:pb-6">
                              {columnTasks.map((task) => (
                                <SortableTaskCard
                                  key={task.id}
                                  task={task}
                                  onEdit={openEditModal}
                                  onDelete={handleDeleteTask}
                                  activeDropdownId={activeDropdownId}
                                  setActiveDropdownId={setActiveDropdownId}
                                  userEmail={user?.email}
                                  isPending={pendingStatusTask?.id === task.id}
                                  pendingTarget={pendingStatusTask?.targetStatus}
                                  onConfirm={confirmStatusChange}
                                  onCancel={cancelStatusChange}
                                  onToggleSubtask={handleToggleSubtask}
                                  onStopTimer={handleStopTimer}
                                  onCardClick={handleCardClick}
                                  isWorkspaceView={taskView === 'workspace'}
                                />
                              ))}
                            </div>

                            <button onClick={openCreateModal} className="w-full py-2 sm:py-2.5 px-3 rounded-lg flex items-center gap-2 text-[#37352f]/30 hover:text-[#37352f]/60 hover:bg-[#f7f7f5] transition-all group/btn mt-auto">
                              <Plus size={14} className="group-hover/btn:scale-110 transition-transform" />
                              <span className="text-xs font-bold uppercase tracking-tight">Novo</span>
                            </button>
                          </DroppableContainer>
                        </SortableContext>
                      </div>
                    )
                  })}
                </div>

                <DragOverlay dropAnimation={dropAnimationConfig}>
                  {activeTask ? (
                    <TaskCardUI
                      task={activeTask}
                      isOverlay={true}
                      isDragging={true}
                      onEdit={() => { }}
                      onDelete={() => { }}
                      activeDropdownId={null}
                      setActiveDropdownId={() => { }}
                      userEmail={user?.email}
                      style={{ cursor: 'grabbing' }}
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}

            {viewMode === 'table' && (
              <div className="p-4 sm:p-6 lg:p-10 max-w-full space-y-8 sm:space-y-12 pb-20">
                {columns.map((column) => {
                  const columnTasks = tasks.filter(t => t.status === column.id)
                  if (columnTasks.length === 0) return null

                  return (
                    <div key={column.id} className="space-y-3 sm:space-y-4">
                      <div className="flex items-center gap-3 px-1">
                        <span className={`w-2 h-2 rounded-full ${column.color}`}></span>
                        <h3 className="text-xs font-bold text-[#37352f]/80 tracking-widest">{column.title}</h3>
                      </div>

                      <div className="hidden md:block border border-[#e9e9e7] rounded-xl overflow-hidden shadow-sm bg-white">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                              <tr className="bg-[#f7f7f5]/50 border-b border-[#e9e9e7]">
                                <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 tracking-widest border-r border-[#e9e9e7]">Tarefa</th>

                                <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 tracking-widest border-r border-[#e9e9e7]">Prioridade</th>
                                <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 tracking-widest text-right w-32">Prazo</th>
                                <th className="py-3 px-2 text-[9px] font-bold text-[#37352f]/30 tracking-widest text-center w-10">...</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f1f1f0]">
                              {columnTasks.map((task) => (
                                <tr key={task.id} className="group hover:bg-[#fcfcfa] transition-colors relative">
                                  <td className="py-4 px-5 border-r border-[#f1f1f0]">
                                    <span className="text-sm font-semibold text-[#37352f] line-clamp-1">{task.title}</span>
                                  </td>

                                  <td className="py-4 px-5 border-r border-[#f1f1f0]">
                                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${getPriorityColor(task.priority)}`}>
                                      {task.priority === 'high' ? 'Crítica' : task.priority === 'medium' ? 'Normal' : 'Baixa'}
                                    </span>
                                  </td>
                                  <td className="py-4 px-5 text-right border-r border-[#f1f1f0]">
                                    <span className="text-[11px] font-extrabold text-[#37352f]/40 bg-[#f7f7f5] px-2 py-1 rounded-sm border border-[#e9e9e7]">
                                      {formatDate(task.dueDate)}
                                    </span>
                                  </td>
                                  <td className="py-4 px-2 text-center relative">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setActiveDropdownId(activeDropdownId === task.id ? null : task.id)
                                      }}
                                      className="p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>

                                    <Dropdown
                                      isOpen={activeDropdownId === task.id}
                                      onClose={() => setActiveDropdownId(null)}
                                      className="w-[110px]"
                                    >
                                      <DropdownItem
                                        icon={<Edit2 size={12} />}
                                        label="Editar"
                                        onClick={() => openEditModal(task)}
                                      />
                                      <DropdownDivider />
                                      <DropdownItem
                                        icon={<Trash2 size={12} />}
                                        label="Excluir"
                                        variant="danger"
                                        onClick={() => handleDeleteTask(task.id)}
                                      />
                                    </Dropdown>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingTask(null); }} title={editingTask ? 'Editar Tarefa' : 'Nova Tarefa'} hideScrollbar={true}>
        <TaskForm
          initialData={editingTask}
          onSubmit={handleAddTask}
          onCancel={() => { setIsModalOpen(false); setEditingTask(null); }}
          isEditing={!!editingTask}
          hasWorkspaceAccess={isAdmin ? hasWorkspaceAccess : false}
          defaultVisibility={isGuest ? 'workspace' : (taskView === 'workspace' ? 'workspace' : 'personal')}
          workspaceName={isWorkspaceMember ? (workspaceMembership?.ownerName || 'Workspace') : undefined}
        />
      </Modal>

      <DeleteConfirmation isOpen={!!taskToDelete} onConfirm={executeDelete} onCancel={() => setTaskToDelete(null)} />

      <TaskDetailModal
        task={detailTask ? tasks.find(t => t.id === detailTask.id) || detailTask : null}
        isOpen={!!detailTask}
        onClose={() => setDetailTask(null)}
        onToggleSubtask={handleToggleSubtask}
        onStopTimer={handleStopTimer}
        onEdit={(task) => { setDetailTask(null); setTimeout(() => openEditModal(task), 250) }}
      />
    </>
  )
}

export default Tasks