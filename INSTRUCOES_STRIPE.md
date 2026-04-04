# Configuração do Stripe & Webhooks (ngrok)

Parabéns! O sistema de checkout do Stripe e o plano **Flow** (R$ 9,90/mês) foram implementados. Abaixo estão os passos para colocar tudo para funcionar.

## 1. Criar a Tabela no Supabase
Você precisa criar a tabela que armazenará o status da assinatura dos usuários. Copie e cole o SQL abaixo no **SQL Editor** do seu painel Supabase:

```sql
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) unique not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  plan_id text,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Habilitar Row Level Security (Segurança)
alter table public.subscriptions enable row level security;

-- Permitir que usuários vejam apenas sua própria assinatura
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
```

---

## 2. Configurar o Webhook no Stripe
Para o Stripe avisar o seu servidor quando um pagamento for aprovado, siga estas etapas:

1. Acesse o [Painel do Stripe (Developers > Webhooks)](https://dashboard.stripe.com/test/webhooks).
2. Clique em **"Add an endpoint"**.
3. Em **Endpoint URL**, coloque o seu endereço do ngrok seguido da rota do webhook:
   `https://angelina-unsalvageable-inconceivably.ngrok-free.dev/api/stripe/webhook`
4. Em **Select events to listen to**, adicione estes 3 eventos:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Clique em **Add endpoint**.
6. Após criar, você verá uma seção chamada **"Webhook signing secret"**. Clique em "Reveal" e copie a chave que começa com `whsec_...`.

---

## 3. Atualizar o arquivo .env
Abra o seu arquivo `.env` na raiz do projeto e cole a chave que você acabou de copiar:

```env
STRIPE_WEBHOOK_SECRET=whsec_sua_chave_aqui
```

Depois de salvar o `.env`, **reinicie o seu servidor** para que ele reconheça a nova chave.

---

## 4. Testar o Fluxo
1. Vá para a página de **Assinatura** no sistema.
2. Clique em **"Assinar Plano Flow"**.
3. Você será redirecionado para o Stripe Checkout (em modo teste).
4. Use um cartão de teste do Stripe (ex: 4242 4242 4242 4242).
5. Após o pagamento bem-sucedido, você voltará para a página de Assinatura e o status deverá mudar para "Assinatura Ativa" (assim que o webhook processar).

---

### Observação sobre o ngrok:
Sempre que você reiniciar o ngrok e o endereço mudar, você precisará atualizar a URL no painel do Stripe e a variável `VITE_API_URL` no seu `.env`. Caso contrário, os pagamentos continuarão funcionando, mas o seu sistema não saberá que o usuário pagou (o webhook falhará).
