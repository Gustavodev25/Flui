import React from 'react'
import { Shield, Lock, CreditCard, FileText, UserCheck, HelpCircle, RefreshCw } from 'lucide-react'

const TermsContent: React.FC = () => {
  return (
    <div className="space-y-10 text-[#37352f]/80 text-[13px] leading-relaxed pb-6 px-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">

      {/* Header Intro */}
      <div>
        <p className="font-medium text-[#37352f]/50 leading-relaxed italic">
          Bem-vindo ao <strong className="text-[#37352f]/70">Flui</strong>. Esta plataforma foi criada para simplificar sua produtividade com clareza e transparência. Ao utilizar nossos serviços, você concorda legalmente com os termos detalhados abaixo.
        </p>
      </div>

      {/* Section: Terms of Use */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-[#2383e2]/10 rounded-lg flex items-center justify-center text-[#2383e2]">
            <FileText size={18} />
          </div>
          <h4 className="text-lg font-bold text-[#37352f]">Termos de Uso</h4>
        </div>

        <div className="grid gap-6 ml-1">
          <div className="flex gap-4">
            <div className="shrink-0 w-6 h-6 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[10px] font-bold text-[#37352f]/40">01</div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Aceitação dos Termos</h5>
              <p>Ao acessar ou usar o Flui, você concorda em cumprir estes Termos de Uso e todas as leis e regulamentos aplicáveis. Se você não concordar, não deverá utilizar a plataforma.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 w-6 h-6 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[10px] font-bold text-[#37352f]/40">02</div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Licença de Uso</h5>
              <p>Concedemos uma licença pessoal, limitada, revogável e não exclusiva para usar nossa plataforma de acordo com o plano assinado. É proibida a redistribuição ou engenharia reversa do software.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 w-6 h-6 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[10px] font-bold text-[#37352f]/40">03</div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Responsabilidades do Usuário</h5>
              <p>Você é responsável pela segurança da sua senha e por qualquer atividade em sua conta. O uso indevido da plataforma ou do assistente Lui resultará no banimento imediato.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 w-6 h-6 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[10px] font-bold text-[#37352f]/40">04</div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Usos Proibidos</h5>
              <p>Você não pode usar o Flui para: (a) violar leis locais ou internacionais; (b) transmitir vírus ou códigos maliciosos; (c) interferir na segurança da plataforma ou de outros usuários.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 w-6 h-6 rounded-full bg-[#f1f1f0] flex items-center justify-center text-[10px] font-bold text-[#37352f]/40">05</div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Modificações dos Termos</h5>
              <p>Podemos revisar estes termos a qualquer momento. Alterações significativas serão notificadas por e-mail. O uso continuado após as mudanças constitui sua aceitação.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Divider 1 */}
      <div className="h-px bg-[#f1f1f0] -mx-8" />

      {/* Section: Privacy Policy */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-[#25D366]/10 rounded-lg flex items-center justify-center text-[#25D366]">
            <Shield size={18} />
          </div>
          <h4 className="text-lg font-bold text-[#37352f]">Política de Privacidade (LGPD)</h4>
        </div>

        <div className="grid gap-6 ml-1">
          <div className="flex gap-4">
            <div className="shrink-0 text-[#37352f]/30 mt-1"><Lock size={16} /></div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Coleta e Proteção de Dados</h5>
              <p>Coletamos seu nome e e-mail para fins de funcionalidade. Estes dados são criptografados e armazenados via Supabase com altos padrões de segurança.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 text-[#37352f]/30 mt-1"><UserCheck size={16} /></div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Seus Direitos</h5>
              <p>Em conformidade com a LGPD, você possui direito total sobre seus dados. Você pode solicitar o acesso ou a exclusão total de sua conta a qualquer momento.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 text-[#37352f]/30 mt-1"><RefreshCw size={16} /></div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Processamento por IA</h5>
              <p>Utilizamos IA para processar seus comandos. Seus dados privados não são compartilhados para fins publicitários e são mantidos sob estrito sigilo.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="shrink-0 text-[#37352f]/30 mt-1"><CreditCard size={16} /></div>
            <div>
              <h5 className="font-bold text-[#37352f] mb-1">Segurança de Pagamento</h5>
              <p>O Flui utiliza o <strong>Stripe</strong>. Não temos acesso direto nem armazenamos os detalhes do seu cartão de crédito em nossa infraestrutura.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Divider 2 */}
      <div className="h-px bg-[#f1f1f0] -mx-8" />

      {/* Section: Jurisdiction */}
      <section className="space-y-4">
        <h5 className="font-bold text-[#37352f]">Lei e Foro Aplicável</h5>
        <p className="text-[#37352f]/60 text-xs text-justify">
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Qualquer disputa decorrente do uso desta plataforma será resolvida no foro da comarca de São Paulo, SP, com renúncia a qualquer outro, por mais privilegiado que seja.
        </p>
      </section>

      {/* Section: Additional Info */}
      <section className="bg-[#f7f7f5] rounded-2xl p-6 border border-[#e9e9e7]">
        <div className="flex items-start gap-4">
          <div className="shrink-0 text-[#37352f]/40"><HelpCircle size={20} /></div>
          <div className="space-y-3">
            <h5 className="font-bold text-[#37352f]">Dúvidas ou Suporte?</h5>
            <p className="text-[#37352f]/60 text-xs">Se você tiver qualquer dúvida sobre estes termos, nossa equipe está pronta para ajudar através do nosso canal oficial de suporte no WhatsApp.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default TermsContent
