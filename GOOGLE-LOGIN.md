# Login com Google

O FinanFlow usa OAuth 2.0 com OpenID Connect. O servidor valida o ID token emitido pelo Google e retorna a sessão do FinanFlow no fragmento da URL, que não é enviado novamente ao servidor pelo navegador.

## Configuração no Google Cloud

1. Abra **APIs e serviços → Tela de consentimento OAuth** e configure o app como **Externo**. Informe nome do app, e-mail de suporte e `https://vitalflow.ia.br` como domínio inicial autorizado.
2. Em **APIs e serviços → Credenciais**, crie uma credencial do tipo **ID do cliente OAuth**, aplicação **Web**.
3. Adicione esta URI de redirecionamento autorizada:

   `https://finanflow-api-production.up.railway.app/api/auth/google/callback`

4. Copie o ID do cliente e o segredo gerados.

## Variáveis da Railway

Defina estas variáveis no serviço da API e faça um novo deploy:

```text
GOOGLE_CLIENT_ID=<ID do cliente OAuth>
GOOGLE_CLIENT_SECRET=<segredo do cliente OAuth>
GOOGLE_REDIRECT_URI=https://finanflow-api-production.up.railway.app/api/auth/google/callback
FRONTEND_URL=https://vitalflow.ia.br
NODE_ENV=production
```

O botão **Continuar com Google** aparece automaticamente quando as três variáveis `GOOGLE_*` estiverem presentes. Contas existentes com o mesmo e-mail são vinculadas ao Google no primeiro acesso; contas novas devem usar **Criar conta com Google** e aceitar os termos.
