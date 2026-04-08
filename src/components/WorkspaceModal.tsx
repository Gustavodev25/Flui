import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, UserPlus, Copy, Check, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import Avvvatars from 'avvvatars-react'
import { useAuth } from '../contexts/AuthContext'
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface Member {
  id: string
  member_user_id: string
  member_email: string
  member_name: string | null
  member_avatar: string | null
  role: string
  is_invite?: boolean
}

interface WorkspaceModalProps {
  isOpen: boolean
  onClose: () => void
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const wsName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Workspace'
  const avatarValue = user?.email || wsName
  const userDisplayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Você'

  useEffect(() => {
    if (!isOpen || !user) return
    setInviteEmail('')
    setInviteError('')
    setInviteSuccess(false)
    fetchMembers()
  }, [isOpen, user])

  const fetchMembers = async () => {
    if (!user) return
    setLoadingMembers(true)
    try {
      const { members } = await apiFetch<{ members: Member[] }>('/api/workspace/members', undefined, { userId: user.id })
      setMembers(members)
    } catch {
      setMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !user) return
    setInviteLoading(true)
    setInviteError('')
    setInviteSuccess(false)
    try {
      const { member } = await apiFetch<{ member: Member }>('/api/workspace/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId: user.id, inviteEmail: inviteEmail.trim() }),
      })
      setMembers(prev => [...prev, member as any])
      setInviteEmail('')
      setInviteSuccess(true)
      setTimeout(() => setInviteSuccess(false), 3000)
    } catch (err: any) {
      setInviteError(err.message || 'Erro ao convidar.')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRemove = async (member: Member) => {
    if (!user) return
    setRemovingId(member.id)
    try {
      await apiFetch(`/api/workspace/members/${member.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId: user.id, is_invite: member.is_invite }),
      })
      setMembers(prev => prev.filter(m => m.id !== member.id))
    } catch {
      // silently fail
    } finally {
      setRemovingId(null)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const totalMembers = 1 + members.length

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
            transition={{ duration: 0.2 }}
            className="relative bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-[#e9e9e7] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9e9e7]">
              <div className="flex items-center gap-3">
                <Avvvatars value={avatarValue} style="shape" size={34} radius={9} />
                <div>
                  <p className="text-[13px] font-bold text-[#37352f] leading-tight">{wsName}</p>
                  <p className="text-[10px] text-[#37352f]/40 leading-tight">Workspace</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[#f7f7f5] transition-colors cursor-pointer"
              >
                <X size={14} className="text-[#37352f]/40" />
              </button>
            </div>

            {/* Membros */}
            <div className="px-5 pt-5 pb-3">
              <p className="text-[10px] font-semibold text-[#37352f]/40 uppercase tracking-wider mb-3">
                Membros · {totalMembers}
              </p>

              {/* Owner */}
              <div className="flex items-center gap-3 py-2 group">
                {user?.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-[#e9e9e7]" />
                ) : (
                  <Avvvatars value={avatarValue} style="character" size={36} radius={100} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#37352f] truncate leading-tight">{userDisplayName}</p>
                  <p className="text-[10.5px] text-[#37352f]/40 truncate leading-tight">{user?.email}</p>
                </div>
                <span className="text-[9px] font-semibold text-[#37352f]/30 uppercase tracking-wider flex-shrink-0">Admin</span>
              </div>

              {/* Outros membros */}
              {loadingMembers ? (
                <div className="flex justify-center py-3">
                  <Loader2 size={16} className="animate-spin text-[#37352f]/30" />
                </div>
              ) : (
                members.map(m => (
                  <div key={m.id} className="flex items-center gap-3 py-2 group">
                    {m.member_avatar ? (
                      <img src={m.member_avatar} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-[#e9e9e7]" />
                    ) : (
                      <Avvvatars value={m.member_email} style="character" size={36} radius={100} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#37352f] truncate leading-tight">{m.member_name || m.member_email.split('@')[0]}</p>
                      <p className="text-[10.5px] text-[#37352f]/40 truncate leading-tight">
                        {m.member_email}
                        {m.role === 'pending' && <span className="text-amber-500 font-medium ml-1 bg-amber-50 px-1 py-0.5 rounded text-[9px] uppercase tracking-widest border border-amber-200/50">Pendente</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemove(m)}
                      disabled={removingId === m.id}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all cursor-pointer"
                    >
                      {removingId === m.id
                        ? <Loader2 size={13} className="animate-spin text-red-400" />
                        : <Trash2 size={13} className="text-red-400" />}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Convidar */}
            <div className="px-5 py-4 border-t border-[#e9e9e7]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-semibold text-[#37352f]/60">Convidar membros</p>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1 text-[10.5px] text-[#37352f]/40 hover:text-[#37352f]/70 transition-colors cursor-pointer font-medium"
                >
                  {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                  {copied ? 'Copiado!' : 'Copiar link'}
                </button>
              </div>

              <div className="rounded-xl border border-[#e9e9e7] bg-[#f7f7f5] overflow-hidden">
                <div className="flex items-center px-3 gap-2">
                  <UserPlus size={13} className="text-[#37352f]/30 flex-shrink-0" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteError(''); setInviteSuccess(false) }}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder="Adicionar por e-mail..."
                    className="flex-1 py-3 text-[12px] bg-transparent placeholder-[#37352f]/30 text-[#37352f] outline-none"
                  />
                </div>

                {inviteEmail.trim() && (
                  <div className="border-t border-[#e9e9e7] px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#37352f]/50 truncate">{inviteEmail}</span>
                    <button
                      onClick={handleInvite}
                      disabled={inviteLoading}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#37352f] hover:bg-[#1a1a1a] text-white text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {inviteLoading && <Loader2 size={11} className="animate-spin" />}
                      Convidar
                    </button>
                  </div>
                )}
              </div>

              {/* Feedback */}
              <AnimatePresence>
                {inviteError && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 flex items-start gap-1.5 text-[11px] text-red-500"
                  >
                    <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                    {inviteError}
                  </motion.div>
                )}
                {inviteSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 flex items-center gap-1.5 text-[11px] text-green-600"
                  >
                    <Check size={12} />
                    Membro adicionado com sucesso!
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
