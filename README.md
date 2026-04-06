# Flui — Guia de Deploy

> **Leia este documento ANTES de fazer qualquer push.**
> O projeto tem dois repositórios separados: um para o frontend (Vercel) e outro para o backend (Railway).
> Misturar arquivos de um no outro causa erros de build e quebra a aplicação em produção.

---

## Repositórios

| Parte | Git | Hospedagem | URL |
|---|---|---|---|
| Frontend | https://github.com/Gustavodev25/Flui.git | Vercel | https://flui.ia.br |
| Backend | https://github.com/Gustavodev25/Flui-backend.git | Railway | https://flui-backend-production.up.railway.app |

---

## Estrutura do projeto local

```
taskapp/
├── agent/                  → BACKEND
├── api/                    → BACKEND (entry point para Vercel Node, mantido mas não usado em Railway)
├── public/                 → FRONTEND
├── src/                    → FRONTEND
│   ├── assets/             → FRONTEND
│   ├── components/         → FRONTEND
│   ├── contexts/           → FRONTEND
│   ├── hooks/              → FRONTEND
│   ├── lib/                → FRONTEND
│   ├── pages/              → FRONTEND
│   └── utils/              → FRONTEND
├── supabase/               → BACKEND (migrations do banco)
├── .env                    → NÃO SOBE (ignorado pelo .gitignore)
├── .gitignore              → AMBOS
├── index.html              → FRONTEND
├── package.json            → AMBOS (mesmo arquivo, contém deps dos dois)
├── package-lock.json       → AMBOS
├── postcss.config.js       → FRONTEND
├── railway.json            → BACKEND
├── server.js               → BACKEND
├── tailwind.config.js      → FRONTEND
├── tsconfig.json           → FRONTEND
├── vercel.json             → FRONTEND
└── vite.config.ts          → FRONTEND
```

---

## Arquivos por repositório

### Frontend — `Gustavodev25/Flui`

Esses são os únicos arquivos que devem existir no repositório do frontend:

```
src/
public/
index.html
package.json
package-lock.json
postcss.config.js
tailwind.config.js
tsconfig.json
vercel.json
vite.config.ts
.gitignore
README.md
```

**Nunca subir no frontend:**
- `server.js`
- `agent/`
- `supabase/`
- `railway.json`
- `api/` *(existe no repo mas só é usado se o backend estiver no Vercel — não é o caso)*

---

### Backend — `Gustavodev25/Flui-backend`

Esses são os únicos arquivos que devem existir no repositório do backend:

```
server.js
agent/
api/
supabase/
package.json
package-lock.json
railway.json
.gitignore
README.md
```

**Nunca subir no backend:**
- `src/`
- `public/`
- `index.html`
- `vite.config.ts`
- `tailwind.config.js`
- `postcss.config.js`
- `tsconfig.json`
- `vercel.json`

---

## Como fazer push corretamente

### Passo 1 — Verificar se há atualizações nos remotes antes de subir

```bash
# Verificar status local
git status

# Puxar atualizações do remote (se trabalhar em múltiplas máquinas)
git pull origin main
```

### Passo 2 — Subir para o Frontend (Vercel)

```bash
# Adicionar apenas os arquivos do frontend
git add src/ public/ index.html package.json package-lock.json postcss.config.js tailwind.config.js tsconfig.json vercel.json vite.config.ts .gitignore README.md

# Conferir o que vai subir (leia com atenção!)
git status

# Commit
git commit -m "feat: descrição do que mudou no frontend"

# Push para o repo do frontend
git remote set-url origin https://github.com/Gustavodev25/Flui.git
git push origin main
```

### Passo 3 — Subir para o Backend (Railway)

```bash
# Adicionar apenas os arquivos do backend
git add server.js agent/ api/ supabase/ package.json package-lock.json railway.json .gitignore README.md

# Conferir o que vai subir (leia com atenção!)
git status

# Commit
git commit -m "feat: descrição do que mudou no backend"

# Push para o repo do backend
git remote set-url origin https://github.com/Gustavodev25/Flui-backend.git
git push origin main
```

> **Dica:** Depois do push, lembre de restaurar o remote para o repo principal (ou o que preferir usar como padrão).

---

## Variáveis de ambiente

O arquivo `.env` **nunca** é commitado (está no `.gitignore`). As variáveis precisam ser configuradas manualmente em cada plataforma.

### Vercel — variáveis do Frontend

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública do Supabase |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Chave pública do Stripe (pk_live_...) |
| `VITE_API_URL` | URL do backend Railway |

### Railway — variáveis do Backend

| Variável | Descrição |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role do Supabase (secreta) |
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret do webhook Stripe (whsec_...) |
| `FRONTEND_URL` | https://flui.ia.br |
| `NVIDIA_API_KEY` | Chave da API NVIDIA |
| `GROQ_API_KEY` | Chave da API Groq |
| `MODEL_ID` | ID do modelo de IA (ex: deepseek-ai/deepseek-v3.1) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número WhatsApp |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID da conta Business WhatsApp |
| `WHATSAPP_ACCESS_TOKEN` | Token de acesso WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook WhatsApp |

---

## Webhook do Stripe

- **URL do webhook:** `https://flui-backend-production.up.railway.app/api/stripe/webhook`
- **Configurar em:** Stripe Dashboard → Developers → Webhooks
- **Eventos necessários:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

---

## Checklist antes de cada push

- [ ] Rodei `git status` e li todos os arquivos que serão commitados?
- [ ] Não há arquivos do frontend sendo enviados para o repo do backend?
- [ ] Não há arquivos do backend sendo enviados para o repo do frontend?
- [ ] As variáveis de ambiente estão configuradas na plataforma correta?
- [ ] O `.env` NÃO está na lista de arquivos para commit?
- [ ] O remote (`git remote -v`) aponta para o repositório certo?

---

## Produto Stripe em produção

- **Price ID:** `price_1TJFEGJBeIyj93UbSOp5yZuY`
- **Modo:** Live (produção)
- **Redirects após pagamento:**
  - Sucesso: `https://flui.ia.br/subscription?success=true`
  - Cancelado: `https://flui.ia.br/subscription?canceled=true`
