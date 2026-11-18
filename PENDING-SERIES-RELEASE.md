# Edição de parcelas pendentes

Regra escolhida pelo proprietário: a parcela selecionada e as pendentes seguintes. Pagamentos concluídos e parcelas anteriores não são alterados. Para usar o fluxo, selecionar uma parcela pendente e clicar em Editar.

- O endpoint PATCH pending-series mantém IDs, série, frequência e quantidade. Não remove nem recria registros.
- Valor, descrição, categoria, conta, origem do saldo e demais dados editáveis valem para os alvos pendentes. O status escolhido vale apenas para a parcela selecionada; as outras continuam pendentes.
- A nova data define a âncora mensal. As posições ocupadas por pagamentos concluídos são respeitadas, sem deslocá-los. A regra de final de mês é mantida.
- Registros concluídos, incluindo seu total histórico, ficam intactos. A interface calcula o total atual da série a partir dos valores de todas as parcelas, e os registros pendentes atualizados recebem esse total.
- Uma fotografia dos identificadores, timestamps e revisões detecta mudanças em outra aba. Em conflito, retorna 409 e solicita recarregar.
- Todas as alterações e o histórico são gravados na mesma transação MongoDB. Falha na auditoria desfaz o lote. O fluxo não grava contas fora dessa transação.
- Autoria e permissões do espaço continuam obrigatórias. Alterar frequência ou quantidade exige outro fluxo; a reconstrução antiga continua bloqueada quando há outros pagamentos concluídos.

Os testes usam banco descartável e contas fictícias, incluindo concorrência, falha de auditoria, recorrência mensal, parcelas pagas intercaladas e navegação em desktop/celular. Não há migração nem correção automática de históricos já alterados por versões antigas.
