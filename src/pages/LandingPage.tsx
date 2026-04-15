import React, { useEffect, useState, useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import NumberFlow from '@number-flow/react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import logo from '../assets/logo/logo.svg'
import finloz from '../assets/logo/lui.svg'
import flowIcon from '../assets/logo/flow.svg'
import gratisIcon from '../assets/logo/gratis.svg'
import pulseIcon from '../assets/logo/pulse.svg'
import DeepSeekLandingChat from '../components/DeepSeekLandingChat'

const LandingPage: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [price, setPrice] = useState(0)
  const [teamPrice, setTeamPrice] = useState(0)
  const priceRef = useRef(null)
  const isPriceInView = useInView(priceRef, { once: true, amount: 0.5 })

  useEffect(() => {
    if (isPriceInView) {
      const timer = setTimeout(() => {
        setPrice(9.90)
        setTeamPrice(29.90)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isPriceInView])

  useEffect(() => {
    // Se o usuário já estiver logado e cair na Landing Page, joga ele pro dashboard/checkout
    if (user) {
      navigate('/checkout-preview', { replace: true })
    }
  }, [user, navigate])

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-white text-[#37352f] font-sans selection:bg-[#37352f]/10 relative overflow-x-hidden">
      {/* Background Grid Moderno com Mockups Transparentes */}
      <div className="absolute top-0 left-0 w-full h-[1000px] pointer-events-none z-0 overflow-hidden">
        <div className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(55, 53, 47, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(55, 53, 47, 0.05) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 70%, transparent 100%)'
          }}
        />

        {/* Mockup Fragments Floating in Background */}
        <div className="absolute inset-0 opacity-[0.05] select-none">
          {/* Calendar Grid Fragment - Top Left */}
          <motion.div
            animate={{ x: [0, 15, 0], y: [0, 20, 0], rotate: [-2, 2, -2] }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-[5%] left-[-5%] w-72 h-64 bg-[#37352f]/5 border border-[#37352f]/10 rounded-3xl p-4 flex flex-col gap-3"
          >
            <div className="flex justify-between items-center px-1">
              <div className="w-12 h-2 bg-[#37352f]/20 rounded-full" />
              <div className="flex gap-1"><div className="w-1 h-1 bg-[#37352f]/40 rounded-full" /><div className="w-1 h-1 bg-[#37352f]/40 rounded-full" /></div>
            </div>
            <div className="grid grid-cols-7 gap-2 flex-1">
              {Array.from({ length: 28 }).map((_, i) => (
                <div key={i} className="aspect-square border border-[#37352f]/10 rounded-md flex flex-col items-center justify-center p-0.5">
                  <div className={`w-full h-1 bg-[#37352f]/20 rounded-full ${[3, 8, 15, 22].includes(i) ? 'opacity-100' : 'opacity-0'}`} />
                </div>
              ))}
            </div>
          </motion.div>

          {/* Task Detail Card - Middle Right */}
          <motion.div
            animate={{ x: [0, -20, 0], y: [0, -10, 0], rotate: [5, 8, 5] }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-[35%] right-[-8%] w-80 h-48 bg-[#37352f]/5 border border-[#37352f]/10 rounded-2xl p-6 flex flex-col gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md border-2 border-[#37352f]/40" />
              <div className="h-3 w-40 bg-[#37352f]/30 rounded-full" />
            </div>
            <div className="space-y-2 ml-9">
              <div className="h-1.5 w-full bg-[#37352f]/10 rounded-full" />
              <div className="h-1.5 w-[70%] bg-[#37352f]/10 rounded-full" />
              <div className="flex gap-2 mt-4">
                <div className="px-3 py-1 bg-[#37352f]/10 rounded-md w-16 h-4" />
                <div className="px-3 py-1 bg-[#37352f]/5 rounded-md w-12 h-4" />
              </div>
            </div>
          </motion.div>

          {/* Stats Bar Table - Bottom Center-ish */}
          <motion.div
            animate={{ y: [0, 25, 0], x: [0, -10, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-[10%] left-[30%] w-[500px] h-32 bg-[#37352f]/5 border border-[#37352f]/10 rounded-t-3xl p-6 flex flex-col gap-4"
          >
            <div className="flex gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex-1 h-3 bg-[#37352f]/10 rounded-full relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-[#37352f]/20" style={{ width: `${20 + i * 15}%` }} />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div className="h-1 w-full bg-[#37352f]/5 rounded-full" />
              <div className="h-1 w-full bg-[#37352f]/5 rounded-full" />
            </div>
          </motion.div>

          {/* Icon Pattern - Bottom Right */}
          <motion.div
            animate={{ rotate: [15, 20, 15], scale: [1, 1.1, 1] }}
            transition={{ duration: 12, repeat: Infinity }}
            className="absolute bottom-[-5%] right-[5%] grid grid-cols-3 gap-8 opacity-[0.4]"
          >
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="w-12 h-12 rounded-2xl border-2 border-[#37352f]/20 flex items-center justify-center p-3">
                <div className="w-full h-full bg-[#37352f]/10 rounded-lg animate-pulse" />
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Navbar Minimalista */}
      <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
          <span className="text-xl font-bold tracking-tight">flui.</span>
        </div>

        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          <a href="#features" onClick={(e) => scrollToSection(e, 'features')} className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Funcionalidades</a>
          <a href="#pricing" onClick={(e) => scrollToSection(e, 'pricing')} className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Planos</a>
          <a href="#faq" onClick={(e) => scrollToSection(e, 'faq')} className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">Dúvidas</a>
        </nav>

        <div className="flex items-center gap-4">
          {user ? (
            <Link to="/checkout-preview" className="bg-[#202020] text-white text-sm font-medium px-4 py-2 rounded-[6px] shadow-sm hover:bg-[#202020]/90 transition-all">
              Acessar Painel
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors hidden sm:block">
                Fazer login
              </Link>
              <Link to="/login" className="bg-[#202020] text-white text-sm font-medium px-4 py-2 rounded-[6px] shadow-md shadow-black/5 hover:bg-[#202020]/90 transition-all">
                Criar conta
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="w-full max-w-6xl mx-auto px-6 py-12 md:py-24 flex flex-col items-center justify-center relative z-10">
        <div className="relative text-center max-w-3xl mb-16 md:mb-24">

          {/* Floating Minimalist Icons */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, y: [-15, 15, -15], rotate: [-10, 5, -10] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", opacity: { duration: 1 }, scale: { duration: 1, type: "spring" } }}
            className="absolute -top-10 -left-8 md:-left-24 w-12 h-12 bg-white rounded-2xl border border-[#e9e9e7] shadow-sm flex items-center justify-center -rotate-12 hidden md:flex"
          >
            <svg className="w-5 h-5 text-[#37352f]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, y: [15, -15, 15], x: [0, 5, 0], rotate: [15, -5, 15] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.5, opacity: { duration: 1 }, scale: { duration: 1, type: "spring" } }}
            className="absolute top-24 -right-8 md:-right-24 w-16 h-16 bg-[#fcfcfc] rounded-full border border-[#f1f1f0] shadow-sm flex flex-col items-center justify-center rotate-6 hidden md:flex"
          >
            <div className="w-5 h-1.5 bg-[#37352f]/20 rounded-full mb-1.5" />
            <div className="w-8 h-1.5 bg-[#37352f]/10 rounded-full" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, y: [-10, 10, -10], rotate: [0, -15, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1, opacity: { duration: 1 }, scale: { duration: 1, type: "spring" } }}
            className="absolute bottom-4 -left-4 md:-left-16 w-10 h-10 bg-[#f7f7f5] rounded-xl border border-[#e9e9e7] flex items-center justify-center hidden md:flex"
          >
            <svg className="w-4 h-4 text-[#37352f]/30" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, y: [5, -15, 5], rotate: [10, 0, 10] }}
            transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 1.5, opacity: { duration: 1 }, scale: { duration: 1, type: "spring" } }}
            className="absolute -bottom-8 right-4 md:-right-8 w-12 h-12 bg-white rounded-lg border border-[#e9e9e7] flex items-center justify-center shadow-sm rotate-12 hidden md:flex"
          >
            <div className="w-2.5 h-2.5 rounded-full border-2 border-[#37352f]/30" />
          </motion.div>

          <div className="relative z-10 flex flex-col items-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, type: "spring", stiffness: 70 }}
              className="text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] text-[#202020] mb-6"
            >
              Sua mente livre.
              <span className="block mt-2">Suas tarefas, resolvidas.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, type: "spring", stiffness: 70 }}
              className="text-lg md:text-xl text-[#37352f]/60 font-medium leading-relaxed max-w-2xl mx-auto"
            >
              Gerencie sua vida sem atrito, domine sua rotina e tenha uma AI cuidando de suas tarefas repetitivas.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35, type: "spring", stiffness: 70 }}
              className="mt-8"
            >
              <Link
                to={user ? "/dashboard" : "/login"}
                className="relative inline-block overflow-hidden bg-[#202020] text-white font-semibold text-base px-8 py-4 rounded-2xl shadow-lg shadow-black/10 hover:bg-[#30302E] transition-colors"
              >
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                  }}
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.5, ease: 'easeInOut' }}
                />
                Comece usando gratuito.
              </Link>
            </motion.div>
          </div>
        </div>

        {/* Infinite Feature Marquee */}
        <div
          className="w-full max-w-5xl mx-auto relative overflow-hidden py-10 mb-16 md:mb-24 flex items-center"
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)'
          }}
        >
          <motion.div
            animate={{ x: [0, -1000] }}
            transition={{ duration: 25, ease: "linear", repeat: Infinity }}
            className="flex w-max"
          >
            {[1, 2].map((_, index) => (
              <div key={index} className="flex items-center">
                {[
                  { text: 'Inteligência Artificial', icon: <div className="w-2 h-2 rounded-full bg-[#37352f]/20" /> },
                  { text: 'Gestão Ágil', icon: <div className="w-2 h-2 rotate-45 bg-[#37352f]/20" /> },
                  { text: 'Automações Fluidas', icon: <svg className="w-3 h-3 text-[#37352f]/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg> },
                  { text: 'Kanban Intuitivo', icon: <div className="w-2 h-2 rounded-[2px] bg-[#37352f]/20" /> },
                  { text: 'Foco Total', icon: <svg className="w-3 h-3 text-[#37352f]/20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg> },
                  { text: 'Assistente por Áudio', icon: <div className="w-1.5 h-3 rounded-full bg-[#37352f]/20" /> },
                  { text: 'Análises Inteligentes', icon: <div className="w-2 h-2 rounded-tl-full rounded-br-full bg-[#37352f]/20 border border-[#37352f]/30" /> },
                  { text: 'Hiper Produtividade', icon: <svg className="w-3 h-3 text-[#37352f]/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
                ].map((item, j) => (
                  <div key={j} className="flex items-center gap-4 mx-6">
                    {item.icon}
                    <span className="text-xl md:text-2xl font-extrabold text-[#37352f]/20 tracking-tight whitespace-nowrap">{item.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </div>

        {/* Bento Grid */}
        <div id="features" className="w-full grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[340px]">

          {/* Card Maior - Workspace & Mockup */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7 }}
            className="md:col-span-2 bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-8 relative overflow-hidden flex flex-col shadow-sm"
          >
            <div className="absolute top-0 right-0 w-full h-full opacity-[0.03]"
              style={{ backgroundImage: 'radial-gradient(#37352f 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

            <div className="relative z-10 mb-auto">
              <h3 className="text-xl font-bold tracking-tight mb-2">Seu Segundo Cérebro</h3>
              <p className="text-[#37352f]/60 font-medium text-sm max-w-[280px]">Sua produtividade ganha super poderes com nossa inteligência artificial integrada nativamente.</p>
            </div>

            <div className="absolute -bottom-8 -right-8 w-[400px] h-[300px] flex items-end justify-end pointer-events-none">

              {/* Kanban Board Mockup */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10, rotate: -2 }}
                animate={{ opacity: 1, scale: 1, y: 0, rotate: -2 }}
                transition={{ duration: 1.2, type: "spring", damping: 20 }}
                className="absolute top-10 left-8 w-[340px] h-[230px] bg-white border border-[#e9e9e7] rounded-2xl shadow-[0_30px_50px_-15px_rgba(0,0,0,0.15)] z-10 overflow-hidden flex flex-col"
              >
                {/* Browser Header */}
                <div className="h-10 border-b border-[#f1f1f0] flex items-center px-4 gap-3 bg-[#fcfcfc] shrink-0">
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <div className="h-3 w-16 bg-[#e9e9e7] rounded-md ml-2" />
                </div>

                {/* Kanban Body */}
                <div className="flex-1 bg-[#f7f7f5] p-3 flex gap-2 overflow-hidden">

                  {/* Column 1: Todo */}
                  <div className="flex-1 flex flex-col gap-2 relative">
                    <div className="h-2.5 w-10 bg-[#e9e9e7] rounded mb-0.5" />

                    <motion.div className="bg-white border border-[#e9e9e7] rounded-md p-1.5 shadow-sm flex flex-col gap-1.5">
                      <div className="h-1.5 w-[90%] bg-[#37352f]/10 rounded-full" />
                      <div className="h-1.5 w-[60%] bg-[#37352f]/5 rounded-full" />
                      <div className="flex justify-between items-center mt-1">
                        <div className="h-2.5 w-6 bg-[#2383e2]/20 rounded" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#f1f1f0]" />
                      </div>
                    </motion.div>

                    {/* Animated Drag Card */}
                    <motion.div
                      animate={{
                        x: [0, 95, 95, 0],
                        y: [0, -5, -5, 0],
                        rotate: [0, 4, 4, 0],
                        scale: [1, 1.05, 1.05, 1],
                        zIndex: [10, 30, 30, 10]
                      }}
                      transition={{
                        duration: 6,
                        repeat: Infinity,
                        times: [0, 0.35, 0.75, 1],
                        ease: "easeInOut"
                      }}
                      className="bg-white border border-[#2383e2] rounded-md p-1.5 shadow-md flex flex-col gap-1.5 absolute top-[45px] w-full"
                    >
                      <div className="h-1.5 w-[85%] bg-[#37352f]/20 rounded-full" />
                      <div className="h-1.5 w-[50%] bg-[#37352f]/10 rounded-full" />
                      <div className="flex justify-between items-center mt-1">
                        <div className="h-2.5 w-8 bg-[#ffbd2e]/30 rounded" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#202020] flex items-center justify-center">
                          <div className="w-1 h-1 bg-white rounded-full" />
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {/* Column 2: In Progress */}
                  <div className="flex-1 flex flex-col gap-2 relative">
                    <div className="flex gap-1 items-center mb-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#ffbd2e]" />
                      <div className="h-2.5 w-14 bg-[#e9e9e7] rounded" />
                    </div>

                    {/* Placeholder */}
                    <div className="border border-dashed border-[#e9e9e7] bg-[#f1f1f0]/40 rounded-md h-[44px] w-full" />

                    <motion.div className="bg-white border border-[#e9e9e7] rounded-md p-1.5 shadow-sm flex flex-col gap-1.5 opacity-60">
                      <div className="h-1.5 w-full bg-[#37352f]/10 rounded-full" />
                      <div className="h-1.5 w-1/3 bg-[#37352f]/5 rounded-full" />
                    </motion.div>
                  </div>

                  {/* Column 3: Done */}
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex gap-1 items-center mb-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#28c840]" />
                      <div className="h-2.5 w-12 bg-[#e9e9e7] rounded" />
                    </div>

                    <motion.div className="bg-[#fcfcfc] border border-[#e9e9e7] rounded-md p-1.5 shadow-sm flex flex-col gap-1.5 opacity-60">
                      <div className="h-1.5 w-full bg-[#37352f]/10 rounded-full line-through" />
                      <div className="flex justify-between items-center mt-1">
                        <div className="h-2.5 w-6 bg-[#28c840]/20 rounded" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/10 flex items-center justify-center">
                          <svg className="w-1.5 h-1.5 text-[#28c840]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </div>
                      </div>
                    </motion.div>

                    <motion.div className="bg-[#fcfcfc] border border-[#e9e9e7] rounded-md p-1.5 shadow-sm flex flex-col gap-1.5 opacity-60">
                      <div className="h-1.5 w-[70%] bg-[#37352f]/10 rounded-full line-through" />
                      <div className="flex justify-between items-center mt-1">
                        <div className="h-2.5 w-5 bg-[#28c840]/20 rounded" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/10 flex items-center justify-center">
                          <svg className="w-1.5 h-1.5 text-[#28c840]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </motion.div>


            </div>
          </motion.div>

          {/* Card Calendário - Mockup Animado */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-8 relative overflow-hidden flex flex-col shadow-sm"
          >
            <div className="relative z-10 mb-auto">
              <h3 className="text-xl font-bold tracking-tight mb-2">Visão por Calendário</h3>
              <p className="text-[#37352f]/60 font-medium text-sm">Visualize sua semana e planeje seus próximos passos com clareza visual absoluta.</p>
            </div>

            <div className="absolute -bottom-4 left-0 w-full px-6 pointer-events-none">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="w-full bg-white border border-[#e9e9e7] rounded-t-2xl shadow-xl shadow-black/5 overflow-hidden"
              >
                {/* Mini Calendar Header */}
                <div className="p-3 border-b border-[#f1f1f0] flex items-center justify-between">
                  <div className="flex gap-2">
                    <div className="w-6 h-2 bg-[#37352f]/10 rounded-full" />
                    <div className="w-10 h-2 bg-[#37352f]/5 rounded-full" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#37352f]/10 rounded-full" />
                    <div className="w-1.5 h-1.5 bg-[#37352f]/10 rounded-full" />
                  </div>
                </div>

                {/* Mini Calendar Grid */}
                <div className="p-3 grid grid-cols-7 gap-1.5">
                  {/* Days Labels */}
                  {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
                    <div key={i} className="text-[7px] font-bold text-[#37352f]/20 text-center mb-1">{d}</div>
                  ))}

                  {/* Calendar Days Cells */}
                  {Array.from({ length: 28 }).map((_, i) => {
                    const day = i + 1;
                    const hasTask = [3, 8, 12, 19, 21].includes(day);
                    const isToday = day === 12;

                    return (
                      <div
                        key={i}
                        className={`aspect-square rounded-md border flex flex-col items-center justify-start py-1 gap-1 relative ${isToday ? 'border-[#37352f] bg-[#f7f7f5]' : 'border-[#f1f1f0] bg-white'}`}
                      >
                        <span className={`text-[8px] font-bold ${isToday ? 'text-[#37352f]' : (day > 14 ? 'text-[#37352f]/10' : 'text-[#37352f]/30')}`}>{day}</span>

                        {hasTask && (
                          <motion.div
                            initial={{ scaleX: 0 }}
                            whileInView={{ scaleX: 1 }}
                            transition={{ delay: 0.5 + (i * 0.05), duration: 0.5 }}
                            className={`h-[3px] w-[70%] rounded-full ${day === 12 ? 'bg-[#2383e2]' : 'bg-[#37352f]/10'}`}
                          />
                        )}

                        {day === 19 && (
                          <motion.div
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute inset-0 bg-blue-50/40 rounded-md ring-1 ring-blue-500/20"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Task Details Popup - Animated */}
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 3, duration: 0.8, type: "spring" }}
                  className="absolute bottom-6 right-4 w-32 bg-white border border-[#e9e9e7] rounded-xl shadow-2xl p-2.5 z-20"
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#2383e2]" />
                    <div className="h-1.5 w-12 bg-[#37352f]/20 rounded-full" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-1 w-full bg-[#37352f]/5 rounded-full" />
                    <div className="h-1 w-[80%] bg-[#37352f]/5 rounded-full" />
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>

          {/* Card Flow / Progresso */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="md:col-span-1 bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-8 relative overflow-hidden flex flex-col shadow-sm"
          >
            <div className="relative z-10">
              <h3 className="text-xl font-bold tracking-tight mb-2">Seu assistente via WhatsApp</h3>
              <p className="text-[#37352f]/60 font-medium text-sm">Crie tarefas de áudio ou texto direto pelo celular.</p>
            </div>

            <div className="absolute -bottom-2 -right-2 w-full h-full flex items-end justify-end pointer-events-none p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                whileInView={{ opacity: 1, scale: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="w-[220px] h-auto min-h-[165px] bg-[#fcfcfc] rounded-2xl border border-[#e9e9e7] shadow-xl shadow-black/5 p-4 flex flex-col gap-3 justify-end"
              >
                {/* User Audio Bubble */}
                <motion.div
                  initial={{ opacity: 0, x: 20, scale: 0.9 }}
                  whileInView={{ opacity: 1, x: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3, duration: 0.6, type: "spring" }}
                  className="w-[85%] bg-[#25D366] text-white rounded-[14px] rounded-tr-[4px] p-2.5 shadow-sm self-end"
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 opacity-90 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" /></svg>

                    {/* Animated Waveform */}
                    <div className="flex gap-[1.5px] items-center flex-1 h-3.5 mx-1">
                      {[0.4, 0.7, 1, 0.6, 0.3, 0.8, 0.5, 0.9, 0.4, 0.7].map((h, i) => (
                        <motion.div
                          key={i}
                          animate={{ scaleY: [h, h * 0.3, h] }}
                          transition={{ duration: 0.7 + (i % 3) * 0.1, repeat: Infinity, ease: "easeInOut" }}
                          className="flex-1 bg-white rounded-full origin-center"
                          style={{ height: '100%' }}
                        />
                      ))}
                    </div>

                    <span className="text-[8px] font-bold opacity-80 shrink-0">0:04</span>
                  </div>
                </motion.div>

                {/* System Reply Bubble */}
                <motion.div
                  initial={{ opacity: 0, x: -20, scale: 0.9 }}
                  whileInView={{ opacity: 1, x: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 1.2, duration: 0.6, type: "spring" }}
                  className="w-[85%] bg-white border border-[#e9e9e7] text-[#37352f] rounded-[14px] rounded-tl-[4px] p-2 shadow-sm self-start relative ml-1"
                >
                  <div className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-[#202020] border-2 border-[#fcfcfc] flex items-center justify-center shadow-sm z-10">
                    <div className="w-1 h-1 bg-white shadow-sm transform rotate-45" />
                  </div>
                  <div className="flex flex-col gap-1 pl-2.5 pr-1.5 py-0.5">
                    <span className="text-[9px] font-medium leading-[1.4] text-[#37352f]/90">
                      Tarefa salva! 🎉<br />
                      <strong className="text-[#37352f]">Ligar pro fornecedor</strong><br />
                      <span className="text-[#37352f]/60">Marquei para <strong>hoje</strong> c/ prioridade <strong>alta</strong>.</span>
                    </span>
                    <span className="text-[7px] text-right font-bold text-[#37352f]/30 -mt-1">10:48</span>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>

          {/* CTA Footer Card (col-span-2) */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="md:col-span-2 bg-[#f7f7f5] border border-[#e9e9e7] text-[#37352f] rounded-3xl p-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-center shadow-sm md:pl-10 h-full"
          >
            <div className="absolute top-0 right-0 w-full h-full opacity-30 pointer-events-none"
              style={{ backgroundImage: 'radial-gradient(#e9e9e7 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

            {/* Logos Decorativas - Fora do texto */}
            <motion.img 
              src={logo} 
              alt="Logo" 
              className="absolute top-6 left-6 w-14 h-14 object-contain opacity-80"
              initial={{ opacity: 0, y: -20, rotate: -12 }}
              whileInView={{ opacity: 0.8, y: 0, rotate: -12 }}
              transition={{ delay: 0.4, type: 'spring' }}
            />
            <motion.img 
              src={finloz} 
              alt="Lui" 
              className="absolute bottom-6 right-6 w-14 h-14 object-contain opacity-80"
              initial={{ opacity: 0, y: 20, rotate: 12 }}
              whileInView={{ opacity: 0.8, y: 0, rotate: 12 }}
              transition={{ delay: 0.5, type: 'spring' }}
            />

            <div className="relative z-10 text-center md:text-left mb-6 md:mb-0">
              <h3 className="text-2xl font-bold tracking-tight mb-2">Pronto para acelerar?</h3>
              <p className="text-[#37352f]/60 font-medium text-sm">Crie sua conta em segundos e experimente o futuro.</p>
            </div>

            <div className="relative z-10 shrink-0">
              <Link to={user ? "/checkout-preview" : "/login"} className="bg-[#202020] text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-md shadow-[#202020]/10 hover:bg-[#30302E] hover:scale-[1.02] transition-all inline-block">
                {user ? "Acessar Painel" : "Criar conta"}
              </Link>
            </div>
          </motion.div>

        </div>

        {/* Pricing Section */}
        <div id="pricing" className="w-full mt-24 mb-8 md:mt-32 md:mb-16 flex flex-col items-center">
          <div className="text-center mb-12 space-y-3">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Escolha seu plano.</h2>
            <p className="text-[#37352f]/60 font-medium">Comece grátis e evolua quando estiver pronto.</p>
          </div>


          <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">

            {/* Card Gratuito */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              whileInView={{ opacity: 1, scale: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.7, type: "spring", bounce: 0.4 }}
              className="w-full h-full bg-[#fcfcfc] border border-[#e9e9e7] rounded-3xl p-8 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.05)] relative overflow-hidden flex flex-col"
            >
              <div className="absolute -top-16 -right-16 w-32 h-32 bg-black/5 blur-3xl rounded-full" />

              <div className="flex justify-between items-center pb-6 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center justify-center bg-[#f7f7f5] border border-[#e9e9e7] w-12 h-12 rounded-2xl shadow-sm shrink-0">
                    <img src={gratisIcon} alt="Gratuito" className="w-8 h-8 object-contain" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-[#37352f]">Gratuito</h3>
                </div>
                <div className="text-right flex flex-col items-end">
                  <span className="text-3xl font-black tracking-tight text-[#37352f]">R$ 0</span>
                  <span className="text-[10px] font-bold text-[#37352f]/40 tracking-widest uppercase -mt-1">Para Sempre</span>
                </div>
              </div>
              <hr className="-mx-8 border-t border-[#e9e9e7]" />

              <div className="space-y-4 py-8 relative z-10 flex-1">
                {[
                  'Tarefas manuais ilimitadas',
                  'Painel e calendário',
                  'Organização básica',
                ].map((benefit, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm font-medium text-[#37352f]/60">
                    <div className="w-4 h-4 rounded-full bg-white border border-[#e9e9e7] flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-[#37352f]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    {benefit}
                  </div>
                ))}
                {[
                  'Lui Assistant (WhatsApp)',
                  'Sincronização em Nuvem',
                  'Suporte Prioritário',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm font-medium text-[#37352f]/25 line-through">
                    <div className="w-4 h-4 rounded-full bg-white border border-[#e9e9e7] flex items-center justify-center shrink-0 opacity-40">
                      <svg className="w-2.5 h-2.5 text-[#37352f]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </div>
                    {item}
                  </div>
                ))}
              </div>

              <Link
                to={user ? "/dashboard" : "/login"}
                className="w-full py-3.5 border border-[#e9e9e7] bg-white text-[#37352f]/60 text-sm font-bold rounded-xl hover:bg-[#f7f7f5] hover:text-[#37352f] transition-all flex items-center justify-center gap-2 relative z-10"
              >
                {user ? "Acessar painel" : "Começar grátis"}
              </Link>
            </motion.div>

            {/* Card Flow */}
            <div className="relative flex flex-col">
{/* Card Flow - Destacado */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                whileInView={{ opacity: 1, scale: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.7, type: "spring", bounce: 0.4, delay: 0.1 }}
                className="w-full h-full bg-[#fcfcfc] border border-[#e9e9e7] rounded-3xl p-8 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] relative overflow-hidden flex flex-col md:-mt-6 md:mb-6 z-20 border-black/5"
              >
                <div className="absolute -top-16 -right-16 w-32 h-32 bg-black/5 blur-3xl rounded-full" />

                <div className="flex justify-between items-center pb-6 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex items-center justify-center bg-[#f7f7f5] border border-[#e9e9e7] w-12 h-12 rounded-2xl shadow-sm shrink-0">
                      <img src={flowIcon} alt="Flow" className="w-8 h-8 object-contain" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-[#37352f]">Flow</h3>
                  </div>
                  <div ref={priceRef} className="text-right flex flex-col items-end">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black tracking-tight text-[#37352f]">R$</span>
                      <NumberFlow
                        value={price}
                        format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                        className="text-3xl font-black tracking-tight text-[#37352f]"
                      />
                    </div>
                    <span className="text-[10px] font-bold text-[#37352f]/40 tracking-widest uppercase -mt-1">/ mês</span>
                  </div>
                </div>
                <hr className="-mx-8 border-t border-[#e9e9e7]" />

                <div className="space-y-4 py-8 relative z-10 flex-1">
                  {[
                    'Tarefas e Projetos Ilimitados',
                    'Lui (Áudios & Mensagens)',
                    'Sincronização em Nuvem',
                    'Sem limites ou amarras',
                    'Suporte Prioritário'
                  ].map((benefit, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 text-sm font-medium text-[#37352f]/70"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#f1f1f0] border border-[#e9e9e7] flex items-center justify-center shrink-0">
                        <svg className="w-2.5 h-2.5 text-[#37352f]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      {benefit}
                    </div>
                  ))}
                </div>

                <p className="text-center text-[10px] font-medium text-[#37352f]/40 mb-4 relative z-10">
                  Pagamento processado pelo Stripe.<br />
                  Cancele com um clique, quando quiser.
                </p>

                <Link
                  to={user ? "/checkout-preview" : "/login"}
                  className="w-full py-3.5 bg-[#202020] text-white text-sm font-bold rounded-xl hover:bg-[#30302E] transition-all flex items-center justify-center gap-2 shadow-xl shadow-[#202020]/10 hover:shadow-[#202020]/20 transform hover:-translate-y-0.5 relative z-10"
                >
                  Assinar agora
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </Link>
              </motion.div>
            </div>

            {/* Card Pulse */}
{/* Card Pulse */}
            <div className="relative flex flex-col">
              <motion.div 
                initial={{ opacity: 0, y: 10, x: '-50%' }}
                whileInView={{ opacity: 1, y: 0, x: '-50%' }}
                viewport={{ once: true }}
                transition={{ delay: 0.6, duration: 0.5 }}
                className="absolute -top-3 left-1/2 z-20 bg-white border border-[#e9e9e7] px-4 py-1.5 rounded-full shadow-sm flex items-center whitespace-nowrap"
              >
                <span className="text-[10px] font-bold text-[#37352f]/60 tracking-tight">Ideal para empresas e times</span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                whileInView={{ opacity: 1, scale: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.7, type: "spring", bounce: 0.4, delay: 0.2 }}
                className="w-full h-full bg-[#fcfcfc] border border-[#e9e9e7] rounded-3xl p-8 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.05)] relative overflow-hidden flex flex-col"
              >
                <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full" />

                <div className="flex justify-between items-center pb-6 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex items-center justify-center bg-[#f7f7f5] border border-[#e9e9e7] w-12 h-12 rounded-2xl shadow-sm shrink-0">
                      <img src={pulseIcon} alt="Pulse" className="w-8 h-8 object-contain" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-[#37352f]">Pulse</h3>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black tracking-tight text-[#37352f]">R$</span>
                      <NumberFlow
                        value={teamPrice}
                        format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                        className="text-3xl font-black tracking-tight text-[#37352f]"
                      />
                    </div>
                    <span className="text-[10px] font-bold text-[#37352f]/40 tracking-widest uppercase -mt-1">/ membro</span>
                  </div>
                </div>
                <hr className="-mx-8 border-t border-[#e9e9e7]" />

                <div className="space-y-4 py-8 relative z-10 flex-1">
                  {[
                    'Tudo do plano Flow',
                    'Gestão de Equipes',
                    'Workspaces Compartilhados',
                    'Convidar Membros',
                    'Faturamento Centralizado',
                    'Suporte VIP 24/7'
                  ].map((benefit, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 + (i * 0.1) }}
                      viewport={{ once: true }}
                      className="flex items-center gap-3 text-sm font-medium text-[#37352f]/70"
                    >
                      <div className="w-4 h-4 rounded-full bg-[#f1f1f0] border border-[#e9e9e7] flex items-center justify-center shrink-0">
                        <svg className="w-2.5 h-2.5 text-[#37352f]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      {benefit}
                    </motion.div>
                  ))}
                </div>

                <Link
                  to={user ? "/checkout-preview" : "/login"}
                  className="w-full py-3.5 bg-[#202020] text-white text-sm font-bold rounded-xl hover:bg-[#303030] transition-all flex items-center justify-center gap-2 transform hover:-translate-y-0.5 relative z-10 shadow-sm"
                >
                  Assinar agora
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </Link>
              </motion.div>
            </div>

          </div>
        </div>

        <FAQSection />

        {/* Final CTA */}
        <div className="w-full max-w-5xl mx-auto mb-0 px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl p-8 md:p-10 flex flex-col md:flex-row items-center justify-between text-center md:text-left gap-6 shadow-sm"
          >
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold tracking-tight mb-2">
                Pronto para assumir o controle?
              </h2>
              <p className="text-[#37352f]/60 font-medium text-sm">
                Junte-se ao novo padrão de produtividade. Sem distrações, apenas foco.
              </p>
            </div>

            <Link to={user ? "/checkout-preview" : "/login"} className="bg-[#202020] text-white text-sm font-bold px-6 py-3 rounded-xl hover:bg-[#30302E] hover:scale-[1.02] transition-all flex items-center shrink-0 gap-2 shadow-sm">
              {user ? "Acessar meu painel" : "Criar conta"}
              <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </Link>
          </motion.div>
        </div>

      </main>

      {/* Footer Minimalista */}
      <footer className="w-full border-t border-[#e9e9e7] bg-[#f7f7f5] py-8 relative z-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-base font-bold text-[#37352f] tracking-tight flex items-center gap-2">
            <img src={logo} alt="Flui Logo" className="w-6 h-6 object-contain opacity-80" />
            flui.
          </div>
          <p className="text-xs font-medium text-[#37352f]/40">© {new Date().getFullYear()} Flui. Feito com extrema clareza.</p>
        </div>
      </footer>
      <DeepSeekLandingChat />
    </div>
  )
}

const faqs = [
  {
    q: "O que torna o Flui diferente de outras ferramentas?",
    a: "O Flui não é apenas uma lista de tarefas, é um ecossistema focado no essencial. Com a integração nativa do Lui (nosso assistente IA de WhatsApp), você cria, detalha e categoriza grandes demandas de trabalho com apenas um áudio. A interface minimalista foca em eliminar o peso invisível da usabilidade excessiva."
  },
  {
    q: "Posso acessar meus dados em qualquer lugar?",
    a: "Com certeza. O Flui foi desenhado para ser seu companheiro constante. Seja no desktop, no tablet ou via WhatsApp no celular, todas as suas notas, tarefas e projetos estão sincronizados instantaneamente em nuvem, garantindo que você nunca perca o fio da meada, onde quer que esteja."
  },
  {
    q: "Como o bot de WhatsApp (Lui) realmente afeta minha produtividade?",
    a: "O benefício do Lui não é automação oca, mas eliminação de rito de entrada. Enquanto você dirige, pode enviar um simples comando de voz descritivo e, sem precisar tocar na tela, a inteligência processa suas diretrizes, quebra o plano de ação, localiza a data e injeta cards categorizados diretamente no seu Kanban."
  },
  {
    q: "Meus dados sincronizam em tempo real entre dispositivos?",
    a: "Absolutamente! Utilizamos tecnologia reativa de ponta. A partir do instante em que uma tarefa é concluída no seu computador, o aplicativo no seu celular ou o bot do WhatsApp reflete essa mudança em milissegundos, mantendo sua visão da rotina sempre atualizada."
  },
  {
    q: "A assinatura pode ser cancelada sem letras miúdas?",
    a: "Protegemos sua autonomia. O Flow conta com faturamento integrado pela solidez da provedora global Stripe. Não existe carência imposta ou contratos amarrados; é possível rescindir e revogar em segundos, nas configurações nativas, sem telefonemas de retenção ou multas fantasmas."
  }
]

const FAQSection = () => {
  const [active, setActive] = React.useState<number | null>(0)

  return (
    <div id="faq" className="w-full max-w-3xl mx-auto mt-16 mb-24 px-6 relative z-10">
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mb-3">Questões Frequentes</h2>
        <p className="text-[#37352f]/60 font-medium text-sm">Entenda por que o Flui dita um novo formato de gestão.</p>
      </div>

      <div className="space-y-2">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className={`overflow-hidden transition-all duration-300 ${active === index ? 'bg-[#fcfcfc] border border-[#e9e9e7] rounded-2xl shadow-sm' : 'bg-transparent border border-transparent rounded-2xl hover:border-[#e9e9e7]/50'}`}
          >
            <button
              onClick={() => setActive(active === index ? null : index)}
              className="w-full text-left px-6 py-5 flex items-center justify-between group"
            >
              <span className={`font-bold transition-colors ${active === index ? 'text-[#37352f]' : 'text-[#37352f]/70 group-hover:text-[#37352f]'}`}>
                {faq.q}
              </span>
              <motion.div
                animate={{ rotate: active === index ? 45 : 0 }}
                transition={{ duration: 0.2, type: "spring", stiffness: 200 }}
                className={`w-6 h-6 flex items-center justify-center shrink-0 ml-4 rounded-full transition-colors ${active === index ? 'bg-[#e9e9e7]' : 'bg-[#f1f1f0] group-hover:bg-[#e9e9e7]'}`}
              >
                <svg className="w-3.5 h-3.5 text-[#37352f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              </motion.div>
            </button>
            <motion.div
              initial={false}
              animate={{ height: active === index ? 'auto' : 0, opacity: active === index ? 1 : 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-6 pb-6 pt-1 text-sm font-medium text-[#37352f]/60 leading-relaxed border-t border-transparent">
                {faq.a}
              </div>
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default LandingPage
