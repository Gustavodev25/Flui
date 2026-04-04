import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Loader2 } from 'lucide-react'
import flowLogo from '../assets/logo/flow.png'
import gratisLogo from '../assets/logo/gratis.png'
import { useAuth } from '../contexts/AuthContext'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useEffect } from 'react'
import { apiFetch } from '../lib/api'

const CheckoutPreview: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  useEffect(() => {
    const checkStatus = async () => {
      if (!user) {
        setChecking(false)
        return
      }
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', user.id)
          .maybeSingle()

        if (data?.status === 'active') {
          navigate('/dashboard', { replace: true })
        }
      } catch (err) {
        console.error(err)
      } finally {
        setChecking(false)
      }
    }
    checkStatus()
  }, [user, navigate])

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfa]">
        <Loader2 className="animate-spin text-[#37352f]/10" size={24} />
      </div>
    )
  }

  const handleStartPayment = async () => {
    setLoading(true)
    try {
      const { url, error } = await apiFetch<{ url?: string; error?: string }>('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, userEmail: user.email }),
      })
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error(err)
      alert('Erro ao iniciar checkout.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fcfcfa] flex flex-col items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[360px] space-y-8 text-center"
      >
        <div className="space-y-3">
          <h1 className="text-2xl font-black text-[#37352f] tracking-tight">Ative seu acesso.</h1>
          <p className="text-[13px] text-[#37352f]/40 font-medium leading-relaxed">
            Para continuar, é necessário ativar o seu Flow.
          </p>
        </div>

        <div className="bg-white border border-[#e9e9e7] rounded-2xl p-6 shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex justify-between items-center pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#f7f7f5] border border-[#e9e9e7] flex items-center justify-center shadow-sm shrink-0">
                  <img src={flowLogo} alt="Flow" className="w-6 h-6 object-contain" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-bold text-[#37352f]">Flow</h2>
                  <p className="text-[10px] font-bold text-[#37352f]/40 tracking-widest">Assinatura Mensal</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-[#37352f]">R$ 9,90</p>
                <p className="text-[9px] font-bold text-[#37352f]/30 tracking-widest">Mensal</p>
              </div>
            </div>
            <hr className="-mx-6 border-t border-[#f1f1f0]" />

            <div className="space-y-3 pt-4">
              {[
                'Tarefas e Projetos Ilimitados',
                'Lui (Áudios & Mensagens)',
                'Sincronização em Nuvem',
                'Sem limites ou amarras',
                'Suporte Prioritário'
              ].map((benefit, i) => (
                <div key={i} className="flex items-center gap-3 text-[12px] font-medium text-[#37352f]/70">
                  <div className="w-4 h-4 rounded-full bg-[#f1f1f0] border border-[#e9e9e7] flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5 text-[#37352f]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  {benefit}
                </div>
              ))}
            </div>

            <button
              onClick={handleStartPayment}
              disabled={loading}
              className="w-full mt-5 py-3.5 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-70"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-white/50" />
              ) : (
                <>Assinar agora <ArrowRight size={16} /></>
              )}
            </button>

            <p className="mt-3 text-[9px] text-[#37352f]/30 font-medium leading-relaxed">
              Pagamento via Stripe. Cancele quando quiser.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#e9e9e7]" />
            <span className="text-[9px] font-bold text-[#37352f]/20 tracking-widest">OU</span>
            <div className="h-px flex-1 bg-[#e9e9e7]" />
          </div>

          <button
            onClick={() => navigate('/dashboard', { replace: true })}
            className="w-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl px-4 py-3 flex items-center gap-3 hover:bg-[#f1f1f0] transition-all active:scale-[0.98]"
          >
            <div className="w-9 h-9 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm shrink-0">
              <img src={gratisLogo} alt="Gratuito" className="w-5 h-5 object-contain" />
            </div>
            <div className="text-left">
              <p className="text-[12px] font-bold text-[#37352f]/60">Continuar grátis</p>
              <p className="text-[10px] text-[#37352f]/35 font-medium leading-tight mt-0.5">Apenas tarefas manuais. Sem Lui Assistant.</p>
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  )
}

export default CheckoutPreview
