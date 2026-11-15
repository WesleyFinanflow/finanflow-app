# Revisão operacional — novembro de 2026

## Mudanças

- “+ dias” soma ao vencimento existente ou à data atual se já expirou. A escolha explícita de data é validada e usa o final do dia de Fortaleza.
- Plano de cortesia sem vencimento: preserva papel USER, converte o teste, remove validade operacional e cancela registros de assinatura substituídos na mesma transação.
- Assinaturas com prazo são validadas. O direito de acesso é reconciliado no servidor ao usar a sessão; uma assinatura expirada retorna ao FREE. Cortesias e planos legados sem origem não são expirados automaticamente.
- Exclusão administrativa e autoexclusão usam a mesma transação e removem sessões, dados individuais, dívidas, snapshots e vínculos. Dados compartilhados do parceiro são preservados; dívidas compartilhadas mudam de responsável. Não há limpeza retroativa automática de registros órfãos antigos.
- Sessões novas têm registro revogável por dispositivo, com hash do token e TTL. Logout invalida a cópia da sessão no servidor. Sessões anteriores à mudança exigem novo login.
- Suporte e resgate de cupons desativados são recusados na API. Criação de casal e operações de planejamento verificam os respectivos controles de recurso.
- Busca e filtros de clientes são processados no banco, com exportação do resultado completo até 10.000 registros; resultados maiores exigem filtro mais específico.
- Listas auxiliares têm paginação própria. Ações protegidas ficam desabilitadas no detalhe, falhas têm mensagens e o diálogo gerencia foco/teclado.
- Pipeline de PR verifica testes, lint, build e dependências sem usar segredos de produção.

## Backup

O workflow passa a falhar quando faltar configuração, exige cópia não vazia, testa restauração em MongoDB local descartável, criptografa o arquivo e verifica a leitura antes de enviar o artefato. Mantém periodicidade semanal e retenção de 30 dias. Não restaura nem modifica o banco de origem.

Segredos necessários no GitHub:

- `MONGODB_URI`: conexão do banco do aplicativo, com o nome do banco na URI. Deve ser cadastrada diretamente pelo proprietário em Settings → Secrets and variables → Actions. Nunca enviar por chat ou commitar.
- `BACKUP_ENCRYPTION_KEY`: chave aleatória criada diretamente no GitHub durante esta correção, sem exibir ou gravar o valor no repositório. Não substituir a chave enquanto ainda forem necessárias cópias anteriores.

Depois de cadastrar a conexão, executar `mongodb-backup.yml` e confirmar: job verde, restauração verificada e artefato `.enc` não vazio. Antes disso, o backup está preparado, mas ainda não está operacional. O fato de o workflow existir não comprova backup.

## Publicação

1. Executar as suítes dos dois projetos e os checks do PR.
2. Implantar backend e frontend do mesmo commit em Render e Vercel já vinculados ao FinanFlow. Preservar variáveis existentes.
3. Verificar readiness/commit, tela pública e regras com contas fictícias; confirmar o novo login do proprietário sem acessar seus dados financeiros.
4. Não executar exclusões ou alterações de planos em contas reais para testar a publicação.
5. Rollback deve coordenar backend e frontend. Os campos novos são opcionais; sessões antigas poderão exigir login.

Não foram implementados segundo fator, migração retroativa de cadastros ambíguos, limpeza retroativa de órfãos nem uma reformulação visual. Esses itens precisam de escopo e validação próprios.
