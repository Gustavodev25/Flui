import { useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading: authLoading } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null)
  const [loadingSub, setLoadingSub] = useState(true)
  const location = useLocation()

  useEffect(() => {
    // Reseta estado a cada mudança de usuário
    setIsSubscribed(null)
    setLoadingSub(true)

    if (!user) {
      setLoadingSub(false)
      return
    }

    const checkSubscription = async () => {
      try {
        // Consulta diretamente o Supabase (RLS garante que só vê seus dados)
        const { data, error } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) {
          console.error('Subscription check error:', error)
          setIsSubscribed(false)
        } else {
          setIsSubscribed(data?.status === 'active')
        }
      } catch (err) {
        console.error('Subscription check error:', err)
        setIsSubscribed(false)
      } finally {
        setLoadingSub(false)
      }
    }

    checkSubscription()
  }, [user])

  if (authLoading || loadingSub) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f7f5]">
        <div className="w-8 h-8 border-4 border-[#202020]/10 border-t-[#202020] rounded-full animate-spin" />
      </div>
    )
  }

  // Se não tem usuário logado, joga pro login
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Usuários sem assinatura podem acessar o app no plano gratuito (funcionalidades limitadas)
  // O gate de checkout só bloqueia a primeira vez, via CheckoutPreview/SubscriptionPage
  return <>{children}</>
}
