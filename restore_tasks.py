import re

content = """
1: import React, { useState, useEffect } from 'react'
2: import { motion } from 'framer-motion'
3: import { Plus, MoreHorizontal, Layout, Table as TableIcon, Phone, Loader2, Edit2, Trash2 } from 'lucide-react'
4: import { useAuth } from '../contexts/AuthContext'
5: import Avvvatars from 'avvvatars-react'
6: import { supabase } from '../lib/supabase'
7: import Modal from '../components/ui/Modal'
8: import TaskForm from '../components/TaskForm'
9: import { Dropdown, DropdownItem, DropdownDivider } from '../components/ui/Dropdown'
10: import DeleteConfirmation from '../components/ui/DeleteConfirmation'
11: import swingingDoodle from '../assets/doodle/SwingingDoodle.png'
12: import {
13:   DndContext,
14:   closestCorners,
15:   KeyboardSensor,
16:   PointerSensor,
17:   useSensor,
18:   useSensors,
19:   DragOverlay,
20:   defaultDropAnimationSideEffects,
21:   useDroppable,
22: } from '@dnd-kit/core'
23: import type {
24:   DragEndEvent,
25:   DragOverEvent,
26:   DragStartEvent,
27: } from '@dnd-kit/core'
28: import {
29:   arrayMove,
30:   SortableContext,
31:   sortableKeyboardCoordinates,
32:   verticalListSortingStrategy,
33:   useSortable,
34: } from '@dnd-kit/sortable'
35: import { CSS } from '@dnd-kit/utilities'
36: 
37: interface Task {
38:   id: string
39:   title: string
40:   status: 'todo' | 'doing' | 'review' | 'done' | 'canceled'
41:   priority: 'low' | 'medium' | 'high'
42:   dueDate: string
43:   source: 'user' | 'whatsapp'
44:   tags: string[]
45:   progress: number
46: }
47: 
48: const getPriorityColor = (priority: Task['priority']) => {
49:   switch (priority) {
50:     case 'high': return 'bg-red-50 text-red-600 border-red-100'
51:     case 'medium': return 'bg-slate-50 text-slate-600 border-slate-200'
52:     default: return 'bg-slate-50 text-slate-400 border-slate-100'
53:   }
54: }
55: 
56: const getTagColor = (tag: string) => {
57:   const colors: Record<string, string> = {
58:     'UI/UX': 'bg-indigo-50 text-indigo-600 border-indigo-100',
59:     'Backend': 'bg-emerald-50 text-emerald-600 border-emerald-100',
60:     'CSS': 'bg-pink-50 text-pink-600 border-pink-100',
61:     'Frontend': 'bg-blue-50 text-blue-600 border-blue-100',
62:     'Bug': 'bg-red-50 text-red-600 border-red-100',
63:     'Feature': 'bg-violet-50 text-violet-600 border-violet-100',
64:   }
65:   return colors[tag] || 'bg-slate-50 text-slate-600 border-slate-100'
66: }
67: 
68: // Componente para o Card da Tarefa
69: const TaskCardUI = React.forwardRef<HTMLDivElement, {
70:   task: Task
71:   isDragging?: boolean
72:   isOverlay?: boolean
73:   dragHandleProps?: any
74:   style?: React.CSSProperties
75:   onEdit: (task: Task) => void
76:   onDelete: (id: string) => void
77:   activeDropdownId: string | null
78:   setActiveDropdownId: (id: string | null) => void
79:   userEmail?: string
80: }>(({ task, isDragging, isOverlay, dragHandleProps, style, onEdit, onDelete, activeDropdownId, setActiveDropdownId, userEmail }, ref) => {
81: 
82:   const isPlaceholder = isDragging && !isOverlay;
83: 
84:   return (
85:     <motion.div
86:       ref={ref}
87:       style={style}
88:       layoutId={!isOverlay ? `card-${task.id}` : undefined}
89:       initial={false}
90:       animate={{
91:         scale: isOverlay ? 1.05 : 1,
92:         rotate: isOverlay ? 3 : 0,
93:         boxShadow: isOverlay
94:           ? "0 20px 25px -5px rgb(0 0 0 / 0.15), 0 8px 10px -6px rgb(0 0 0 / 0.1)"
95:           : "0 1px 2px 0 rgb(0 0 0 / 0.05)"
96:       }}
97:       transition={{ type: "spring", stiffness: 400, damping: 25, mass: 0.8 }}
98:       className={`relative rounded-xl transition-colors p-4 ${isPlaceholder
99:           ? 'border-2 border-dashed border-[#d3d3d1]/60 bg-[#f7f7f5]/50 shadow-none'
100:           : 'bg-white border border-[#e9e9e7] hover:border-[#d3d3d1]'
101:         } ${isOverlay ? 'cursor-grabbing z-50' : 'cursor-grab active:cursor-grabbing hover:shadow-md'}`}
102:       {...dragHandleProps}
103:     >
104:       {/* 1. MELHORIA: Esconder o conteúdo do card deixado para trás, mantendo apenas seu tamanho e borda tracejada (Efeito Trello) */}
105:       <div className={`flex flex-col h-full transition-opacity duration-200 ${isPlaceholder ? 'opacity-0' : 'opacity-100'}`}>
106:         {/* Cabeçalho */}
107:         <div className="flex items-start justify-between gap-2 mb-3">
108:           <div className="flex flex-wrap gap-1.5">
109:             {task.tags.map(tag => (
110:               <span key={tag} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getTagColor(tag)}`}>
111:                 {tag}
112:               </span>
113:             ))}
114:           </div>
115: 
116:           <div className="relative -mt-1 -mr-1">
117:             <button
118:               onClick={(e) => {
119:                 e.stopPropagation()
120:                 setActiveDropdownId(activeDropdownId === task.id ? null : task.id)
121:               }}
122:               className="p-1 hover:bg-[#000000]/[0.05] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
123:             >
124:               <MoreHorizontal size={16} className="flex-shrink-0" />
125:             </button>
126: 
127:             <Dropdown
128:               isOpen={activeDropdownId === task.id}
129:               onClose={() => setActiveDropdownId(null)}
130:             >
131:               <DropdownItem
132:                 icon={<Edit2 size={12} />}
133:                 label="Editar"
134:                 onClick={() => onEdit(task)}
135:               />
136:               <DropdownDivider />
137:               <DropdownItem
138:                 icon={<Trash2 size={12} />}
139:                 label="Excluir"
140:                 variant="danger"
141:                 onClick={() => onDelete(task.id)}
142:               />
143:             </Dropdown>
144:           </div>
145:         </div>
146: 
147:         {/* Título */}
148:         <h4 className="text-[14px] font-semibold text-[#37352f] leading-snug line-clamp-2 mb-4">
149:           {task.title}
150:         </h4>
151: 
152:         {/* Rodapé */}
153:         <div className="flex items-center justify-between pt-3 border-t border-[#f1f1f0] mt-auto">
154:           <span className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider border ${getPriorityColor(task.priority)}`}>
155:             {task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Média' : 'Baixa'}
156:           </span>
157: 
158:           <div className="flex items-center gap-3">
159:             <span className="text-[10px] font-bold text-[#37352f]/40 uppercase tracking-tighter">
160:               {task.dueDate}
161:             </span>
162: 
163:             {task.source === 'whatsapp' ? (
164:               <div className="w-5 h-5 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[#25D366] border border-[#25D366]/20" title="Criado via WhatsApp">
165:                 <Phone size={10} strokeWidth={2.5} />
166:               </div>
167:             ) : (
168:               <div className="border border-[#e9e9e7] rounded-full shadow-sm overflow-hidden flex-shrink-0">
169:                 <Avvvatars value={userEmail || 'guest'} size={20} style="character" />
170:               </div>
171:             )}
172:           </div>
173:         </div>
174:       </div>
175:     </motion.div>
176:   )
177: })
178: 
179: // Wrapper Sortable
180: const SortableTaskCard: React.FC<{
181:   task: Task
182:   onEdit: (task: Task) => void
183:   onDelete: (id: string) => void
184:   activeDropdownId: string | null
185:   setActiveDropdownId: (id: string | null) => void
186:   userEmail?: string
187: }> = (props) => {
188:   const {
189:     attributes,
190:     listeners,
191:     setNodeRef,
192:     transform,
193:     transition,
194:     isDragging,
195:   } = useSortable({ id: props.task.id })
196: 
197:   // 2. MELHORIA: CSS.Transform em vez de CSS.Translate previne reflow de layout do navegador durante o drag
198:   const style = {
199:     transform: CSS.Transform.toString(transform),
200:     transition: transition || undefined,
201:   }
202: 
203:   return (
204:     <div ref={setNodeRef} style={style} className="z-10 relative">
205:       <TaskCardUI
206:         isDragging={isDragging}
207:         dragHandleProps={{ ...attributes, ...listeners }}
208:         {...props}
209:       />
210:     </div>
211:   )
212: }
213: 
214: const DroppableContainer: React.FC<{
215:   id: string
216:   children: React.ReactNode
217:   className?: string
218:   isOver?: boolean
219: }> = ({ id, children, className }) => {
220:   const { setNodeRef, isOver } = useDroppable({ id })
221: 
222:   return (
223:     <div
224:       ref={setNodeRef}
225:       className={`${className} rounded-2xl transition-all duration-300 ease-in-out ${isOver ? 'bg-[#f7f7f5] ring-2 ring-inset ring-[#e9e9e7] ring-offset-2 ring-offset-white shadow-inner' : ''
226:         }`}
227:     >
228:       {children}
229:     </div>
230:   )
231: }
232: 
233: const Tasks: React.FC = () => {
234:   const { user } = useAuth()
235:   const [viewMode, setViewMode] = useState<'board' | 'table'>('board')
236:   const [isModalOpen, setIsModalOpen] = useState(false)
237:   const [loading, setLoading] = useState(true)
238:   const [tasks, setTasks] = useState<Task[]>([])
239:   const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null)
240:   const [editingTask, setEditingTask] = useState<Task | null>(null)
241:   const [activeId, setActiveId] = useState<string | null>(null)
242:   const [taskToDelete, setTaskToDelete] = useState<string | null>(null)
243: 
244:   const sensors = useSensors(
245:     useSensor(PointerSensor, {
246:       activationConstraint: {
247:         distance: 8,
248:       },
249:     }),
250:     useSensor(KeyboardSensor, {
251:       coordinateGetter: sortableKeyboardCoordinates,
252:     })
253:   )
254: 
255:   useEffect(() => {
256:     fetchTasks()
257:   }, [])
258: 
259:   const fetchTasks = async () => {
260:     try {
261:       setLoading(true)
262:       const { data, error } = await supabase
263:         .from('tasks')
264:         .select('*')
265:         .order('created_at', { ascending: false })
266: 
267:       if (error) throw error
268: 
269:       const mappedTasks = (data || []).map(task => ({
270:         ...task,
271:         dueDate: task.due_date
272:       }))
273: 
274:       setTasks(mappedTasks)
275:     } catch (error) {
276:       console.error('Erro ao buscar tarefas:', error)
277:     } finally {
278:       setLoading(false)
279:     }
280:   }
281: 
282:   const columns = [
283:     { id: 'todo' as const, title: 'A Fazer', color: 'bg-slate-400' },
284:     { id: 'doing' as const, title: 'Em Progresso', color: 'bg-[#2383e2]' },
285:     { id: 'review' as const, title: 'Em Revisão', color: 'bg-[#F2994A]' },
286:     { id: 'done' as const, title: 'Concluído', color: 'bg-[#25D366]' },
287:     { id: 'canceled' as const, title: 'Cancelado', color: 'bg-red-200' },
288:   ]
289: 
290:   const tabs = [
291:     { id: 'board', label: 'Quadro', icon: Layout },
292:     { id: 'table', label: 'Tabela', icon: TableIcon },
293:   ]
294: 
295:   // ... (handleAddTask, handleDeleteTask, openEditModal, openCreateModal mantidos iguais) ...
296:   const handleAddTask = async (newTask: any) => {
297:     try {
298:       if (editingTask) {
299:         const { error } = await supabase
300:           .from('tasks')
301:           .update({
302:             title: newTask.title,
303:             status: newTask.status,
304:             priority: newTask.priority,
305:             due_date: newTask.dueDate,
306:             source: newTask.source,
307:             tags: newTask.tags,
308:             progress: newTask.progress
309:           })
310:           .eq('id', editingTask.id)
311: 
312:         if (error) throw error
313:         setTasks(tasks.map(t => t.id === editingTask.id ? { ...t, ...newTask } : t))
314:       } else {
315:         const { id, ...taskData } = newTask
316:         const { data, error } = await supabase
317:           .from('tasks')
318:           .insert([{
319:             title: taskData.title, status: taskData.status, priority: taskData.priority,
320:             due_date: taskData.dueDate, source: taskData.source, tags: taskData.tags, progress: taskData.progress
321:           }]).select()
322: 
323:         if (error) throw error
324:         if (data && data[0]) {
325:           const newTaskWithId = {
326:             ...newTask,
327:             id: data[0].id,
328:           }
329:           setTasks([newTaskWithId, ...tasks])
330:         }
331:       }
332:       setIsModalOpen(false)
333:       setEditingTask(null)
334:     } catch (error) {
335:       console.error('Erro:', error)
336:       alert('Erro ao processar tarefa.')
337:     }
338:   }
339: 
340:   const handleDeleteTask = (id: string) => {
341:     setTaskToDelete(id)
342:     setActiveDropdownId(null)
343:   }
344: 
345:   const executeDelete = async () => {
346:     if (!taskToDelete) return
347:     const id = taskToDelete
348:     setTaskToDelete(null)
349: 
350:     try {
351:       const { error } = await supabase.from('tasks').delete().eq('id', id)
352:       if (error) throw error
353:       setTasks(tasks.filter(t => t.id !== id))
354:     } catch (error) {
355:       console.error('Erro ao excluir:', error)
356:       alert('Erro ao excluir tarefa.')
357:     }
358:   }
359: 
360:   const openEditModal = (task: Task) => {
361:     setEditingTask(task)
362:     setIsModalOpen(true)
363:     setActiveDropdownId(null)
364:   }
365: 
366:   const openCreateModal = () => {
367:     setEditingTask(null)
368:     setIsModalOpen(true)
369:   }
370: 
371:   const handleDragStart = (event: DragStartEvent) => {
372:     setActiveId(event.active.id as string)
373:     // Fechar dropdowns abertos durante o drag
374:     setActiveDropdownId(null)
375:   }
376: 
377:   const handleDragOver = (event: DragOverEvent) => {
378:     const { active, over } = event
379:     if (!over) return
380: 
381:     const activeId = active.id as string
382:     const overId = over.id as string
383: 
384:     const activeTask = tasks.find(t => t.id === activeId)
385:     const overTask = tasks.find(t => t.id === overId)
386: 
387:     const overContainer = overTask ? overTask.status : (overId as Task['status'])
388:     const activeContainer = activeTask ? activeTask.status : null
389: 
390:     const validStatuses = ['todo', 'doing', 'review', 'done', 'canceled']
391:     if (!validStatuses.includes(overContainer)) return
392: 
393:     if (!activeContainer || !overContainer || activeContainer === overContainer) {
394:       return
395:     }
396: 
397:     setTasks((prev) => {
398:       const activeIndex = prev.findIndex((t) => t.id === activeId)
399:       if (activeIndex === -1) return prev
400: 
401:       const updatedTasks = [...prev]
402:       updatedTasks[activeIndex] = { ...updatedTasks[activeIndex], status: overContainer }
403:       return updatedTasks
404:     })
405:   }
406: 
407:   // 3. MELHORIA: handleDragEnd Totalmente "Otimista" (Não bloqueia a UI esperando o BD)
408:   const handleDragEnd = (event: DragEndEvent) => {
409:     const { active, over } = event
410:     setActiveId(null)
411: 
412:     if (!over) return
413: 
414:     const activeId = active.id as string
415:     const overId = over.id as string
416: 
417:     const activeTask = tasks.find(t => t.id === activeId)
418:     const overTask = tasks.find(t => t.id === overId)
419: 
420:     const overContainer = overTask ? overTask.status : (overId as Task['status'])
421:     const validStatuses = ['todo', 'doing', 'review', 'done', 'canceled']
422:     if (!validStatuses.includes(overContainer)) return
423: 
424:     // Atualiza a interface (Front-end) IMEDIATAMENTE para máxima fluidez
425:     if (activeId !== overId) {
426:       setTasks((items) => {
427:         const oldIndex = items.findIndex((t) => t.id === activeId)
428:         const newIndex = items.findIndex((t) => t.id === overId)
429:         if (oldIndex === -1 || newIndex === -1) return items
430:         return arrayMove(items, oldIndex, newIndex)
431:       })
432:     }
433: 
434:     // Dispara a requisição para o banco de dados em SEGUNDO PLANO
435:     if (activeTask && activeTask.status !== overContainer) {
436:       supabase
437:         .from('tasks')
438:         .update({ status: overContainer })
439:         .eq('id', activeId)
440:         .then(({ error }) => {
441:           if (error) {
442:             console.error('Erro ao atualizar status:', error)
443:             // Se der erro no BD, refaz o fetch para reverter a interface
444:             fetchTasks()
445:           }
446:         })
447:     }
448:   }
449: 
450:   const activeTask = activeId ? tasks.find(t => t.id === activeId) : null
451: 
452:   return (
453:     <>
454:       {/* Header mantido igual */}
455:       <div className="px-10 pt-6 bg-white sticky top-0 z-10">
456:         <div className="max-w-full mx-auto w-full">
457:           <div className="flex items-center justify-between mb-6">
458:             <div>
459:               <h1 className="text-2xl font-bold tracking-tight mb-1">Tarefas</h1>
460:               <p className="text-sm text-[#37352f]/50 font-medium">Veja e organize seu fluxo de trabalho.</p>
461:             </div>
462:             <div className="flex items-center gap-3">
463:               {!loading && tasks.length > 0 && (
464:                 <motion.button
465:                   initial={{ opacity: 0, scale: 0.9 }}
466:                   animate={{ opacity: 1, scale: 1 }}
467:                   onClick={openCreateModal}
468:                   whileHover={{ y: -1 }}
469:                   whileTap={{ scale: 0.98 }}
470:                   className="flex items-center gap-2 px-5 bg-[#202020] text-white rounded-[6px] text-xs font-semibold hover:bg-[#202020]/90 transition-all shadow-md shadow-black/10 h-[38px]"
471:                 >
472:                   <Plus size={14} strokeWidth={2.5} />
473:                   Novo Item
474:                 </motion.button>
475:               )}
476:             </div>
477:           </div>
478: 
479:           <div className="flex items-center gap-6">
480:             {tabs.map((tab) => (
481:               <button
482:                 key={tab.id}
483:                 onClick={() => setViewMode(tab.id as any)}
484:                 className={`flex items-center gap-2 pb-3 text-sm font-semibold transition-all relative ${viewMode === tab.id
485:                   ? 'text-[#37352f]'
486:                   : 'text-[#37352f]/40 hover:text-[#37352f]/60'
487:                   }`}
488:               >
489:                 <tab.icon size={16} strokeWidth={viewMode === tab.id ? 2.5 : 2} />
490:                 {tab.label}
491:                 {viewMode === tab.id && (
492:                   <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#37352f]" />
493:                 )}
494:               </button>
495:             ))}
496:           </div>
497:         </div>
498:       </div>
499: 
500:       <div className="flex-1 overflow-auto bg-white">
501:         {loading ? (
502:           <div className="h-full w-full flex flex-col items-center justify-center gap-3 opacity-40">
503:             <Loader2 className="animate-spin text-[#37352f]" size={24} />
504:             <p className="text-xs font-semibold">Carregando tarefas...</p>
505:           </div>
506:         ) : tasks.length === 0 ? (
507:           <div className="h-full w-full flex flex-col items-center justify-center p-20 text-center bg-white">
508:             <motion.div
509:               initial={{ opacity: 0, y: 20 }}
510:               animate={{ opacity: 1, y: 0 }}
511:               className="max-w-md"
512:             >
513:               <motion.img
514:                 src={swingingDoodle}
515:                 alt="Nenhuma tarefa"
516:                 className="w-40 h-auto mx-auto mb-6 opacity-80"
517:                 initial={{ scale: 0.8, opacity: 0 }}
518:                 animate={{ scale: 1, opacity: 0.8 }}
519:                 transition={{ delay: 0.2 }}
520:               />
521:               <h2 className="text-xl font-bold text-[#37352f] mb-3">Tudo limpo por aqui!</h2>
522:               <p className="text-[#37352f]/50 text-sm mb-10 leading-relaxed font-medium">
523:                 Você ainda não tem nenhuma tarefa cadastrada. Organize seu trabalho e acompanhe seu progresso criando sua primeira tarefa agora.
524:               </p>
525:               <motion.button
526:                 onClick={openCreateModal}
527:                 whileHover={{ scale: 1.02 }}
528:                 whileTap={{ scale: 0.98 }}
529:                 className="inline-flex items-center gap-3 px-8 pb-3 pt-3 bg-[#202020] text-white rounded-xl text-sm font-bold shadow-xl shadow-black/10 hover:bg-[#303030] transition-all"
530:               >
531:                 <Plus size={18} strokeWidth={2.5} />
532:                 Criar Primeira Tarefa
533:               </motion.button>
534:             </motion.div>
535:           </div>
536:         ) : (
537:           <>
538:             {viewMode === 'board' && (
539:               <DndContext
540:                 sensors={sensors}
541:                 collisionDetection={closestCorners}
542:                 onDragStart={handleDragStart}
543:                 onDragOver={handleDragOver}
544:                 onDragEnd={handleDragEnd}
545:               >
546:                 <div className="p-10 flex gap-6 h-full min-w-max items-stretch">
547:                   {columns.map((column) => {
548:                     const columnTasks = tasks.filter(t => t.status === column.id)
549:                     return (
550:                       <div key={column.id} className="w-80 flex flex-col h-full">
551:                         <div className="flex items-center justify-between px-1 mb-4">
552:                           <div className="flex items-center gap-2.5">
553:                             <span className={`w-2 h-2 rounded-full ${column.color}`}></span>
554:                             <h3 className="text-sm font-bold text-[#37352f]/80 uppercase tracking-wider">{column.title}</h3>
555:                             <span className="text-[11px] font-bold text-[#37352f]/30 bg-[#000000]/5 px-1.5 py-0.5 rounded">
556:                               {columnTasks.length}
557:                             </span>
558:                           </div>
559:                         </div>
560: 
561:                         <SortableContext id={column.id} items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
562:                           <DroppableContainer id={column.id} className="flex-1 flex flex-col min-h-[500px]">
563:                             <div className="flex-1 flex flex-col space-y-3 pb-6 px-1">
564:                               {columnTasks.map((task) => (
565:                                 <SortableTaskCard
566:                                   key={task.id}
567:                                   task={task}
568:                                   onEdit={openEditModal}
569:                                   onDelete={handleDeleteTask}
570:                                   activeDropdownId={activeDropdownId}
571:                                   setActiveDropdownId={setActiveDropdownId}
572:                                   userEmail={user?.email}
573:                                 />
574:                               ))}
575:                               {columnTasks.length === 0 && (
576:                                 <div className="flex-1 border border-dashed border-[#e9e9e7] rounded-xl p-8 flex flex-col items-center justify-center text-center opacity-40 bg-[#fbfbfb]">
577:                                   <p className="text-[10px] font-bold uppercase tracking-wider text-[#37352f]/40">Solte aqui</p>
578:                                 </div>
579:                               )}
580:                             </div>
581: 
582:                             <button onClick={openCreateModal} className="w-full py-2.5 px-3 rounded-lg flex items-center gap-2 text-[#37352f]/30 hover:text-[#37352f]/60 hover:bg-[#f7f7f5] transition-all group/btn mt-auto">
583:                               <Plus size={14} className="group-hover/btn:scale-110 transition-transform" />
584:                               <span className="text-xs font-bold uppercase tracking-tight">Novo</span>
585:                             </button>
586:                           </DroppableContainer>
587:                         </SortableContext>
588:                       </div>
589:                     )
590:                   })}
591:                 </div>
592: 
593:                 <DragOverlay
594:                   dropAnimation={{
595:                     duration: 250,
596:                     easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
597:                     sideEffects: defaultDropAnimationSideEffects({
598:                       styles: { active: { opacity: '0.4' } }
599:                     }),
600:                   }}
601:                 >
602:                   {activeTask ? (
603:                     <TaskCardUI
604:                       task={activeTask}
605:                       isOverlay={true}
606:                       isDragging={true}
607:                       onEdit={() => { }}
608:                       onDelete={() => { }}
609:                       activeDropdownId={null}
610:                       setActiveDropdownId={() => { }}
611:                       userEmail={user?.email}
612:                       style={{ width: '320px', cursor: 'grabbing' }}
613:                     />
614:                   ) : null}
615:                 </DragOverlay>
616:               </DndContext>
617:             )}
618: 
619:             {/* Código da tabela cortado por brevidade, pode manter o exato mesmo do arquivo original */}
620:             {viewMode === 'table' && (
621:               <div className="p-10 max-w-full overflow-x-auto space-y-12 h-screen">
622:                 {columns.map((column) => {
623:                   const columnTasks = tasks.filter(t => t.status === column.id)
624:                   if (columnTasks.length === 0) return null
625: 
626:                   return (
627:                     <div key={column.id} className="space-y-4">
628:                       <div className="flex items-center gap-3 px-1">
629:                         <span className={`w-2 h-2 rounded-full ${column.color}`}></span>
630:                         <h3 className="text-xs font-bold text-[#37352f]/80 uppercase tracking-widest">{column.title}</h3>
631:                         <span className="text-[10px] font-bold text-[#37352f]/30 bg-[#000000]/5 px-2 py-0.5 rounded-full">
632:                           {columnTasks.length}
633:                         </span>
634:                       </div>
635: 
636:                       <div className="border border-[#e9e9e7] rounded-xl overflow-hidden shadow-sm bg-white">
637:                         <table className="w-full text-left border-collapse min-w-[1000px]">
638:                           <thead>
639:                             <tr className="bg-[#f7f7f5]/50 border-b border-[#e9e9e7]">
640:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest border-r border-[#e9e9e7] w-12 text-center">
641:                                 <Plus size={12} className="mx-auto" />
642:                               </th>
643:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest border-r border-[#e9e9e7]">Tarefa</th>
644:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest border-r border-[#e9e9e7]">Responsável</th>
645:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest border-r border-[#e9e9e7]">Tags</th>
646:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest border-r border-[#e9e9e7]">Prioridade</th>
647:                               <th className="py-3 px-5 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest text-right w-32">Prazo</th>
648:                               <th className="py-3 px-2 text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest text-center w-10">...</th>
649:                             </tr>
650:                           </thead>
651:                           <tbody className="divide-y divide-[#f1f1f0]">
652:                             {columnTasks.map((task) => (
653:                               <tr key={task.id} className="group hover:bg-[#fcfcfa] transition-colors relative">
654:                                 <td className="py-4 px-5 border-r border-[#f1f1f0] text-center">
655:                                   <div className="w-4 h-4 rounded border border-[#e9e9e7] group-hover:border-[#2383e2] transition-colors mx-auto flex items-center justify-center cursor-pointer">
656:                                     <div className="w-2 h-2 rounded bg-[#2383e2] opacity-0 group-hover:opacity-20 transition-opacity" />
657:                                   </div>
658:                                 </td>
659:                                 <td className="py-4 px-5 border-r border-[#f1f1f0]">
660:                                   <span className="text-sm font-semibold text-[#37352f] line-clamp-1">{task.title}</span>
661:                                 </td>
662:                                 <td className="py-4 px-5 border-r border-[#f1f1f0]">
663:                                   <div className="flex items-center gap-2.5">
664:                                     {task.source === 'whatsapp' ? (
665:                                       <>
666:                                         <div className="w-7 h-7 flex items-center justify-center text-[#37352f]/30">
667:                                           <Phone size={14} strokeWidth={2.5} />
668:                                         </div>
669:                                         <span className="text-xs font-bold text-[#37352f]/30">WhatsApp</span>
670:                                       </>
671:                                     ) : (
672:                                       <>
673:                                         <div className="border border-white shadow-sm rounded-full overflow-hidden flex-shrink-0">
674:                                           <Avvvatars value={user?.email || 'guest'} size={24} style="character" />
675:                                         </div>
676:                                         <span className="text-xs font-bold text-[#37352f]">Eu</span>
677:                                       </>
678:                                     )}
679:                                   </div>
680:                                 </td>
681:                                 <td className="py-4 px-5 border-r border-[#f1f1f0]">
682:                                   <div className="flex flex-wrap gap-1">
683:                                     {task.tags.map(tag => (
684:                                       <span key={tag} className={`px-2 py-0.5 rounded text-[9px] font-bold border ${getTagColor(tag)}`}>
685:                                         {tag}
686:                                       </span>
687:                                     ))}
688:                                   </div>
689:                                 </td>
690:                                 <td className="py-4 px-5 border-r border-[#f1f1f0]">
691:                                   <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border ${getPriorityColor(task.priority)}`}>
692:                                     {task.priority === 'high' ? 'Crítica' : task.priority === 'medium' ? 'Normal' : 'Baixa'}
693:                                   </span>
694:                                 </td>
695:                                 <td className="py-4 px-5 text-right border-r border-[#f1f1f0]">
696:                                   <span className="text-[11px] font-extrabold text-[#37352f]/40 bg-[#f7f7f5] px-2 py-1 rounded-sm border border-[#e9e9e7]">
697:                                     {task.dueDate}
698:                                   </span>
699:                                 </td>
700:                                 <td className="py-4 px-2 text-center relative">
701:                                   <button
702:                                     onClick={(e) => {
703:                                       e.stopPropagation()
704:                                       setActiveDropdownId(activeDropdownId === task.id ? null : task.id)
705:                                     }}
706:                                     className="p-1.5 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/30 hover:text-[#37352f]"
707:                                   >
708:                                     <MoreHorizontal size={14} />
709:                                   </button>
710: 
711:                                   <Dropdown
712:                                     isOpen={activeDropdownId === task.id}
713:                                     onClose={() => setActiveDropdownId(null)}
714:                                   >
715:                                     <DropdownItem
716:                                       icon={<Edit2 size={12} />}
717:                                       label="Editar"
718:                                       onClick={() => openEditModal(task)}
719:                                     />
720:                                     <DropdownDivider />
721:                                     <DropdownItem
722:                                       icon={<Trash2 size={12} />}
723:                                       label="Excluir"
724:                                       variant="danger"
725:                                       onClick={() => handleDeleteTask(task.id)}
726:                                     />
727:                                   </Dropdown>
728:                                 </td>
729:                               </tr>
730:                             ))}
731:                           </tbody>
732:                         </table>
733:                       </div>
734:                     </div>
735:                   )
736:                 })}
737:               </div>
738:             )}
739:           </>
740:         )}
741:       </div>
742: 
743:       <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingTask(null); }} title={editingTask ? "Editar Tarefa" : "Criar Nova Tarefa"}>
744:         <TaskForm 
745:           key={editingTask?.id || 'new'}
746:           initialData={editingTask} 
747:           onSubmit={handleAddTask} 
748:           onCancel={() => { setIsModalOpen(false); setEditingTask(null); }} 
749:         />
750:       </Modal>
751: 
752:       <DeleteConfirmation
753:         isOpen={!!taskToDelete}
754:         onConfirm={executeDelete}
755:         onCancel={() => setTaskToDelete(null)}
756:       />
757:     </>
758:   )
759: }
760: 
761: export default Tasks
"""

# Remover o prefixo de número de linha (ex: "1: ")
cleaned_lines = []
for line in content.strip().split('\n'):
    # Procurar pelo padrão "número: " no início da linha
    match = re.match(r'^\d+:\s?(.*)$', line)
    if match:
        cleaned_lines.append(match.group(1))
    else:
        # Se por algum motivo a linha não tiver o padrão (ex: linha vazia no content mas que não foi numerada)
        cleaned_lines.append(line)

final_content = '\n'.join(cleaned_lines)

with open(r'c:\Users\de\Desktop\taskapp\src\pages\Tasks.tsx', 'w', encoding='utf-8') as f:
    f.write(final_content)

print("Reversão concluída com sucesso.")
