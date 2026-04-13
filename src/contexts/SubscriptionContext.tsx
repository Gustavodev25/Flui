import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'

interface WorkspaceMembership {
  ownerName: string
  ownerEmail: string
  planId: string
}

interface SubscriptionContextValue {
  /** Plano ativo (subscription própria ou herdada do workspace) */
  hasFlow: boolean
  hasPulse: boolean
  /** ID efetivo do plano: 'flow' | 'pulse' | null */
  planId: string | null
  /** True quando o usuário É membro de workspace (independente do modo ativo) */
  isWorkspaceMember: boolean
  /** True quando o modo workspace está ativo (isWorkspaceMember && !useOwnPlan) */
  workspaceModeActive: boolean
  /** Dados do workspace ao qual pertence (se for membro) */
  workspaceMembership: WorkspaceMembership | null
  /** True se o usuário tem plano próprio ativo (independente do workspace) */
  hasOwnPlan: boolean
  /** True quando o usuário optou por usar seu próprio plano em vez do workspace */
  useOwnPlan: boolean
  /** Alterna entre plano próprio e workspace */
  togglePlanMode: () => void
  /** Raw da tabela subscriptions (pode ser null se ainda não assinou) */
  subscription: any
  /** True enquanto os dados ainda estão sendo buscados */
  loading: boolean
  /** Recarrega os dados (útil após aceitar convite, assinar, etc.) */
  refresh: () => void
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  hasFlow: false,
  hasPulse: false,
  planId: null,
  isWorkspaceMember: false,
  workspaceModeActive: false,
  workspaceMembership: null,
  hasOwnPlan: false,
  useOwnPlan: false,
  togglePlanMode: () => {},
  subscription: null,
  loading: true,
  refresh: () => {},
})

export const useSubscription = () => useContext(SubscriptionContext)

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [subscription, setSubscription] = useState<any>(null)
  const [workspaceMembership, setWorkspaceMembership] = useState<WorkspaceMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [useOwnPlan, setUseOwnPlan] = useState(false)

  const refresh = () => setTick(t => t + 1)
  const togglePlanMode = () => setUseOwnPlan(v => !v)

  useEffect(() => {
    if (!user) {
      setSubscription(null)
      setWorkspaceMembership(null)
      setLoading(false)
      return
    }

    setLoading(true)

    Promise.allSettled([
      supabase
        .from('subscriptions')
        .select('status, plan_id, stripe_subscription_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      apiFetch<{ membership: WorkspaceMembership | null }>(
        '/api/workspace/my-membership',
        undefined,
        { userId: user.id }
      ),
    ]).then(([subRes, memberRes]) => {
      if (subRes.status === 'fulfilled') setSubscription(subRes.value.data)
      if (memberRes.status === 'fulfilled') setWorkspaceMembership(memberRes.value.membership)
    }).finally(() => {
      setLoading(false)
    })
  }, [user, tick])

  const isWorkspaceMember = !!workspaceMembership

  // Verifica se o usuário tem plano próprio ativo (independente do workspace)
  const hasOwnPlan = subscription?.status === 'active' &&
    ['flow', 'pulse'].includes(subscription?.plan_id ?? '')

  // Plano efetivo: se for membro com plano próprio e optou por usar o próprio, usa o dele
  const shouldUseOwn = isWorkspaceMember && useOwnPlan && hasOwnPlan
  const effectivePlanId = (!isWorkspaceMember || shouldUseOwn)
    ? subscription?.plan_id
    : workspaceMembership!.planId
  const effectiveStatus = (!isWorkspaceMember || shouldUseOwn)
    ? subscription?.status
    : 'active'

  const hasFlow = effectiveStatus === 'active' && ['flow', 'pulse'].includes(effectivePlanId ?? '')
  const hasPulse = effectiveStatus === 'active' && effectivePlanId === 'pulse'
  const planId = hasFlow ? effectivePlanId : null

  return (
    <SubscriptionContext.Provider value={{
      hasFlow,
      hasPulse,
      planId,
      isWorkspaceMember,           // sempre: o usuário É membro
      workspaceModeActive: isWorkspaceMember && !shouldUseOwn,  // modo ativo
      workspaceMembership,
      hasOwnPlan,
      useOwnPlan,
      togglePlanMode,
      subscription,
      loading,
      refresh,
    }}>
      {children}
    </SubscriptionContext.Provider>
  )
}
