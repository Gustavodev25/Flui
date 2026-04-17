import React, { useState, useEffect } from 'react'
import { Loading } from '../components/ui/Loading'
import { motion } from 'framer-motion'
import { Check, Zap, Loader2, ArrowRight } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { useAuth } from '../contexts/AuthContext'
import { Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
const SubscriptionPage: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSuccess = searchParams.get('success') === 'true'
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [subscription, setSubscription] = useState<any>(null)
  const [membership, setMembership] = useState<any>(null)

  useEffect(() => {
    if (!user) return

    let attempts = 0
    const maxAttempts = isSuccess ? 12 : 1
    const interval = 2500

    const fetchData = async () => {
      attempts++
      try {
        const [subResult, memResult] = await Promise.allSettled([
          supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle(),
          apiFetch<{ membership: any }>('/api/workspace/my-membership', undefined, { userId: user.id })
        ])

        if (subResult.status === 'fulfilled' && subResult.value.data) {
          setSubscription(subResult.value.data)
          if (subResult.value.data.status === 'active') {
            setCheckingStatus(false)
            if (isSuccess) window.dispatchEvent(new CustomEvent('flui:subscription-success'))
            return
          }
        }

        if (memResult.status === 'fulfilled' && memResult.value.membership) {
          setMembership(memResult.value.membership)
          setCheckingStatus(false)
          return
        }

      } catch (err) {
        console.error('Erro ao verificar status:', err)
      }

      if (attempts < maxAttempts) {
        setTimeout(fetchData, interval)
      } else {
        setCheckingStatus(false)
      }
    }

    fetchData()
  }, [user])

  const [loadingPlan, setLoadingPlan] = useState<'flow' | 'pulse' | null>(null)

  const handleSubscribe = async (plan: 'flow' | 'pulse') => {
    if (!user) return
    setLoadingPlan(plan)
    try {
      const { url, error: stripeError } = await apiFetch<{ url?: string; error?: string }>('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: user.id, 
          userEmail: user.email,
          plan: plan // Passando o plano selecionado
        }),
      })
      if (stripeError) throw new Error(stripeError)
      if (url) window.location.href = url
    } catch (err: any) {
      console.error('Erro ao iniciar checkout:', err)
      alert('Erro ao iniciar o pagamento.')
    } finally {
      setLoadingPlan(null)
    }
  }

  if (checkingStatus) {
    return <Loading message={isSuccess ? "Confirmando sua assinatura..." : "Carregando..."} />
  }

  // Se já tiver assinatura ativa e tentar entrar aqui, joga pro dashboard (a menos que queira ver o status)
  if (subscription?.status === 'active' && !isSuccess) {
    return <Navigate to="/dashboard" replace />
  }

  // Se for membro de workspace, mostramos uma tela especial
  if (membership) {
    const planLabel = membership.planId === 'pulse' ? 'Pulse' : 'Flow'
    return (
      <div className="flex-1 min-h-screen overflow-y-auto bg-[#fcfcfa] flex flex-col items-center justify-center p-6 font-sans">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-[440px] bg-white border border-[#e9e9e7] rounded-3xl p-8 shadow-sm text-center space-y-6"
        >
          <div className="w-16 h-16 bg-[#f7f7f5] rounded-2xl border border-[#e9e9e7] flex items-center justify-center mx-auto mb-2">
            <Zap className="text-[#37352f] fill-[#37352f]" size={24} />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-xl font-black text-[#37352f]">Acesso via Workspace</h1>
            <p className="text-[13px] text-[#37352f]/40 font-medium leading-relaxed px-4">
              Você possui acesso ilimitado ao Flui através do workspace de <strong>{membership.ownerName}</strong>.
            </p>
          </div>

          <div className="bg-[#f7f7f5] rounded-2xl p-4 border border-[#e9e9e7] flex items-center justify-between text-left">
            <div>
              <p className="text-[9px] font-bold text-[#37352f]/30 uppercase tracking-widest mb-0.5">Plano Ativo</p>
              <p className="text-[14px] font-bold text-[#37352f]">{planLabel}</p>
            </div>
            <div className="px-2 py-1 bg-[#25D366]/10 text-[#25D366] text-[10px] font-bold rounded-lg border border-[#25D366]/20">
              ATIVO
            </div>
          </div>

          <button
            onClick={() => navigate('/dashboard')}
            className="w-full py-4 bg-[#1a1a1a] text-white text-[12px] font-bold rounded-2xl hover:bg-black transition-all active:scale-[0.98] shadow-sm"
          >
            Ir para o Dashboard
          </button>

          <p className="text-[10px] text-[#37352f]/30 font-medium leading-relaxed">
            Como membro convidado, o faturamento é gerenciado pelo proprietário do workspace.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-screen overflow-y-auto bg-[#fcfcfa] flex flex-col items-center justify-center p-6 py-12 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[800px] space-y-12 text-center"
      >
        <div className="space-y-4 max-w-[400px] mx-auto">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-amber-50 text-amber-600 text-[9px] font-black tracking-widest rounded-full border border-amber-100/50">
            <Zap size={10} className="fill-current" />
            Planos Disponíveis
          </div>
          <h1 className="text-3xl font-black text-[#37352f] tracking-tight">Ative seu acesso.</h1>
          <p className="text-[13px] text-[#37352f]/40 font-medium leading-relaxed">
            O Flui é uma experiência exclusiva para membros. <br />
            Escolha o plano ideal para sua rotina ou para seu time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Card Flow */}
          <div className="bg-white border border-[#e9e9e7] rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col text-left">
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex justify-between items-center pb-5 border-b border-[#f1f1f0]">
                <div>
                  <h2 className="text-lg font-bold text-[#37352f]">Flow</h2>
                  <p className="text-[10px] font-bold text-[#37352f]/40 tracking-widest uppercase">Individual</p>
                </div>
                <div className="text-right">
                  <div className="flex items-baseline gap-0.5 justify-end">
                    <span className="text-[10px] font-black text-[#37352f]/40">R$</span>
                    <NumberFlow
                      value={9.90}
                      format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                      className="text-xl font-black text-[#37352f]"
                    />
                  </div>
                  <p className="text-[9px] font-bold text-[#37352f]/30 tracking-widest uppercase">Mensal</p>
                </div>
              </div>

              <div className="space-y-3 py-6 flex-1">
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
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => handleSubscribe('flow')}
                  disabled={!!loadingPlan}
                  className="w-full py-3.5 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-70"
                >
                  {loadingPlan === 'flow' ? (
                    <Loader2 size={16} className="animate-spin text-white/50" />
                  ) : (
                    <>Escolher o Flow <ArrowRight size={16} /></>
                  )}
                </button>

                <p className="text-[9px] text-[#37352f]/30 font-medium leading-relaxed">
                  Pagamento via Stripe. Cancele quando quiser.
                </p>
              </div>
            </div>
          </div>

          {/* Card Pulse */}
          <div className="bg-white border border-[#e9e9e7] rounded-2xl p-6 shadow-sm relative overflow-hidden flex flex-col text-left">
            <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full" />
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex justify-between items-center pb-5 border-b border-[#f1f1f0]">
                <div>
                  <h2 className="text-lg font-bold text-[#37352f]">Pulse</h2>
                  <p className="text-[10px] font-bold text-[#37352f]/40 tracking-widest uppercase">Times</p>
                </div>
                <div className="text-right">
                  <div className="flex items-baseline gap-0.5 justify-end">
                    <span className="text-[10px] font-black text-[#37352f]/40">R$</span>
                    <NumberFlow
                      value={29.90}
                      format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                      className="text-xl font-black text-[#37352f]"
                    />
                  </div>
                  <p className="text-[9px] font-bold text-[#37352f]/30 tracking-widest uppercase">Por Membro</p>
                </div>
              </div>

              <div className="space-y-3 py-6 flex-1">
                {[
                  'Tudo do plano Flow',
                  'Gestão de Equipes',
                  'Workspaces Compartilhados',
                  'Convidar Membros',
                  'Faturamento Centralizado',
                  'Suporte VIP 24/7'
                ].map((benefit, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px] font-medium text-[#37352f]/60">
                    <Check size={12} className="text-[#25D366]" />
                    {benefit}
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => handleSubscribe('pulse')}
                  disabled={!!loadingPlan}
                  className="w-full py-3.5 bg-[#202020] text-white text-[11px] font-bold rounded-xl hover:bg-[#303030] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-70"
                >
                  {loadingPlan === 'pulse' ? (
                    <Loader2 size={16} className="animate-spin text-white/50" />
                  ) : (
                    <>Assinar Agora <ArrowRight size={16} /></>
                  )}
                </button>

                <p className="text-[9px] text-[#37352f]/30 font-medium leading-relaxed text-center">
                  Gestão profissional para o seu negócio.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 max-w-[360px] mx-auto pt-6 border-t border-[#f1f1f0]">
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
