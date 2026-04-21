import React from 'react'

const TermsContent: React.FC = () => {
  return (
    <div className="space-y-10 text-[#37352f]/70 text-[13px] leading-relaxed pb-6">
      {/* Header Intro */}
      <div className="px-1">
        <p className="font-medium text-[#37352f]/40 leading-relaxed">
          Bem-vindo ao <strong className="text-[#37352f]/60">Flui</strong>. Esta plataforma foi criada para simplificar sua produtividade com clareza e transparência. Ao utilizar nossos serviços, você concorda legalmente com os termos detalhados abaixo.
        </p>
      </div>

      <div className="h-px bg-[#f1f1f0] -mx-5 sm:-mx-6" />

      {/* Section: Terms of Use */}
      <section className="space-y-6 px-1">
        <h4 className="text-sm font-bold text-[#37352f] uppercase tracking-wider">Termos de Uso</h4>

        <div className="space-y-6">
          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">01. Aceitação dos Termos</h5>
            <p>Ao acessar ou usar o Flui, você concorda em cumprir estes Termos de Uso e todas as leis e regulamentos aplicáveis. Se você não concordar, não deverá utilizar a plataforma.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">02. Licença de Uso</h5>
            <p>Concedemos uma licença pessoal, limitada, revogável e não exclusiva para usar nossa plataforma de acordo com o plano assinado. É proibida a redistribuição ou engenharia reversa do software.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">03. Responsabilidades do Usuário</h5>
            <p>Você é responsável pela segurança da sua senha e por qualquer atividade em sua conta. O uso indevido da plataforma ou do assistente Lui resultará no banimento imediato.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">04. Usos Proibidos</h5>
            <p>Você não pode usar o Flui para: (a) violar leis locais ou internacionais; (b) transmitir vírus ou códigos maliciosos; (c) interferir na segurança da plataforma ou de outros usuários.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">05. Modificações dos Termos</h5>
            <p>Podemos revisar estes termos a qualquer momento. Alterações significativas serão notificadas por e-mail. O uso continuado após as mudanças constitui sua aceitação.</p>
          </div>
        </div>
      </section>

      <div className="h-px bg-[#f1f1f0] -mx-5 sm:-mx-6" />

      {/* Section: Privacy Policy */}
      <section className="space-y-6 px-1">
        <h4 className="text-sm font-bold text-[#37352f] uppercase tracking-wider">Política de Privacidade</h4>

        <div className="space-y-6">
          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">Coleta e Proteção de Dados</h5>
            <p>Coletamos seu nome e e-mail para fins de funcionalidade. Estes dados são criptografados e armazenados via Supabase com altos padrões de segurança.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">Seus Direitos</h5>
            <p>Em conformidade com a LGPD, você possui direito total sobre seus dados. Você pode solicitar o acesso ou a exclusão total de sua conta a qualquer momento.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">Processamento por IA</h5>
            <p>Utilizamos IA para processar seus comandos. Seus dados privados não são compartilhados para fins publicitários e são mantidos sob estrito sigilo.</p>
          </div>

          <div>
            <h5 className="font-bold text-[#37352f] mb-1.5">Segurança de Pagamento</h5>
            <p>O Flui utiliza o Stripe. Não temos acesso direto nem armazenamos os detalhes do seu cartão de crédito em nossa infraestrutura.</p>
          </div>
        </div>
      </section>

      <div className="h-px bg-[#f1f1f0] -mx-5 sm:-mx-6" />

      {/* Section: Jurisdiction & Support */}
      <section className="space-y-6 px-1">
        <div>
          <h5 className="font-bold text-[#37352f] mb-1.5">Lei e Foro Aplicável</h5>
          <p className="text-[11px] text-[#37352f]/50">
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Foro da comarca de São Paulo, SP.
          </p>
        </div>
        
        <p className="text-[11px] text-[#37352f]/50">
          Dúvidas ou Suporte? Entre em contato através do nosso canal oficial no WhatsApp.
        </p>
      </section>
    </div>
  )
}

export default TermsContent

