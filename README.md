# FinanFlow App

App financeiro para uso individual e casal, com frontend React/Vite e backend Node.js/Express/MongoDB.

## Estado atual do produto

O FinanFlow já está em fase de MVP funcional avançado. Ele possui:

- Cadastro e login real com JWT.
- Espaço financeiro individual criado automaticamente.
- Espaço financeiro de casal por convite.
- Contas manuais com saldo atual.
- Receitas, despesas, dívidas e metas.
- Simulador simples: “posso comprar?”.
- Reserva mínima protegida salva por espaço.
- Recuperação e troca de senha.
- Sessão expirada tratada no frontend.
- Tema visual “Green Wallet”.
- PWA instalável.
- Testes unitários básicos para cálculo financeiro e validações.

## Estrutura

```txt
frontend/  Aplicação React + Vite para Vercel
backend/   API Node.js + Express + MongoDB para Railway
```

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: MongoDB Atlas
- Deploy frontend: Vercel
- Deploy backend: Railway
- E-mail de recuperação: Resend, quando configurado

## Configuração de produção

No frontend da Vercel, configure:

- `VITE_API_URL`: URL pública HTTPS do backend, sem barra no final.

No backend, configure:

- `MONGODB_URI`: conexão do MongoDB Atlas.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `CORS_ORIGIN`: origens permitidas separadas por vírgula, incluindo a URL da Vercel.
- `FRONTEND_URL`: URL pública do frontend para links de recuperação de senha.
- `RESEND_API_KEY`: chave do Resend para recuperação de senha por e-mail.
- `EMAIL_FROM`: remetente autorizado no Resend.

O backend não inicia sem `MONGODB_URI` e um `JWT_SECRET` seguro. Isso evita publicar a API usando credenciais padrão.

## Rodar localmente

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

No Codespaces, abra a porta `5173` para o frontend. A porta `3000` é apenas a API.

## Validação local

Frontend:

```bash
cd frontend
npm test
npm run build
```

Backend:

```bash
cd backend
npm test
```

## Pontos pendentes para virar produto final

- Trocar confirmações nativas do navegador por modal visual.
- Criar filtro por mês/período nos lançamentos.
- Melhorar QR real do convite casal.
- Ampliar testes automatizados de fluxo completo.
- Separar melhor componentes do `App.jsx`, que ainda está grande.
- Homologar login, convite casal, recuperação de senha e PWA em produção.
