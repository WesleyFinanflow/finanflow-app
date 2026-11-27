# ORION – Fase 0: Diagnóstico e proteção da base

Data: 27/11/2026 · Base analisada: `main` @ `50449df` (merge do PR #12) · Modo: somente leitura (nenhum código do produto foi alterado)

Cobre OR-001 (auditar código e ambientes), OR-002 (backup) e OR-003 (checklist de regressão) do Plano Mestre.

## 1. Veredito

A base é sólida para evoluir. Ela já tem segurança, auditoria, backup agendado, MFA admin, CI e e2e, o que cobre parte da Fase 0. Para fechar a fase faltam três coisas:

1. Provar a restauração do backup (não consegui verificar daqui).
2. Resolver a ambiguidade de deploy (Railway ou Render).
3. Rodar os 29 testes de backend que dependem de MongoDB num ambiente com acesso à rede (CI).

**A Fase 0 ainda não está aceita.** Os critérios do plano exigem inventário assinado, backup restaurado em teste, linha de base funcional e plano de migração aprovado. Os dois primeiros e o último dependem de você.

## 2. Inventário (OR-001)

| Camada | Realidade no código |
|---|---|
| Frontend | React 19 + Vite 8, PWA, ~6,9 mil linhas só de CSS/JS principal; `App.jsx` 2.207 linhas (86 `useState`) |
| Backend | Node + Express 5 + Mongoose 8, `server.js` 1.347 linhas, ~46 rotas no arquivo principal + `admin.js`, `mfa.js` |
| Banco | MongoDB Atlas (coleções: User, Space, Member, Account, Transaction, PurchasePlan, Invite, AuditLog, BackupSnapshot, Session, MerchantCategoryMap, mais admin/cupons/assinaturas/suporte) |
| Auth | Cookie HttpOnly `__Host-` + CSRF, JWT com `passwordVersion`, bcrypt (custo 10), Google OAuth, MFA para admin, rate limit próprio (auth 10/15 min, registro 5/h) |
| Módulos | Finanças individuais e casal por convite, contas, lançamentos com séries/recorrência/parcelas, dívidas e plano de dívida, metas, simulador "posso comprar?", OCR de recibo, exportação CSV/XLSX/PDF, histórico com restauração, cupons/assinaturas, painel admin, suporte |
| Ausente (esperado) | Chat, IA, voz, tarefas, listas, agenda, lembretes, notificações, memória |

### Testes e qualidade (linha de base)

| Verificação | Resultado |
|---|---|
| Frontend `lint` | passou |
| Frontend `test` | **29/29** |
| Frontend `build` | passou (aviso: chunks > 500 kB, `exceljs` 929 kB) |
| Frontend `audit:checked` | passou (0 advisories bloqueantes) |
| Backend `lint` e `build` | passaram |
| Backend `test` | **47 passam, 29 falham** (76 no total) |
| e2e Playwright | não executado aqui (6 testes em 2 arquivos; rodam no CI) |

As **29 falhas do backend têm todas a mesma causa**: o `mongodb-memory-server` não conseguiu baixar o binário do MongoDB (HTTP 403 do proxy do sandbox). Não indicam defeito no código, mas **esses testes não foram validados por mim**. Eles cobrem justamente autorização, MFA, cupons, séries e exclusão de dados, então o CI precisa confirmá-los. Rode `pnpm test` no CI ou localmente antes de qualquer mudança.

Obs.: o ambiente usou Node 22; o projeto declara Node 24.

## 3. Backup e recuperação (OR-002)

Existe:
- Workflow semanal `mongodb-backup.yml`: `mongodump`, restauração em um Mongo descartável, criptografia AES-256 e checagem de integridade, retenção de 30 dias.
- Scripts `backup-mongodb.ps1` e `restore-mongodb.ps1`.
- Snapshots internos por espaço (`BackupSnapshot`) e histórico de auditoria com restauração.

**Não verifiquei** (exige acesso ao GitHub Actions e ao Atlas): se os secrets `MONGODB_URI` e `BACKUP_ENCRYPTION_KEY` estão configurados, se o último backup rodou com sucesso, e se a chave de criptografia está guardada fora do GitHub. Sem isso, não há como afirmar que o backup é recuperável.

Atenção: o backup fica como artifact do GitHub num repositório **público**. O arquivo é criptografado, mas a segurança passa a depender só da força de `BACKUP_ENCRYPTION_KEY`. Vale mover para armazenamento privado.

## 4. Achados e riscos

| # | Achado | Impacto | Sugestão |
|---|---|---|---|
| 1 | **Deploy inconsistente.** README, DEPLOYMENT e `railway.json` dizem Railway. `render.yaml` e o rewrite de `/api` no `vercel.json` apontam para `finanflow-api.onrender.com`. O CORS aponta para `vitalflow.ia.br` | Risco de mexer no serviço errado; rollback incerto | Confirmar qual backend está em produção e remover a config morta |
| 2 | Repositório **público** que lida com dados financeiros | Todo segredo, prompt de IA ou instrução operacional commitada fica exposta | Considerar tornar privado antes de entrar IA/integrações (Fase 1+) |
| 3 | Dois repositórios com nome parecido (`finanflow-app` público, `VitalFlow-Wesley/finanflow` privado, parado desde junho) | Confusão sobre fonte da verdade | Definir o oficial e arquivar o outro |
| 4 | `App.jsx` e `server.js` monolíticos; 5 CSS de "remendo" (`product-fix`, `layout-fix`, `premium-redesign`, `green-wallet-theme`, `finanflow-onboarding`) sobrepostos | Dificulta o design system do ORION (OR-004) e a camada de ferramentas tipadas da IA (OR-005) | Separar serviços de domínio no backend antes da Fase 2; consolidar tokens de design na Fase 1 |
| 5 | `localStorage` ainda guarda `finanflow_user` (e remove `finanflow_token` legado) | Dado pessoal em storage do navegador; resquício do modelo antigo de token | Confirmar que o token não é mais gravado e limpar o legado |
| 6 | bcrypt com custo 10 | Aceitável, mas abaixo do recomendado hoje (12) | Subir o custo no próximo login (rehash) |
| 7 | `AuditLog.before/after` e `BackupSnapshot` usam tipo `Mixed` | Conteúdo financeiro em logs; precisa respeitar minimização/LGPD quando a IA gravar ações | Definir política de retenção e campos permitidos (OR-005) |
| 8 | O modelo de dados é por `Space` (individual/casal), enquanto o plano prevê `households/memberships` | A migração para o modelo ORION precisa mapear Space→household | Definir no plano de migração |
| 9 | Chunks grandes no frontend (`exceljs`, `pdf`, `jspdf`) | Carregamento lento em celular | Já carregam sob demanda; revisar na Fase 1 |

## 5. Checklist de regressão (OR-003)

Fluxos que não podem regredir, derivados das rotas e dos testes existentes. Cada item deve ter teste automatizado ou verificação manual registrada antes de cada release.

**Conta e acesso**
- [ ] Cadastro com consentimento versionado e verificação de e-mail
- [ ] Login por senha, login Google, logout, sessão expirada
- [ ] Recuperação e troca de senha
- [ ] Exclusão de conta com limpeza completa (preservando dívida compartilhada do parceiro)
- [ ] MFA do administrador (cadastro, replay, recuperação)

**Espaços**
- [ ] Espaço individual criado automaticamente
- [ ] Convite de casal: criar, aceitar, sair
- [ ] Isolamento: não-membro e cônjuge não acessam dados privados

**Finanças**
- [ ] Contas: criar, editar, excluir, saldo
- [ ] Lançamentos: criar, editar, excluir, marcar como pago, lembrete
- [ ] Séries/recorrência/parcelas: centavos, fim de mês, sem duplicar em retry, edição atômica
- [ ] Histórico e restauração de lançamento; reset do espaço
- [ ] Dívidas e plano de dívida; metas; reserva mínima; "posso comprar?"
- [ ] Mapa categoria-estabelecimento; OCR de recibo
- [ ] Exportação CSV/XLSX/PDF

**Plataforma**
- [ ] Cupons (limites concorrentes, rollback atômico), assinaturas e expiração de trial
- [ ] Recursos desligados pelo admin bloqueados na API
- [ ] Painel admin, suporte, exportação administrativa
- [ ] PWA instalável e service worker
- [ ] `/api/health` e `/api/ready`

## 6. O que preciso de você para fechar a Fase 0

1. **Qual backend está em produção:** Railway ou Render? E o repositório oficial?
2. **Backup:** o último workflow "Backup semanal do MongoDB" passou? Se quiser, faça um disparo manual e me diga o resultado; o teste de restauração mensal também precisa de registro.
3. **Ambiente de homologação:** existe um banco e um deploy separados de produção? Se não, sugiro criar (Atlas free + preview da Vercel).
4. **Acesso de escrita:** a sessão não consegue dar push em `finanflow-app` porque o GitHub App da Claude não está instalado nele. Para eu abrir PRs, instale-o em https://github.com/apps/claude/installations/select_target.
5. **CI:** rodar `quality.yml` para validar os 29 testes de backend que aqui ficaram bloqueados.

## 7. Próximos passos (após a Fase 0)

1. Fase 1 / OR-004: consolidar os CSS em tokens e componentes ORION (identidade já definida).
2. OR-005: desenhar os contratos tipados das ações da IA (criar lançamento, consultar saldo etc.) reutilizando as funções de domínio já existentes, com idempotência (as séries já têm).
3. Extrair serviços de domínio de `server.js` em incrementos pequenos, com os testes existentes como rede de segurança.
