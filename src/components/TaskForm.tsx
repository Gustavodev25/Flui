import React, { useState, useEffect } from 'react'
import { Loader2, Plus, Trash2, CheckCircle2, Circle, Lock, Users, UserCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Select from './ui/Select'
import DatePicker from './ui/DatePicker'
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
  const [visibility, setVisibility] = useState<'personal' | 'workspace'>(
    initialData?.visibility || defaultVisibility || 'personal'
  )
  const [assignedTo, setAssignedTo] = useState<string>(initialData?.assignedToId || '')
  const [subtasks, setSubtasks] = useState<{ id: string, title: string, completed: boolean }[]>(initialData?.subtasks || [])
  const [newSubtask, setNewSubtask] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [lastAnalyzed, setLastAnalyzed] = useState(initialData?.title || '')
  const [showFullMessage, setShowFullMessage] = useState(false)

  useEffect(() => {
    if (initialData?.source !== 'whatsapp' || !initialData?.whatsappMessage) return
    const t = setTimeout(() => setTypingDone(true), 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || trimmedTitle === lastAnalyzed) return

    const timeoutId = setTimeout(() => {
      handleAIAnalyze(trimmedTitle)
    }, 1200)

    return () => clearTimeout(timeoutId)
  }, [title, lastAnalyzed])

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

    onSubmit({
      id: initialData?.id || Math.random().toString(36).substr(2, 9),
      title,
      description,
      status,
      priority,
      source: initialData?.source || 'user',
      dueDate: dueDate ? formatDateForTask(dueDate) : 'Sem prazo',
      progress,
      subtasks,
      visibility,
      assignedTo: visibility === 'workspace' && assignedTo ? assignedTo : undefined,
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
    <form onSubmit={handleSubmit} className="space-y-4">

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
                    className="text-[12px] font-medium leading-relaxed relative"
                  >
                    {/* 1. Camada Base (Texto Escuro Sólido - Sempre Visível) */}
                    <span className="text-[#37352f]/70 flex flex-wrap">
                      {(showFullMessage || initialData.whatsappMessage.length <= 150
                        ? initialData.whatsappMessage
                        : initialData.whatsappMessage.slice(0, 150)
                      ).split("").map((char: string, i: number) => (
                        <motion.span
                          key={i}
                          initial={{ y: "100%", opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{
                            duration: 0.3,
                            delay: i * 0.003,
                            ease: [0.2, 0.65, 0.3, 0.9]
                          }}
                          className="inline-block"
                          style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                        >
                          {char}
                        </motion.span>
                      ))}
                      
                      {!showFullMessage && initialData.whatsappMessage.length > 150 && (
                        <motion.button
                          key="see-more"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 150 * 0.003 + 0.1 }}
                          type="button"
                          onClick={() => setShowFullMessage(true)}
                          className="text-[#37352f]/40 hover:text-[#37352f] ml-1.5 text-[11px] font-bold transition-colors underline underline-offset-2 decoration-[#37352f]/10"
                        >
                          ver mais
                        </motion.button>
                      )}
                    </span>

                    {/* 2. Camada de Brilho (Texto Branco com Opacidade Controlada) */}
                    <motion.span
                      className="absolute inset-0 flex flex-wrap text-white pointer-events-none select-none"
                      style={{
                        WebkitMaskImage: "linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)",
                        WebkitMaskSize: "200% 100%",
                        maskImage: "linear-gradient(90deg, transparent 40%, black 50%, transparent 60%)",
                        maskSize: "200% 100%",
                      }}
                      initial={{ maskPosition: "150%", opacity: 0 }}
                      animate={{
                        maskPosition: "-150%",
                        opacity: [0, 1, 0]
                      }}
                      transition={{
                        maskPosition: { delay: 0.3, duration: 1.5, ease: "easeInOut" },
                        opacity: { delay: 0.3, duration: 1.5, times: [0, 0.15, 1], ease: "linear" }
                      }}
                    >
                      {(showFullMessage || initialData.whatsappMessage.length <= 150
                        ? initialData.whatsappMessage
                        : initialData.whatsappMessage.slice(0, 150)
                      ).split("").map((char: string, i: number) => (
                        <motion.span
                          key={i}
                          initial={{ y: "100%", opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{
                            duration: 0.3,
                            delay: i * 0.003,
                            ease: [0.2, 0.65, 0.3, 0.9]
                          }}
                          className="inline-block"
                          style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                        >
                          {char}
                        </motion.span>
                      ))}
                    </motion.span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* Title Input */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">Título da Tarefa</label>
        <input
          type="text"
          placeholder="O que precisa ser feito?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-white border border-[#e9e9e7] rounded-lg py-2.5 px-4 text-sm font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000]/5 transition-all"
          autoFocus
          required
        />
      </div>

      {/* Description Input */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">Descrição</label>
        <textarea
          placeholder="Adicione detalhes sobre esta tarefa..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-white border border-[#e9e9e7] rounded-lg py-2.5 px-4 text-sm font-medium text-[#37352f] placeholder-[#37352f]/50 placeholder:font-normal outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000]/5 transition-all resize-none h-24"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
          label={
            <>
              Prioridade
              {isAnalyzing && (
                <span className="flex items-center gap-1 ml-1.5 text-black font-medium normal-case">
                  <Loader2 size={10} className="animate-spin" />
                  <span className="text-[9px] opacity-70">IA Analisando</span>
                </span>
              )}
            </>
          }
          value={priority}
          onChange={(val) => setPriority(val as any)}
          options={[
            { value: 'low', label: 'Baixa' },
            { value: 'medium', label: 'Média' },
            { value: 'high', label: 'Alta' }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Due Date */}
        <DatePicker
          label="Prazo"
          value={dueDate}
          onChange={setDueDate}
        />
      </div>

      {/* Subtasks Section */}
      <div className="space-y-1.5 mt-1">
        <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5 gap-2">
          Subtarefas
          {subtasks.length > 0 && (
            <span className="text-[9px] bg-[#f7f7f5] px-1.5 py-0.5 rounded-full border border-[#e9e9e7]">
              {subtasks.filter(s => s.completed).length}/{subtasks.length}
            </span>
          )}
          {isAnalyzing && (
            <span className="flex items-center gap-1 ml-0.5 text-black font-medium">
              <Loader2 size={10} className="animate-spin" />
              <span className="text-[9px] opacity-70">IA Sugerindo</span>
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

      {/* Visibility Toggle (workspace members/owners only) */}
      {hasWorkspaceAccess && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center h-5">Visibilidade</label>
          <div className="flex items-center gap-2 bg-[#f7f7f5] border border-[#e9e9e7] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setVisibility('personal')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-[11px] font-semibold transition-all ${
                visibility === 'personal'
                  ? 'bg-white text-[#37352f] shadow-sm border border-[#e9e9e7]'
                  : 'text-[#37352f]/40 hover:text-[#37352f]/70'
              }`}
            >
              <Lock size={12} strokeWidth={2.5} />
              Pessoal
              {visibility === 'personal' && (
                <span className="text-[9px] text-[#37352f]/40 font-normal ml-0.5">só você vê</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setVisibility('workspace')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-[11px] font-semibold transition-all ${
                visibility === 'workspace'
                  ? 'bg-white text-[#37352f] shadow-sm border border-[#e9e9e7]'
                  : 'text-[#37352f]/40 hover:text-[#37352f]/70'
              }`}
            >
              <Users size={12} strokeWidth={2.5} />
              Workspace
              {visibility === 'workspace' && (
                <span className="text-[9px] text-[#37352f]/40 font-normal ml-0.5">
                  {workspaceName ? `${workspaceName}` : 'equipe vê'}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Assignee Selector (workspace only, when members exist) */}
      {hasWorkspaceAccess && visibility === 'workspace' && workspaceMembers.filter(m => m.member_user_id).length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-[#37352f]/70 flex items-center gap-1.5 h-5">
            <UserCheck size={11} strokeWidth={2.5} />
            Atribuir a
          </label>
          <div className="flex flex-wrap gap-2">
            {/* Opção: ninguém (eu mesmo) */}
            <button
              type="button"
              onClick={() => setAssignedTo('')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                assignedTo === ''
                  ? 'bg-[#37352f] text-white border-[#37352f]'
                  : 'bg-white text-[#37352f]/60 border-[#e9e9e7] hover:border-[#37352f]/20'
              }`}
            >
              <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                <Avvvatars value={user?.email || 'me'} size={16} style="character" />
              </div>
              Eu
            </button>
            {/* Membros */}
            {workspaceMembers.filter(m => m.member_user_id && m.role !== 'pending').map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setAssignedTo(m.member_user_id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                  assignedTo === m.member_user_id
                    ? 'bg-[#37352f] text-white border-[#37352f]'
                    : 'bg-white text-[#37352f]/60 border-[#e9e9e7] hover:border-[#37352f]/20'
                }`}
              >
                <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0">
                  {m.member_avatar
                    ? <img src={m.member_avatar} alt="" className="w-full h-full object-cover" />
                    : <Avvvatars value={m.member_email} size={16} style="character" />
                  }
                </div>
                {m.member_name?.split(' ')[0] || m.member_email.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Form Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-xs font-medium text-[#37352f]/40 hover:text-[#37352f] transition-colors"
        >
          Descartar
        </button>
        <button
          type="submit"
          className="bg-[#202020] text-white px-6 py-2.5 rounded-lg text-xs font-medium hover:bg-black transition-all shadow-md shadow-black/5 active:scale-95"
        >
          {isEditing ? 'Salvar Alterações' : 'Criar Tarefa'}
        </button>
      </div>
    </form>
  )
}

export default TaskForm
