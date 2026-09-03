# FinanFlow — operação sem custo inicial

## Já implementado

- Termos de Uso, Política de Privacidade e consentimento versionado no cadastro.
- Senhas com hash, sessões revogáveis, bloqueio de tentativas, CORS e cabeçalhos de segurança.
- Recuperação de senha por e-mail quando `RESEND_API_KEY` e `EMAIL_FROM` estiverem configurados.
- Endpoints `/api/health` e `/api/ready` para monitoramento.
- Área administrativa protegida pela variável `ADMIN_EMAILS`.
- Exportação, exclusão de conta, histórico e recuperação interna de lançamentos.
- Scripts de backup externo e restauração em `scripts/`.

## Configuração gratuita necessária

1. Railway: configure `ADMIN_EMAILS` com os e-mails autorizados, separados por vírgula.
2. Resend: valide o domínio e configure `RESEND_API_KEY` e `EMAIL_FROM` para a recuperação de senha.
3. UptimeRobot: monitore `https://finanflow-api-production.up.railway.app/api/ready` a cada 5 minutos.
4. MongoDB: instale MongoDB Database Tools para usar `mongodump` e `mongorestore`.
5. GitHub: adicione o secret `MONGODB_URI`; o workflow semanal guardará backups por 30 dias.

## Teste mensal de restauração

Restaure em um banco temporário, nunca diretamente no banco real sem conferência. Confira contas, lançamentos, parcelas, recorrências, metas e espaço do casal.

## Antes de cobrar

Faça revisão jurídica dos textos, defina um canal oficial de suporte, publique preço/reembolso e só então conecte o provedor de pagamento. Planos gratuitos de terceiros possuem limites e termos próprios.
