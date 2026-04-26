import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Circle, CheckCircle2, X, Plus, Clock, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import Avvvatars from 'avvvatars-react'
import Modal from '../components/ui/Modal'
import TaskForm from '../components/TaskForm'
import { Loading } from '../components/ui/Loading'
import finlozLogo from '../assets/logo/lui.svg'
import { syncTaskWithGoogleCalendar } from '../lib/googleCalendar'

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
  assignedToId?: string
  assignedToName?: string
  assignedToAvatar?: string
  assignedToEmail?: string
  dueTime?: string
}

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]
const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DAYS_PT_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const STATUS_CONFIG = {
  todo:     { label: 'A Fazer',      dot: 'bg-slate-400',  bar: 'bg-slate-100 border-slate-200',  text: 'text-slate-600' },
  doing:    { label: 'Em Progresso', dot: 'bg-[#2383e2]',  bar: 'bg-blue-50 border-blue-200',    text: 'text-blue-700'  },
  done:     { label: 'Concluído',    dot: 'bg-emerald-500', bar: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700'},
  canceled: { label: 'Cancelado',    dot: 'bg-red-300',    bar: 'bg-red-50 border-red-200',       text: 'text-red-500'   },
}

function toDateKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function todayKey() {
  const t = new Date()
  return toDateKey(t.getFullYear(), t.getMonth(), t.getDate())
}

export default function CalendarPage() {
  const { user } = useAuth()
  const { workspaceModeActive, hasPulse, isWorkspaceMember } = useSubscription()
  const hasWorkspaceAccess = hasPulse || isWorkspaceMember
  const isWorkspaceView = workspaceModeActive || hasPulse
  const userEmail = user?.email
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [newTaskDate, setNewTaskDate] = useState<string | null>(null)

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
    dueTime: dbTask.due_time || undefined,
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
    assignedToId: dbTask.assigned_to || dbTask.assignee?.id || undefined,
    assignedToName: dbTask.assignee?.name || undefined,
    assignedToAvatar: dbTask.assignee?.avatar || undefined,
    assignedToEmail: dbTask.assignee?.email || undefined,
  }), [])

  const fetchTasks = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)

      // Busca tarefas pessoais sempre
      const { data: personalData, error: personalError } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .eq('visibility', 'personal')
        .order('created_at', { ascending: false })
      if (personalError) throw personalError
      const personalTasks = (personalData || []).map(mapDbTask)

      // Se tem acesso ao workspace, busca também as tarefas compartilhadas
      if (hasWorkspaceAccess) {
        try {
          const result = await apiFetch<{ tasks: any[]; workspaceOwnerId: string | null }>(
            `/api/workspace/shared-tasks`,
            undefined,
            { userId: user.id }
          )
          const workspaceTasks = (result.tasks || []).map(mapDbTask)
          // Combina sem duplicatas (workspace tasks sobrepõe pela id)
          const seen = new Set<string>()
          const combined: Task[] = []
          for (const t of [...workspaceTasks, ...personalTasks]) {
            if (!seen.has(t.id)) { seen.add(t.id); combined.push(t) }
          }
          setTasks(combined)
        } catch {
          setTasks(personalTasks)
        }
      } else {
        setTasks(personalTasks)
      }
    } catch (err) {
      console.error('Erro ao buscar tarefas:', err)
    } finally {
      setLoading(false)
    }
  }, [user, mapDbTask, hasWorkspaceAccess])

  useEffect(() => {
    fetchTasks()
    const channel = supabase
      .channel('calendar-tasks-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
        const t = mapDbTask(payload.new)
        setTasks(prev => prev.some(x => x.id === t.id) ? prev : [t, ...prev])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, (payload) => {
        const t = mapDbTask(payload.new)
        setTasks(prev => prev.map(x => x.id === t.id ? t : x))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (payload) => {
        const id = (payload.old as any).id
        setTasks(prev => prev.filter(x => x.id !== id))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTasks, mapDbTask])

  // Calcular dias do calendário
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const calendarDays: { day: number; month: 'prev' | 'current' | 'next'; key: string }[] = []

  // Dias do mês anterior
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const prevMonth = month === 0 ? 11 : month - 1
    const prevYear = month === 0 ? year - 1 : year
    calendarDays.push({ day: d, month: 'prev', key: toDateKey(prevYear, prevMonth, d) })
  }
  // Dias do mês atual
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push({ day: d, month: 'current', key: toDateKey(year, month, d) })
  }
  // Dias do próximo mês
  const remaining = 42 - calendarDays.length
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 0 : month + 1
    const nextYear = month === 11 ? year + 1 : year
    calendarDays.push({ day: d, month: 'next', key: toDateKey(nextYear, nextMonth, d) })
  }

  // Agrupar tarefas por data
  const tasksByDate: Record<string, Task[]> = {}
  for (const task of tasks) {
    if (!task.dueDate || task.dueDate === 'Sem prazo') continue
    if (!tasksByDate[task.dueDate]) tasksByDate[task.dueDate] = []
    tasksByDate[task.dueDate].push(task)
  }

  const today = todayKey()
  const selectedTasks = selectedDay ? (tasksByDate[selectedDay] || []) : []

  // Formatar data selecionada para exibição
  const formatSelectedDate = (key: string) => {
    if (!key) return ''
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const dayName = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][date.getDay()]
    return `${dayName}, ${d} de ${MONTHS_PT[m - 1]}`
  }

  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  const openNewTask = (dateKey?: string) => {
    setEditingTask(null)
    setNewTaskDate(dateKey || selectedDay || null)
    setIsModalOpen(true)
  }

  const handleAddTask = async (newTask: any) => {
    try {
      if (editingTask) {
        const { error } = await supabase
          .from('tasks')
          .update({
            title: newTask.title,
            status: newTask.status,
            priority: newTask.priority,
            due_date: newTask.dueDate,
            due_time: newTask.dueTime || null,
            source: newTask.source,
            progress: newTask.progress,
            description: newTask.description,
            subtasks: newTask.subtasks,
            ...(newTask.timerAt !== undefined ? { timer_at: newTask.timerAt, timer_fired: false } : {}),
          })
          .eq('id', editingTask.id)
        if (error) throw error
        setTasks(prev => prev.map(t => t.id === editingTask.id ? { ...t, ...newTask } : t))
        await syncTaskWithGoogleCalendar(editingTask.id, user?.id)
      } else {
        const { id: _id, ...taskData } = newTask
        const { data, error } = await supabase
          .from('tasks')
          .insert([{
            user_id: user?.id,
            title: taskData.title,
            status: taskData.status,
            priority: taskData.priority,
            due_date: taskData.dueDate,
            due_time: taskData.dueTime || null,
            source: taskData.source,
            progress: taskData.progress,
            description: taskData.description,
            subtasks: taskData.subtasks,
            timer_at: taskData.timerAt || null,
            timer_fired: false,
          }])
          .select()
        if (error) throw error
        if (data?.[0]) {
          setTasks(prev => [{ ...newTask, id: data[0].id }, ...prev])
          await syncTaskWithGoogleCalendar(data[0].id, user?.id)
        }
      }
      setIsModalOpen(false)
      setEditingTask(null)
      setNewTaskDate(null)
    } catch (err) {
      console.error('Erro ao salvar tarefa:', err)
    }
  }

  {/* openNewTask was moved up/refactored */}

  const openEditTask = (task: Task) => {
    setEditingTask(task)
    setNewTaskDate(null)
    setIsModalOpen(true)
  }

  // Contagem de tarefas do mês para mini-stats
  const monthTasks = tasks.filter(t => {
    if (!t.dueDate) return false
    const [y, m] = t.dueDate.split('-').map(Number)
    return y === year && m === month + 1
  })
  const stats = {
    total: monthTasks.length,
    done: monthTasks.filter(t => t.status === 'done').length,
    doing: monthTasks.filter(t => t.status === 'doing').length,
    todo: monthTasks.filter(t => t.status === 'todo').length,
    overdue: monthTasks.filter(t => {
      if (t.status === 'done' || t.status === 'canceled') return false
      const [y, m, d] = t.dueDate.split('-').map(Number)
      const due = new Date(y, m - 1, d)
      due.setHours(0, 0, 0, 0)
      const now = new Date(); now.setHours(0, 0, 0, 0)
      return due < now
    }).length,
  }

  const monthStats = stats

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-white relative">
      {/* Área principal do calendário */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-3 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-[#e9e9e7]">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            {/* Título + navegação */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex items-center gap-1 bg-[#f7f7f5] rounded-lg p-0.5 border border-[#e9e9e7] flex-shrink-0">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded-md hover:bg-white transition-colors text-[#37352f]/50 hover:text-[#37352f]"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={handleNextMonth}
                  className="p-1.5 rounded-md hover:bg-white transition-colors text-[#37352f]/50 hover:text-[#37352f]"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                <motion.h1
                  key={`${year}-${month}`}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="text-base sm:text-xl font-bold text-[#37352f] tracking-tight truncate"
                >
                  <span className="sm:hidden">{MONTHS_PT[month].slice(0, 3)}</span>
                  <span className="hidden sm:inline">{MONTHS_PT[month]}</span>{' '}
                  <span className="font-normal text-[#37352f]/40">{year}</span>
                </motion.h1>
              </AnimatePresence>

              <button
                onClick={handleToday}
                className="px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-semibold text-[#37352f]/60 hover:text-[#37352f] bg-[#f7f7f5] hover:bg-[#e9e9e7] border border-[#e9e9e7] rounded-lg transition-colors flex-shrink-0"
              >
                Hoje
              </button>
            </div>

            {/* Stats do mês + botão novo */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {!loading && monthStats.total > 0 && (
                <div className="hidden lg:flex items-center gap-2">
                  {monthStats.doing > 0 && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2383e2]" />
                      {monthStats.doing} em progresso
                    </span>
                  )}
                  {monthStats.overdue > 0 && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                      <Clock size={10} />
                      {monthStats.overdue} atrasada{monthStats.overdue > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-[11px] text-[#37352f]/40">
                    {monthStats.done}/{monthStats.total} concluída(s)
                  </span>
                </div>
              )}

              <button
                onClick={() => openNewTask()}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[#37352f] hover:bg-[#1a1a1a] text-white text-[11px] sm:text-xs font-semibold rounded-lg transition-colors"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Nova tarefa</span>
                <span className="sm:hidden">Nova</span>
              </button>
            </div>
          </div>
        </div>

        {/* Grade do calendário */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {/* Dias da semana */}
          <div className="grid grid-cols-7 border-b border-[#e9e9e7] bg-[#f7f7f5]/50 sticky top-0 z-10">
            {DAYS_PT.map((d, i) => (
              <div key={d} className="py-1.5 sm:py-2 text-center text-[10px] sm:text-[11px] font-semibold text-[#37352f]/40 tracking-wider uppercase">
                <span className="sm:hidden">{DAYS_PT_SHORT[i]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          {/* Células dos dias */}
          {loading ? (
            <Loading fullScreen={false} />
          ) : (
            <div className="grid grid-cols-7">
              {calendarDays.map(({ day, month: dm, key }) => {
                const isToday = key === today
                const isSelected = key === selectedDay
                const dayTasks = tasksByDate[key] || []
                const isCurrentMonth = dm === 'current'

                const MAX_VISIBLE = 3
                const visible = dayTasks.slice(0, MAX_VISIBLE)
                const overflow = dayTasks.length - MAX_VISIBLE

                return (
                  <motion.div
                    key={key}
                    onClick={() => {
                      setSelectedDay(key)
                      if (dm === 'prev') handlePrevMonth()
                      else if (dm === 'next') handleNextMonth()
                    }}
                    whileTap={{ scale: 0.98 }}
                    className={`min-h-[52px] sm:min-h-[96px] p-1 sm:p-1.5 border-b border-r border-[#e9e9e7] cursor-pointer transition-colors relative group
                      ${isSelected ? 'bg-[#37352f]/[0.04]' : 'hover:bg-[#f7f7f5]'}
                      ${!isCurrentMonth ? 'bg-[#fafaf9]' : ''}
                    `}
                  >
                    {/* Número do dia */}
                    <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                      <span
                        className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center text-[10px] sm:text-xs font-semibold rounded-full transition-colors
                          ${isToday ? 'bg-[#37352f] text-white' : ''}
                          ${isSelected && !isToday ? 'bg-[#37352f] text-white' : ''}
                          ${!isToday && !isSelected ? (isCurrentMonth ? 'text-[#37352f]' : 'text-[#37352f]/25') : ''}
                        `}
                      >
                        {day}
                      </span>
                      {/* Botão "+" ao hover */}
                      {isCurrentMonth && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedDay(key); openNewTask(key) }}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 hidden sm:flex items-center justify-center rounded text-[#37352f]/30 hover:text-[#37352f] hover:bg-[#e9e9e7] transition-all"
                        >
                          <Plus size={11} />
                        </button>
                      )}
                    </div>

                    {/* Tarefas do dia */}
                    {/* Tarefas do dia - Mobile: apenas dots, Desktop: nomes */}
                    <div className="space-y-0.5">
                      {/* Mobile: mostrar dots coloridos */}
                      <div className="flex flex-wrap gap-0.5 sm:hidden">
                        {dayTasks.slice(0, 4).map(task => {
                          const cfg = STATUS_CONFIG[task.status]
                          return (
                            <span key={task.id} className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          )
                        })}
                        {dayTasks.length > 4 && (
                          <span className="text-[8px] font-bold text-[#37352f]/30">+{dayTasks.length - 4}</span>
                        )}
                      </div>
                      {/* Desktop: mostrar nomes */}
                      <div className="hidden sm:block space-y-0.5">
                        {visible.map(task => {
                          const cfg = STATUS_CONFIG[task.status]
                          return (
                            <div
                              key={task.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedDay(key); openEditTask(task) }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border truncate cursor-pointer hover:opacity-80 transition-opacity ${cfg.bar} ${cfg.text}`}
                              title={task.title}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                              <span className="truncate">{task.title}</span>
                            </div>
                          )
                        })}
                        {overflow > 0 && (
                          <div className="px-1.5 text-[9px] font-semibold text-[#37352f]/40">
                            +{overflow} mais
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Painel lateral - tarefas do dia selecionado */}
      {/* Painel lateral - Desktop: sidebar fixa */}
      <AnimatePresence>
        {selectedDay && (
          <motion.div
            key="side-panel-desktop"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="hidden md:block flex-shrink-0 border-l border-[#e9e9e7] bg-[#f7f7f5] overflow-hidden"
          >
            <div className="w-[300px] h-full flex flex-col overflow-hidden">
              {/* Header do painel */}
              <div className="flex-shrink-0 px-4 pt-5 pb-3 border-b border-[#e9e9e7]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#37352f]/40 uppercase tracking-wider mb-0.5">
                      {selectedDay === today ? 'Hoje' : ''}
                    </p>
                    <h2 className="text-sm font-bold text-[#37352f] leading-snug">
                      {formatSelectedDate(selectedDay)}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1 rounded-md hover:bg-[#e9e9e7] text-[#37352f]/30 hover:text-[#37352f] transition-colors flex-shrink-0 mt-0.5"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Resumo do dia */}
                {selectedTasks.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {(['todo', 'doing', 'done', 'canceled'] as const).map(s => {
                      const count = selectedTasks.filter(t => t.status === s).length
                      if (!count) return null
                      return (
                        <span key={s} className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_CONFIG[s].bar} ${STATUS_CONFIG[s].text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[s].dot}`} />
                          {count}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Lista de tarefas */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                <AnimatePresence initial={false}>
                  {selectedTasks.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-10 text-center gap-2"
                    >
                      <CalendarIcon size={28} className="text-[#37352f]/15" />
                      <p className="text-xs text-[#37352f]/35 font-medium">Nenhuma tarefa</p>
                      <p className="text-[10px] text-[#37352f]/25">neste dia</p>
                    </motion.div>
                  ) : (
                    selectedTasks.map((task, i) => {
                      const isDone = task.status === 'done'
                      const isCanceled = task.status === 'canceled'

                      return (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ delay: i * 0.04 }}
                          onClick={() => openEditTask(task)}
                          className="bg-white border border-[#e9e9e7] rounded-xl p-3 cursor-pointer hover:border-[#d3d1d1] hover:shadow-sm transition-all group"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-shrink-0 mt-0.5">
                              {isDone ? (
                                <CheckCircle2 size={14} className="text-emerald-500" />
                              ) : isCanceled ? (
                                <X size={14} className="text-red-300" />
                              ) : (
                                <Circle size={14} className={task.status === 'doing' ? 'text-[#2383e2]' : 'text-slate-300'} />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug ${isDone || isCanceled ? 'line-through text-[#37352f]/35' : 'text-[#37352f]'}`}>
                                {task.title}
                              </p>
                              {task.description && (
                                <p className="text-[10px] text-[#37352f]/40 mt-0.5 line-clamp-2 leading-relaxed">
                                  {task.description}
                                </p>
                              )}

                              <div className="flex items-center justify-between mt-1.5">
                                {/* Workspace badge + info */}
                                <div className="flex items-center gap-1.5 opacity-50">
                                  {isWorkspaceView && task.visibility === 'workspace' && (
                                    <div className="flex items-center gap-1">
                                      <Users size={9} className="text-[#37352f]" />
                                      {task.authorName && task.authorEmail !== userEmail && (
                                        <span className="text-[9px] font-semibold text-[#37352f]/60 truncate max-w-[60px]">{task.authorName}</span>
                                      )}
                                    </div>
                                  )}
                                  {!isWorkspaceView && task.visibility === 'workspace' && (
                                    <Users size={9} className="text-[#37352f] opacity-40" />
                                  )}
                                  {task.dueTime && (
                                    <span className="text-[9px] font-bold text-[#37352f]/70 bg-[#37352f]/5 px-1 py-0.5 rounded flex items-center gap-0.5">
                                      <Clock size={8} />
                                      {task.dueTime.substring(0, 5)}
                                    </span>
                                  )}
                                  {task.priority === 'high' && (
                                    <span className="text-[9px] font-bold text-red-500 uppercase tracking-tighter">Crítica</span>
                                  )}
                                  {task.priority === 'medium' && (
                                    <span className="text-[9px] font-bold text-amber-500 uppercase tracking-tighter">Média</span>
                                  )}
                                  {task.subtasks && task.subtasks.length > 0 && (
                                    <span className="text-[9px] font-bold tracking-tight">
                                      {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                                    </span>
                                  )}
                                  {task.source === 'whatsapp' && (
                                    <div className="flex items-center gap-0.5 opacity-30 grayscale">
                                      <img src={finlozLogo} alt="Lui" className="w-2.5 h-2.5 object-contain" />
                                      <span className="text-[8px] font-bold text-[#37352f] tracking-wider uppercase">Lui</span>
                                    </div>
                                  )}
                                </div>

                                {/* Avatares: assignee + author */}
                                <div className="flex items-center gap-[-4px] flex-shrink-0">
                                  {task.assignedToId && (
                                    <div
                                      className="border-2 border-white rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white z-10"
                                      title={`Responsável: ${task.assignedToName || 'Membro'}`}
                                      style={{ width: 18, height: 18 }}
                                    >
                                      {task.assignedToAvatar
                                        ? <img src={task.assignedToAvatar} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display='none' }} />
                                        : <Avvvatars value={task.assignedToEmail || task.assignedToId} size={18} style="character" />
                                      }
                                    </div>
                                  )}
                                  {task.source === 'whatsapp' ? null : isWorkspaceView && task.authorAvatar ? (
                                    <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white" title={task.authorName} style={{ width: 18, height: 18 }}>
                                      <img src={task.authorAvatar} alt={task.authorName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                    </div>
                                  ) : (
                                    <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white" style={{ width: 18, height: 18 }}>
                                      <Avvvatars value={isWorkspaceView && task.authorEmail ? task.authorEmail : (userEmail || 'guest')} size={18} style="character" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })
                  )}
                </AnimatePresence>
              </div>

              {/* Botão adicionar tarefa para esse dia */}
              <div className="flex-shrink-0 p-3 border-t border-[#e9e9e7]">
                <button
                  onClick={() => openNewTask(selectedDay)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-[#37352f]/50 hover:text-[#37352f] hover:bg-white border border-dashed border-[#e9e9e7] hover:border-[#d3d1d1] transition-all"
                >
                  <Plus size={13} />
                  Adicionar tarefa neste dia
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel lateral - Mobile: bottom sheet overlay */}
      <AnimatePresence>
        {selectedDay && (
          <>
            {/* Backdrop mobile */}
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-[1px] z-50"
            />
            <motion.div
              key="side-panel-mobile"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#f7f7f5] rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col overflow-hidden"
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                <div className="w-8 h-1 bg-[#37352f]/10 rounded-full" />
              </div>

              {/* Header do painel */}
              <div className="flex-shrink-0 px-4 pt-2 pb-3 border-b border-[#e9e9e7]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#37352f]/40 uppercase tracking-wider mb-0.5">
                      {selectedDay === today ? 'Hoje' : ''}
                    </p>
                    <h2 className="text-sm font-bold text-[#37352f] leading-snug">
                      {formatSelectedDate(selectedDay)}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1.5 rounded-md hover:bg-[#e9e9e7] text-[#37352f]/30 hover:text-[#37352f] transition-colors flex-shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {selectedTasks.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {(['todo', 'doing', 'done', 'canceled'] as const).map(s => {
                      const count = selectedTasks.filter(t => t.status === s).length
                      if (!count) return null
                      return (
                        <span key={s} className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_CONFIG[s].bar} ${STATUS_CONFIG[s].text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[s].dot}`} />
                          {count}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Lista de tarefas */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <AnimatePresence initial={false}>
                  {selectedTasks.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-8 text-center gap-2"
                    >
                      <CalendarIcon size={28} className="text-[#37352f]/15" />
                      <p className="text-xs text-[#37352f]/35 font-medium">Nenhuma tarefa</p>
                      <p className="text-[10px] text-[#37352f]/25">neste dia</p>
                    </motion.div>
                  ) : (
                    selectedTasks.map((task, i) => {
                      const isDone = task.status === 'done'
                      const isCanceled = task.status === 'canceled'

                      return (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ delay: i * 0.04 }}
                          onClick={() => openEditTask(task)}
                          className="bg-white border border-[#e9e9e7] rounded-xl p-3 cursor-pointer hover:border-[#d3d1d1] hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-shrink-0 mt-0.5">
                              {isDone ? (
                                <CheckCircle2 size={14} className="text-emerald-500" />
                              ) : isCanceled ? (
                                <X size={14} className="text-red-300" />
                              ) : (
                                <Circle size={14} className={task.status === 'doing' ? 'text-[#2383e2]' : 'text-slate-300'} />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug ${isDone || isCanceled ? 'line-through text-[#37352f]/35' : 'text-[#37352f]'}`}>
                                {task.title}
                              </p>
                              {task.description && (
                                <p className="text-[10px] text-[#37352f]/40 mt-0.5 line-clamp-2 leading-relaxed">
                                  {task.description}
                                </p>
                              )}

                              <div className="flex items-center justify-between mt-1.5">
                                <div className="flex items-center gap-1.5 opacity-50">
                                  {isWorkspaceView && task.visibility === 'workspace' && (
                                    <div className="flex items-center gap-1">
                                      <Users size={9} className="text-[#37352f]" />
                                      {task.authorName && task.authorEmail !== userEmail && (
                                        <span className="text-[9px] font-semibold text-[#37352f]/60 truncate max-w-[60px]">{task.authorName}</span>
                                      )}
                                    </div>
                                  )}
                                  {!isWorkspaceView && task.visibility === 'workspace' && (
                                    <Users size={9} className="text-[#37352f] opacity-40" />
                                  )}
                                  {task.priority === 'high' && (
                                    <span className="text-[9px] font-bold text-red-500 uppercase tracking-tighter">Crítica</span>
                                  )}
                                  {task.priority === 'medium' && (
                                    <span className="text-[9px] font-bold text-amber-500 uppercase tracking-tighter">Média</span>
                                  )}
                                  {task.subtasks && task.subtasks.length > 0 && (
                                    <span className="text-[9px] font-bold tracking-tight">
                                      {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                                    </span>
                                  )}
                                  {task.source === 'whatsapp' && (
                                    <div className="flex items-center gap-0.5 opacity-30 grayscale">
                                      <img src={finlozLogo} alt="Lui" className="w-2.5 h-2.5 object-contain" />
                                      <span className="text-[8px] font-bold text-[#37352f] tracking-wider uppercase">Lui</span>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-[-4px] flex-shrink-0">
                                  {task.assignedToId && (
                                    <div
                                      className="border-2 border-white rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white z-10"
                                      title={`Responsável: ${task.assignedToName || 'Membro'}`}
                                      style={{ width: 18, height: 18 }}
                                    >
                                      {task.assignedToAvatar
                                        ? <img src={task.assignedToAvatar} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display='none' }} />
                                        : <Avvvatars value={task.assignedToEmail || task.assignedToId} size={18} style="character" />
                                      }
                                    </div>
                                  )}
                                  {task.source === 'whatsapp' ? null : isWorkspaceView && task.authorAvatar ? (
                                    <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white" title={task.authorName} style={{ width: 18, height: 18 }}>
                                      <img src={task.authorAvatar} alt={task.authorName} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                    </div>
                                  ) : (
                                    <div className="border border-[#e9e9e7]/60 rounded-full shadow-sm overflow-hidden flex items-center justify-center bg-white" style={{ width: 18, height: 18 }}>
                                      <Avvvatars value={isWorkspaceView && task.authorEmail ? task.authorEmail : (userEmail || 'guest')} size={18} style="character" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })
                  )}
                </AnimatePresence>
              </div>

              {/* Botão adicionar */}
              <div className="flex-shrink-0 p-3 pb-5 border-t border-[#e9e9e7]">
                <button
                  onClick={() => openNewTask(selectedDay)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold text-[#37352f]/50 hover:text-[#37352f] hover:bg-white border border-dashed border-[#e9e9e7] hover:border-[#d3d1d1] transition-all"
                >
                  <Plus size={13} />
                  Adicionar tarefa neste dia
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal de criação/edição */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setEditingTask(null); setNewTaskDate(null) }}
        title={editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}
        hideScrollbar={true}
      >
        <TaskForm
          onSubmit={handleAddTask}
          onCancel={() => { setIsModalOpen(false); setEditingTask(null); setNewTaskDate(null) }}
          initialData={editingTask || (newTaskDate ? { dueDate: newTaskDate } as any : undefined)}
          isEditing={!!editingTask}
        />
      </Modal>
    </div>
  )
}
