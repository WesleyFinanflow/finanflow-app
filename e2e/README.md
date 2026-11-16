# Testes de navegador do FinanFlow

Suíte com Playwright Chromium em computador e celular (Pixel 7 emulado). Usa frontend compilado, proxy de mesma origem para a API local, backend real e MongoDB replica set descartável. Nenhuma credencial de produção é necessária. O navegador bloqueia solicitações externas.

Cobertura: usuário comum recusado no admin, logout e repetição de cookie, cortesia Premium sem vencimento preservando USER, configuração MFA por interface, desafio após senha, rejeição de TOTP repetido e recuperação de uso único.

## Executar

Na raiz, instalar dependências de backend, frontend e e2e com pnpm e lockfile. Depois:

```
pnpm --dir frontend build
pnpm --dir e2e exec playwright install chromium
pnpm --dir e2e test
```

Portas exclusivas 4392 e 5392 precisam estar livres. Não reutiliza servidor existente. O processo cria e encerra seu próprio banco descartável. A configuração não aceita URL/banco de produção por variável. Não executar em serviços de produção. Os dados fictícios são diferentes por projeto para evitar interferência entre desktop e celular. Não há retries automáticos que escondam falhas ou consumam tentativas adicionais de login.

Relatório HTML e JSON em `e2e/playwright-report` e `e2e/test-results`, ignorados no Git. Na CI são artefatos com retenção de sete dias. Traces e screenshots de falha podem conter chaves e códigos das contas descartáveis, nunca de usuários reais. Isso não valida integrações externas de Google ou e-mail, nem representa toda a aplicação coberta por E2E.

Referências: https://playwright.dev/docs/test-webserver e https://playwright.dev/docs/ci-intro.
