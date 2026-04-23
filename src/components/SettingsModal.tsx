import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, Loader2, ArrowRight, ExternalLink, Camera, Smartphone, CheckCircle2, XCircle } from 'lucide-react'
import perfilIcon from '../assets/icones/perfil.svg'
import assinaturaIcon from '../assets/icones/assinatura.svg'
import integracaoIcon from '../assets/icones/integracao.svg'
import flowLogo from '../assets/logo/flow.svg'
import pulseLogo from '../assets/logo/pulse.svg'
import gratisLogo from '../assets/logo/gratis.svg'
import googleCalendarLogo from '../assets/logo/googlecalendar.svg'
import { toaster } from './ui/Toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Avvvatars from 'avvvatars-react'
import { AvatarUploadModal } from './AvatarUploadModal'
import { apiFetch, buildApiUrl } from '../lib/api'
import { useLocation, useNavigate } from 'react-router-dom'
import CountrySelector from './CountrySelector'
import { countries } from '../constants/countries'
import type { Country } from '../constants/countries'

type SettingsTab = 'profile' | 'subscription' | 'integrations'
type IntegrationView = null | 'google-calendar'


interface GoogleCalendarStatus {
  configured: boolean
  connected: boolean
  autoSyncEnabled: boolean
  email?: string | null
  calendarId?: string | null
  timeZone?: string | null
  connectedAt?: string | null
  lastSyncedAt?: string | null
  lastError?: string | null
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab = 'profile' }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const { user } = useAuth()
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Usuário'
  const [subscription, setSubscription] = useState<any>(null)
  const [membership, setMembership] = useState<any>(null)
  const [loadingSub, setLoadingSub] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.user_metadata?.avatar_url || null)
  const [uploading, setUploading] = useState(false)
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false)
  const [editName, setEditName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null)
  const [pendingPhone, setPendingPhone] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [ddd, setDdd] = useState('')
  const [phoneRemainder, setPhoneRemainder] = useState('')
  const [phoneLinkSuccess, setPhoneLinkSuccess] = useState(false)
  const [phoneLinkError, setPhoneLinkError] = useState<string | null>(null)
  const [isUnlinkingPhone, setIsUnlinkingPhone] = useState(false)
  const [isLinkingPhone, setIsLinkingPhone] = useState(false)
  const [isVerifyingPhone, setIsVerifyingPhone] = useState(false)
  const [isValidatingPhone, setIsValidatingPhone] = useState(false)
  const [isPhoneValid, setIsPhoneValid] = useState<boolean | null>(null)
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<GoogleCalendarStatus | null>(null)
  const [loadingGoogleCalendar, setLoadingGoogleCalendar] = useState(false)
  const [connectingGoogleCalendar, setConnectingGoogleCalendar] = useState(false)
  const [disconnectingGoogleCalendar, setDisconnectingGoogleCalendar] = useState(false)
  const [savingGoogleAutoSync, setSavingGoogleAutoSync] = useState(false)
  const [integrationView, setIntegrationView] = useState<IntegrationView>(null)

  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]) // Brasil (+55) default
  const navigate = useNavigate()
  const location = useLocation()
  const providers = user?.app_metadata?.providers || []
  const isGoogleUser = providers.includes('google') && !providers.includes('email')

  // Sincroniza para o backend
  const phoneInput = `${selectedCountry.code}${ddd}${phoneRemainder.replace(/\D/g, '')}`

  const handleDddChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneLinkError(null)
    const val = e.target.value.replace(/\D/g, '').slice(0, 2)
    setDdd(val)
  }

  const handleRemainderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneLinkError(null)
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9)
    let formatted = raw
    if (raw.length > 5) {
      formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`
    }
    setPhoneRemainder(formatted)
  }

  // Validação "Real" (Formato + Simulação) no Settings
  useEffect(() => {
    const raw = phoneRemainder.replace(/\D/g, '')
    if (ddd.length === 2 && raw.length >= 8) {
      const timer = setTimeout(() => {
        setIsValidatingPhone(true)
        setIsPhoneValid(null)

        const isBR = selectedCountry.iso === 'BR'
        const validFormat = isBR
          ? (raw.length === 9 && raw.startsWith('9')) || (raw.length === 8)
          : raw.length >= 8

        setTimeout(() => {
          setIsPhoneValid(validFormat)
          setIsValidatingPhone(false)
        }, 1200)
      }, 500)
      return () => clearTimeout(timer)
    } else {
      setIsPhoneValid(null)
      setIsValidatingPhone(false)
    }
  }, [ddd, phoneRemainder, selectedCountry])

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) return
      try {
        const [subResult, memResult] = await Promise.allSettled([
          supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle(),
          apiFetch<{ membership: any }>('/api/workspace/my-membership', undefined, { userId: user.id })
        ])

        if (subResult.status === 'fulfilled') {
          const data = subResult.value.data
          setSubscription(data)

          if (data?.stripe_subscription_id || data?.stripe_customer_id) {
            try {
              const { subscription: synced } = await apiFetch<{ subscription?: any }>('/api/subscription/sync', undefined, {
                userId: user.id,
              })
              if (synced) setSubscription(synced)
            } catch (syncErr) {
              console.warn('Sync com Stripe falhou:', syncErr)
            }
          }
        }

        if (memResult.status === 'fulfilled' && memResult.value.membership) {
          setMembership(memResult.value.membership)
        }
      } catch (err) {
        console.error('Erro ao buscar dados de assinatura:', err)
      } finally {
        setLoadingSub(false)
      }
    }

    if (isOpen && activeTab === 'subscription') {
      setLoadingSub(true)
      fetchSubscription()
    }
  }, [isOpen, activeTab, user])

  useEffect(() => {
    if (!isOpen || !user || !isGoogleUser) return
    apiFetch<{ phone: string | null; pendingPhone?: string | null }>('/api/whatsapp/linked-phone', undefined, { userId: user.id })
      .then(({ phone, pendingPhone }) => {
        setLinkedPhone(phone)
        setPendingPhone(pendingPhone || null)
      })
      .catch(() => { })
  }, [isOpen, user, isGoogleUser])

  const fetchGoogleCalendarStatus = async () => {
    if (!user) return
    setLoadingGoogleCalendar(true)
    try {
      const data = await apiFetch<GoogleCalendarStatus>('/api/integrations/google/status', undefined, { userId: user.id })
      setGoogleCalendarStatus(data)
    } catch (error) {
      console.error('Erro ao buscar status do Google Calendar:', error)
      toaster.create({ title: 'Não foi possível carregar o status da integração.', type: 'error' })
    } finally {
      setLoadingGoogleCalendar(false)
    }
  }

  useEffect(() => {
    if (!isOpen || activeTab !== 'integrations' || !user) return
    fetchGoogleCalendarStatus()
  }, [isOpen, activeTab, user])

  useEffect(() => {
    if (!isOpen) return

    const params = new URLSearchParams(location.search)
    const status = params.get('googleCalendar')
    if (!status) return

    const message = params.get('googleCalendarMessage')
      || (status === 'connected'
        ? 'Google Calendar conectado com sucesso.'
        : 'Não foi possível concluir a integração com o Google Calendar.')

    toaster.create({ title: message, type: status === 'connected' ? 'success' : 'error' })

    const nextParams = new URLSearchParams(location.search)
    nextParams.delete('googleCalendar')
    nextParams.delete('googleCalendarMessage')

    navigate(
      {
        pathname: location.pathname,
        search: nextParams.toString() ? `?${nextParams.toString()}` : '',
      },
      { replace: true }
    )
  }, [isOpen, location.pathname, location.search, navigate])

  const handleGoogleCalendarConnect = () => {
    if (!user) return
    setConnectingGoogleCalendar(true)

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
    const returnTo = `${location.pathname}?settings=integrations`

    window.location.assign(buildApiUrl('/api/integrations/google/connect', {
      userId: user.id,
      returnTo,
      timeZone,
    }))
  }

  const handleGoogleCalendarDisconnect = async () => {
    if (!user) return
    setDisconnectingGoogleCalendar(true)
    try {
      await apiFetch('/api/integrations/google/disconnect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      toaster.create({ title: 'Google Calendar desconectado.', type: 'success' })
      await fetchGoogleCalendarStatus()
    } catch (error) {
      console.error('Erro ao desconectar Google Calendar:', error)
      toaster.create({ title: 'Não foi possível desconectar o Google Calendar.', type: 'error' })
    } finally {
      setDisconnectingGoogleCalendar(false)
      setConnectingGoogleCalendar(false)
    }
  }

  const handleToggleGoogleAutoSync = async () => {
    if (!user || !googleCalendarStatus?.connected) return

    setSavingGoogleAutoSync(true)
    try {
      const nextValue = !googleCalendarStatus.autoSyncEnabled
      const response = await apiFetch<{ autoSyncEnabled: boolean }>('/api/integrations/google/auto-sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, autoSyncEnabled: nextValue }),
      })

      setGoogleCalendarStatus(prev => prev ? { ...prev, autoSyncEnabled: response.autoSyncEnabled } : prev)
      toaster.create({ title: response.autoSyncEnabled ? 'Sincronização automática ativada.' : 'Sincronização automática pausada.', type: 'success' })
    } catch (error) {
      console.error('Erro ao atualizar sincronização automática:', error)
      toaster.create({ title: 'Não foi possível atualizar a sincronização automática.', type: 'error' })
    } finally {
      setSavingGoogleAutoSync(false)
    }
  }


  const handleSubscribe = async () => {
    if (!user) return
    setSubscribing(true)
    try {
      const { url, error } = await apiFetch<{ url?: string; error?: string }>('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, userEmail: user.email ?? '' }),
      })
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error(err)
      alert('Erro ao iniciar checkout.')
    } finally {
      setSubscribing(false)
    }
  }

  const handleOpenPortal = async () => {
    if (!user) return
    setOpeningPortal(true)
    try {
      const { url, error } = await apiFetch<{ url?: string; error?: string }>('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error(err)
      alert('Erro ao abrir o portal de pagamento.')
    } finally {
      setOpeningPortal(false)
    }
  }

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
    if (!isOpen) setIntegrationView(null)
  }, [isOpen, initialTab])

  useEffect(() => {
    if (activeTab !== 'integrations') setIntegrationView(null)
  }, [activeTab])

  useEffect(() => {
    if (user?.user_metadata?.avatar_url) {
      setAvatarUrl(user.user_metadata.avatar_url)
    }
    if (user?.user_metadata?.full_name || user?.user_metadata?.name) {
      setEditName(user.user_metadata.full_name || user.user_metadata.name)
    }
  }, [user])

  const handleAvatarUpload = async (file: File) => {
    if (!user) return

    setUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `avatar-${Date.now()}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          avatar_url: publicUrl
        })

      if (profileError) throw profileError

      const { error: authError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      })

      if (authError) throw authError

      // Sincroniza avatar no workspace_members via server (bypassa RLS)
      await apiFetch('/api/workspace/sync-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatar: publicUrl }),
      }).catch(() => { })

      setAvatarUrl(publicUrl)
      setIsAvatarModalOpen(false)
    } catch (err: any) {
      console.error('Erro no upload:', err)
      alert('Erro ao carregar imagem: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleUpdateName = async () => {
    if (!user || !editName.trim() || editName === (user.user_metadata.full_name || user.user_metadata.name)) return
    setIsSavingName(true)
    const oldName = user.user_metadata?.full_name || user.user_metadata?.name || ''
    const newName = editName.trim()
    try {
      // Sincroniza nome do workspace ANTES de atualizar auth (evita race condition no Sidebar)
      // Se não havia nome customizado ou o nome do workspace era igual ao nome antigo, atualiza automaticamente
      await apiFetch<{ name: string | null }>('/api/workspace/name', undefined, { userId: user.id })
        .then(({ name: currentWsName }) => {
          if (!currentWsName || currentWsName === oldName) {
            return apiFetch('/api/workspace/name', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ownerUserId: user.id, name: newName }),
            })
          }
        })
        .catch(() => { })

      const { error } = await supabase.auth.updateUser({
        data: { full_name: newName, name: newName }
      })
      if (error) throw error

      // Também atualizar a tabela profiles se existir
      await supabase
        .from('profiles')
        .update({ name: newName })
        .eq('id', user.id)

      // Sincroniza nome no workspace_members via server (bypassa RLS)
      await apiFetch('/api/workspace/sync-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name: newName }),
      }).catch(() => { })

    } catch (err: any) {
      console.error('Erro ao atualizar nome:', err)
      alert('Erro ao atualizar nome: ' + err.message)
    } finally {
      setIsSavingName(false)
    }
  }

  const handleLinkPhone = async () => {
    if (!user || !phoneInput.trim() || ddd.length < 2 || isPhoneValid === false) return
    setIsLinkingPhone(true)
    setPhoneLinkError(null)
    try {
      const { phone, pendingVerification } = await apiFetch<{ ok: boolean; phone: string; pendingVerification?: boolean }>('/api/whatsapp/link-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, phone: phoneInput.trim() }),
      })
      setPendingPhone(phone)
      setLinkedPhone(null)
      setVerificationCode('')
      if (!pendingVerification) {
        setLinkedPhone(phone)
        setPendingPhone(null)
        setPhoneLinkSuccess(true)
        setTimeout(() => setPhoneLinkSuccess(false), 4000)
      }
    } catch (err: any) {
      setPhoneLinkError(err.message || 'Não foi possível validar este número.')
    } finally {
      setIsLinkingPhone(false)
    }
  }

  const handleVerifyPhoneCode = async () => {
    if (!user || !pendingPhone || verificationCode.replace(/\D/g, '').length !== 6) return
    setIsVerifyingPhone(true)
    setPhoneLinkError(null)
    try {
      const { phone } = await apiFetch<{ ok: boolean; phone: string }>('/api/whatsapp/link-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          phone: pendingPhone,
          code: verificationCode.replace(/\D/g, ''),
        }),
      })
      setLinkedPhone(phone)
      setPendingPhone(null)
      setVerificationCode('')
      setDdd('')
      setPhoneRemainder('')
      setPhoneLinkSuccess(true)
      setTimeout(() => setPhoneLinkSuccess(false), 4000)
    } catch (err: any) {
      setPhoneLinkError(err.message || 'Nao foi possivel confirmar o codigo.')
    } finally {
      setIsVerifyingPhone(false)
    }
  }

  const handleResendPhoneCode = async () => {
    if (!user || !pendingPhone) return
    setIsLinkingPhone(true)
    setPhoneLinkError(null)
    try {
      await apiFetch('/api/whatsapp/link-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, phone: pendingPhone }),
      })
    } catch (err: any) {
      setPhoneLinkError(err.message || 'Nao foi possivel reenviar o codigo.')
    } finally {
      setIsLinkingPhone(false)
    }
  }

  const handleUnlinkPhone = async () => {
    if (!user) return
    setIsUnlinkingPhone(true)
    try {
      await apiFetch('/api/whatsapp/link-phone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      setLinkedPhone(null)
      setPendingPhone(null)
      setVerificationCode('')
      setDdd('')
      setPhoneRemainder('')
    } catch (err: any) {
      alert('Erro ao desvincular: ' + (err.message || 'Tente novamente'))
    } finally {
      setIsUnlinkingPhone(false)
    }
  }

  const isNameChanged = editName.trim() !== '' && editName.trim() !== (user?.user_metadata?.full_name || user?.user_metadata?.name || '')

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Avatar Upload Modal (Crop) */}
          <AvatarUploadModal
            isOpen={isAvatarModalOpen}
            onClose={() => setIsAvatarModalOpen(false)}
            onUpload={handleAvatarUpload}
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative bg-white w-full max-w-3xl max-h-[85vh] sm:h-[500px] rounded-2xl shadow-2xl flex flex-col sm:flex-row overflow-hidden border border-[#e9e9e7]"
          >
            {/* Sidebar */}
            {/* Sidebar Desktop */}
            <div className="hidden sm:flex w-[240px] border-r border-[#e9e9e7] bg-[#fcfcfa] flex-col flex-shrink-0">
              <div className="p-6 pb-4 border-b border-[#e9e9e7]/50">
                <h2 className="text-lg font-bold text-[#37352f]">Configurações</h2>
              </div>
              <nav className="flex-1 p-3 space-y-1">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'profile' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/60 hover:bg-[#e9e9e7]/50'}`}
                >
                  <img src={perfilIcon} alt="" className={`w-[18px] h-[18px] flex-shrink-0 ${activeTab === 'profile' ? 'opacity-100' : 'opacity-60'}`} /> Meu Perfil
                </button>
                <button
                  onClick={() => setActiveTab('subscription')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'subscription' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/60 hover:bg-[#e9e9e7]/50'}`}
                >
                  <img src={assinaturaIcon} alt="" className={`w-[18px] h-[18px] flex-shrink-0 ${activeTab === 'subscription' ? 'opacity-100' : 'opacity-60'}`} /> Assinatura
                </button>
                <button
                  onClick={() => setActiveTab('integrations')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'integrations' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/60 hover:bg-[#e9e9e7]/50'}`}
                >
                  <img src={integracaoIcon} alt="" className={`w-[18px] h-[18px] flex-shrink-0 ${activeTab === 'integrations' ? 'opacity-100' : 'opacity-60'}`} /> Integrações
                </button>
              </nav>

              {/* Version Footer Clean */}
              <div className="px-6 py-4 mt-auto">
                <div className="flex items-center gap-2 text-[#37352f]/25">
                  <span className="text-[11px] font-bold tracking-tight">v1.0.0</span>
                  <span className="w-1 h-1 rounded-full bg-[#37352f]/10" />
                  <span className="text-[9px] font-black uppercase tracking-[0.1em]">Beta</span>
                </div>
              </div>
            </div>

            {/* Tabs Mobile */}
            <div className="flex sm:hidden items-center border-b border-[#e9e9e7] bg-[#fcfcfa] flex-shrink-0">
              <div className="flex items-center gap-1 px-4 py-3 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <h2 className="text-base font-bold text-[#37352f] mr-4">Configurações</h2>
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${activeTab === 'profile' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/50'}`}
                >
                  <img src={perfilIcon} alt="" className={`w-[15px] h-[15px] flex-shrink-0 ${activeTab === 'profile' ? 'opacity-100' : 'opacity-50'}`} /> Perfil
                </button>
                <button
                  onClick={() => setActiveTab('subscription')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${activeTab === 'subscription' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/50'}`}
                >
                  <img src={assinaturaIcon} alt="" className={`w-[15px] h-[15px] flex-shrink-0 ${activeTab === 'subscription' ? 'opacity-100' : 'opacity-50'}`} /> Assinatura
                </button>
                <button
                  onClick={() => setActiveTab('integrations')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors whitespace-nowrap ${activeTab === 'integrations' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/50'}`}
                >
                  <img src={integracaoIcon} alt="" className={`w-[15px] h-[15px] flex-shrink-0 ${activeTab === 'integrations' ? 'opacity-100' : 'opacity-50'}`} /> Integrações
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-2.5 mr-3 text-[#37352f]/40 hover:text-[#37352f] hover:bg-[#f7f7f5] rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 bg-white relative min-h-0">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2.5 text-[#37352f]/40 hover:text-[#37352f] hover:bg-[#f7f7f5] rounded-xl transition-colors z-10 hidden sm:flex"
              >
                <X size={20} />
              </button>

              <div className="p-5 sm:p-8 h-full overflow-y-auto [ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {activeTab === 'profile' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                    <div className="flex items-center justify-between pb-2">
                      <div>
                        <h3 className="text-xl font-bold text-[#37352f] tracking-tight leading-none">Meu Perfil</h3>
                        <p className="text-[13px] text-[#37352f]/50 mt-1.5 flex items-center gap-1.5">
                          Gerencie suas informações e foto de perfil.
                        </p>
                      </div>
                    </div>

                    {/* Profile Picture Section */}
                    <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-6 pb-2">
                      <div className="relative flex-shrink-0">
                        <div
                          onClick={() => setIsAvatarModalOpen(true)}
                          className="w-20 h-20 rounded-full overflow-hidden border border-[#e9e9e7] bg-[#f7f7f5] cursor-pointer ring-0 hover:ring-4 ring-black/5 transition-all duration-300"
                        >
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt="Profile"
                              className="w-full h-full object-cover"
                              onError={() => setAvatarUrl(null)}
                            />
                          ) : (
                            <Avvvatars value={user?.email || 'guest'} size={80} style="character" />
                          )}
                        </div>

                        <button
                          onClick={() => setIsAvatarModalOpen(true)}
                          className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border border-[#e9e9e7] rounded-full flex items-center justify-center shadow-sm hover:scale-110 active:scale-95 transition-all z-10"
                          title="Alterar foto"
                        >
                          <Camera size={12} className="text-[#37352f]/50" />
                        </button>
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0 text-center sm:text-left">
                        <h4 className="text-xl font-bold text-[#37352f] leading-none truncate">{fullName}</h4>
                        <p className="text-sm text-[#37352f]/40 font-medium truncate">{user?.email}</p>
                      </div>
                    </div>

                    {/* Inputs Section */}
                    <hr className="-mx-5 sm:-mx-8 border-t border-[#e9e9e7]" />
                    <div className="grid grid-cols-1 gap-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <label className="text-[11px] font-bold text-[#37352f]/50">Nome Completo</label>
                          {isNameChanged && (
                            <button
                              onClick={handleUpdateName}
                              disabled={isSavingName}
                              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              {isSavingName ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                              Salvar
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Seu nome"
                          className="w-full px-4 py-3.5 bg-white border border-[#e9e9e7] rounded-xl text-sm font-medium text-[#37352f] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all shadow-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-bold text-[#37352f]/50 px-1">Endereço de Email</label>
                        <input
                          type="email"
                          disabled
                          value={user?.email || ''}
                          className="w-full px-4 py-3.5 bg-[#fcfcfa] border border-[#e9e9e7] rounded-xl text-sm font-medium text-[#37352f] cursor-not-allowed opacity-80"
                        />
                      </div>

                      {isGoogleUser && (
                        <div className="space-y-4 pt-4">
                          <hr className="-mx-5 sm:-mx-8 border-t border-[#e9e9e7]" />
                          <div className="space-y-1 px-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Smartphone size={11} className="text-[#37352f]/40" />
                                <label className="text-[11px] font-bold text-[#37352f]/50">Assistente WhatsApp</label>
                              </div>
                              {(linkedPhone || pendingPhone) && (
                                <button
                                  onClick={handleUnlinkPhone}
                                  disabled={isUnlinkingPhone}
                                  className="text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] transition-colors disabled:opacity-40"
                                >
                                  {isUnlinkingPhone ? <Loader2 size={10} className="animate-spin inline" /> : (linkedPhone ? 'Desconectar' : 'Cancelar')}
                                </button>
                              )}
                            </div>
                            <p className="text-[11px] text-[#37352f]/40 leading-relaxed">
                              {linkedPhone
                                ? `Número conectado: +${linkedPhone}. O bot vai te reconhecer automaticamente.`
                                : 'Vincule seu número do WhatsApp para usar o assistente sem precisar de senha.'
                              }
                            </p>
                          </div>

                          {phoneLinkSuccess && (
                            <div className="flex items-center gap-2 px-1">
                              <Check size={11} className="text-green-500" />
                              <span className="text-[11px] font-bold text-green-600">Conectado! Você recebeu uma mensagem de confirmação no WhatsApp.</span>
                            </div>
                          )}

                          {!linkedPhone && !phoneLinkSuccess && !pendingPhone && (
                            <>
                              <div className={`w-full flex items-center gap-0 p-2 bg-[#fcfcfa] border rounded-xl focus-within:ring-1 focus-within:ring-black/5 transition-all ${phoneLinkError ? 'border-red-100' : isPhoneValid === true ? 'border-green-100' : 'border-[#e9e9e7] focus-within:border-[#37352f]/30'}`}>
                                <CountrySelector
                                  selectedCountry={selectedCountry}
                                  onSelect={setSelectedCountry}
                                />
                                <div className="h-4 w-[1px] bg-[#e9e9e7] mx-1" />
                                <span className="text-sm font-bold text-[#37352f]/40 ml-1">
                                  (
                                </span>
                                <input
                                  type="tel"
                                  maxLength={2}
                                  placeholder="18"
                                  value={ddd}
                                  onChange={handleDddChange}
                                  className="w-5 text-sm font-bold bg-transparent border-none focus:outline-none placeholder:text-[#37352f]/20 p-0 text-center text-[#37352f]"
                                />
                                <span className="text-sm font-bold text-[#37352f]/40">
                                  )
                                </span>
                                <input
                                  type="tel"
                                  placeholder="91234-5678"
                                  value={phoneRemainder}
                                  onChange={handleRemainderChange}
                                  className="flex-1 ml-2 text-sm font-medium bg-transparent border-none focus:outline-none text-[#37352f] placeholder:text-[#37352f]/30 p-0"
                                />

                                {/* Validação no lado direito */}
                                <div className="flex items-center px-1.5 min-w-[20px] justify-center">
                                  {isValidatingPhone ? (
                                    <Loader2 size={12} className="animate-spin text-[#37352f]/20" />
                                  ) : isPhoneValid === true ? (
                                    <CheckCircle2 size={12} className="text-green-400" />
                                  ) : isPhoneValid === false ? (
                                    <XCircle size={12} className="text-red-400" />
                                  ) : null}
                                </div>
                              </div>

                              {phoneLinkError && (
                                <p className="px-1 text-[10px] text-red-500 font-medium -mt-1.5">
                                  {phoneLinkError}
                                </p>
                              )}

                              <p className="px-1 text-[10px] text-[#37352f]/40 leading-relaxed">
                                Use seu <span className={`font-bold transition-colors ${ddd.length === 2 ? 'text-green-500' : 'text-[#37352f]/60'}`}>DDD</span> e número. O <span className="font-semibold">+{selectedCountry.code}</span> já está incluído.
                              </p>
                              <div className="flex items-center gap-3 px-1">
                                <button
                                  onClick={handleLinkPhone}
                                  disabled={isLinkingPhone || phoneInput.replace(/\D/g, '').length < 10}
                                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#37352f]/50 hover:text-[#37352f] transition-colors disabled:opacity-40"
                                >
                                  {isLinkingPhone ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                  Conectar WhatsApp
                                </button>
                              </div>
                            </>
                          )}

                          {!linkedPhone && !phoneLinkSuccess && pendingPhone && (
                            <div className="space-y-3 px-1">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#37352f]/35">
                                  Codigo de verificacao
                                </label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={6}
                                  value={verificationCode}
                                  onChange={(e) => {
                                    setPhoneLinkError(null)
                                    setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                  }}
                                  placeholder="123456"
                                  className="w-full rounded-xl border border-[#e9e9e7] bg-[#fcfcfa] px-3 py-2 text-sm font-semibold tracking-[0.35em] text-[#37352f] outline-none transition focus:border-[#37352f]/30"
                                />
                                <p className="text-[10px] text-[#37352f]/40 leading-relaxed">
                                  Digite o codigo enviado para <span className="font-semibold text-[#37352f]/65">+{pendingPhone}</span>.
                                </p>
                              </div>

                              {phoneLinkError && (
                                <p className="text-[10px] text-red-500 font-medium">
                                  {phoneLinkError}
                                </p>
                              )}

                              <div className="flex items-center gap-3">
                                <button
                                  onClick={handleVerifyPhoneCode}
                                  disabled={isVerifyingPhone || verificationCode.replace(/\D/g, '').length !== 6}
                                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#37352f]/50 hover:text-[#37352f] transition-colors disabled:opacity-40"
                                >
                                  {isVerifyingPhone ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                  Confirmar codigo
                                </button>
                                <button
                                  onClick={handleResendPhoneCode}
                                  disabled={isLinkingPhone}
                                  className="text-[11px] font-bold text-[#37352f]/35 hover:text-[#37352f]/60 transition-colors disabled:opacity-40"
                                >
                                  {isLinkingPhone ? 'Reenviando...' : 'Reenviar codigo'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
                {activeTab === 'subscription' && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    <div className="flex items-center justify-between pb-2">
                      <div>
                        <h3 className="text-xl font-bold text-[#37352f] tracking-tight leading-none">Assinatura</h3>
                        <p className="text-[13px] text-[#37352f]/50 mt-1.5 flex items-center gap-1.5">
                          Gerencie seu plano e recursos.
                        </p>
                      </div>
                    </div>

                    {loadingSub ? (
                      <div className="space-y-6">
                        {/* Skeleton Status Card */}
                        <div className="border border-[#e9e9e7] p-5 rounded-2xl bg-[#f7f7f5] flex items-center justify-between animate-pulse">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#37352f]/5 border border-[#e9e9e7]" />
                            <div className="space-y-2">
                              <div className="h-2.5 w-16 bg-[#37352f]/10 rounded-full" />
                              <div className="h-4 w-24 bg-[#37352f]/10 rounded-full" />
                            </div>
                          </div>
                          <div className="h-4 w-20 bg-[#37352f]/10 rounded-full" />
                        </div>

                        {/* Skeleton Grid Details */}
                        <div className="flex border-b border-[#f1f1f0] pb-6 gap-8 animate-pulse">
                          <div className="space-y-2">
                            <div className="h-2.5 w-24 bg-[#37352f]/10 rounded-full" />
                            <div className="h-4 w-32 bg-[#37352f]/10 rounded-full" />
                          </div>
                          <div className="space-y-2">
                            <div className="h-2.5 w-24 bg-[#37352f]/10 rounded-full" />
                            <div className="h-4 w-32 bg-[#37352f]/10 rounded-full" />
                          </div>
                        </div>

                        {/* Skeleton Action Button */}
                        <div className="pt-2 space-y-4 animate-pulse">
                          <div className="w-full h-[68px] bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl flex items-center px-5 justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-[#37352f]/5 border border-[#e9e9e7]" />
                              <div className="space-y-2">
                                <div className="h-3 w-32 bg-[#37352f]/10 rounded-full" />
                                <div className="h-2 w-48 bg-[#37352f]/10 rounded-full" />
                              </div>
                            </div>
                            <div className="w-3.5 h-3.5 rounded bg-[#37352f]/5" />
                          </div>

                          <div className="h-3 w-full max-w-[280px] bg-[#37352f]/5 rounded-full mx-1" />
                        </div>
                      </div>
                    ) : subscription?.status === 'active' ? (
                      <div className="space-y-6">
                        {/* Status Card Clean */}
                        <div className="border border-[#e9e9e7] p-5 rounded-2xl bg-[#f7f7f5] flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm">
                              <img src={subscription?.plan_id === 'pulse' ? pulseLogo : flowLogo} alt="Plan" className="w-6 h-6 object-contain" />
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-[#37352f]/50 mb-0.5">Plano ativo</p>
                              <h4 className="text-base font-bold text-[#37352f]">
                                {subscription?.plan_id === 'pulse' ? 'Pulse' : 'Flow'}
                              </h4>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-[#37352f]">
                              {subscription?.plan_id === 'pulse' ? 'R$ 29,90/mês' : 'R$ 9,90/mês'}
                            </p>
                          </div>
                        </div>

                        <div className="flex border-b border-[#f1f1f0] pb-6 gap-8">
                          <div className="space-y-1">
                            <p className="text-[11px] font-bold text-[#37352f]/50">Próxima renovação</p>
                            {subscription.current_period_end ? (() => {
                              const renewDate = new Date(subscription.current_period_end)
                              const today = new Date()
                              today.setHours(0, 0, 0, 0)
                              renewDate.setHours(0, 0, 0, 0)
                              const daysLeft = Math.ceil((renewDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                              const badgeColor = daysLeft <= 3
                                ? 'bg-red-100 text-red-600'
                                : daysLeft <= 7
                                  ? 'bg-amber-100 text-amber-600'
                                  : 'bg-emerald-100 text-emerald-600'
                              return (
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-[#37352f]/80">
                                    {new Date(subscription.current_period_end).toLocaleDateString('pt-BR')}
                                  </p>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeColor}`}>
                                    {daysLeft <= 0 ? 'Hoje' : `${daysLeft}d`}
                                  </span>
                                </div>
                              )
                            })() : (
                              <p className="text-sm font-semibold text-[#37352f]/80">Renovação automática</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-bold text-[#37352f]/50">Bandeira do Cartão</p>
                            <p className="text-sm font-semibold text-[#37352f]/80">
                              {subscription?.card_brand
                                ? `${({ visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', elo: 'Elo', hipercard: 'Hipercard', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay' } as Record<string, string>)[subscription.card_brand] ?? subscription.card_brand.charAt(0).toUpperCase() + subscription.card_brand.slice(1)}${subscription?.card_last4 ? ` •••• ${subscription.card_last4}` : ''}`
                                : 'Cartão via Stripe'}
                            </p>
                          </div>
                        </div>

                        <div className="pt-2 space-y-4">
                          <button
                            onClick={handleOpenPortal}
                            disabled={openingPortal}
                            className="w-full flex items-center justify-between px-5 py-4 bg-[#f7f7f5] border border-[#e9e9e7] rounded-2xl group hover:bg-[#e9e9e7] transition-all active:scale-[0.98] disabled:opacity-50"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
                                <ExternalLink size={16} className="text-[#37352f]/40" />
                              </div>
                              <div className="text-left">
                                <p className="text-[12px] font-bold text-[#37352f]">Gerenciar no Portal Stripe</p>
                                <p className="text-[10px] text-[#37352f]/40 font-medium">Faturas, cartões e cancelamentos</p>
                              </div>
                            </div>
                            <ArrowRight size={14} className="text-[#37352f]/20 group-hover:translate-x-1 transition-transform" />
                          </button>

                          <p className="text-[10px] text-[#37352f]/20 font-medium leading-relaxed px-1">
                            O Flui utiliza tecnologia do Stripe para garantir sua segurança e privacidade financeira.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {membership ? (
                          <div className="border border-[#e9e9e7] p-4 rounded-2xl bg-[#f7f7f5] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm shrink-0">
                                <Zap size={20} className="text-[#37352f] fill-[#37352f]" />
                              </div>
                              <div>
                                <p className="text-[11px] font-bold text-[#37352f]/40 mb-0.5">Plano atual</p>
                                <h4 className="text-sm font-bold text-[#37352f]">Workspace · {membership.planId === 'pulse' ? 'Pulse' : 'Flow'}</h4>
                                <p className="text-[10px] text-[#37352f]/40 font-medium truncate max-w-[180px]">Convidado por {membership.ownerName}</p>
                              </div>
                            </div>
                            <div className="px-2 py-1 bg-[#25D366]/10 text-[#25D366] text-[9px] font-bold rounded-lg border border-[#25D366]/20">
                              ATIVO
                            </div>
                          </div>
                        ) : (
                          /* Card plano atual: Gratuito */
                          <div className="border border-[#e9e9e7] p-4 rounded-2xl bg-[#f7f7f5] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm shrink-0">
                                <img src={gratisLogo} alt="Gratuito" className="w-6 h-6 object-contain" />
                              </div>
                              <div>
                                <p className="text-[11px] font-bold text-[#37352f]/40 mb-0.5">Plano atual</p>
                                <h4 className="text-sm font-bold text-[#37352f]">Gratuito</h4>
                              </div>
                            </div>
                            <button
                              onClick={() => { onClose(); navigate('/checkout-preview') }}
                              className="text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] transition-colors flex items-center gap-1"
                            >
                              Fazer upgrade
                              <ArrowRight size={11} />
                            </button>
                          </div>
                        )}

                        {/* Card Ativar Flow */}
                        <div className="w-full border border-[#e9e9e7] rounded-3xl bg-[#fcfcfa] flex flex-col group transition-all duration-300 overflow-hidden">
                          {/* Seção Superior: Nome, Preço e Botão */}
                          <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
                            <div className="flex gap-3 sm:gap-4 items-center">
                              <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm flex-shrink-0">
                                <img src={flowLogo} alt="Flow" className="w-6 h-6 object-contain" />
                              </div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-[14px] font-black text-[#37352f] tracking-tight leading-none">
                                  {membership ? 'Flow Individual' : 'Ativar Flow'}
                                </h4>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 sm:gap-5 w-full sm:w-auto justify-between sm:justify-end">
                              <div className="text-left sm:text-right">
                                <div className="flex items-baseline gap-0.5">
                                  <span className="text-[9px] font-bold text-[#37352f]/30 uppercase">R$</span>
                                  <span className="text-xl font-black text-[#37352f] leading-none">9,90</span>
                                </div>
                                <p className="text-[8px] font-bold text-[#37352f]/20 tracking-wider uppercase mt-0.5">mensal</p>
                              </div>
                              <button
                                onClick={handleSubscribe}
                                disabled={subscribing}
                                className="h-9 px-6 bg-[#1a1a1a] text-white text-[11px] font-bold rounded-xl hover:bg-black transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 shadow-sm"
                              >
                                {subscribing ? (
                                  <Loader2 size={14} className="animate-spin text-white/50" />
                                ) : (
                                  <>
                                    Assinar
                                    <ArrowRight size={14} />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>



                          {/* Seção Inferior: Recursos (Com o mesmo fundo e divisor sutil) */}
                          <div className="px-5 sm:px-14 pb-5 pt-4 border-t border-[#37352f]/5 bg-[#37352f]/[0.02]">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                              {[
                                'Tarefas Ilimitadas',
                                'Lui Pro AI',
                                'Sincronização',
                                'Suporte Prioritário'
                              ].map((item, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px] font-bold text-[#37352f]/40">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/30" />
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
                {activeTab === 'integrations' && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">

                    {integrationView === null ? (
                      <>
                        <div className="flex items-center justify-between pb-2">
                          <div>
                            <h3 className="text-xl font-bold text-[#37352f] tracking-tight leading-none">Integrações</h3>
                            <p className="text-[13px] text-[#37352f]/50 mt-1.5">
                              Conecte serviços externos ao Flui.
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <button
                            onClick={() => setIntegrationView('google-calendar')}
                            className="w-full flex items-center gap-3 px-4 py-3.5 border border-[#e9e9e7] rounded-2xl bg-[#f7f7f5] hover:bg-[#f0f0ee] transition-all text-left group active:scale-[0.98]"
                          >
                            <img src={googleCalendarLogo} alt="Google Calendar" className="w-7 h-7 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-[#37352f]">Google Calendar</p>
                              <p className="text-[11px] text-[#37352f]/40 mt-0.5">Sincronize tarefas com seu calendário</p>
                            </div>
                            <div className="flex items-center gap-2.5 flex-shrink-0">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border whitespace-nowrap ${loadingGoogleCalendar
                                ? 'bg-[#f1f1f0] border-[#e9e9e7] text-[#37352f]/30'
                                : !googleCalendarStatus?.configured
                                  ? 'bg-[#f1f1f0] border-[#e9e9e7] text-[#37352f]/45'
                                  : googleCalendarStatus.connected
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : 'bg-[#f1f1f0] border-[#e9e9e7] text-[#37352f]/55'
                                }`}>
                                {loadingGoogleCalendar ? '···' : !googleCalendarStatus?.configured ? 'Indisponível' : googleCalendarStatus.connected ? 'Conectado' : 'Desconectado'}
                              </span>
                              <ArrowRight size={12} className="text-[#37352f]/25 group-hover:translate-x-0.5 transition-transform" />
                            </div>
                          </button>
                        </div>
                      </>
                    ) : integrationView === 'google-calendar' ? (
                      <>
                        <div className="flex items-center gap-2 pb-2">
                          <button
                            onClick={() => setIntegrationView(null)}
                            className="flex items-center gap-1 text-[12px] font-bold text-[#37352f]/40 hover:text-[#37352f] transition-colors"
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M8.5 2L4 6.5L8.5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Integrações
                          </button>
                          <span className="text-[#37352f]/20 text-[12px]">/</span>
                          <div className="flex items-center gap-1.5">
                            <img src={googleCalendarLogo} alt="Google Calendar" className="w-3.5 h-3.5" />
                            <span className="text-[12px] font-bold text-[#37352f]">Google Calendar</span>
                          </div>
                        </div>

                        {loadingGoogleCalendar ? (
                          <div className="space-y-3 animate-pulse">
                            <div className="border border-[#e9e9e7] rounded-2xl overflow-hidden">
                              <div className="h-16 bg-[#f7f7f5]" />
                              <div className="h-20 bg-white px-5 py-4 space-y-2">
                                <div className="h-2.5 w-20 bg-[#37352f]/8 rounded-full" />
                                <div className="h-3.5 w-44 bg-[#37352f]/10 rounded-full" />
                                <div className="h-2.5 w-36 bg-[#37352f]/6 rounded-full" />
                              </div>
                            </div>
                            <div className="border border-[#e9e9e7] rounded-2xl h-16 bg-[#f7f7f5]" />
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Card principal */}
                            <div className="border border-[#e9e9e7] rounded-2xl overflow-hidden">
                              {/* Cabeçalho */}
                              <div className="flex items-center justify-between px-5 py-4 bg-[#f7f7f5]">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <img src={googleCalendarLogo} alt="Google Calendar" className="w-5 h-5 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-[#37352f]">Google Calendar</p>
                                    <p className="text-[11px] text-[#37352f]/40">Tarefas com data e horário no seu calendário</p>
                                  </div>
                                </div>
                                {googleCalendarStatus?.connected && (
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-[11px] font-semibold text-emerald-600">Ativo</span>
                                  </div>
                                )}
                              </div>

                              {/* Conectado: info da conta */}
                              {googleCalendarStatus?.connected && (
                                <>
                                  <div className="px-5 py-4 border-t border-[#e9e9e7] space-y-0.5">
                                    <p className="text-[10px] font-bold text-[#37352f]/35 mb-2">Conta conectada</p>
                                    <p className="text-[13px] font-semibold text-[#37352f] truncate">{googleCalendarStatus.email || 'Google Calendar'}</p>
                                    <p className="text-[11px] text-[#37352f]/40">{googleCalendarStatus.calendarId || 'primary'} · {googleCalendarStatus.timeZone || 'America/Sao_Paulo'}</p>
                                  </div>
                                  {googleCalendarStatus?.lastError && (
                                    <div className="px-5 pb-3">
                                      <p className="text-[11px] text-red-500">{googleCalendarStatus.lastError}</p>
                                    </div>
                                  )}
                                  <div className="px-5 pb-4 pt-1 border-t border-[#e9e9e7]/60">
                                    <button
                                      onClick={handleGoogleCalendarDisconnect}
                                      disabled={disconnectingGoogleCalendar}
                                      className="text-[11px] font-bold text-[#37352f]/35 hover:text-red-500 transition-colors disabled:opacity-40 flex items-center gap-1.5 mt-2"
                                    >
                                      {disconnectingGoogleCalendar && <Loader2 size={10} className="animate-spin" />}
                                      Desconectar conta
                                    </button>
                                  </div>
                                </>
                              )}

                              {/* Desconectado: explicação + botão */}
                              {!googleCalendarStatus?.connected && (
                                <div className="px-5 py-4 border-t border-[#e9e9e7] space-y-4">
                                  <p className="text-[12px] text-[#37352f]/50 leading-relaxed">
                                    Conecte sua conta do Google para que tarefas com data e horário apareçam automaticamente no seu Google Calendar. Edições feitas no Flui se refletem no calendário em tempo real.
                                  </p>
                                  {!googleCalendarStatus?.configured && (
                                    <p className="text-[11px] text-amber-600/80 leading-relaxed">
                                      Integração não configurada no servidor. Fale com o administrador.
                                    </p>
                                  )}
                                  {googleCalendarStatus?.lastError && (
                                    <p className="text-[11px] text-red-500">{googleCalendarStatus.lastError}</p>
                                  )}
                                  <button
                                    onClick={handleGoogleCalendarConnect}
                                    disabled={!googleCalendarStatus?.configured || connectingGoogleCalendar}
                                    className="flex items-center gap-2 h-9 px-5 bg-[#1a1a1a] text-white rounded-xl text-[11px] font-bold hover:bg-black transition-colors disabled:opacity-40"
                                  >
                                    {connectingGoogleCalendar && <Loader2 size={12} className="animate-spin" />}
                                    Conectar com Google
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Sincronização automática — só exibe quando conectado */}
                            {googleCalendarStatus?.connected && (
                              <div className="border border-[#e9e9e7] rounded-2xl px-5 py-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="space-y-1 flex-1">
                                    <p className="text-[13px] font-semibold text-[#37352f]">Sincronização automática</p>
                                    <p className="text-[11px] text-[#37352f]/40 leading-relaxed">
                                      {googleCalendarStatus.autoSyncEnabled
                                        ? 'Ligada novas tarefas com data e horário criam eventos automaticamente no Google Calendar.'
                                        : 'Desligada tarefas não serão enviadas ao Google Calendar automaticamente.'}
                                    </p>
                                  </div>
                                  <button
                                    onClick={handleToggleGoogleAutoSync}
                                    disabled={savingGoogleAutoSync}
                                    className={`relative mt-0.5 w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${googleCalendarStatus.autoSyncEnabled ? 'bg-[#1a1a1a]' : 'bg-[#d8d8d4]'
                                      }`}
                                  >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${googleCalendarStatus.autoSyncEnabled ? 'translate-x-5' : ''
                                      }`} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : null}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
