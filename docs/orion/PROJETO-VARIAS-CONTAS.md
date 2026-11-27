# Projeto: várias contas (Nubank, Santander, Mercado Pago…)

Status: **plano para aprovação. Nenhum código foi escrito.** Data: 27/11/2026. Base: `main` @ `50449df`.

## Por que
O usuário quer cadastrar várias contas e ver o saldo de cada uma. Isso também torna a transferência entre contas útil (hoje ela não mudaria nenhum número) e combina com o ORION ("gastei R$ 50 no Nubank").

## Como é hoje (verificado no código)
- Cada espaço tem **uma conta automática** ("Conta principal" ou "Conta conjunta"). `POST /accounts` responde 409; `DELETE` também; `PUT` só altera o saldo inicial da principal.
- `ensurePrimaryAccount` (`backend/src/server.js:492`) **junta e apaga** qualquer conta extra: soma os saldos na principal, move os lançamentos e executa `Account.deleteMany`. É chamada ao listar as contas (visão individual), ao criar/editar/excluir conta e ao criar ou editar lançamento.
- `normalizeAccountIdForSpace` (`server.js:518`) **ignora a conta escolhida** e sempre devolve a principal.
- O saldo é **consolidado**: `calculateSummary` (`frontend/src/finance.js`) soma `balance` de todas as contas e aplica os lançamentos pagos de uma vez. O vale-refeição (`fundingSource: "meal"`) é um saldo separado.
- Telas: `Contas` mostra só `accounts[0]` (`App.jsx:1346`); o relatório usa o saldo base consolidado (`calculateReportBalances`).
- `Transaction.accountId` já existe: lançamentos criados pelo app apontam para a conta principal, e os antigos sem conta são preenchidos quando `ensurePrimaryAccount` roda. Com uma conta só, não há migração de dados a fazer (a confirmar com uma checagem no banco real antes de ligar).
- **Casal:** a visão do casal é a **união dos espaços individuais dos dois** (`spaceViewIds`, `server.js:417`), e cada lançamento é gravado no espaço individual de quem o criou (`userWriteSpaceId`). A "Conta conjunta" do espaço do casal (`server.js:890`) não entra nessa visão com dois membros.
- Outros pontos que leem contas: `debt-plan.js:152` (plano de dívida); `legacy-audit.js` (verifica `accountId` órfão); excluir o espaço do casal e o reset usam `Account.deleteMany` (continuam corretos).

## Proposta
**Saldo de uma conta** = saldo inicial + lançamentos pagos dela (receita soma; despesa, dívida e meta subtraem), sem contar o vale-refeição. **Saldo total** = soma das contas. Para quem tem uma conta só, o total fica idêntico ao de hoje.

**Contas:** nome livre (ex.: Nubank), saldo inicial, e "arquivada" (em vez de excluir quando já há lançamentos). Limite sugerido: 20 por espaço.

**Transferência:** novo tipo de lançamento `transferencia` com conta de origem e de destino. Não conta como receita nem despesa nem compromisso; só move saldo entre contas (total inalterado). Alternativa descartada: dois lançamentos ligados (despesa + receita), porque poluiria relatórios e exigiria exclusões especiais em edição/exclusão de série.

**Vale-refeição:** continua como saldo separado, fora do conceito de conta.

**Casal:** as contas pertencem ao espaço individual de quem as cria, e a visão do casal continua mostrando as contas dos dois juntas, como hoje (quem usa o modo casal já enxerga os dados dos dois nessa visão). Não proponho um espaço novo de "contas compartilhadas"; se isso for desejado, é uma decisão à parte.

## Etapas (cada uma em um PR pequeno e verificável)
Tudo atrás de um recurso desligável (`multiAccount`), usando o mecanismo de `platformFeatures` que já existe. Desligado, o app se comporta como hoje.

1. **Cálculo por conta (sem mudança visível).** Funções puras `calculateAccountBalances` + testes. Teste de equivalência: o total é idêntico ao `calculateSummary` atual nos cenários existentes.
2. **Backend.** `ensurePrimaryAccount` passa a garantir só que exista ao menos uma conta (não junta nem apaga quando o recurso está ligado). `POST/PUT/DELETE` de contas liberados (arquivar). `normalizeAccountIdForSpace` respeita a conta escolhida, validando que pertence ao espaço. A API de contas devolve o saldo calculado.
3. **Tela.** `Contas` lista as contas com saldo; "Nova conta"; seletor de conta no lançamento (padrão: a principal); total na tela inicial.
4. **Transferência.** Tipo `transferencia` no modelo, na validação e fora dos totais; formulário na tela.
5. **ORION.** Contratos de ação ganham `accountId` resolvido por nome ("no Nubank") e a ação de transferência (`ai-actions.js`).

**Ordem crítica:** a etapa 2 precisa desativar a junção automática **antes** de existir qualquer conta extra, senão a próxima leitura apagaria as contas novas.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Cálculo de saldo é o coração do app | Etapa 1 com teste de equivalência; recurso desligado por padrão; só ligar depois de validar |
| A junção automática apagaria contas novas | Etapa 2 primeiro; teste que cria duas contas e confirma que ambas sobrevivem |
| Perda de dados | Backup verificado antes de ligar em produção (o diagnóstico da Fase 0 não confirmou que a restauração foi testada) |
| Relatórios, exportação e plano de dívida usam saldo consolidado | Conferir cada um na etapa 3 (checklist de regressão da Fase 0) |
| Testes atuais assumem conta única (`debt-api`, `finance`, `form-state`, `e2e/financial-flows`) | Continuam passando com o recurso desligado; novos testes para o ligado |
| Transferência apagada ou editada deixa saldo inconsistente | Operação única (origem e destino juntos), coberta por teste |

## Fora do escopo
Cartão de crédito e fatura; conexão automática com bancos (Open Finance); conversão de moeda; extrato importado.

## Decisões que preciso do dono do produto
1. **Excluir conta:** só arquivar quando houver lançamentos (proposta) ou permitir excluir tudo junto?
2. **Limite de contas** por espaço: 20 serve?
3. **Casal:** manter como hoje (cada pessoa cria as próprias contas e o casal vê a soma dos dois) ou criar contas realmente compartilhadas, que seriam um conceito novo? Proposta: manter como hoje.
4. **Ordem de entrega:** esperar o backup verificado antes de ligar em produção (proposta) ou ligar só para o seu usuário em teste primeiro?
