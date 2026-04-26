import React from 'react'
import {
  Plus,
  Send,
  CalendarDays,
  CheckCircle2,
} from 'lucide-react'
import { motion } from 'framer-motion'

export default function MockupsPage() {
  return (
    <div className="min-h-screen bg-white text-[#37352f] p-8 md:p-12 overflow-hidden flex flex-col items-center">
      <div className="max-w-5xl w-full space-y-4 mb-16 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#37352f]">
          UI Reference <span className="text-[#37352f]/40">Grid</span>
        </h1>
        <p className="text-[#37352f]/60 font-medium text-lg max-w-xl mx-auto">
          Mockups estilizados no formato Bento Grid, fiéis ao design system da aplicação, mas compactos e redimensionados para cópia.
        </p>
      </div>

      {/* BENTO GRID NOVO DESIGN */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-4 auto-rows-[250px] gap-6">
        
        {/* ==================================
            1. KANBAN (Col-span-2, Row-span-2)
        ================================== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="md:col-span-2 md:row-span-2 bg-[#fcfcfc] rounded-3xl p-6 relative overflow-hidden border border-[#e9e9e7] shadow-sm flex flex-col group"
        >
          <div className="absolute top-0 right-0 w-full h-full opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#37352f 1.5px, transparent 1.5px)', backgroundSize: '24px 24px' }} />
          
          <div className="flex justify-between items-center mb-6 relative z-10">
            <div>
              <h2 className="font-bold text-lg text-[#37352f] flex items-center gap-2">
                <LayoutGridIcon size={18} className="text-[#2383e2]" />
                Gestão Kanban
              </h2>
              <p className="text-xs text-[#37352f]/50">O fluxo real de tarefas em miniatura.</p>
            </div>
            <button className="bg-[#37352f] text-white w-8 h-8 rounded-full flex items-center justify-center">
              <Plus size={16} />
            </button>
          </div>

          <div className="flex-1 bg-[#f7f7f5] rounded-2xl border border-[#e9e9e7] p-4 flex gap-4 overflow-hidden relative z-10">
            {/* Coluna A Fazer */}
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#37352f]/60">A Fazer</span>
              </div>
              
              <div className="bg-white border border-[#e9e9e7] rounded-xl p-3 shadow-sm flex flex-col">
                <div className="h-2 w-3/4 bg-[#37352f]/20 rounded-full mb-2" />
                <div className="h-2 w-1/2 bg-[#37352f]/10 rounded-full" />
                <div className="flex justify-between mt-3">
                   <div className="px-2 py-0.5 bg-orange-50 border border-orange-200 text-orange-600 rounded-md text-[8px] font-bold">Amanhã</div>
                   <div className="w-4 h-4 rounded-full bg-[#1a1a1a] flex items-center justify-center text-white text-[8px] font-bold">A</div>
                </div>
              </div>

              {/* Animated Floating Card */}
              <motion.div 
                animate={{ y: [0, -10, 0], rotate: [0, -2, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="bg-white border border-[#2383e2] rounded-xl p-3 shadow-lg relative z-20 cursor-grab flex flex-col"
              >
                <div className="h-2 w-[85%] bg-[#37352f]/20 rounded-full mb-2" />
                <div className="h-2 w-[60%] bg-[#37352f]/10 rounded-full" />
                <div className="flex justify-between mt-3">
                   <div className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-600 rounded-md text-[8px] font-bold">Hoje</div>
                   <div className="flex items-center gap-1 opacity-50 grayscale">
                     <div className="w-4 h-4 rounded-full bg-[#e9e9e7]" />
                   </div>
                </div>
              </motion.div>
            </div>

            {/* Coluna Em Progresso */}
            <div className="flex-1 flex flex-col gap-3">
               <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#2383e2]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#37352f]/60">Execução</span>
              </div>
              <div className="border border-dashed border-[#d9d9d7] bg-[#f7f7f5] rounded-xl h-24 flex items-center justify-center">
                 <span className="text-[10px] text-[#37352f]/30 font-medium">Solte aqui</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ==================================
            2. DASHBOARD RESUMO (Col-span-1, Row-span-1)
        ================================== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="md:col-span-1 md:row-span-1 bg-[#37352f] text-white rounded-3xl p-6 relative overflow-hidden shadow-sm flex flex-col justify-between group"
        >
           <div className="flex justify-between items-start">
             <div className="p-2 bg-white/10 rounded-xl">
               <CheckCircle2 size={20} className="text-[#25D366]" />
             </div>
             <TrendingUpIcon size={16} className="text-white/40 group-hover:text-white transition-colors" />
           </div>
           
           <div>
             <h3 className="text-5xl font-black tracking-tight mb-1">42</h3>
             <p className="text-xs text-white/60 font-medium tracking-wide">Tarefas Concluídas</p>
           </div>
        </motion.div>

        {/* ==================================
            3. WHATSAPP CHAT (Col-span-1, Row-span-2)
        ================================== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="md:col-span-1 md:row-span-2 bg-[#efeae2] rounded-3xl overflow-hidden relative shadow-sm border border-[#e9e9e7] flex flex-col"
          style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundSize: 'cover' }}
        >
          <div className="absolute inset-0 bg-[#efeae2]/40" />
          
          <div className="bg-[#f0f2f5] p-4 flex items-center gap-3 relative z-10 border-b border-[#e9e9e7]">
             <div className="w-8 h-8 rounded-full bg-[#1a1a1a] flex items-center justify-center text-white text-xs font-bold shrink-0">
               L
             </div>
             <div className="flex flex-col">
               <span className="text-xs font-bold text-[#37352f]">Assistente IA</span>
               <span className="text-[9px] text-[#25D366] font-medium">Online</span>
             </div>
          </div>

          <div className="flex-1 p-3 pb-4 relative z-10 flex flex-col gap-3 justify-end overflow-hidden">
             {/* User Audio */}
             <motion.div 
               initial={{ x: 20, opacity: 0 }}
               animate={{ x: 0, opacity: 1 }}
               transition={{ delay: 1 }}
               className="self-end bg-[#dcf8c6] rounded-[14px] rounded-tr-[2px] p-2 pr-3 flex items-center gap-2 shadow-sm max-w-[95%]"
             >
               <CirclePlayIcon size={14} className="text-[#37352f]/50 shrink-0" />
               <div className="flex items-center gap-[2px] h-3">
                 {[1,0.5,0.8,0.3,1,0.6].map((h,i) => (
                    <motion.div key={i} animate={{ scaleY: [h, h*0.2, h] }} transition={{ repeat: Infinity, duration: 0.8+(i*0.1) }} className="w-1 bg-[#37352f]/40 rounded-full" style={{ height: '100%' }} />
                 ))}
               </div>
             </motion.div>

             {/* Bot Reply */}
             <motion.div 
               initial={{ x: -20, opacity: 0 }}
               animate={{ x: 0, opacity: 1 }}
               transition={{ delay: 2.5 }}
               className="self-start bg-white rounded-[14px] rounded-tl-[2px] p-3 shadow-sm border border-[#e9e9e7] max-w-[95%]"
             >
               <p className="text-[10px] font-semibold text-green-600 mb-1">Anotado ✅</p>
               <p className="text-[11px] text-[#37352f] leading-snug">
                 "Revisar fluxo" salvo para Terça, Prioridade Alta.
               </p>
             </motion.div>
          </div>

          <div className="bg-[#f0f2f5] p-3 relative z-10 flex items-center gap-2">
            <div className="flex-1 bg-white rounded-full h-8 px-3 flex items-center shadow-sm">
               <span className="text-[10px] text-[#37352f]/40">Mensagem...</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#25d366] text-white flex items-center justify-center shrink-0 shadow-sm">
               <Send size={12} className="ml-0.5" />
            </div>
          </div>
        </motion.div>

        {/* ==================================
            4. PERFORMANCE (Col-span-1, Row-span-1)
        ================================== */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="md:col-span-1 md:row-span-1 bg-[#f7f7f5] rounded-3xl p-6 border border-[#e9e9e7] shadow-sm flex flex-col justify-center items-center relative overflow-hidden group"
        >
          {/* Animated Circle */}
          <div className="relative w-28 h-28 mb-3">
             <svg className="w-full h-full -rotate-90">
               <circle cx="56" cy="56" r="46" stroke="#e9e9e7" strokeWidth="8" fill="none" />
               <motion.circle 
                 cx="56" cy="56" r="46" stroke="#2383e2" strokeWidth="8" fill="none" 
                 strokeDasharray="289"
                 initial={{ strokeDashoffset: 289 }}
                 animate={{ strokeDashoffset: 289 * 0.25 }} // 75%
                 transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
                 strokeLinecap="round"
               />
             </svg>
             <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-2xl font-black text-[#37352f] group-hover:scale-110 transition-transform">75%</span>
             </div>
          </div>
          <p className="text-xs font-semibold text-[#37352f]/50">Eficiência Semanal</p>
        </motion.div>

        {/* ==================================
            5. CALENDÁRIO / TIMELINE (Col-span-2, Row-span-1)
        ================================== */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="md:col-span-2 md:row-span-1 bg-white rounded-3xl p-6 border border-[#e9e9e7] shadow-sm flex flex-col justify-center"
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-bold text-lg text-[#37352f] flex items-center gap-2">
              <CalendarDays size={18} className="text-[#f59e0b]" />
              Visão Semanal
            </h2>
            <div className="flex gap-2">
               <div className="w-6 h-6 rounded-md bg-[#f7f7f5] border border-[#e9e9e7] flex items-center justify-center text-[#37352f]/40 cursor-pointer"><ChevronLeftIcon size={14}/></div>
               <div className="w-6 h-6 rounded-md bg-[#f7f7f5] border border-[#e9e9e7] flex items-center justify-center text-[#37352f]/40 cursor-pointer"><ChevronRightIcon size={14}/></div>
            </div>
          </div>

          <div className="flex gap-3 h-24 w-full">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((day, i) => (
               <motion.div 
                 key={day} 
                 whileHover={{ y: -4 }}
                 className={`flex-1 rounded-2xl flex flex-col items-center justify-center border relative overflow-hidden cursor-pointer ${i === 2 ? 'bg-[#37352f] border-[#37352f] text-white shadow-md' : 'bg-[#f7f7f5] border-[#e9e9e7] text-[#37352f] hover:bg-white'}`}
               >
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${i === 2 ? 'text-white/60' : 'text-[#37352f]/40'}`}>{day}</span>
                  <span className={`text-xl font-black mt-0.5 ${i === 2 ? 'text-white' : 'text-[#37352f]'}`}>{12 + i}</span>
                  
                  {/* Event Indicator */}
                  {i === 2 && (
                    <motion.div 
                      layoutId="active-day-dot"
                      className="absolute bottom-2 w-1.5 h-1.5 rounded-full bg-[#25D366]" 
                    />
                  )}
                  {i === 1 && (
                    <div className="absolute bottom-2 w-1 h-1 rounded-full bg-[#2383e2]" />
                  )}
                  {i === 4 && (
                    <div className="absolute bottom-2 w-1 h-1 rounded-full bg-[#f59e0b]" />
                  )}
               </motion.div>
            ))}
          </div>
        </motion.div>

      </div>
    </div>
  )
}

// Icons
function LayoutGridIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
  )
}
function TrendingUpIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  )
}
function CirclePlayIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
  )
}
function ChevronLeftIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  )
}
function ChevronRightIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  )
}
