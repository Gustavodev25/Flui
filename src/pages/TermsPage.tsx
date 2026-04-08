import React from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/logo/logo.svg'
import TermsContent from '../components/TermsContent'

const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-[#37352f] font-sans relative flex flex-col">
      {/* Background Decorative Patterns */}
      <div className="absolute top-0 right-0 w-full h-full opacity-[0.02] pointer-events-none z-0"
        style={{ backgroundImage: 'radial-gradient(#37352f 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Navbar Minimalista (Reproveitado da LandingPage) */}
      <header className="w-full bg-[#f7f7f5] border-b border-[#f1f1f0]/80 relative z-10">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src={logo} alt="Flui Logo" className="w-8 h-8 object-contain" />
            <span className="text-xl font-bold tracking-tight">flui.</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-semibold text-[#37352f]/60 hover:text-[#202020] transition-colors">
              Fazer login
            </Link>
            <Link to="/login" className="bg-[#202020] text-white text-xs font-bold px-4 py-2 rounded-[6px] shadow-sm hover:bg-[#202020]/90 transition-all">
              Criar conta
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-16 relative z-10">
        <div className="mb-14">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-[#37352f] mb-4">
            Termos e Privacidade
          </h1>
          <p className="text-[#37352f]/40 text-sm leading-relaxed max-w-xl">
            Tudo o que você precisa saber sobre o uso da plataforma Flui e como cuidamos dos seus dados com transparência e segurança.
          </p>
        </div>

        <TermsContent />
      </main>

      {/* Footer info (matches TermsModal style but full width) */}
      <footer className="w-full bg-[#f7f7f5] border-t border-[#f1f1f0] relative z-10 py-12">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <p className="text-[10px] font-bold text-[#37352f]/30 uppercase tracking-[0.2em]">
              Flui
            </p>
            <p className="text-[10px] text-[#37352f]/40 mt-1">
              Versão 1.0.0 • Atualizado em {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-col items-center md:items-end text-center md:text-right gap-1">
            <p className="text-[10px] text-[#37352f]/30 font-medium">
              © {new Date().getFullYear()} Flui. Todos os direitos reservados.
            </p>
            <p className="text-[9px] text-[#37352f]/20 uppercase">
              Sua privacidade é nossa prioridade.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default TermsPage
