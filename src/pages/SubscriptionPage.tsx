import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, Zap, Loader2, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
const SubscriptionPage: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSuccess = searchParams.get('success') === 'true'
  const [loading, setLoading] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [subscription, setSubscription] = useState<any>(null)

  useEffect(() => {
    if (!user) return

    let attempts = 0
    const maxAttempts = isSuccess ? 12 : 1
    const interval = 2500

    const checkSubscription = async () => {
      attempts++
      try {
        // Consulta diretamente o Supabase (RLS garante segurança)
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) {
          console.error('Erro ao verificar assinatura:', error)
        } else if (data?.status === 'active') {
          setSubscription(data)
          setCheckingStatus(false)
          if (isSuccess) window.dispatchEvent(new CustomEvent('flui:subscription-success'))
          return
        }
      } catch (err) {
        console.error('Erro ao verificar assinatura:', err)
      }

      if (attempts < maxAttempts) {
        setTimeout(checkSubscription, interval)
      } else {
        setCheckingStatus(false)
      }
    }

    checkSubscription()
  }, [user])

  const handleSubscribe = async () => {
    if (!user) return
    setLoading(true)
    try {
      const { url, error: stripeError } = await apiFetch<{ url?: string; error?: string }>('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, userEmail: user.email }),
      })
      if (stripeError) throw new Error(stripeError)
      if (url) window.location.href = url
    } catch (err: any) {
      console.error('Erro ao iniciar checkout:', err)
      alert('Erro ao iniciar o pagamento.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingStatus) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[#fcfcfa]">
        <Loader2 className="animate-spin text-[#37352f]/20" size={28} />
        {isSuccess && (
          <p className="text-[12px] text-[#37352f]/40 font-medium">Confirmando sua assinatura...</p>
        )}
      </div>
    )
  }

  // Se já tiver assinatura ativa e tentar entrar aqui, joga pro dashboard
  if (subscription?.status === 'active') {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="flex-1 min-h-screen overflow-y-auto bg-[#fcfcfa] flex flex-col items-center justify-center p-6 py-12 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[360px] space-y-8 text-center"
      >
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-amber-50 text-amber-600 text-[9px] font-black tracking-widest rounded-full border border-amber-100/50">
            <Zap size={10} className="fill-current" />
            Assinatura Mensal
          </div>
          <h1 className="text-2xl font-black text-[#37352f] tracking-tight">Ative seu acesso.</h1>
          <p className="text-[13px] text-[#37352f]/40 font-medium leading-relaxed">
            O Flui é uma experiência exclusiva para membros. <br />
            Assine o Flow para começar a organizar sua vida.
          </p>
        </div>

        <div className="bg-white border border-[#e9e9e7] rounded-2xl p-6 shadow-sm relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="flex justify-between items-center pb-5 border-b border-[#f1f1f0]">
              <div className="text-left">
                <h2 className="text-lg font-bold text-[#37352f]">Flow</h2>
                <p className="text-[10px] font-bold text-[#37352f]/40 tracking-widest">Poder Ilimitado</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-[#37352f]">R$ 9,90</p>
                <p className="text-[9px] font-bold text-[#37352f]/30 tracking-widest">Mensal</p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              {[
                'Tarefas e Projetos Ilimitados',
                'Lui Pro (Áudios & Mensagens)',
                'Sincronização em Nuvem',
                'Suporte Prioritário'
              ].map((benefit, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] font-medium text-[#37352f]/60">
                  <Check size={12} className="text-[#25D366]" />
                  {benefit}
                </div>
              ))}
              <p className="text-[10px] text-[#37352f]/30 font-medium px-1">... e muito mais.</p>
            </div>

            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="w-full py-3.5 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-70"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-white/50" />
              ) : (
                <>Assinar plano agora <ArrowRight size={16} /></>
              )}
            </button>

            <p className="text-[9px] text-[#37352f]/30 font-medium leading-relaxed">
              Pagamento processado pelo Stripe. <br />
              Sem contratos, cancele quando quiser.
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
            className="w-full py-2.5 text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f]/60 transition-colors"
          >
            Continuar grátis
          </button>
          <p className="text-[9px] text-[#37352f]/25 font-medium leading-relaxed text-center">
            Plano gratuito: apenas tarefas manuais. Sem Lui Assistant.
          </p>
        </div>

        <p className="text-[10px] font-bold text-[#37352f]/20 tracking-widest">
          Flui © 2026
        </p>
      </motion.div>
    </div>
  )
}

export default SubscriptionPage
