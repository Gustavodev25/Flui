import React, { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, CheckCircle2, Circle, Lock, Users, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Select from './ui/Select'
import DatePicker from './ui/DatePicker'
import TimePicker from './ui/TimePicker'
import { useAuth } from '../contexts/AuthContext'
import Avvvatars from 'avvvatars-react'
import { apiFetch } from '../lib/api'

interface WorkspaceMember {
  id: string
  member_user_id: string
  member_email: string
  member_name: string | null
  member_avatar: string | null
  role: string
}

interface TaskFormProps {
  initialData?: any
  onSubmit: (task: any) => void
  onCancel: () => void
  isEditing?: boolean
  hasWorkspaceAccess?: boolean
  defaultVisibility?: 'personal' | 'workspace'
  workspaceName?: string
  workspaceMembers?: WorkspaceMember[]
  currentUserId?: string
}

const TaskForm: React.FC<TaskFormProps> = ({ initialData, onSubmit, onCancel, isEditing, hasWorkspaceAccess, defaultVisibility, workspaceName, workspaceMembers = [], currentUserId }) => {
  const { user } = useAuth()
  const [avatarError, setAvatarError] = useState(false)
  const [typingDone, setTypingDone] = useState(false)
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [status, setStatus] = useState<'todo' | 'doing' | 'done' | 'canceled'>(initialData?.status || 'todo')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(initialData?.priority || 'medium')
  const [dueDate, setDueDate] = useState<Date | null>(
    initialData?.dueDate && initialData.dueDate !== 'Sem prazo'
      ? new Date(initialData.dueDate)
      : null
  )
  const [timerDuration, setTimerDuration] = useState<string | null>(() => {
    if (initialData?.timerAt && !initialData?.timerFired) {
      const remaining = new Date(initialData.timerAt).getTime() - Date.now()
      if (remaining > 0) {
        const totalSeconds = Math.floor(remaining / 1000)
        const h = Math.floor(totalSeconds / 3600)
        const m = Math.floor((totalSeconds % 3600) / 60)
        const s = totalSeconds % 60
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      }
    }
    return null
  })
  const [timerTouched, setTimerTouched] = useState(false)
  const [visibility, setVisibility] = useState<'personal' | 'workspace'>(
    initialData?.visibility || defaultVisibility || 'personal'
  )
  const [assignedTo, setAssignedTo] = useState<string[]>(() => {
    if (initialData?.assignedToIds && Array.isArray(initialData.assignedToIds)) return initialData.assignedToIds
    if (initialData?.assignedToId) return [initialData.assignedToId]
    return []
  })
  const [subtasks, setSubtasks] = useState<{ id: string, title: string, completed: boolean }[]>(initialData?.subtasks || [])
  const [newSubtask, setNewSubtask] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [lastAnalyzed, setLastAnalyzed] = useState(initialData?.title || '')
  const [showFullMessage, setShowFullMessage] = useState(false)

  const lastAnalyzedRef = useRef(lastAnalyzed)
  lastAnalyzedRef.current = lastAnalyzed
  const isAnalyzingRef = useRef(isAnalyzing)
  isAnalyzingRef.current = isAnalyzing

  useEffect(() => {
    if (initialData?.source !== 'whatsapp' || !initialData?.whatsappMessage) return
    const t = setTimeout(() => setTypingDone(true), 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || trimmedTitle === lastAnalyzedRef.current || isAnalyzingRef.current) return

    const timeoutId = setTimeout(() => {
      handleAIAnalyze(trimmedTitle)
    }, 1500)

    return () => clearTimeout(timeoutId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  const handleAIAnalyze = async (textToAnalyze: string) => {
    if (!textToAnalyze || isAnalyzing) return
    setIsAnalyzing(true)
    setLastAnalyzed(textToAnalyze)

    try {
      const data = await apiFetch<any>('/api/chat', {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `Você é um assistente de produtividade. Responda APENAS com um objeto JSON puro, sem explicações.
O formato deve ser:
{
  "priority": "low" | "medium" | "high",
  "subtasks": ["subtarefa 1", "subtarefa 2", ...]
}

REGRAS:
- Baseie a prioridade no título da tarefa.
- Analise se a tarefa é complexa o suficiente para ter subtarefas.
- Se a tarefa for simples e direta (ex: "comprar leite", "ligar pro João"), retorne "subtasks": [].
- Se a tarefa for complexa ou envolver múltiplos passos (ex: "criar apresentação do projeto", "organizar mudança", "planejar viagem"), sugira de 2 a 5 subtarefas práticas e acionáveis.
- As subtarefas devem ser passos concretos e curtos.
- Responda SOMENTE com o JSON, sem texto adicional.`
            },
            { role: 'user', content: `Tarefa: ${textToAnalyze}` }
          ],
          temperature: 0.3,
          max_tokens: 800
        })
      })
      const m = data.choices?.[0]?.message
      const content = m?.content?.trim() || m?.reasoning_content?.trim() || m?.thought?.trim() || m?.reasoning?.trim()

      if (!content) throw new Error('A IA retornou uma resposta sem texto.')

      // Extrai o JSON da resposta
      let parsed: any = null
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0])
        }
      } catch (parseError) {
        console.error('Erro ao parsear JSON da IA:', parseError)
      }

      if (parsed) {
        // Aplica prioridade
        if (parsed.priority) {
          const p = parsed.priority.toLowerCase()
          if (['low', 'medium', 'high'].includes(p)) {
            setPriority(p as any)
          }
        }

        // Aplica subtarefas sugeridas (somente se não há subtarefas manuais já adicionadas)
        if (parsed.subtasks && Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0 && subtasks.length === 0) {
          const aiSubtasks = parsed.subtasks
            .filter((s: any) => typeof s === 'string' && s.trim())
            .map((s: string) => ({
              id: Math.random().toString(36).substr(2, 9),
              title: s.trim(),
              completed: false
            }))
          if (aiSubtasks.length > 0) {
            setSubtasks(aiSubtasks)
          }
        }
      }
    } catch (error: any) {
      console.error('Erro ao sugerir com IA:', error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    const totalSubtasks = subtasks.length
    const completedSubtasks = subtasks.filter(s => s.completed).length
    let progress = status === 'done' ? 100 : (status === 'doing' ? 50 : 0)

    if (totalSubtasks > 0) {
      progress = Math.round((completedSubtasks / totalSubtasks) * 100)
    }

    // Calcula timer_at a partir da duração (igual ao WhatsApp faz no backend)
    let timerAt: string | null | undefined = undefined
    if (timerTouched) {
      if (timerDuration && timerDuration !== '00:00:00') {
        const [h, m, s] = timerDuration.split(':').map(Number)
        const totalMs = (h * 3600 + m * 60 + s) * 1000
        timerAt = new Date(Date.now() + totalMs).toISOString()
      } else {
        timerAt = null
      }
    }

    onSubmit({
      id: initialData?.id || Math.random().toString(36).substr(2, 9),
      title,
      description,
      status,
      priority,
      source: initialData?.source || 'user',
      dueDate: dueDate ? formatDateForTask(dueDate) : 'Sem prazo',
      timerAt,
      progress,
      subtasks,
      visibility,
      assignedTo: visibility === 'workspace' && assignedTo.length > 0 ? assignedTo[0] : undefined,
      assignedToIds: visibility === 'workspace' && assignedTo.length > 0 ? assignedTo : undefined,
    })
  }



  const formatDateForTask = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const addSubtask = () => {
    if (!newSubtask.trim()) return
    setSubtasks([...subtasks, {
      id: Math.random().toString(36).substr(2, 9),
      title: newSubtask,
      completed: false
    }])
    setNewSubtask('')
  }

  const toggleSubtask = (id: string) => {
    setSubtasks(subtasks.map(s => {
      if (s.id === id) {
        return { ...s, completed: !s.completed }
      }
      return s
    }))
  }

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter(s => s.id !== id))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">

      {/* WhatsApp original message bubble */}
      {initialData?.source === 'whatsapp' && initialData?.whatsappMessage && (
        <div className="space-y-1.5 mb-6">
          <label className="text-[10px] font-bold text-[#37352f]/40 flex items-center gap-1.5 ml-1">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="#25D366" className="opacity-60">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Mensagem original
          </label>
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-[#e9e9e7] ring-1 ring-[#e9e9e7]">
              {user?.user_metadata?.avatar_url && !avatarError ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full object-cover transition-all hover:scale-110" onError={() => setAvatarError(true)} />
              ) : (
                <Avvvatars value={user?.email || 'guest'} size={28} style="character" />
              )}
            </div>
            <div className={`bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl rounded-tl-sm px-3.5 py-2 min-w-0 ${!typingDone ? 'w-fit' : 'flex-1'}`}>
              <AnimatePresence mode="wait">
                {!typingDone ? (
                  <motion.div
                    key="typing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-1.5 h-4"
                  >
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="w-1 h-1 rounded-full bg-[#37352f]/20 animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="message"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.2, 0.65, 0.3, 0.9] }}
                    className="text-[12px] font-medium leading-relaxed"
                  >
                    <span className="text-[#37352f]/70">
                      {showFullMessage || initialData.whatsappMessage.length <= 150
                        ? initialData.whatsappMessage
                        : initialData.whatsappMessage.slice(0, 150)}
                      {!showFullMessage && initialData.whatsappMessage.length > 150 && (
                        <button
                          type="button"
                          onClick={() => setShowFullMessage(true)}
                          className="text-[#37352f]/40 hover:text-[#37352f] ml-1.5 text-[11px] font-bold transition-colors underline underline-offset-2 decoration-[#37352f]/10"
                        >
                          ver mais
                        </button>
                      )}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[10px] font-bold text-[#37352f]/30 flex items-center h-4 uppercase tracking-tight">Título da Tarefa</label>
        <input
          type="text"
          placeholder="O que precisa ser feito?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-white border border-[#edf0f2] rounded-lg py-2 px-3 text-[13px] font-medium text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#000000] transition-all"
          autoFocus
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-bold text-[#37352f]/30 flex items-center h-4 uppercase tracking-tight">Descrição</label>
        <textarea
          placeholder="Adicione detalhes..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-white border border-[#edf0f2] rounded-lg py-2 px-3 text-[13px] font-medium text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#000000] transition-all resize-none h-20"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Select
          label="Status"
          value={status}
          onChange={(val) => setStatus(val as any)}
          options={[
            { value: 'todo', label: 'A Fazer' },
            { value: 'doing', label: 'Em Progresso' },
            { value: 'done', label: 'Concluído' },
            { value: 'canceled', label: 'Cancelado' }
          ]}
        />

        <Select
          label="Prioridade"
          value={priority}
          onChange={(val) => setPriority(val as any)}
          options={[
            { value: 'low', label: 'Baixa' },
            { value: 'medium', label: 'Média' },
            { value: 'high', label: 'Alta' }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Due Date */}
        <DatePicker
          label="Prazo"
          value={dueDate}
          onChange={setDueDate}
        />

        <TimePicker
          label="Timer"
          value={timerDuration}
          onChange={(val) => { setTimerDuration(val); setTimerTouched(true) }}
        />
      </div>

      {/* Visibilidade (membros/donos de workspace) */}
      {hasWorkspaceAccess && (
        <div className="space-y-1.5 mb-4">
          <label className="text-[10px] font-bold text-[#37352f]/30 flex items-center h-4 uppercase tracking-tight">Visibilidade</label>
          <div className="relative flex items-center bg-[#f7f7f5]/80 rounded-full p-1 border border-[#e9e9e7]/50">
            <button
              type="button"
              onClick={() => setVisibility('personal')}
              className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-full text-[11px] font-bold transition-colors duration-300 ${
                visibility === 'personal'
                  ? 'text-[#37352f]'
                  : 'text-[#37352f]/30 hover:text-[#37352f]/50'
              }`}
            >
              <Lock size={12} strokeWidth={2.5} />
              <span>Pessoal</span>
              {visibility === 'personal' && (
                <motion.div
                  layoutId="active-visibility"
                  className="absolute inset-0 bg-white shadow-sm border border-[#e9e9e7] rounded-full -z-10"
                  transition={{ type: "spring", stiffness: 350, damping: 35, mass: 0.8 }}
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setVisibility('workspace')}
              className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-full text-[11px] font-bold transition-colors duration-300 ${
                visibility === 'workspace'
                  ? 'text-[#37352f]'
                  : 'text-[#37352f]/30 hover:text-[#37352f]/50'
              }`}
            >
              <Users size={12} strokeWidth={2.5} />
              <span>Workspace</span>
              {visibility === 'workspace' && (
                <motion.div
                  layoutId="active-visibility"
                  className="absolute inset-0 bg-white shadow-sm border border-[#e9e9e7] rounded-full -z-10"
                  transition={{ type: "spring", stiffness: 350, damping: 35, mass: 0.8 }}
                />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Subtasks Section */}
      <div className="space-y-1.5 mt-1">
        <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5 gap-2">
          Subtarefas
          {subtasks.length > 0 && (
            <span className="text-[9px] bg-[#f7f7f5] px-1.5 py-0.5 rounded-full border border-[#e9e9e7]">
              {subtasks.filter(s => s.completed).length}/{subtasks.length}
            </span>
          )}
        </label>

        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
          {subtasks.map(subtask => (
            <div key={subtask.id} className="flex items-center gap-2 group bg-white border border-[#e9e9e7] p-2 rounded-lg hover:border-[#d3d3d1] transition-all">
              <button
                type="button"
                onClick={() => toggleSubtask(subtask.id)}
                className={`transition-colors ${subtask.completed ? 'text-[#25D366]' : 'text-[#37352f]/20 hover:text-[#37352f]/40'}`}
              >
                {subtask.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </button>
              <span className={`text-xs font-medium flex-1 ${subtask.completed ? 'text-[#37352f]/30 line-through' : 'text-[#37352f]'}`}>
                {subtask.title}
              </span>
              <button
                type="button"
                onClick={() => removeSubtask(subtask.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 rounded transition-all text-[#37352f]/20"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="relative flex items-center bg-white border border-[#e9e9e7] rounded-lg focus-within:border-[#000000] focus-within:ring-1 focus-within:ring-[#000000]/5 transition-all px-1">
            <input
              type="text"
              placeholder="Nova subtarefa..."
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
              className="flex-1 bg-transparent border-none outline-none py-2 px-3 text-xs font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal"
            />
            <button
              type="button"
              onClick={addSubtask}
              className="p-1.5 bg-transparent text-[#37352f]/40 hover:text-[#37352f] transition-all"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>


      {hasWorkspaceAccess && visibility === 'workspace' && workspaceMembers.filter(m => m.member_user_id).length > 0 && (() => {
        const meId = currentUserId || user?.id || ''
        // Build all members list: me + others
        const allMembers: { id: string, name: string, avatar: string | null | undefined, email: string, isMe: boolean }[] = [
          { id: meId, name: 'Eu', avatar: user?.user_metadata?.avatar_url, email: user?.email || 'me', isMe: true },
          ...workspaceMembers
            .filter(m => m.member_user_id && m.role !== 'pending' && m.member_user_id !== meId)
            .map(m => ({ id: m.member_user_id, name: m.member_name?.split(' ')[0] || m.member_email.split('@')[0], avatar: m.member_avatar, email: m.member_email, isMe: false }))
        ]
        // Sort: selected first
        const sorted = [...allMembers].sort((a, b) => {
          const aS = assignedTo.includes(a.id) ? 0 : 1
          const bS = assignedTo.includes(b.id) ? 0 : 1
          return aS - bS
        })

        return (
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#37352f]/30 flex items-center h-4 uppercase tracking-tight">Responsáveis</label>
            <motion.div layout className="flex flex-wrap items-center gap-2 pt-1">
              {sorted.map(m => {
                const isSelected = assignedTo.includes(m.id)
                return (
                  <motion.button
                    key={m.id}
                    type="button"
                    layout
                    initial={false}
                    animate={{
                      scale: isSelected ? 1 : 0.98,
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setAssignedTo(prev =>
                        prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]
                      )
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors duration-300 ${
                      isSelected
                        ? 'bg-[#37352f] border-[#37352f] text-white shadow-sm'
                        : 'bg-[#f7f7f5]/60 border-[#e9e9e7]/50 text-[#37352f]/40 hover:border-[#d3d3d1]'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full overflow-hidden flex-shrink-0 transition-all duration-300 ${isSelected ? 'ring-1 ring-white/30' : 'grayscale opacity-70'}`}>
                      {m.avatar
                        ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                        : <Avvvatars value={m.email} size={14} style="character" />
                      }
                    </div>
                    <span className={`text-[10px] font-bold truncate max-w-[90px] tracking-tight transition-colors duration-300 ${isSelected ? 'text-white' : 'text-[#37352f]/60'}`}>
                      {m.name}
                    </span>
                    <AnimatePresence>
                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0, width: 0, opacity: 0 }}
                          animate={{ scale: 1, width: 'auto', opacity: 1 }}
                          exit={{ scale: 0, width: 0, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="ml-0.5 overflow-hidden flex items-center"
                        >
                          <Check size={10} strokeWidth={4} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                )
              })}
            </motion.div>
          </div>
        )
      })()}

      {/* Rodapé Minimalista Refatorado */}
      <div className="flex items-center justify-end gap-3 mt-8 py-5 border-t border-[#f1f1f0] -mx-5 sm:-mx-6 px-5 sm:px-6 rounded-b-2xl">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] hover:bg-[#37352f]/[0.03] rounded-xl transition-all whitespace-nowrap"
        >
          Descartar
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="h-9 px-6 rounded-xl bg-[#202020] text-white text-[11px] font-bold hover:bg-black transition-all active:scale-[0.98] disabled:opacity-20 disabled:scale-100 flex items-center gap-2 whitespace-nowrap shadow-sm shadow-black/5"
        >
          {isEditing ? <CheckCircle2 size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
          <span>{isEditing ? 'Salvar Tarefa' : 'Criar Tarefa'}</span>
        </button>
      </div>
    </form>
  )
}

export default TaskForm
