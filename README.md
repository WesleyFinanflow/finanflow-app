# FinanFlow App

App financeiro para uso individual e casal.

## Estrutura

```txt
frontend/  Aplicação React + Vite para Vercel
backend/   API Node.js + Express + MongoDB para Railway
```

## Objetivo da primeira versão

- Cadastro e login real
- Espaço financeiro individual automático
- Espaço financeiro de casal por convite
- Contas manuais
- Receitas, despesas, dívidas e metas
- Simulador simples: posso comprar?

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: MongoDB Atlas
- Deploy frontend: Vercel
- Deploy backend: Railway

## Configuração de produção

No frontend da Vercel, configure `VITE_API_URL` com a URL pública HTTPS do backend, sem barra no final.

No backend, configure:

- `MONGODB_URI`: conexão do MongoDB Atlas.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `CORS_ORIGIN`: origens permitidas separadas por vírgula, incluindo a URL da Vercel.

O backend não inicia sem `MONGODB_URI` e um `JWT_SECRET` seguro. Isso evita publicar a API usando credenciais padrão.

## Validação local

```bash
cd frontend
npm test
npm run build
```
