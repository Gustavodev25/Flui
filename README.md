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
├── api/                    → BACKEND (entry point Vercel Node, mantido para compatibilidade)
├── public/                 → FRONTEND (assets estáticos)
├── src/                    → FRONTEND
├── supabase/               → BACKEND (migrations SQL do banco)
├── .env                    → NÃO SOBE (ignorado pelo .gitignore)
├── .gitignore              → AMBOS
├── index.html              → FRONTEND
├── nixpacks.toml           → BACKEND (fixa Node 20 + ffmpeg no Railway)
├── package.json            → AMBOS
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
- `api/`

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

---

## Como fazer push corretamente

### Passo 1 — Verificar atualizações

```bash
git status
git pull origin main
```

### Passo 2 — Subir para o Frontend (Vercel)

```bash
git add src/ public/ index.html package.json package-lock.json postcss.config.js tailwind.config.js tsconfig.json vercel.json vite.config.ts .gitignore README.md
git commit -m "feat: descrição"
git push frontend main
```

### Passo 3 — Subir para o Backend (Railway)

```bash
git add server.js agent/ api/ supabase/ nixpacks.toml package.json package-lock.json railway.json .gitignore README.md
git commit -m "feat: descrição"
git push backend main
```

---

## Variáveis de ambiente

### Vercel — Frontend
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_API_URL`

### Railway — Backend
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_URL`
- `VITE_API_URL`
- `NVIDIA_API_KEY`
- `GROQ_API_KEY`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`

---

## Endpoints da API

(Consulte as rotas em server.js ou na documentação estendida)

---

## Checklist antes de cada push

- [ ] Rodei `git status`?
- [ ] Não há arquivos cruzados?
- [ ] O `.env` NÃO está no commit?
