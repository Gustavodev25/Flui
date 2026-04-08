import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Loader2, ArrowRight } from 'lucide-react'
import { apiFetch } from '../lib/api'
import sittingDoodle from '../assets/doodles/SittingDoodle.png'
import sleekDoodle from '../assets/doodles/SleekDoodle.png'



const InvitePage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite_token')
  const { user, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteInfo, setInviteInfo] = useState<{ ownerName: string, email: string } | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!inviteToken) {
      setError('Nenhum link de convite encontrado.')
      setLoading(false)
      return
    }

    // Fetch details
    apiFetch<{ ownerName: string, email: string }>(`/api/workspace/invite-info?token=${inviteToken}`)
      .then((data) => {
        setInviteInfo(data)
      })
      .catch((err) => {
        console.error(err)
        setError('Este convite não é válido ou já foi utilizado/expirou.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [inviteToken])

  const handleAccept = async () => {
    setAccepting(true)

    if (user) {
      // Já está logado, aceita diretamente
      try {
        await apiFetch('/api/workspace/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: inviteToken, userId: user.id })
        })
        navigate('/dashboard', { replace: true })
      } catch (err) {
        setError('Ocorreu um erro ao aceitar o convite.')
        setAccepting(false)
      }
    } else {
      // Mandar para tela de login com o token preservado
      navigate(`/login?invite_token=${inviteToken}`, { replace: true })
    }
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfa]">
        <Loader2 className="animate-spin text-[#37352f]/20" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fcfcfa] flex flex-col items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[400px] text-left space-y-8"

      >
        {/* Logo removida a pedido do usuário */}


        {error ? (
          <div className="space-y-6 flex flex-col items-start">

            <img 
              src={sittingDoodle} 
              alt="Convite Inválido" 
              className="w-40 h-40 object-contain mb-2" 
            />
            <div className="space-y-3">
              <h1 className="text-2xl font-black text-[#37352f] tracking-tight">Convite Inválido</h1>
              <p className="text-[13px] text-[#37352f]/60 font-medium leading-relaxed">

                {error}
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="w-full px-6 py-3.5 bg-[#f7f7f5] border border-[#e9e9e7] text-[13px] font-bold text-[#37352f] rounded-xl hover:bg-[#f1f1f0] transition-colors mt-2"
            >
              Ir para tela inicial
            </button>
          </div>
        ) : (
          <div className="space-y-6 flex flex-col items-start">

            <img 
              src={sleekDoodle} 
              alt="Convidado" 
              className="w-40 h-40 object-contain mb-2" 
            />
            <div className="space-y-3 text-left">

              <h1 className="text-2xl font-black text-[#37352f] tracking-tight">Você foi Convidado!</h1>
              <p className="text-[13px] text-[#37352f]/60 font-medium leading-relaxed">
                <strong>{inviteInfo?.ownerName}</strong> enviou um convite para você ingressar no Workspace em que a equipe colabora.
              </p>

            </div>

            <div className="text-left py-2">

               <p className="text-sm font-bold text-[#37352f]">Junte-se ao Workspace de {inviteInfo?.ownerName?.split(' ')[0]}</p>
               <p className="text-[11px] text-[#37352f]/60 font-medium mt-1">
                 Para o e-mail: <span className="text-[#37352f]">{inviteInfo?.email}</span>
               </p>
            </div>

            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full mt-4 py-4 bg-[#202020] text-white text-[13px] font-bold rounded-xl hover:bg-[#30302E] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 disabled:scale-100"
            >
              {accepting ? (
                <Loader2 size={16} className="animate-spin text-white/50" />
              ) : (
                <>Aceitar Convite e Entrar <ArrowRight size={16} /></>
              )}
            </button>

            {!user && (
              <p className="text-[10px] text-[#37352f]/40 font-medium leading-relaxed pt-2">
                Se você não possui uma conta, poderá criar uma na próxima etapa rapidamente.
              </p>

            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default InvitePage
