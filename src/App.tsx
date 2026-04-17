import { BrowserRouter as Router, Routes, Route, useSearchParams, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { apiFetch } from './lib/api'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import WhatsApp from './pages/WhatsApp'
import SubscriptionPage from './pages/SubscriptionPage'
import CheckoutPreview from './pages/CheckoutPreview'
import LandingPage from './pages/LandingPage'
import TermsPage from './pages/TermsPage'
import CalendarPage from './pages/Calendar'
import InvitePage from './pages/InvitePage'
import MockupsPage from './pages/MockupsPage'
import { AppLayout } from './components/layout/AppLayout'
import { AppToaster } from './components/ui/Toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SidebarProvider } from './contexts/SidebarContext'
import { SubscriptionProvider } from './contexts/SubscriptionContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import ThankYouModal from './components/ThankYouModal'
import WhatsAppOnboardingModal from './components/WhatsAppOnboardingModal'
import { AdminPanel } from './pages/AdminPanel'

function WhatsAppChecker({ onNeedWhatsApp }: { onNeedWhatsApp: () => void }) {
  const { user } = useAuth()
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!user || checkedRef.current) return
    checkedRef.current = true

    const providers = user?.app_metadata?.providers || []
    const isGoogleUser = providers.includes('google') && !providers.includes('email')

    console.log('[WhatsAppChecker] Checking user:', {
      id: user.id,
      providers,
      isGoogleUser
    })

    if (!isGoogleUser) return

    apiFetch<{ phone: string | null }>('/api/whatsapp/linked-phone', undefined, { userId: user.id })
      .then(({ phone }) => {
        console.log('[WhatsAppChecker] API result:', { phone })
        if (!phone) {
          console.log('[WhatsAppChecker] Triggering onboarding modal')
          onNeedWhatsApp()
        }
      })
      .catch((err) => {
        console.error('[WhatsAppChecker] Error fetching linked phone:', err)
      })
  }, [user])

  return null
}

function InviteProcessor() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const inviteToken = searchParams.get('invite_token')

  useEffect(() => {
    // Não processa automaticamente se já estiver na página de convite interativa
    if (location.pathname === '/invite') return

    if (user && inviteToken) {
      apiFetch('/api/workspace/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, userId: user.id })
      }).then(() => {
        searchParams.delete('invite_token')
        setSearchParams(searchParams)
      }).catch(err => {
        console.error('Invite Processor err', err)
      })
    }
  }, [user, inviteToken, searchParams, setSearchParams, location.pathname])

  return null
}

import { Loading } from './components/ui/Loading'

function App() {
  const [showThankYou, setShowThankYou] = useState(false)
  const [showWhatsAppOnboarding, setShowWhatsAppOnboarding] = useState(false)
  const [showLoading, setShowLoading] = useState(false) // Desativado por padrão

  useEffect(() => {
    const handler = () => setShowThankYou(true)
    window.addEventListener('flui:subscription-success', handler)
    ;(window as any).__testThankYouModal = () => setShowThankYou(true)
    ;(window as any).__testWhatsAppOnboarding = () => setShowWhatsAppOnboarding(true)
    ;(window as any).__testLoading = (val: boolean) => setShowLoading(val)
    
    // Auto-hide após alguns segundos para não travar a experiência por muito tempo, 
    // mas deixaremos tempo suficiente para ele ver bem.
    const timer = setTimeout(() => {
      // setShowLoading(false) // Descomente aqui se quiser que desapareça sozinho
    }, 10000)

    return () => {
      window.removeEventListener('flui:subscription-success', handler)
      delete (window as any).__testThankYouModal
      delete (window as any).__testWhatsAppOnboarding
      delete (window as any).__testLoading
      clearTimeout(timer)
    }
  }, [])

  return (
    <AuthProvider>
      <SubscriptionProvider>
      <SidebarProvider>
        <Router>
            {showLoading && <Loading />}
            <InviteProcessor />
            <WhatsAppChecker onNeedWhatsApp={() => setShowWhatsAppOnboarding(true)} />
            <Routes>
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/login" element={<LoginPage />} />
              
              {/* Rotas Protegidas com Layout Persistente */}
              <Route element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/whatsapp" element={<WhatsApp />} />
                <Route path="/subscription" element={<SubscriptionPage />} />
                <Route path="/checkout-preview" element={<CheckoutPreview />} />
              </Route>
  
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/mockups" element={<MockupsPage />} />
              <Route path="/" element={<LandingPage />} />
            </Routes>
          <ThankYouModal
            isOpen={showThankYou}
            onClose={() => setShowThankYou(false)}
            onGoToDashboard={() => setShowWhatsAppOnboarding(true)}
          />
          <WhatsAppOnboardingModal
            isOpen={showWhatsAppOnboarding}
            onClose={() => setShowWhatsAppOnboarding(false)}
            mandatory
          />
          </Router>
          <AppToaster />
      </SidebarProvider>
      </SubscriptionProvider>
    </AuthProvider>
  )
}

export default App
