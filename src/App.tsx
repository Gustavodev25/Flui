import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import WhatsApp from './pages/WhatsApp'
import SubscriptionPage from './pages/SubscriptionPage'
import CheckoutPreview from './pages/CheckoutPreview'
import LandingPage from './pages/LandingPage'
import TermsPage from './pages/TermsPage'
import CalendarPage from './pages/Calendar'
import { AppLayout } from './components/layout/AppLayout'
import { AppToaster } from './components/ui/Toast'
import { AuthProvider } from './contexts/AuthContext'
import { SidebarProvider } from './contexts/SidebarContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import ThankYouModal from './components/ThankYouModal'
import { AdminPanel } from './pages/AdminPanel'

function App() {
  const [showThankYou, setShowThankYou] = useState(false)

  useEffect(() => {
    const handler = () => setShowThankYou(true)
    window.addEventListener('flui:subscription-success', handler)
    ;(window as any).__testThankYouModal = () => setShowThankYou(true)
    return () => {
      window.removeEventListener('flui:subscription-success', handler)
      delete (window as any).__testThankYouModal
    }
  }, [])

  return (
    <AuthProvider>
      <SidebarProvider>
        <Router>
            <Routes>
              <Route path="/admin" element={<AdminPanel />} />
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
              <Route path="/" element={<LandingPage />} />
            </Routes>
          <ThankYouModal isOpen={showThankYou} onClose={() => setShowThankYou(false)} />
          </Router>
          <AppToaster />
      </SidebarProvider>
    </AuthProvider>
  )
}

export default App
