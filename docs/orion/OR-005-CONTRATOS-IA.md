# OR-005 – Contratos das ações da IA

Implementação: `backend/src/ai-actions.js` (testes: `backend/src/ai-actions.test.js`). Módulo puro: não acessa banco nem provedor de IA. A execução real é o OR-008.

## Princípio
A IA não escreve no banco. Ela **propõe** uma ação nomeada com campos tipados; o sistema valida, decide e só então executa por código já existente (validação, autorização, idempotência e auditoria).

## Ações da primeira versão
| Ação | Acesso | Risco | Observação |
|---|---|---|---|
| `create_transaction` | escrita | baixo | só receita/despesa avulsas; sem parcelas nem contas fixas |
| `set_transaction_status` | escrita | baixo | pago ↔ pendente |
| `delete_transaction` | escrita | alto | **sempre confirma**; avisa que a série inteira é excluída; restaurável pelo histórico só por quem criou |
| `list_transactions` | leitura | – | limite padrão 20, máximo 50 |
| `get_summary` | leitura | – | mês AAAA-MM, padrão mês atual |

## Decisão para cada proposta (`evaluateAction`)
Ordem de avaliação: 1) ação desconhecida → `deny`; 2) sem permissão de leitura/escrita → `deny`; 3) escrita sem `requestId` → `deny`; 4) campo não permitido ou valor inválido → `invalid`; 5) campo obrigatório ausente → `clarify` (pergunta só o que falta); 6) regra de revisão → `confirm`; 7) caso contrário → `execute`.

Regras que pedem confirmação em `create_transaction` (valores padrão, ajustáveis por contexto):
- valor acima de R$ 5.000;
- data a mais de 366 dias de hoje;
- possível duplicidade (informada pelo chamador, que consulta o banco).

## Garantias de segurança (cobertas por testes)
- Nenhum contrato aceita usuário, espaço, papel ou token: a identidade vem do contexto autenticado, nunca do modelo.
- Esquemas estritos: campo desconhecido é rejeitado, não ignorado.
- Tipos são verificados: valor deve ser número (nada de `"150,50"`), texto não pode ser objeto (evita injeção de operadores), ids precisam ter formato de id real, datas precisam existir.
- Rejeitado nunca devolve `input` executável.
- Toda escrita exige `requestId`. `deriveRequestId` gera `orion:<hash>` determinístico por (conversa, mensagem, posição), com no máximo 80 caracteres, reaproveitando a idempotência de `Transaction.requestId`.
- `buildActionLog` monta o registro de auditoria sem o texto livre `notes`.
- `toToolDefinitions()` exporta JSON Schema neutro de provedor.

## Decisões minhas a validar
- Limites de confirmação (R$ 5.000 e 366 dias) são sugestões.
- Valores monetários com no máximo 2 casas decimais.
- Interpretar "150,50" ou "sexta-feira" é trabalho do interpretador (Fase 2): o contrato exige número e data já resolvidos.

## Lacunas conhecidas
- **Transferência entre contas não existe no modelo** (tipos: receita, despesa, dívida, meta), embora o Plano Mestre a cite na Fase 2. Precisa de decisão de produto e de modelo.
- Parcelamento, conta fixa mensal, dívidas e metas ficam fora desta versão (geram vários registros ou têm regras próprias).
- Edição de lançamento (`PUT`) e restauração pelo histórico ainda não têm contrato.
- A UX de confirmação (texto, botões, expiração do pedido pendente) não está definida.
- O mapeamento de cada ação para as rotas/funções de domínio, e a persistência de `assistant_conversations`/`action_logs`, entram no OR-008.
