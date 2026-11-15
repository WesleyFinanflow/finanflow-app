# Correções da auditoria de novembro de 2026

## Alterações

- Express 5 encaminha rejeições assíncronas ao tratamento de erro. Suporte valida campos; entradas inválidas retornam 400 sem encerrar o processo.
- Resgate de cupons usa transação e uma gravação no documento do cupom para serializar verificações de limite global, individual e diário. Benefício, assinatura, uso, contador e auditoria confirmam ou revertem juntos. Requer MongoDB com suporte a transações (replica set, como MongoDB Atlas); não há fallback inseguro para standalone.
- Política única protege o administrador principal e impede ADMIN de modificar administradores. ADMIN e SUPER_ADMIN não são bloqueados por teste vencido; bloqueio explícito continua valendo para admins que não são o principal.
- Credencial é verificada antes de informar expiração. Senhas novas têm mínimo de 12 caracteres; senhas antigas continuam aceitas no login.
- Sessão usa cookie HttpOnly, Secure em produção, SameSite=Lax e origem validada nas escritas. Navegador acessa `/api` pelo proxy da Vercel. JWT não é devolvido em JSON, URL ou localStorage. Sessões novas duram oito horas para usuário e uma hora para administrador. Tokens antigos sem issuer deixam de valer; usuários precisarão entrar novamente.
- OAuth volta com código opaco, válido por 60 segundos e de uso único. O início do OAuth continua direto na API Render para preservar o cookie de state no mesmo domínio do callback; o código é trocado pelo cookie da origem do frontend.
- Frontend ganha CSP, proteção contra enquadramento e outros cabeçalhos. OCR e exportações usam recursos da própria origem; workers e WebAssembly são permitidos explicitamente.
- Readiness antecede login/cadastro, permitindo acordar o Render antes da escrita. Não se repetem escritas automaticamente.
- Admin carrega sob demanda; bootstrap agrega estatísticas no banco e pagina clientes em grupos de 100. Listas auxiliares são limitadas; exportações e filtros visuais indicam a página exibida.
- Dependências e lockfiles atualizados; relatório de auditoria sem alertas nos dois projetos na validação local.
- Preservada a correção de índice de lançamentos recorrentes que já estava no Render e faltava no main. A migração idempotente não altera lançamentos.

## Validação local

Em cada diretório `backend` e `frontend`:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm lint
pnpm build
pnpm audit
```

Backend: 49 testes. Frontend: 17 testes. Os testes de segurança iniciam a API real como processo filho com MongoDB temporário em replica set, nunca com o banco de produção.

Cobertura adicional: cookie Secure/HttpOnly, CSRF, logout, separação de papéis, proteção do principal nas duas rotas, senha antiga/nova, expiração após validação da senha, código OAuth de uso único, concorrência nos três limites de cupom, rollback dos benefícios, entrada inválida sem queda e paginação sem perda de clientes.

## Publicação coordenada

1. Confirmar o commit revisado e os serviços: Render `srv-dan7cpijnfac73fkse90`, Vercel `prj_45ojNo92PcQCY4RSAkFWEYHcnKhA`, domínio `vitalflow.ia.br`.
2. Preservar as variáveis existentes. `ADMIN_EMAILS` deve manter o e-mail principal já autorizado. Não copiar segredos para o repositório. `CORS_ORIGIN` deve conter a origem exata `https://vitalflow.ia.br`; origens de preview só podem ser acrescentadas se deliberadamente usadas na validação.
3. Confirmar suporte a transações no MongoDB e disponibilidade de backup recuperável antes da publicação. O rollout não exclui registros nem executa limpeza de dados.
4. Render: backend em `backend`; build `npx --yes pnpm@12.11.2 install --frozen-lockfile`; start `node src/server.js`; Node 24 ou 22. Implantar o commit específico da correção e acompanhar até Live. O painel pode sobrescrever render.yaml: conferir os comandos efetivos.
5. Vercel: raiz `frontend`, configuração e rewrites de `frontend/vercel.json`. Publicar o mesmo commit. As duas partes mudam o contrato de sessão; coordenar a janela de publicação para evitar front/backend incompatíveis.
6. Conferir `/api/ready` diretamente na API e pelo domínio do frontend. Ambos devem retornar JSON 200; readiness deve mostrar o commit do Render.
7. Conferir cabeçalhos do HTML, login e logout no navegador, recarregamento com sessão mantida, ausência de token no localStorage, admin e usuário com contas de teste autorizadas. Conferir OAuth real, recuperação por e-mail, PDF/Excel e OCR.
8. Se houver regressão, reverter **backend e frontend juntos** para os commits anteriores. As colunas adicionadas são opcionais; rollback não exige apagar dados.

## Limites

O plano gratuito do Render continua podendo dormir; isso não é eliminado pelo código. Não foi implementado segundo fator, nem alteradas políticas do provedor MongoDB, backup ou e-mail. Essas são decisões/configurações adicionais, não achados com exploração comprovada nesta correção.

A validação final de navegação da versão corrigida foi interrompida por timeouts do controle do navegador. As suítes, o build e as verificações HTTP locais passaram; a validação visual e a confirmação em produção precisam ser concluídas no rollout.
