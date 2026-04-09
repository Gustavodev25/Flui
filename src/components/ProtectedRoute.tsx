import { useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'

// Rotas acessíveis sem plano ativo (para o usuário poder assinar)
const FREE_ROUTES = ['/checkout-preview', '/subscription']

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading: authLoading } = useAuth()
  const [hasActivePlan, setHasActivePlan] = useState<boolean | null>(null)
  const [loadingSub, setLoadingSub] = useState(true)
  const location = useLocation()

  useEffect(() => {
    setHasActivePlan(null)
    setLoadingSub(true)

    if (!user) {
      setLoadingSub(false)
      return
    }

    const checkAccess = async () => {
      try {
        const [subRes, memberRes] = await Promise.allSettled([
          supabase
            .from('subscriptions')
            .select('status, plan_id')
            .eq('user_id', user.id)
            .maybeSingle(),
          apiFetch<{ membership: { planId: string } | null }>(
            '/api/workspace/my-membership',
            undefined,
            { userId: user.id }
          ),
        ])

        const sub = subRes.status === 'fulfilled' ? subRes.value.data : null
        const membership = memberRes.status === 'fulfilled' ? memberRes.value.membership : null

        const ownPlanActive =
          sub?.status === 'active' && ['flow', 'pulse'].includes(sub?.plan_id ?? '')

        setHasActivePlan(ownPlanActive || !!membership)
      } catch (err) {
        console.error('Access check error:', err)
        setHasActivePlan(false)
      } finally {
        setLoadingSub(false)
      }
    }

    checkAccess()
  }, [user])

  if (authLoading || loadingSub) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f7f5]">
        <div className="w-8 h-8 border-4 border-[#202020]/10 border-t-[#202020] rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Sem plano ativo: redireciona para checkout, exceto nas rotas liberadas
  if (!hasActivePlan && !FREE_ROUTES.includes(location.pathname)) {
    return <Navigate to="/checkout-preview" replace />
  }

  return <>{children}</>
}
