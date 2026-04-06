import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, User, CreditCard, Check, Loader2, ArrowRight, ExternalLink, Camera, Lock } from 'lucide-react'
import flowLogo from '../assets/logo/flow.png'
import gratisLogo from '../assets/logo/gratis.png'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Avvvatars from 'avvvatars-react'
import { AvatarUploadModal } from './AvatarUploadModal'
import { apiFetch } from '../lib/api'
import { useNavigate } from 'react-router-dom'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'profile' | 'subscription'
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab = 'profile' }) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'subscription'>(initialTab)
  const { user } = useAuth()
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Usuário'
  const [subscription, setSubscription] = useState<any>(null)
  const [loadingSub, setLoadingSub] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.user_metadata?.avatar_url || null)
  const [uploading, setUploading] = useState(false)
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false)
  const [editName, setEditName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const hasWhatsappPassword = user?.user_metadata?.has_whatsapp_password === true

  const navigate = useNavigate()
  const isGoogleUser = user?.identities?.some(i => i.provider === 'google') &&
    !user?.identities?.some(i => i.provider === 'email')

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) return
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()

        setSubscription(data)

        if (data?.stripe_subscription_id) {
          try {
            const { subscription: synced } = await apiFetch<{ subscription?: any }>('/api/subscription/sync', undefined, {
              userId: user.id,
            })
            if (synced) setSubscription(synced)
          } catch (syncErr) {
            console.warn('Sync com Stripe falhou:', syncErr)
          }
        }
      } catch (err) {
        console.error('Erro ao buscar assinatura:', err)
      } finally {
        setLoadingSub(false)
      }
    }

    if (isOpen && activeTab === 'subscription') {
      setLoadingSub(true)
      fetchSubscription()
    }
  }, [isOpen, activeTab, user])

  const handleSubscribe = async () => {
    if (!user) return
    setSubscribing(true)
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
  }, [isOpen, initialTab])

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
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: editName.trim(), name: editName.trim() }
      })
      if (error) throw error

      // Também atualizar a tabela profiles se existir
      await supabase
        .from('profiles')
        .update({ name: editName.trim() })
        .eq('id', user.id)

    } catch (err: any) {
      console.error('Erro ao atualizar nome:', err)
      alert('Erro ao atualizar nome: ' + err.message)
    } finally {
      setIsSavingName(false)
    }
  }

  const handleSetPassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) return
    setIsSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { has_whatsapp_password: true }
      })
      if (error) throw error
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      setShowChangePassword(false)
      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (err: any) {
      alert('Erro ao definir senha: ' + err.message)
    } finally {
      setIsSavingPassword(false)
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
                  <User size={18} /> Meu Perfil
                </button>
                <button
                  onClick={() => setActiveTab('subscription')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'subscription' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/60 hover:bg-[#e9e9e7]/50'}`}
                >
                  <CreditCard size={18} /> Assinatura
                </button>
              </nav>
            </div>

            {/* Tabs Mobile */}
            <div className="flex sm:hidden items-center border-b border-[#e9e9e7] bg-[#fcfcfa] flex-shrink-0">
              <div className="flex items-center gap-1 px-4 py-3 flex-1">
                <h2 className="text-base font-bold text-[#37352f] mr-4">Configurações</h2>
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${activeTab === 'profile' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/50'}`}
                >
                  <User size={15} /> Perfil
                </button>
                <button
                  onClick={() => setActiveTab('subscription')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${activeTab === 'subscription' ? 'bg-[#e9e9e7] text-[#37352f]' : 'text-[#37352f]/50'}`}
                >
                  <CreditCard size={15} /> Assinatura
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
                      <div className="relative group flex-shrink-0">
                        <div
                          onClick={() => setIsAvatarModalOpen(true)}
                          className="w-20 h-20 rounded-full overflow-hidden border border-[#e9e9e7] bg-[#f7f7f5] cursor-pointer ring-0 hover:ring-4 ring-black/5 transition-all duration-300 relative"
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

                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            {uploading ? (
                              <Loader2 size={20} className="text-white animate-spin" />
                            ) : (
                              <Camera size={20} className="text-white" />
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => setIsAvatarModalOpen(true)}
                          className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border border-[#e9e9e7] rounded-full flex items-center justify-center shadow-sm hover:scale-110 active:scale-95 transition-all z-10"
                          title="Alterar foto"
                        >
                          <Camera size={14} className="text-[#37352f]/60" />
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
                                <Lock size={11} className="text-[#37352f]/40" />
                                <label className="text-[11px] font-bold text-[#37352f]/50">Senha para o assistente WhatsApp</label>
                              </div>
                              {(hasWhatsappPassword || passwordSuccess) && !showChangePassword && (
                                <button
                                  onClick={() => { setShowChangePassword(true); setNewPassword(''); setConfirmPassword('') }}
                                  className="text-[11px] font-bold text-[#37352f]/40 hover:text-[#37352f] transition-colors"
                                >
                                  Mudar senha
                                </button>
                              )}
                            </div>
                            <p className="text-[11px] text-[#37352f]/40 leading-relaxed">
                              {(hasWhatsappPassword || passwordSuccess) && !showChangePassword
                                ? 'Você já possui uma senha definida para o bot do WhatsApp.'
                                : 'Sua conta usa o Google. Defina uma senha para se autenticar no bot do WhatsApp.'
                              }
                            </p>
                          </div>

                          {(!hasWhatsappPassword && !passwordSuccess || showChangePassword) && (
                            <>
                              <input
                                type="password"
                                placeholder="Nova senha (mín. 6 caracteres)"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-[#fcfcfa] border border-[#e9e9e7] rounded-xl text-sm font-medium text-[#37352f] placeholder:text-[#37352f]/30 placeholder:font-normal focus:outline-none focus:border-[#37352f]/30 focus:ring-1 focus:ring-black/5 transition-all"
                              />
                              <input
                                type="password"
                                placeholder="Confirmar senha"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-[#fcfcfa] border border-[#e9e9e7] rounded-xl text-sm font-medium text-[#37352f] placeholder:text-[#37352f]/30 placeholder:font-normal focus:outline-none focus:border-[#37352f]/30 focus:ring-1 focus:ring-black/5 transition-all"
                              />
                              <div className="flex items-center gap-3 px-1">
                                <button
                                  onClick={handleSetPassword}
                                  disabled={isSavingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#37352f]/50 hover:text-[#37352f] transition-colors disabled:opacity-40"
                                >
                                  {isSavingPassword ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                  Salvar senha
                                </button>
                                {showChangePassword && (
                                  <button
                                    onClick={() => { setShowChangePassword(false); setNewPassword(''); setConfirmPassword('') }}
                                    className="text-[11px] font-bold text-[#37352f]/30 hover:text-[#37352f]/50 transition-colors"
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </div>
                            </>
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
                              <img src={flowLogo} alt="Flow" className="w-6 h-6 object-contain" />
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-[#37352f]/50 mb-0.5">Plano ativo</p>
                              <h4 className="text-base font-bold text-[#37352f]">Flow</h4>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-[#37352f]">R$ 9,90/mês</p>
                          </div>
                        </div>

                        <div className="flex border-b border-[#f1f1f0] pb-6 gap-8">
                          <div className="space-y-1">
                            <p className="text-[11px] font-bold text-[#37352f]/50">Próxima renovação</p>
                            <p className="text-sm font-semibold text-[#37352f]/80">
                              {subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString('pt-BR') : 'Renovação automática'}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-bold text-[#37352f]/50">Bandeira do Cartão</p>
                            <p className="text-sm font-semibold text-[#37352f]/80">Cartão via Stripe</p>
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
                        {/* Card plano atual: Gratuito */}
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

                        {/* Card Ativar Flow */}
                      <div className="w-full border border-[#e9e9e7] rounded-3xl bg-[#fcfcfa] flex flex-col group transition-all duration-300 overflow-hidden">
                        {/* Seção Superior: Nome, Preço e Botão */}
                        <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
                          <div className="flex gap-3 sm:gap-4 items-center">
                            <div className="w-10 h-10 rounded-xl bg-white border border-[#e9e9e7] flex items-center justify-center shadow-sm flex-shrink-0">
                              <img src={flowLogo} alt="Flow" className="w-6 h-6 object-contain" />
                            </div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-[14px] font-black text-[#37352f] tracking-tight leading-none">Ativar Flow</h4>
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
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
