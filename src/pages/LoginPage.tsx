import React, { useState, useRef } from 'react'
import { Loading } from '../components/ui/Loading'
import { motion, AnimatePresence } from 'framer-motion'
import logoSvg from '../assets/logo/logo.svg'
import finlozLogo from '../assets/logo/lui.svg'
import { toaster } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Eye, EyeOff, Check, ArrowLeft } from 'lucide-react'
import TermsModal from '../components/TermsModal'
import PixelBlast from '../components/ui/PixelBlast'

// ── Forgot Password Flow ──────────────────────────────────────────────────────

type ForgotStep = 'email' | 'code' | 'newPassword'

const ForgotPasswordFlow: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [step, setStep] = useState<ForgotStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const digitRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStep('code')
      toaster.create({ title: 'Código enviado!', description: 'Verifique seu email.', type: 'success' })
    } catch (err: any) {
      toaster.create({ title: 'Erro', description: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDigitChange = (index: number, value: string) => {
    const char = value.replace(/\D/g, '').slice(-1)
    const next = [...code]
    next[index] = char
    setCode(next)
    if (char && index < 5) {
      digitRefs.current[index + 1]?.focus()
    }
  }

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      digitRefs.current[index - 1]?.focus()
    }
  }

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length > 0) {
      const next = [...code]
      pasted.split('').forEach((char, i) => { next[i] = char })
      setCode(next)
      const focusIdx = Math.min(pasted.length, 5)
      digitRefs.current[focusIdx]?.focus()
    }
    e.preventDefault()
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const fullCode = code.join('')
    if (fullCode.length < 6) {
      toaster.create({ title: 'Código incompleto', description: 'Digite todos os 6 dígitos.', type: 'error' })
      return
    }
    setIsLoading(true)
    try {
      await apiFetch('/api/auth/verify-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: fullCode }),
      })
      setStep('newPassword')
    } catch (err: any) {
      toaster.create({ title: 'Código inválido', description: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toaster.create({ title: 'Senhas não coincidem', description: 'As senhas devem ser iguais.', type: 'error' })
      return
    }
    if (newPassword.length < 6) {
      toaster.create({ title: 'Senha fraca', description: 'A senha deve ter pelo menos 6 caracteres.', type: 'error' })
      return
    }
    setIsLoading(true)
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: code.join(''), newPassword }),
      })
      toaster.create({ 
        title: 'Senha redefinida!', 
        description: 'Faça login com sua nova senha.', 
        type: 'success' 
      })
      setTimeout(() => {
        onBack()
      }, 500)
    } catch (err: any) {
      toaster.create({ title: 'Erro', description: err.message, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const stepTitle: Record<ForgotStep, string> = {
    email: 'Recuperar senha',
    code: 'Digite o código',
    newPassword: 'Nova senha',
  }
  const stepDesc: Record<ForgotStep, string> = {
    email: 'Informe seu email e enviaremos um código de 6 dígitos.',
    code: `Enviamos um código para ${email}. Insira abaixo.`,
    newPassword: 'Escolha uma nova senha segura.',
  }

  return (
    <motion.div
      key={`forgot-${step}`}
      initial={{ opacity: 0, scale: 0.9, filter: 'blur(8px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.8, type: 'spring', stiffness: 70, damping: 20, delay: 0.05 }}
      className="w-full max-w-[380px]"
    >
      <div className="mb-5 flex flex-col items-center md:items-start text-center md:text-left">
        <h1 className="text-2xl font-bold tracking-tight mb-2">{stepTitle[step]}</h1>
        <p className="text-sm text-[#37352f]/40 font-medium">{stepDesc[step]}</p>
      </div>

      {step === 'email' && (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#37352f]/40">E-mail</label>
            <input
              type="email"
              placeholder="Seu e-mail cadastrado"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 px-3.5 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
              required
              autoFocus
            />
          </div>
          <SubmitButton isLoading={isLoading} label="Enviar código" />
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={handleVerifyCode} className="space-y-6">
          <div className="grid grid-cols-6 gap-2 w-full items-center">
            {code.map((digit, i) => (
              <div key={i} className="relative w-full h-14">
                <input
                  ref={(el) => { digitRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(i, e)}
                  onPaste={handleDigitPaste}
                  onFocus={() => setFocusedIndex(i)}
                  onBlur={() => setFocusedIndex(null)}
                  className="w-full h-full text-center text-2xl font-bold border border-black rounded-[8px] bg-white text-transparent caret-transparent outline-none focus:ring-2 focus:ring-black/5 transition-all"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <AnimatePresence mode="wait">
                    {digit ? (
                      <motion.span
                        key={digit}
                        initial={{ y: 10, opacity: 0, scale: 0.5 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: -10, opacity: 0, scale: 0.5 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="text-2xl font-bold text-[#37352f]"
                      >
                        {digit}
                      </motion.span>
                    ) : (
                      <motion.div
                        key="placeholder"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-1.5 h-1.5 rounded-full bg-[#37352f]/10"
                      />
                    )}
                  </AnimatePresence>
                </div>
                {/* Indicador de foco customizado */}
                {focusedIndex === i && (
                  <motion.div
                    layoutId="otp-focus"
                    className="absolute inset-0 border-2 border-black rounded-[8px] pointer-events-none"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </div>
            ))}
          </div>
          <SubmitButton isLoading={isLoading} label="Verificar código" />
          <button
            type="button"
            onClick={() => handleSendCode({ preventDefault: () => {} } as any)}
            className="w-full text-center text-[11px] text-[#37352f]/40 hover:text-[#2383e2] font-medium transition-colors"
          >
            Reenviar código
          </button>
        </form>
      )}

      {step === 'newPassword' && (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#37352f]/40">Nova senha</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nova senha"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 pl-3.5 pr-10 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#37352f]/30 hover:text-[#37352f]/60 transition-colors focus:outline-none"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#37352f]/40">Confirmar senha</label>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Repita a senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 px-3.5 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
              required
            />
          </div>
          <SubmitButton isLoading={isLoading} label="Redefinir senha" />
        </form>
      )}

      <p className="pt-8 text-center text-[11px] text-[#37352f]/30 font-medium font-sans">
        <button onClick={onBack} className="text-[#2383e2] hover:underline font-semibold">
          Voltar para o login
        </button>
      </p>
    </motion.div>
  )
}

// Botão de submit reutilizável
const SubmitButton: React.FC<{ isLoading: boolean; label: string }> = ({ isLoading, label }) => (
  <motion.button
    type="submit"
    disabled={isLoading}
    className="w-full bg-[#202020] hover:bg-[#202020]/90 disabled:opacity-70 text-white font-medium py-2.5 rounded-[6px] transition-all mt-2 shadow-md shadow-black/5 flex items-center justify-center h-[42px] relative overflow-hidden"
  >
    <AnimatePresence mode="wait">
      {isLoading ? (
        <motion.div
          key="loader"
          initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 360 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ rotate: { repeat: Infinity, duration: 1, ease: 'linear' }, default: { type: 'spring', stiffness: 400, damping: 30 } }}
          className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full"
        />
      ) : (
        <motion.span
          key="text"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="text-sm font-medium pointer-events-none"
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  </motion.button>
)

// ── Forgot Password Decorative Mockup ────────────────────────────────────────

const CODE_DIGITS = ['3', '8', '1', '4', '0', '2']

const ForgotMockup: React.FC = () => (
  <motion.div
    key="forgot-content"
    initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
    exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
    transition={{ duration: 0.8, type: 'spring', stiffness: 70, damping: 20 }}
    className="relative z-10 flex flex-col items-center w-full max-w-[340px] px-4"
  >
    {/* Header text */}
    <div className="text-center mb-10 space-y-3">
      <h2 className="text-2xl font-bold tracking-tight text-[#37352f] overflow-hidden flex justify-center">
        {'Código no seu email.'.split('').map((char, i) => (
          <motion.span
            key={i}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3, delay: i * 0.025, ease: [0.2, 0.65, 0.3, 0.9] }}
            className="inline-block"
            style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
          >
            {char}
          </motion.span>
        ))}
      </h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="text-sm font-medium text-[#37352f]/50 leading-relaxed"
      >
        Enviamos um código de 6 dígitos para você confirmar sua identidade com segurança.
      </motion.p>
    </div>

    {/* Email card mockup */}
    <div className="relative w-full flex flex-col items-center gap-3">

      {/* Email card */}
      <motion.div
        initial={{ opacity: 0, y: 16, rotate: -1 }}
        animate={{ opacity: 1, y: [0, -5, 0], rotate: -1 }}
        transition={{
          opacity: { duration: 0.5, delay: 0.3 },
          y: { duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.3 },
          rotate: { duration: 0 },
        }}
        className="w-full bg-white border border-[#e9e9e7] rounded-2xl shadow-md shadow-[#37352f]/8 overflow-hidden -rotate-1"
      >
        {/* Email header bar */}
        <div className="bg-[#f7f7f5] border-b border-[#e9e9e7] px-4 py-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#37352f]/10" />
          <div className="h-2 w-24 bg-[#37352f]/10 rounded-full" />
          <div className="ml-auto h-2 w-12 bg-[#37352f]/8 rounded-full" />
        </div>

        {/* Email body */}
        <div className="px-5 py-5">
          {/* Sender row */}
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-full bg-[#37352f] flex items-center justify-center shrink-0">
              <img src={logoSvg} alt="Logo" className="w-4 h-4 brightness-0 invert" />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#37352f]">Flui</div>
              <div className="text-[9px] text-[#37352f]/40">noreply@flui.ia.br</div>
            </div>
          </div>

          {/* Subject line */}
          <div className="text-[12px] font-semibold text-[#37352f] mb-1">Redefinição de senha</div>
          <div className="text-[10px] text-[#37352f]/40 mb-4">Use o código abaixo para redefinir sua senha.</div>

          {/* Code block */}
          <div className="bg-[#f7f7f5] border border-[#e9e9e7] rounded-xl py-4 flex justify-center gap-1.5 mb-3">
            {CODE_DIGITS.map((digit, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + i * 0.12, type: 'spring', stiffness: 300, damping: 24 }}
                className="w-8 h-9 flex items-center justify-center bg-white border border-[#e9e9e7] rounded-lg text-[18px] font-bold text-[#37352f] shadow-sm"
                style={{ fontFamily: 'monospace' }}
              >
                {digit}
              </motion.span>
            ))}
          </div>

          <div className="h-1.5 w-3/4 bg-[#f1f1f0] rounded-full" />
        </div>
      </motion.div>

      {/* Success badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: [0, 4, 0] }}
        transition={{
          opacity: { delay: 1.6, duration: 0.4 },
          scale: { delay: 1.6, type: 'spring', stiffness: 400, damping: 20 },
          y: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1.6 },
        }}
        className="self-end mr-4 flex items-center gap-2 bg-white border border-[#e9e9e7] rounded-full px-3 py-1.5 shadow-sm rotate-1"
      >
        <div className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3 5.5L6.5 2" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="text-[10px] font-semibold text-[#37352f]">Código verificado</span>
      </motion.div>
    </div>
  </motion.div>
)

// ── Login Page ────────────────────────────────────────────────────────────────

const LoginPage: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [isLogin, setIsLogin] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isAgreed, setIsAgreed] = useState(false)
  const [isTermsOpen, setIsTermsOpen] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite_token')
  const [lastLoginMethod, setLastLoginMethod] = useState<string | null>(null)

  React.useEffect(() => {
    const saved = localStorage.getItem('lastLoginMethod')
    if (saved) setLastLoginMethod(saved)
  }, [])


  if (authLoading) {
    return <Loading />
  }

  if (user) {
    return <Navigate to={inviteToken ? `/dashboard?invite_token=${inviteToken}` : `/checkout-preview`} replace />
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error

        localStorage.setItem('lastLoginMethod', 'password')
        setLastLoginMethod('password')

        if (inviteToken && data?.user) {
          try {
            await apiFetch('/api/workspace/accept-invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: inviteToken, userId: data.user.id })
            })
          } catch(err) {
            console.error('Falha ao aceitar convite', err)
          }
        }

        toaster.create({
          title: 'Login realizado com sucesso!',
          description: 'Bem-vindo de volta ao seu painel.',
          type: 'success',
        })
      } else {
        const staffNames = ['Ana', 'Carlos', 'Beatriz', 'Diego', 'Camila']
        const agentName = staffNames[Math.floor(Math.random() * staffNames.length)]

        toaster.create({
          title: '',
          description: (
            <div className="flex items-center gap-3 w-full">
              <img
                src={`https://api.dicebear.com/9.x/notionists/svg?seed=${agentName}`}
                alt="Avatar Equipe"
                className="w-10 h-10 bg-[#f7f7f5] rounded-full border border-[#e9e9e7] shrink-0"
              />
              <div className="flex-1 flex flex-col justify-center">
                <span className="font-semibold text-[13px] text-[#37352f]">
                  {agentName} <span className="text-[10px] text-[#37352f]/40 font-normal ml-0.5">• Análise</span>
                </span>
                <p className="text-[11px] text-[#37352f]/60 mt-0.5 mb-2 font-medium animate-pulse">
                  Analisando sua solicitação...
                </p>
                <div className="w-full h-[2px] bg-[#f1f1f0] rounded-full overflow-hidden relative">
                  <motion.div
                    initial={{ width: '5%', filter: 'blur(1px)', borderRadius: '10px' }}
                    animate={{ width: '100%', filter: 'blur(0px)', borderRadius: '0px' }}
                    transition={{ duration: 3, ease: [0.65, 0, 0.35, 1] }}
                    className="absolute top-0 left-0 h-full bg-[#202020]"
                  />
                </div>
              </div>
            </div>
          ),
          type: 'info',
          duration: 3500
        })

        await new Promise((resolve) => setTimeout(resolve, 3000))

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } }
        })

        if (error) throw error

        if (inviteToken && data?.user) {
          try {
            await apiFetch('/api/workspace/accept-invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: inviteToken, userId: data.user.id })
            })
          } catch(err) {
            console.error('Falha ao aceitar convite', err)
          }
        }

        toaster.create({
          title: 'Conta criada com sucesso!',
          description: 'Bem-vindo ao Flui. Acesse para continuar.',
          type: 'success',
        })

        setIsLogin(true)
      }
    } catch (error: any) {
      const isInvalidCredentials =
        error.message?.toLowerCase().includes('invalid login credentials') ||
        error.message?.toLowerCase().includes('invalid_credentials')

      toaster.create({
        title: 'Erro na autenticação',
        description: isInvalidCredentials
          ? 'Credenciais inválidas. Se você criou sua conta com o Google, use o botão "Continuar com Google" acima.'
          : error.message || 'Tente novamente mais tarde.',
        type: 'error',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAgreed) {
      toaster.create({
        title: 'Termos e Privacidade',
        description: 'Você precisa aceitar os termos para criar sua conta.',
        type: 'error',
      })
      return
    }
    if (password !== confirmPassword) {
      toaster.create({
        title: 'Senhas não coincidem',
        description: 'A senha e a confirmação devem ser iguais.',
        type: 'error',
      })
      return
    }
    handleLogin(e)
  }

  const handleGoogleLogin = async () => {
    try {
      localStorage.setItem('lastLoginMethod', 'google')
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${inviteToken ? `/dashboard?invite_token=${inviteToken}` : '/checkout-preview'}`,
        }
      })
      if (error) throw error
    } catch (error: any) {
      toaster.create({ title: 'Erro no Google Login', description: error.message, type: 'error' })
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white text-[#37352f] font-sans selection:bg-[#2383e2]/20">

      {/* Coluna do Formulário */}
      <div className="w-full md:w-1/2 flex-1 flex items-center justify-center p-8 md:p-16 relative">
        <Link
          to="/"
          className="absolute top-12 left-0 right-0 flex items-center justify-center gap-2.5 group transition-all duration-300 select-none z-20"
        >
          <motion.img 
            src={logoSvg} 
            alt="Logo" 
            className="w-9 h-9" 
            whileHover={{ rotate: 10, scale: 1.05 }}
            whileTap={{ scale: 0.9, rotate: -5 }}
            transition={{ type: "spring", stiffness: 400, damping: 10 }}
          />
          <div className="flex items-center h-9">
            {"flui.".split("").map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.25,
                  delay: 0.3 + (i * 0.08),
                  ease: "easeOut"
                }}
                className="text-xl font-bold tracking-tight text-[#37352f]"
              >
                {char}
              </motion.span>
            ))}
          </div>
        </Link>

        <div className="w-full max-w-[340px] relative mt-12 mb-8 md:my-0">
          <div className="relative z-10">
            <AnimatePresence mode="wait">
              {isForgotPassword ? (
                <ForgotPasswordFlow key="forgot" onBack={() => setIsForgotPassword(false)} />
              ) : (
                <motion.div
                  key={isLogin ? 'login' : 'signup'}
                  initial={{ opacity: 0, x: 20, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -20, filter: 'blur(10px)' }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
              {inviteToken && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200/60 rounded-xl">
                  <p className="text-[13px] font-medium text-amber-800 text-center leading-tight">
                    Você foi convidado para um workspace. Faça login ou crie sua conta para aceitar e participar!
                  </p>
                </div>
              )}

              <div className="mb-5 flex flex-col items-start text-left">
                <h1 className="text-2xl font-bold tracking-tight mb-2">
                  {isLogin ? 'Bem-vindo' : 'Crie sua conta'}
                </h1>
                <p className="text-sm text-[#37352f]/40 font-medium">
                  {isLogin ? 'Insira seus dados para acessar sua conta.' : 'Junte-se ao Flui e transforme sua produtividade.'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 relative">
                  {lastLoginMethod === 'google' && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, rotate: 10 }}
                      animate={{ opacity: 1, y: 0, rotate: 8 }}
                      className="absolute -top-2 -right-1.5 bg-white border border-black px-2.5 py-0.5 rounded-md shadow-sm z-20 flex items-center select-none pointer-events-none"
                    >
                      <span className="text-[9px] font-bold text-black uppercase tracking-widest">
                        Recente
                      </span>
                    </motion.div>
                  )}
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="flex items-center justify-center gap-2.5 w-full border border-[#efefed] bg-[#fcfcfc]/50 hover:bg-white hover:border-[#e9e9e7] hover:shadow-sm transition-all py-2.5 px-4 rounded-lg font-medium text-[13px] text-[#37352f]/70 relative"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="" className="w-4 h-4" />
                    Continuar com Google
                  </button>
                </div>

                <div className="relative flex items-center justify-center">
                  <div className="border-t border-[#f1f1f0] w-full"></div>
                  <span className="bg-white px-4 text-[11px] font-medium text-[#37352f]/30 absolute tracking-tight">ou use e-mail</span>
                </div>

                <form onSubmit={isLogin ? handleLogin : handleCreateAccount} className="space-y-3">
                  {!isLogin && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-1.5"
                    >
                      <label className="text-[12px] font-medium text-[#37352f]/40">Nome completo</label>
                      <input
                        type="text"
                        placeholder="Seu nome"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 px-3.5 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                        required
                      />
                    </motion.div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-[#37352f]/40">E-mail</label>
                    <input
                      type="email"
                      placeholder="Seu e-mail profissional"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 px-3.5 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[12px] font-medium text-[#37352f]/40">Senha</label>
                      {isLogin && (
                        <button
                          type="button"
                          onClick={() => setIsForgotPassword(true)}
                          className="text-[11px] font-medium text-[#37352f]/30 hover:text-[#2383e2] transition-colors"
                        >
                          Esqueceu?
                        </button>
                      )}
                    </div>
                    <div className="relative group/pass">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Sua senha"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 pl-3.5 pr-10 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#37352f]/30 hover:text-[#37352f]/60 transition-colors focus:outline-none"
                        title={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {!isLogin && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-1.5"
                    >
                      <label className="text-xs font-medium text-[#37352f]/60 ml-1">Confirme sua senha</label>
                      <div className="relative group/pass">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Repita sua senha"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full bg-white border border-[#e9e9e7] rounded-[6px] py-2 pl-3.5 pr-10 text-[#37352f] placeholder-[#37352f]/30 outline-none focus:border-[#2383e2] focus:ring-1 focus:ring-[#2383e2]/10 transition-all text-sm"
                          required
                        />
                      </div>
                    </motion.div>
                  )}

                  {!isLogin && (
                    <div className="flex items-center gap-2.5 pt-1">
                      <label htmlFor="terms" className="relative flex items-center cursor-pointer group">
                        <input
                          id="terms"
                          type="checkbox"
                          checked={isAgreed}
                          onChange={(e) => setIsAgreed(e.target.checked)}
                          className="sr-only"
                          required
                        />
                        <div className={`
                          w-[18px] h-[18px] rounded-[4px] border transition-all duration-200 flex items-center justify-center
                          ${isAgreed
                            ? 'bg-[#202020] border-[#202020] shadow-sm shadow-black/10'
                            : 'bg-white border-[#e9e9e7] group-hover:border-[#37352f]/20 hover:bg-[#fcfcfc]'}
                        `}>
                          <AnimatePresence>
                            {isAgreed && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                              >
                                <Check size={12} className="text-white" strokeWidth={4} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </label>
                      <label htmlFor="terms" className="text-[12px] font-medium text-[#37352f]/60 leading-none cursor-pointer selection:hidden flex-1">
                        Eu aceito os <button type="button" onClick={() => setIsTermsOpen(true)} className="text-[#37352f] hover:underline font-bold">Termos de Uso</button> e a <button type="button" onClick={() => setIsTermsOpen(true)} className="text-[#37352f] hover:underline font-bold">Política de Privacidade</button>.
                      </label>
                    </div>
                  )}


                  <motion.button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-[#202020] hover:bg-[#202020]/90 disabled:opacity-70 text-white font-medium py-2.5 rounded-[6px] transition-all mt-3 shadow-md shadow-black/5 flex items-center justify-center h-[38px] relative overflow-hidden"
                  >
                    <AnimatePresence mode="wait">
                      {isLoading ? (
                        <motion.div
                          key="loader"
                          initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
                          animate={{ opacity: 1, scale: 1, rotate: 360 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={{
                            rotate: { repeat: Infinity, duration: 1, ease: 'linear' },
                            default: { type: 'spring', stiffness: 400, damping: 30 }
                          }}
                          className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full"
                        />
                      ) : (
                        <motion.div
                          key="text"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                          className="flex items-center justify-center pointer-events-none"
                        >
                          <span className="text-sm font-medium">
                            {isLogin ? 'Acessar conta' : 'Criar minha conta'}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </form>

                <p className="pt-4 text-left text-[11px] text-[#37352f]/30 font-medium font-sans">
                  {isLogin ? (
                    <>
                      Novo por aqui?{' '}
                      <button
                        onClick={() => setIsLogin(false)}
                        className="text-[#2383e2] hover:underline font-semibold"
                      >
                        Criar conta
                      </button>
                    </>
                  ) : (
                    <>
                      Já tem uma conta?{' '}
                      <button
                        onClick={() => setIsLogin(true)}
                        className="text-[#2383e2] hover:underline font-semibold"
                      >
                        Fazer login
                      </button>
                    </>
                  )}
                </p>
              </div>
            </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>

      {/* Coluna Decorativa / Informativa */}
      <div className="hidden md:flex w-1/2 items-center justify-center p-6 lg:p-10">
        <div className="w-full h-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl flex items-center justify-center relative overflow-hidden">
          {/* Fundo Pixel Blast igual Landing Page */}
          <div className="absolute inset-0 pointer-events-none">
            <PixelBlast
              variant="square"
              pixelSize={3}
              color="#cdcdc9"
              patternScale={4}
              patternDensity={0.8}
              enableRipples
              rippleSpeed={0.3}
              speed={0.3}
              transparent
            />
          </div>
          <div className="absolute top-0 right-0 w-full h-full opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(#37352f 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

          {/* Máscara de legibilidade para o centro */}
          <div className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,#f7f7f5_20%,transparent_80%)] pointer-events-none opacity-80" />

          <AnimatePresence mode="wait" initial={false}>
            {isLogin && !isForgotPassword ? (
              <motion.div
                key="login-content"
                initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                transition={{ duration: 0.8, type: 'spring', stiffness: 70, damping: 20 }}
                className="relative z-10 flex flex-col items-center w-full max-w-[340px] px-4"
              >
                <div className="text-center mb-12 space-y-3">
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="text-2xl font-bold tracking-tight text-[#37352f]"
                  >
                    Libere sua mente.
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="text-sm font-medium text-[#37352f]/50 leading-relaxed"
                  >
                    Transforme sua maneira de trabalhar com ferramentas intuitivas no estilo Notion.
                  </motion.p>
                </div>

                <div className="flex flex-col gap-3 items-center w-full max-w-[280px]">
                  {/* Card 1: Checklist */}
                  <motion.div
                    animate={{ y: [-2, 2], rotate: [-1, -0.5] }}
                    transition={{ duration: 5, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
                    className="w-full bg-white border border-[#e9e9e7] rounded-xl p-3.5 shadow-sm flex items-center gap-3"
                  >
                    <div className="w-4 h-4 rounded-md border border-[#e9e9e7] bg-[#f1f1f0]/40 flex-shrink-0 flex items-center justify-center">
                       <Check size={10} className="text-[#37352f]/20" strokeWidth={4} />
                    </div>
                    <div className="flex-1">
                      <div className="h-1.5 w-2/3 bg-[#f1f1f0] rounded-full mb-1.5" />
                      <div className="h-1.5 w-1/3 bg-[#f1f1f0]/40 rounded-full" />
                    </div>
                  </motion.div>

                  {/* Card 2: Progress (The Main One) */}
                  <motion.div
                    animate={{ y: [2, -2], rotate: [0.5, 1] }}
                    transition={{ duration: 7, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: 0.5 }}
                    className="w-full bg-white border border-[#e9e9e7] rounded-xl p-3.5 shadow-md flex flex-col gap-2.5 z-20"
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="h-2 w-1/3 bg-[#37352f]/10 rounded-full" />
                      <div className="h-2 w-8 bg-[#2383e2]/10 rounded-full" />
                    </div>
                    <div className="w-full h-1 bg-[#f1f1f0] rounded-full overflow-hidden">
                       <motion.div 
                         initial={{ width: 0 }}
                         animate={{ width: "65%" }}
                         transition={{ duration: 2, delay: 1 }}
                         className="h-full bg-[#2383e2]/30" 
                       />
                    </div>
                  </motion.div>

                  {/* Card 3: Collaborators */}
                  <motion.div
                    animate={{ y: [-2, 2], rotate: [-0.5, 0.5] }}
                    transition={{ duration: 6, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: 1 }}
                    className="w-full bg-white border border-[#e9e9e7] rounded-xl p-3.5 shadow-sm flex items-center gap-2"
                  >
                    <div className="flex -space-x-1.5">
                       <div className="w-5 h-5 rounded-full border-2 border-white bg-[#f1f1f0]" />
                       <div className="w-5 h-5 rounded-full border-2 border-white bg-[#e9e9e7]" />
                       <div className="w-5 h-5 rounded-full border-2 border-white bg-[#37352f]/10 flex items-center justify-center text-[8px] font-bold text-[#37352f]/40">+</div>
                    </div>
                    <div className="h-1.5 w-1/4 bg-[#f1f1f0] rounded-full ml-1" />
                  </motion.div>
                </div>
              </motion.div>
            ) : isForgotPassword ? (
              <ForgotMockup />
            ) : (
              <motion.div
                key="signup-content"
                initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                transition={{ duration: 0.8, type: 'spring', stiffness: 70, damping: 20 }}
                className="relative z-10 flex flex-col items-center w-full max-w-[340px] px-4"
              >
                <div className="text-center mb-12 space-y-3">
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="text-2xl font-bold tracking-tight text-[#37352f]"
                  >
                    O Flui resolve o resto.
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="text-sm font-medium text-[#37352f]/50 leading-relaxed"
                  >
                    Colabore com sua equipe em tempo real com toda a simplicidade do Flui.
                  </motion.p>
                </div>

                <div className="w-full relative flex justify-center items-center h-[320px]">
                  {/* Browser Mockup */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10, rotate: -2 }}
                    animate={{ opacity: 1, scale: 1, y: 0, rotate: -2 }}
                    transition={{ duration: 1, type: 'spring', damping: 20 }}
                    className="absolute -top-6 -left-12 w-[320px] bg-white border border-[#e9e9e7] rounded-2xl p-0 shadow-[0_30px_60px_-15px_rgba(32,32,32,0.12)] z-10 overflow-hidden"
                  >
                    <div className="h-9 border-b border-[#f1f1f0] flex items-center px-4 bg-[#fcfcfc] shrink-0">
                      <div className="flex gap-1.5 items-center">
                        <div className="w-2 h-2 rounded-full bg-[#e9e9e7]" />
                        <div className="w-2 h-2 rounded-full bg-[#e9e9e7]" />
                        <div className="w-2 h-2 rounded-full bg-[#e9e9e7]" />
                      </div>
                    </div>
                    <div className="flex h-[180px]">
                      <div className="w-20 border-r border-[#f1f1f0] p-4 flex flex-col gap-3">
                        <div className="w-full h-1.5 bg-[#f1f1f0] rounded-full" />
                        <div className="w-3/4 h-1.5 bg-[#f1f1f0] rounded-full" />
                        <div className="w-1/2 h-1.5 bg-[#f1f1f0]/60 rounded-full" />
                        <div className="mt-auto w-8 h-8 rounded-full bg-[#f1f1f0]" />
                      </div>
                      <div className="flex-1 p-6">
                        <div className="h-3 w-1/3 bg-[#37352f]/10 rounded-full mb-8" />
                        <div className="space-y-4">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-3">
                              <div className="w-3.5 h-3.5 rounded border border-[#e9e9e7] bg-[#fcfcfc]" />
                              <div className={`h-1.5 ${i === 1 ? 'w-3/4' : 'w-1/2'} bg-[#f1f1f0] rounded-full`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  {/* Phone Mockup */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, rotate: 4, x: 20 }}
                    animate={{ opacity: 1, scale: 1, rotate: 4, x: 20, y: [-4, 4] }}
                    transition={{ 
                      y: { duration: 6, repeat: Infinity, repeatType: "reverse", ease: 'easeInOut' },
                      default: { duration: 1.1, type: 'spring' } 
                    }}
                    className="absolute -bottom-8 -right-12 w-[150px] h-[260px] bg-white rounded-[2.5rem] p-1.5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.18)] z-20 border border-[#e9e9e7]"
                  >
                    <div className="w-full h-full bg-white rounded-[2.2rem] overflow-hidden flex flex-col relative border border-[#f1f1f0]">
                      <div className="h-12 pt-4 px-4 flex items-center justify-between shrink-0">
                         <div className="w-6 h-6 rounded-full bg-[#f1f1f0]" />
                         <div className="w-2 h-2 rounded-full bg-[#37352f]/5" />
                      </div>
                      <div className="flex-1 p-4 space-y-3">
                        <div className="bg-[#f7f7f5] p-2.5 rounded-2xl rounded-tl-none">
                          <div className="h-1 w-full bg-[#37352f]/10 rounded-full mb-1.5" />
                          <div className="h-1 w-2/3 bg-[#37352f]/5 rounded-full" />
                        </div>
                        <div className="flex justify-end">
                          <div className="bg-[#2383e2]/5 border border-[#2383e2]/10 p-2.5 rounded-2xl rounded-tr-none w-[70%]">
                            <div className="h-1 w-full bg-[#2383e2]/20 rounded-full" />
                          </div>
                        </div>
                        <div className="bg-[#f7f7f5] p-2.5 rounded-2xl rounded-tl-none w-[90%]">
                          <div className="h-1 w-full bg-[#37352f]/10 rounded-full" />
                        </div>
                      </div>
                      <div className="h-10 mt-auto border-t border-[#f1f1f0] flex items-center px-4 bg-[#fcfcfc]">
                         <div className="w-full h-1.5 bg-[#f1f1f0] rounded-full" />
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <TermsModal
        isOpen={isTermsOpen}
        onClose={() => setIsTermsOpen(false)}
        onConfirm={() => setIsAgreed(true)}
      />
    </div>
  )
}

export default LoginPage
