import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import finlozLogo from '../assets/logo/finloz.png'
import { toaster } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Eye, EyeOff, Check, ArrowLeft } from 'lucide-react'
import TermsModal from '../components/TermsModal'

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
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite_token')

  // Se o contexto está verificando a sessão ainda, mostre carregamento
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f7f5]">
        <div className="w-8 h-8 border-4 border-[#2383e2]/20 border-t-[#2383e2] rounded-full animate-spin" />
      </div>
    )
  }

  // Se já tiver uma sessão persistida (logado), joga pro dashboard ou checkout
  if (user) {
    return <Navigate to={inviteToken ? `/dashboard?invite_token=${inviteToken}` : `/checkout-preview`} replace />
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (isLogin) {
        // Fazer Login
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
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
          title: "Login realizado com sucesso!",
          description: "Bem-vindo de volta ao seu painel.",
          type: "success",
        })
      } else {
        // Gera um nome aleatório de funcionário
        const staffNames = ['Ana', 'Carlos', 'Beatriz', 'Diego', 'Camila'];
        const agentName = staffNames[Math.floor(Math.random() * staffNames.length)];

        // Inicia a animação de "Verificando" no Toast com Doodle
        toaster.create({
          title: "",
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
                    initial={{ width: "5%", filter: "blur(1px)", borderRadius: "10px" }}
                    animate={{ width: "100%", filter: "blur(0px)", borderRadius: "0px" }}
                    transition={{ duration: 3, ease: [0.65, 0, 0.35, 1] }}
                    className="absolute top-0 left-0 h-full bg-[#202020]"
                  />
                </div>
              </div>
            </div>
          ),
          type: "info",
          duration: 3500
        })

        // Espera artificial para parecer que estamos "verificando" e validando
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Cria Conta de fato no Supabase
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name,
            }
          }
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
          title: "Conta criada com sucesso!",
          description: "Bem-vindo ao Flui. Acesse para continuar.",
          type: "success",
        })

        // Se criar com sucesso, pode logar automaticamente na tela
        setIsLogin(true)
      }
    } catch (error: any) {
      const isInvalidCredentials =
        error.message?.toLowerCase().includes('invalid login credentials') ||
        error.message?.toLowerCase().includes('invalid_credentials')

      toaster.create({
        title: "Erro na autenticação",
        description: isInvalidCredentials
          ? "Credenciais inválidas. Se você criou sua conta com o Google, use o botão \"Continuar com Google\" acima."
          : error.message || "Tente novamente mais tarde.",
        type: "error",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAgreed) {
      toaster.create({
        title: "Termos e Privacidade",
        description: "Você precisa aceitar os termos para criar sua conta.",
        type: "error",
      })
      return
    }

    if (password !== confirmPassword) {
      toaster.create({
        title: "Senhas não coincidem",
        description: "A senha e a confirmação devem ser iguais.",
        type: "error",
      })
      return
    }

    handleLogin(e)
  }

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Redireciona para o dashboard ou checkout-preview dependendo do convite
          redirectTo: `${window.location.origin}${inviteToken ? `/dashboard?invite_token=${inviteToken}` : '/checkout-preview'}`,
        }
      })
      if (error) throw error
    } catch (error: any) {
      toaster.create({
        title: "Erro no Google Login",
        description: error.message,
        type: "error",
      })
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white text-[#37352f] font-sans selection:bg-[#2383e2]/20">

      {/* Coluna do Formulário */}
      <div className="w-full md:w-1/2 flex-1 flex items-center justify-center p-8 md:p-16 relative">
        <Link
          to="/"
          className="absolute top-10 left-10 group flex items-center gap-2 text-[#37352f]/30 hover:text-[#37352f] transition-all duration-300 select-none"
        >
          <ArrowLeft size={18} strokeWidth={1.5} className="transform group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-xs font-medium tracking-tight">voltar</span>
        </Link>

        <motion.div
          key={isLogin ? "login" : "signup"}
          initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{
            duration: 1,
            type: "spring",
            stiffness: 70,
            damping: 20,
            delay: 0.1
          }}
          className="w-full max-w-[380px]"
        >
          {inviteToken && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200/60 rounded-xl">
              <p className="text-[13px] font-medium text-amber-800 text-center leading-tight">
                Você foi convidado para um workspace. Faça login ou crie sua conta para aceitar e participar!
              </p>
            </div>
          )}

          <div className="mb-10 flex flex-col items-center md:items-start text-center md:text-left">
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              {isLogin ? "Bem-vindo" : "Crie sua conta"}
            </h1>
            <p className="text-sm text-[#37352f]/40 font-medium">
              {isLogin ? "Insira seus dados para acessar sua conta." : "Junte-se ao Flui e transforme sua produtividade."}
            </p>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="flex items-center justify-center gap-3 w-full border border-[#e9e9e7] hover:bg-[#f1f1f0] transition-colors py-2 px-4 rounded-[6px] font-medium text-sm"
              >
                <img src="https://www.google.com/favicon.ico" alt="" className="w-4 h-4" />
                Continuar com Google
              </button>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="border-t border-[#f1f1f0] w-full"></div>
              <span className="bg-white px-4 text-[10px] font-bold text-[#37352f]/20 absolute uppercase tracking-widest">ou use e-mail</span>
            </div>

            <form onSubmit={isLogin ? handleLogin : handleCreateAccount} className="space-y-4">
              {!isLogin && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-1.5"
                >
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#37352f]/20">Nome completo</label>
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
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#37352f]/20">E-mail</label>
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
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#37352f]/20">Senha</label>
                </div>
                <div className="relative group/pass">
                  <input
                    type={showPassword ? "text" : "password"}
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
                    title={showPassword ? "Esconder senha" : "Mostrar senha"}
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
                      type={showPassword ? "text" : "password"}
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
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
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
                className="w-full bg-[#202020] hover:bg-[#202020]/90 disabled:opacity-70 text-white font-medium py-2.5 rounded-[6px] transition-all mt-6 shadow-md shadow-black/5 flex items-center justify-center h-[42px] relative overflow-hidden"
              >
                <AnimatePresence mode='wait'>
                  {isLoading ? (
                    <motion.div
                      key="loader"
                      initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
                      animate={{ opacity: 1, scale: 1, rotate: 360 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{
                        rotate: { repeat: Infinity, duration: 1, ease: "linear" },
                        default: { type: "spring", stiffness: 400, damping: 30 }
                      }}
                      className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full"
                    />
                  ) : (
                    <motion.div
                      key="text"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="flex items-center justify-center pointer-events-none"
                    >
                      <span className="text-sm font-medium">
                        {isLogin ? "Acessar conta" : "Criar minha conta"}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </form>

            <p className="pt-8 text-center text-[11px] text-[#37352f]/30 font-medium font-sans">
              {isLogin ? (
                <>
                  Novo por aqui?{" "}
                  <button
                    onClick={() => setIsLogin(false)}
                    className="text-[#2383e2] hover:underline font-semibold"
                  >
                    Criar conta
                  </button>
                </>
              ) : (
                <>
                  Já tem uma conta?{" "}
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
      </div>

      {/* Coluna Decorativa / Informativa */}
      <div className="hidden md:flex w-1/2 items-center justify-center p-6 lg:p-10">
        <div className="w-full h-full bg-[#f7f7f5] border border-[#e9e9e7] rounded-3xl flex items-center justify-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-full h-full opacity-[0.03]"
            style={{ backgroundImage: 'radial-gradient(#37352f 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

          <AnimatePresence mode="wait" initial={false}>
            {isLogin ? (
              <motion.div
                key="login-content"
                initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                transition={{ duration: 0.8, type: "spring", stiffness: 70, damping: 20 }}
                className="relative z-10 flex flex-col items-center w-full max-w-[340px] px-4"
              >
                {/* Header Text */}
                <div className="text-center mb-12 space-y-3">
                  <h2 className="text-2xl font-bold tracking-tight text-[#37352f] overflow-hidden flex justify-center">
                    {"Organize com clareza.".split("").map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: "100%", opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: i * 0.02,
                          ease: [0.2, 0.65, 0.3, 0.9]
                        }}
                        className="inline-block"
                        style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="text-sm font-medium text-[#37352f]/50 leading-relaxed"
                  >
                    Transforme sua maneira de trabalhar com ferramentas intuitivas no estilo Notion.
                  </motion.p>
                </div>

                {/* Stack of Cards */}
                <div className="flex flex-col gap-1 items-center w-full max-w-[300px]">
                  {/* Mockup Card 1 */}
                  <motion.div
                    animate={{ y: [0, -4, 0], rotate: [-2, -3, -2] }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 w-full bg-white border border-[#e9e9e7] rounded-xl p-4 shadow-sm shadow-[#37352f]/5 -rotate-[2deg] translate-x-1"
                  >
                    <div className="h-2 w-1/2 bg-[#f1f1f0] rounded-full mb-2" />
                    <div className="h-2 w-1/3 bg-[#f1f1f0]/60 rounded-full" />
                  </motion.div>

                  {/* Mockup Card 2 */}
                  <motion.div
                    animate={{ y: [0, 6, 0], rotate: [0.5, 1, 0.5] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                    className="relative z-20 w-full bg-white border border-[#e9e9e7] rounded-xl p-4 shadow-md shadow-[#37352f]/10 rotate-[1deg] -translate-x-1"
                  >
                    <div className="h-2 w-1/2 bg-[#f1f1f0] rounded-full mb-2" />
                    <div className="h-2 w-1/3 bg-[#f1f1f0]/60 rounded-full" />
                  </motion.div>

                  {/* Mockup Card 3 */}
                  <motion.div
                    animate={{ y: [0, -3, 0], rotate: [-1, -2, -1] }}
                    transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="relative z-10 w-full bg-white border border-[#e9e9e7] rounded-xl p-4 shadow-sm shadow-[#37352f]/5 -rotate-[1deg] translate-x-1"
                  >
                    <div className="h-2 w-1/2 bg-[#f1f1f0] rounded-full mb-2" />
                    <div className="h-2 w-1/3 bg-[#f1f1f0]/60 rounded-full" />
                  </motion.div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="signup-content"
                initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
                transition={{ duration: 0.8, type: "spring", stiffness: 70, damping: 20 }}
                className="relative z-10 flex flex-col items-center w-full max-w-[340px] px-4"
              >
                {/* Header Text */}
                <div className="text-center mb-12 space-y-3">
                  <h2 className="text-2xl font-bold tracking-tight text-[#37352f] overflow-hidden flex justify-center">
                    {"Tudo em um só lugar.".split("").map((char, i) => (
                      <motion.span
                        key={i}
                        initial={{ y: "100%", opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: i * 0.02,
                          ease: [0.2, 0.65, 0.3, 0.9]
                        }}
                        className="inline-block"
                        style={{ whiteSpace: char === " " ? "pre" : "normal" }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </h2>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                    className="text-sm font-medium text-[#37352f]/50 leading-relaxed"
                  >
                    Colabore com sua equipe em tempo real com toda a simplicidade do Flui.
                  </motion.p>
                </div>

                {/* Visual Section for Signup */}
                <div className="w-full relative flex justify-center items-center h-[300px]">



                  {/* Browser Representation */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10, rotate: -3 }}
                    animate={{ opacity: 1, scale: 1, y: 0, rotate: -3 }}
                    transition={{ duration: 1, type: "spring", damping: 20 }}
                    className="absolute -top-2 -left-8 w-[280px] bg-white border border-[#e9e9e7] rounded-2xl p-4 shadow-2xl z-10 overflow-hidden"
                  >
                    <div className="flex gap-1.5 items-center mb-4 border-b border-[#f1f1f0] pb-3 -mx-4 px-4">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/30" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/30" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/30" />
                      <div className="h-4 w-32 bg-[#f1f1f0] rounded-md ml-4" />
                    </div>
                    <div className="flex gap-3">
                      <div className="w-12 h-24 bg-[#f1f1f0]/40 rounded-lg shrink-0" />
                      <div className="flex-1 space-y-3 pt-1">
                        <div className="h-2 w-full bg-[#f1f1f0] rounded-full" />
                        <div className="h-2 w-3/4 bg-[#f1f1f0] rounded-full" />
                        <div className="h-12 w-full bg-[#6366f1]/5 rounded-lg border border-[#6366f1]/10 mt-6" />
                      </div>
                    </div>
                  </motion.div>

                  {/* Minimalist Smartphone Mockup */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, rotate: 6, x: 20 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      rotate: 6,
                      x: 20,
                      y: [0, -10, 0]
                    }}
                    transition={{
                      y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
                      default: { duration: 1.1, type: "spring" }
                    }}
                    className="absolute -bottom-10 -right-4 w-[160px] h-[280px] bg-white rounded-[2.5rem] p-1.5 shadow-2xl z-20 border border-[#e9e9e7]"
                  >
                    {/* Minimalist Screen */}
                    <div className="w-full h-full bg-white rounded-[2.2rem] overflow-hidden flex flex-col relative border border-[#f1f1f0]">

                      {/* Minimal Header */}
                      <div className="h-14 pt-4 px-4 flex items-center gap-2 border-b border-[#f1f1f0] shrink-0">
                        <div className="w-7 h-7 rounded-full overflow-hidden bg-[#f1f1f0] flex items-center justify-center p-0.5">
                          <img src={finlozLogo} alt="Lui" className="w-full h-full object-contain rounded-full" />
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-[#37352f] font-bold leading-none">Lui</span>
                            <div className="w-2.5 h-2.5 rounded-full bg-[#6366f1]/10 flex items-center justify-center">
                              <div className="w-1 h-1 rounded-full bg-[#6366f1]" />
                            </div>
                          </div>
                          <span className="text-[8px] text-[#6366f1] font-medium leading-none mt-0.5">Online</span>
                        </div>
                      </div>

                      {/* Clean Chat Area */}
                      <div className="flex-1 p-3 space-y-3 overflow-hidden bg-[#fcfcfc]">
                        <div className="bg-[#f1f1f0]/70 p-2.5 rounded-xl rounded-tl-none max-w-[90%] shadow-sm shadow-black/[0.02]">
                          <div className="h-1.5 w-full bg-[#37352f]/10 rounded-full mb-1" />
                          <div className="h-1.5 w-2/3 bg-[#37352f]/5 rounded-full" />
                        </div>

                        <div className="flex justify-end">
                          <div className="bg-[#6366f1]/10 p-2.5 rounded-xl rounded-tr-none max-w-[85%] border border-[#6366f1]/10">
                            <div className="h-1.5 w-12 bg-[#6366f1]/30 rounded-full" />
                          </div>
                        </div>

                        <div className="bg-[#f1f1f0]/70 p-2.5 rounded-xl rounded-tl-none max-w-[90%] shadow-sm shadow-black/[0.02]">
                          <div className="h-1.5 w-[85%] bg-[#37352f]/10 rounded-full mb-1" />
                          <div className="h-1.5 w-[40%] bg-[#37352f]/5 rounded-full" />
                        </div>
                      </div>

                      {/* Minimal Input Representation */}
                      <div className="h-10 border-t border-[#f1f1f0] flex items-center px-4 gap-2 shrink-0">
                        <div className="h-1.5 w-full bg-[#f1f1f0] rounded-full" />
                        <div className="w-4 h-4 rounded-full bg-[#6366f1]/20 flex items-center justify-center shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#6366f1]" />
                        </div>
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