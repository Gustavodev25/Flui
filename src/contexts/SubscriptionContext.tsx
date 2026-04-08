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
  /** True quando o usuário é membro convidado (não dono) */
  isWorkspaceMember: boolean
  /** Dados do workspace ao qual pertence (se for membro) */
  workspaceMembership: WorkspaceMembership | null
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
  workspaceMembership: null,
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

  const refresh = () => setTick(t => t + 1)

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

  // Plano efetivo: se for membro de workspace, usa o plano do dono
  const isWorkspaceMember = !!workspaceMembership
  const effectivePlanId = isWorkspaceMember ? workspaceMembership!.planId : subscription?.plan_id
  const effectiveStatus = isWorkspaceMember ? 'active' : subscription?.status

  const hasFlow = effectiveStatus === 'active'
  const hasPulse = effectiveStatus === 'active' && effectivePlanId === 'pulse'
  const planId = hasFlow ? effectivePlanId : null

  return (
    <SubscriptionContext.Provider value={{
      hasFlow,
      hasPulse,
      planId,
      isWorkspaceMember,
      workspaceMembership,
      subscription,
      loading,
      refresh,
    }}>
      {children}
    </SubscriptionContext.Provider>
  )
}
