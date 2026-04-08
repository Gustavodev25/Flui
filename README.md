# Flui — Guia de Deploy e Documentação

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

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion |
| Backend | Node.js 20+, Express 5, OpenAI SDK (NVIDIA NIM) |
| Banco de Dados | Supabase (PostgreSQL + Auth + RLS) |
| Pagamentos | Stripe (checkout, subscriptions, webhooks) |
| Mensageria | WhatsApp Business API (Meta Cloud API) |
| IA | NVIDIA NIM (DeepSeek V3.1), Groq (transcrição de áudio) |

---

## Requisitos de Runtime

**Node.js >= 20 (obrigatório)**

O OpenAI SDK v6+ usa `globalThis.File` para uploads de áudio (transcrição via Groq/NVIDIA). Essa API só existe nativamente no Node 20+. Usar Node 18 causa o erro:

```
`File` is not defined as a global, which is required for file uploads.
Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`.
```

**Como a versão é fixada no Railway:**
- `nixpacks.toml` → `nixPkgs = ["nodejs_20"]`
- `package.json` → `"engines": { "node": ">=20.0.0" }`
- `agent/transcriber.js` → polyfill de segurança no topo do arquivo

Não remova nenhuma dessas configurações.

---

## Estrutura do projeto local

```
taskapp/
├── agent/                  → BACKEND (agente IA, tools, LLM, transcrição)
│   ├── conversationOrchestrator.js  → Orquestração de turnos de conversa
│   ├── conversationStore.js         → Persistência de mensagens/threads
│   ├── llmClient.js                 → Multi-provider LLM com fallback
│   ├── queryEngine.js               → Motor de IA para tarefas
│   ├── reminders.js                 → Sistema de lembretes
│   ├── tools.js                     → Ferramentas do agente (CRUD tarefas)
│   └── transcriber.js               → Transcrição de áudio WhatsApp
├── api/                    → BACKEND (entry point Vercel Node, mantido para compatibilidade)
├── public/                 → FRONTEND (assets estáticos)
├── src/                    → FRONTEND
│   ├── assets/logo/        → Logos SVG (lui, flow, pulse, gratis)
│   ├── components/         → Componentes React reutilizáveis
│   ├── contexts/           → Context providers (Subscription)
│   ├── hooks/              → Custom React hooks
│   ├── lib/                → Utilitários (api.ts, supabaseClient)
│   ├── pages/              → Páginas da aplicação
│   └── utils/              → Helpers
├── supabase/               → BACKEND (migrations SQL do banco)
├── .env                    → NÃO SOBE (ignorado pelo .gitignore)
├── .gitignore              → AMBOS
├── index.html              → FRONTEND
├── nixpacks.toml           → BACKEND (fixa Node 20 + ffmpeg no Railway)
├── package.json            → AMBOS (mesmo arquivo, contém deps dos dois)
├── package-lock.json       → AMBOS
├── postcss.config.js       → FRONTEND
├── railway.json            → BACKEND
├── server.js               → BACKEND (Express API principal)
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
- `nixpacks.toml`
- `api/` *(existe no repo mas só é usado se o backend estiver no Vercel — não é o caso)*

---

### Backend — `Gustavodev25/Flui-backend`

Esses são os únicos arquivos que devem existir no repositório do backend:

```
server.js
agent/
api/
supabase/
nixpacks.toml
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

### Passo 1 — Verificar atualizações

```bash
git status
git pull origin main
```

### Passo 2 — Subir para o Frontend (Vercel)

```bash
# Adicionar apenas os arquivos do frontend
git add src/ public/ index.html package.json package-lock.json postcss.config.js tailwind.config.js tsconfig.json vercel.json vite.config.ts .gitignore README.md

# Conferir o que vai subir
git status

# Commit
git commit -m "feat: descrição do que mudou no frontend"

# Push para o repo do frontend
git push frontend main
```

### Passo 3 — Subir para o Backend (Railway)

```bash
# Adicionar apenas os arquivos do backend
git add server.js agent/ api/ supabase/ nixpacks.toml package.json package-lock.json railway.json .gitignore README.md

# Conferir o que vai subir
git status

# Commit
git commit -m "feat: descrição do que mudou no backend"

# Push para o repo do backend
git push backend main
```

---

## Variáveis de ambiente

O arquivo `.env` **nunca** é commitado (está no `.gitignore`). As variáveis precisam ser configuradas manualmente em cada plataforma.

### Vercel — variáveis do Frontend

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública do Supabase |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Chave pública do Stripe (pk_live_...) |
| `VITE_API_URL` | URL do backend Railway (`https://flui-backend-production.up.railway.app`) |

### Railway — variáveis do Backend

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role do Supabase (secreta) |
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret do webhook Stripe (whsec_...) |
| `FRONTEND_URL` | `https://flui.ia.br` |
| `VITE_API_URL` | `https://flui-backend-production.up.railway.app` |
| `NVIDIA_API_KEY` | Chave da API NVIDIA |
| `GROQ_API_KEY` | Chave da API Groq (transcrição de áudio) |
| `MODEL_ID` | ID do modelo de IA (ex: `deepseek-ai/deepseek-v3.1`) |
| `PRIMARY_LLM_TIMEOUT_MS` | Timeout do LLM primário (padrão: 9000) |
| `FALLBACK_LLM_TIMEOUT_MS` | Timeout do LLM fallback (padrão: 8000) |
| `LLM_TURN_BUDGET_MS` | Budget por turno (padrão: 20000) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número WhatsApp |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID da conta Business WhatsApp |
| `WHATSAPP_ACCESS_TOKEN` | Token de acesso WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook WhatsApp |

---

## Endpoints da API

### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/forgot-password` | Solicita código de redefinição de senha |
| POST | `/api/auth/verify-reset-code` | Verifica código de redefinição |
| POST | `/api/auth/reset-password` | Redefine a senha com código válido |

### Stripe / Assinatura
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/stripe/create-checkout-session` | Cria sessão de checkout Stripe |
| POST | `/api/stripe/validate-promo` | Valida código promocional |
| POST | `/api/stripe/create-portal-session` | Cria sessão do portal de faturamento |
| POST | `/api/stripe/webhook` | Webhook de eventos Stripe |
| GET | `/api/subscription/status` | Verifica status da assinatura |
| GET | `/api/subscription/sync` | Sincroniza dados com o Stripe |

### Chat / IA
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/chat` | Chat simples com IA |
| POST | `/api/chat-agent` | Chat com agente e ferramentas |

### WhatsApp
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/whatsapp/webhook` | Verificação do webhook Meta |
| POST | `/api/whatsapp/webhook` | Recebe mensagens do WhatsApp |

### Admin
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/users` | Lista todos os usuários |
| POST | `/api/admin/users/grant` | Concede plano a um usuário |
| GET | `/api/admin/stats` | Estatísticas do painel |
| GET | `/api/admin/messages` | Logs de mensagens (conversas IA) |

### Workspace
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/workspace/my-membership` | Verifica se é membro de workspace |
| GET | `/api/workspace/shared-tasks` | Lista tarefas compartilhadas |
| POST | `/api/workspace/shared-tasks` | Cria tarefa compartilhada |
| GET | `/api/workspace/members` | Lista membros do workspace |

---

## Webhook do Stripe

- **URL do webhook:** `https://flui-backend-production.up.railway.app/api/stripe/webhook`
- **Configurar em:** Stripe Dashboard → Developers → Webhooks
- **Eventos necessários:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

---

## Webhook do WhatsApp

- **URL do webhook:** `https://flui-backend-production.up.railway.app/api/whatsapp/webhook`
- **Token de verificação:** Definido em `WHATSAPP_VERIFY_TOKEN`
- **Configurar em:** Meta Developers → WhatsApp → Configuration → Webhook

---

## Painel Admin

Acessível em `/admin` no frontend. Protegido por senha.

### Funcionalidades:
- **Aba Usuários:** Lista completa de usuários, status de assinatura, concessão manual de planos
- **Aba Mensagens:** Logs de todas as conversas (usuário ↔ IA), com filtros por canal (WhatsApp/Web), busca por nome/conteúdo, paginação, e metadados expandíveis (modelo IA, latência, provider)
- **Estatísticas:** Total de mensagens, tarefas, usuários com interação, consumo WhatsApp mensal

---

## Checklist antes de cada push

- [ ] Rodei `git status` e li todos os arquivos que serão commitados?
- [ ] Não há arquivos do frontend sendo enviados para o repo do backend?
- [ ] Não há arquivos do backend sendo enviados para o repo do frontend?
- [ ] As variáveis de ambiente estão configuradas na plataforma correta?
- [ ] O `.env` NÃO está na lista de arquivos para commit?
- [ ] O `nixpacks.toml` está incluído no push do backend?

---

## Produto Stripe em produção

| Plano | Price ID |
|---|---|
| Flow | `price_1TJFEGJBeIyj93UbSOp5yZuY` |
| Pulse | `price_1TJxgVJBeIyj93UbvhaindFh` |

- **Modo:** Live (produção)
- **Redirects após pagamento:**
  - Sucesso: `https://flui.ia.br/subscription?success=true`
  - Cancelado: `https://flui.ia.br/subscription?canceled=true`
