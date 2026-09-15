import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CircleDollarSign, FileText, HandCoins, Plus, RefreshCw, ShieldCheck, Target, TriangleAlert, WalletCards } from "lucide-react";
import "./debt-plan.css";
import "./debt-plan-status.css";

const money = cents => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = month => month ? new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`)) : "Sem previsão";
const strategies = { recommended: "Recomendado pelo FinanFlow", avalanche: "Avalanche", snowball: "Bola de neve" };
const statuses = { ACTIVE: "Em dia", OVERDUE: "Atrasada", NEGATIVE_LISTED: "Negativada", PROTESTED: "Protestada", ACTIVE_DEBT: "Inscrita em dívida ativa", NEGOTIATED: "Negociada", PAID: "Quitada" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
function usePlan(api, spaceId) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  const base = `/api/spaces/${spaceId}`;
  const load = async () => {
    const request = ++generation.current;
    setError("");
    try { const result = await api(`${base}/debt-plan`); if (request === generation.current) setData(result); }
    catch (e) { if (request === generation.current) setError(e.message); }
  };
  useEffect(() => { if (spaceId) load(); return () => { generation.current++; }; }, [spaceId]);
  const mutate = async (path, body = {}, method = "POST") => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    const request = ++generation.current;
    try {
      const result = await api(`${base}${path}`, { method, body: JSON.stringify({ ...body, revision: data.revision }) });
      if (request === generation.current) setData(result);
      return true;
    } catch (e) { if (request === generation.current) setError(e.message); return false; }
    finally { lock.current = false; if (request === generation.current) setBusy(false); }
  };
  return { data, error, busy, load, mutate };
}
function Progress({ value, label }) {
  return <div className="dp-progress"><progress max="100" value={value} aria-label={label} /><span>{Math.round(value)}%</span></div>;
}
function Kpi({ label, value, tone = "", icon: Icon }) {
  return <article className={`dp-kpi ${tone}`}>{Icon && <span className="dp-kpi-icon"><Icon size={24} /></span>}<div><small>{label}</small><strong>{value}</strong></div></article>;
}
export function DebtPlanReport({ api, spaceId }) {
  const { data, error, load } = usePlan(api, spaceId);
  return <section className="panel debt-plan dp-report"><h2>Plano de quitação de dívidas</h2>
    {error ? <p role="alert">{error} <button onClick={load}>Tentar novamente</button></p> : !data ? <p role="status">Carregando plano…</p> : <>
      <p>Posição atual · {data.spaceType === "couple" ? "Plano compartilhado do casal" : "Espaço individual"} · {strategies[data.strategy]}</p>
      <div className="dp-grid"><Kpi label="Total inicial" value={money(data.summary.original)} /><Kpi label="Total restante" value={money(data.summary.remaining)} /><Kpi label="Valor pago" value={money(data.summary.paid)} /><Kpi label="Descontos negociados" value={money(data.summary.negotiatedDiscount)} /><Kpi label="Dívidas quitadas / restantes" value={`${data.summary.paidCount} / ${data.summary.active}`} /><Kpi label="Previsão de término" value={dateLabel(data.simulation.endDate)} /></div>
      <Progress value={data.summary.progress} label="Percentual concluído" />
      {!data.simulation.ratesKnown && <p>Previsão provisória: há dívidas sem taxa de juros informada.</p>}
    </>}
  </section>;
}
export default function DebtPlanPage({ api, spaceId, currentUserId, back, embedded = false, monthlyOnly = false, openMonthly }) {
  const { data, error, busy, load, mutate } = usePlan(api, spaceId);
  const [modal, setModal] = useState(null), [filter, setFilter] = useState("all"), [typeFilter, setTypeFilter] = useState("all"), [payment, setPayment] = useState(""), [monthsVisible, setMonthsVisible] = useState(6);
  const monthlyView = monthlyOnly;
  useEffect(() => { if (data) setPayment(data.userPayment == null ? "" : String(data.userPayment / 100)); }, [data]);
  return <section className={`debt-plan ${monthlyView ? "dp-monthly" : "dp-overview"}`}>
    {(monthlyView || !embedded) && <header className="dp-header"><div>{!embedded && <button className="ghost-button" onClick={back}><ArrowLeft size={16} /> Planejamento</button>}<span className="eyebrow">Um passo de cada vez</span><h2>{monthlyView ? "Plano mensal para quitar dívidas" : "Plano para sair das dívidas"}</h2><p>{monthlyView ? "Acompanhe os pagamentos previstos e atualize o plano quando necessário." : "Organize prioridades e acompanhe seu caminho até a quitação."}</p></div><button onClick={() => setModal({ type: "add" })} disabled={!data || busy}><Plus size={18} />Adicionar dívida</button></header>}
    {error && <div className="dp-notice danger" role="alert">{error} <button onClick={load}>Recarregar plano</button></div>}
    {!data ? !error && <div className="panel" role="status">Carregando seu plano…</div> : <>
      {!monthlyView && <section className="panel dp-overview-panel"><div className="dp-overview-title"><h2>Plano para sair das dívidas</h2><p>Organize sua saída das dívidas com estratégia, prioridade e previsão de quitação.</p></div><div className="dp-grid dp-overview-grid"><Kpi icon={CircleDollarSign} label="Total em dívidas" value={money(data.summary.remaining)} tone="danger" /><Kpi icon={WalletCards} label="Parcelas mensais" value={money(data.summary.monthlyCommitment)} /><Kpi icon={FileText} label="Dívidas ativas" value={data.summary.active} /><Kpi icon={TriangleAlert} label="Em atraso" value={data.summary.overdue} tone={data.summary.overdue ? "danger" : ""} /><Kpi icon={Target} label="Valor sugerido pelo FinanFlow" value={money(data.suggestedPayment)} tone="positive" /><Kpi icon={WalletCards} label="Valor que eu posso pagar" value={data.userPayment == null ? "Não informado" : money(data.userPayment)} /></div></section>}
      {data.status === "EMPTY" ? <div className="panel dp-empty"><HandCoins size={38} /><h2>Você ainda não cadastrou dívidas.</h2><p>Registre uma dívida para montar seu plano.</p><button onClick={() => setModal({ type: "add" })}>Adicionar primeira dívida</button></div> : data.status === "COMPLETED" && <div className="dp-notice positive"><Check /><h2>Parabéns! Você está sem dívidas.</h2><p>Seu histórico continua disponível abaixo.</p></div>}
      {!monthlyView && <section className="panel dp-plan-settings"><div className="dp-section-head"><div><span className="eyebrow">Estratégia</span><h2>Escolha a estratégia que melhor se adapta a você.</h2></div><button className="ghost-button" disabled={busy} onClick={() => mutate("/debt-plan/recalculate")}><RefreshCw size={16} />Atualizar dados</button></div>
        <div className="dp-notice"><ShieldCheck size={22} /><div><strong>Você pode direcionar até {money(data.capacity.recommended)} neste mês sem ultrapassar seu limite protegido.</strong><p>A estimativa usa receitas recebidas, obrigações e reserva de {money(data.capacity.protectedAmount)}. Confirme novamente a cada mês.</p></div></div>
        {data.spaceType === "couple" && <p className="dp-muted">Este plano inclui apenas dívidas deste espaço. Os dados privados individuais não são importados. A capacidade usa somente valores registrados no espaço compartilhado.</p>}
        <details><summary>Como calculamos o valor disponível</summary><dl className="dp-facts"><div><dt>Receitas realizadas no mês</dt><dd>{money(data.capacity.received)}</dd></div><div><dt>Obrigações já pagas no mês</dt><dd>{money(data.capacity.paid)}</dd></div><div><dt>Obrigações pendentes e atrasadas</dt><dd>{money(data.capacity.pending)}</dd></div><div><dt>Compromissos conhecidos do próximo mês</dt><dd>{money(data.capacity.future)}</dd></div><div><dt>Parcelas exclusivas do plano</dt><dd>{money(data.capacity.unlinkedMinimums)}</dd></div><div><dt>Saldo disponível após proteção</dt><dd>{money(data.capacity.safeFree)}</dd></div></dl></details>
        <form className="dp-settings" onSubmit={async e => { e.preventDefault(); await mutate("/debt-plan", { strategy: data.strategy, monthlyPaymentAmount: payment === "" ? null : payment, generate: true }, "PUT"); }}>
          <label>Valor que eu posso pagar por mês (R$)<input type="number" value={payment} onChange={e => setPayment(e.target.value)} min="0" step="0.01" placeholder="Ex.: 400,00" /></label><button disabled={busy}>Salvar valor</button>
        </form>
        {data.budgetWarning && <p className="dp-notice warning">Seu valor informado está acima da capacidade protegida atual. O plano simula sua escolha, mas não altera a proteção financeira do FinanFlow.</p>}{data.belowMinimums && <p className="dp-notice danger">O valor informado não cobre todas as parcelas mínimas; o plano distribui o orçamento sem ultrapassar o valor escolhido.</p>}
        <div className="dp-strategies" aria-label="Estratégia">{Object.entries(strategies).map(([key, label]) => <button key={key} className={data.strategy === key ? "selected" : ""} aria-pressed={data.strategy === key} disabled={busy} onClick={() => mutate("/debt-plan", { strategy: key, monthlyPaymentAmount: payment === "" ? null : payment }, "PUT")}><strong>{label}</strong><small>{key === "avalanche" ? "Quita primeiro as dívidas com maiores juros." : key === "snowball" ? "Quita primeiro as dívidas de menor valor." : "Equilíbrio entre juros, prazos, atrasos e impacto."}</small></button>)}</div>
        <details><summary>Entenda a prioridade recomendada</summary><p>Pesos centralizados: juros, dias e valor em atraso, negativação, protesto, inscrição em dívida ativa, parcela frente ao orçamento protegido e saldo. Dívidas quitadas não entram. Uma dívida antiga sem restrições informadas recebe peso menor, sem qualquer conclusão jurídica.</p></details>
        {!monthlyView && <button onClick={async()=>{if(await mutate("/debt-plan",{strategy:data.strategy,monthlyPaymentAmount:payment===""?null:payment,generate:true},"PUT"))openMonthly?.()}}>{data.generated ? "Ver plano mensal" : "Gerar plano"}</button>}
      </section>}
      {monthlyView && <section className="panel dp-monthly-summary"><div className="dp-section-head"><div><span className="eyebrow">Estratégia sugerida</span><h2>{strategies[data.strategy]}</h2></div><button className="ghost-button" disabled={busy} onClick={() => mutate("/debt-plan/recalculate")}><RefreshCw size={16} />Recalcular plano</button></div><div className="dp-grid"><Kpi label="Valor sugerido pelo FinanFlow" value={money(data.suggestedPayment)} tone="positive" /><Kpi label="Valor que eu posso pagar" value={data.userPayment == null ? "Não informado" : money(data.userPayment)} /><Kpi label="Quitação seguindo a sugestão" value={dateLabel(data.comparison.suggestedEndDate)} tone="positive" /><Kpi label="Quitação com meu valor" value={dateLabel(data.comparison.userEndDate)} /></div>{data.comparison.userMonths != null && data.comparison.suggestedMonths != null && data.comparison.userMonths > data.comparison.suggestedMonths && <p className="dp-notice">Seguindo a sugestão do FinanFlow, a quitação ocorre cerca de {data.comparison.userMonths - data.comparison.suggestedMonths} mês(es) antes.</p>}</section>}
      {monthlyView && data.status !== "EMPTY" && <section className="panel"><h2>Meu caminho até ficar sem dívidas</h2><p>Estratégia: {strategies[data.strategy]} · Prioritária: {data.debts.find(d=>d.currentBalance>0)?.name || "Nenhuma"}</p><p>Com o valor sugerido: {dateLabel(data.comparison.suggestedEndDate)} ({data.comparison.suggestedMonths ?? "—"} meses). Com o valor informado: {dateLabel(data.comparison.userEndDate)} ({data.comparison.userMonths ?? "—"} meses).</p><p>{money(data.summary.paid)} pagos e {money(data.summary.negotiatedDiscount)} em descontos de {money(data.summary.original)} iniciais.</p><Progress value={data.summary.progress} label="Dívidas quitadas" />
        <div className="dp-grid"><Kpi label="Meses restantes" value={data.simulation.monthsRemaining ?? "Indeterminado"} /><Kpi label="Juros futuros estimados" value={data.simulation.estimatedInterest == null ? "Indisponível" : money(data.simulation.estimatedInterest)} /><Kpi label="Economia estimada de juros" value={data.savings == null ? "Indisponível" : money(data.savings)} /></div>
        {!data.simulation.ratesKnown && <p className="dp-notice warning">Economia de juros indisponível. Informe as taxas das dívidas para calcular. A previsão considera apenas o saldo informado nas dívidas sem taxa.</p>}
        {data.simulation.ratesKnown && data.savings == null && <p>Economia indisponível: não foi possível concluir a simulação de referência.</p>}
        {!data.simulation.complete && <p className="dp-notice danger">{data.simulation.reason === "insufficient_payment" ? "Os pagamentos não reduzem o saldo. Revise as parcelas ou negocie as dívidas." : "Não foi possível projetar a quitação dentro do limite de 600 meses e dos valores suportados."}</p>}
        <p className="dp-muted">Simulação mensal com juros sobre o saldo inicial, pagamentos ao fim do mês e orçamento constante. Não inclui multas desconhecidas nem novas dívidas. A economia compara o plano com o pagamento apenas das parcelas, sem transferência entre dívidas.</p>
        {data.fasterBy100 > 0 && <p className="dp-notice">Se houver capacidade adicional de R$ 100 por mês, a simulação antecipa a quitação em {data.fasterBy100} mês(es).</p>}
        {data.summary.active === 1 && <p className="dp-notice positive">Falta apenas 1 dívida.</p>}
      </section>}
      {!monthlyView && data.spaceType === "couple" && <section className="panel"><h2>Plano compartilhado</h2><p>Total do casal: {money(data.summary.remaining)} · Compartilhadas: {money(data.debts.filter(d => d.shared).reduce((s, d) => s + d.currentBalance, 0))}</p><div className="dp-grid">{data.members.map(m => { const total = data.debts.filter(d => !d.shared && d.ownerUserId === m.id).reduce((s, d) => s + d.currentBalance, 0); return <Kpi key={m.id} label={`${m.name} · ${data.summary.remaining ? Math.round(total / data.summary.remaining * 100) : 0}% do total`} value={money(total)} />; })}</div><p className="dp-muted">Dívidas compartilhadas são exibidas separadamente, sem atribuir percentuais arbitrários às pessoas.</p></section>}
      {!monthlyView && <section className="panel"><div className="dp-section-head"><h2>Ordem de ataque</h2><label>Situação<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas</option><option value="ACTIVE">Em dia</option><option value="OVERDUE">Atrasadas</option><option value="NEGATIVE_LISTED">Negativadas</option><option value="PROTESTED">Protestadas</option><option value="ACTIVE_DEBT">Dívida ativa</option><option value="NEGOTIATED">Negociadas</option><option value="PAID">Quitadas</option><option value="old">Dívidas antigas</option>{data.spaceType === "couple"&&<option value="shared">Compartilhadas</option>}{data.spaceType === "couple"&&data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Tipo<select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">Todos os tipos</option>{Object.entries(data.catalog.types).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="dp-debts"><div className="dp-table-head" aria-hidden="true"><span>#</span><span>Dívida</span><span>Situação</span><span>Saldo devedor</span><span>Parcela</span><span>Juros (a.m.)</span><span>Previsão de quitação</span><span>Progresso</span></div>{data.debts.filter(d => (filter === "all" || filter === "old" ? filter !== "old" || d.isOldDebt : filter === "shared" ? d.shared : Object.keys(statuses).includes(filter) ? d.status === filter || (filter === "OVERDUE" && d.isOverdue) || (filter === "NEGATIVE_LISTED" && d.isNegativeListed) || (filter === "PROTESTED" && d.isProtested) || (filter === "ACTIVE_DEBT" && d.isActiveDebt) : !d.shared && d.ownerUserId === filter) && (typeFilter === "all" || d.debtType === typeFilter)).map(debt => {
          const canEdit = debt.shared || debt.ownerUserId === String(currentUserId), position = data.debts.indexOf(debt) + 1;
          const dueIn = Math.round((Date.parse(debt.dueDate) - Date.parse(today())) / 86400000);
          const progress = debt.originalBalance ? Math.min(100, Math.max(0, (debt.originalBalance - debt.currentBalance) / debt.originalBalance * 100)) : 0;
          return <article key={debt.id} className={`dp-debt ${debt.status === "OVERDUE" ? "overdue" : ""}`}>
            <div className="dp-section-head"><h3><span className="dp-rank">{debt.status === "PAID" ? "✓" : position}</span>{debt.name}</h3><span className={`dp-badge ${debt.status.toLowerCase()}`}>{statuses[debt.status]}</span></div>
            <strong className="dp-amount">{money(debt.currentBalance)}</strong><p className="dp-installment">{money(debt.minimumPayment)}</p><p className="dp-interest">{debt.interestRateMonthly == null ? "não informado" : `${debt.interestRateMonthly}% a.m.`}</p><p className="dp-forecast">{debt.status === "PAID" ? "Quitada" : dateLabel(debt.payoffDate)}</p><div className="dp-chips">{debt.isOverdue&&<span>Em atraso</span>}{debt.isNegativeListed&&<span>CPF com restrição</span>}{debt.isProtested&&<span>Protesto ativo</span>}{debt.isActiveDebt&&<span>Dívida ativa</span>}{debt.isOldDebt&&<span>Dívida antiga</span>}</div>
            <Progress value={progress} label={`Progresso de ${debt.name}`} />
            {debt.overdueDays > 0 && <p className="dp-critical">Atrasada há {debt.overdueDays} dia(s) · Vencida desde {new Date(`${debt.originalDueDate||debt.dueDate}T12:00:00Z`).toLocaleDateString("pt-BR")}</p>}{debt.isOldDebt&&<p className="dp-muted">Vencida há mais de 5 anos. Verifique as condições atuais de cobrança e negociação.</p>}
            {debt.currentBalance > 0 && dueIn >= 0 && dueIn <= 3 && <p className="dp-critical">{dueIn === 0 ? "Sua parcela vence hoje." : `Sua parcela vence em ${dueIn} dia(s).`}</p>}
            {debt.currentBalance > 0 && debt.interestRateMonthly > 0 && debt.interestRateMonthly === Math.max(...data.debts.filter(d => d.currentBalance > 0).map(d => d.interestRateMonthly ?? 0)) && <p>Esta dívida tem a maior taxa de juros entre as cadastradas.</p>}
            {debt.sourceRecurring && <p className="dp-notice warning">Lançamento recorrente: confirme se o saldo cadastrado representa toda a dívida.</p>}
            {debt.sourceMissing && <p className="dp-notice warning">Lançamento de origem não encontrado. Confira o saldo salvo antes de usar a previsão.</p>}
            <div className="dp-actions"><button className="ghost-button" onClick={() => setModal({ type: "details", debt, canEdit })}>Ver detalhes</button>{canEdit && debt.status !== "PAID" && <><button className="ghost-button" disabled={busy} onClick={() => setModal({ type: "negotiate", debt })}>Negociar</button><button disabled={busy} onClick={() => setModal({ type: "paid", debt })}>Marcar como quitada</button></>}</div>
          </article>;
        })}</div>
      </section>}
      {monthlyView && data.simulation.months.length > 0 && <section className="panel"><h2>Próximos pagamentos</h2><p>Os valores abaixo são uma simulação. Registre os pagamentos efetivos nos lançamentos habituais.</p>{data.simulation.months.slice(0, monthsVisible).map((month, i) => <details className="dp-month" key={month.month} open={i === 0}><summary>{dateLabel(month.month)} · {money(month.rows.reduce((s, r) => s + r.normal + r.extra, 0))}</summary>{month.rows.map(row => <div className="dp-payment" key={row.debtId}><strong>{row.name}</strong><span>Pagamento normal: {money(row.normal)}</span><span>Pagamento extra: {money(row.extra)}</span><span>Saldo final: {money(row.closingBalance)}{row.closingBalance === 0 ? " · Quitada" : ""}</span></div>)}<p>Sobra após distribuir os pagamentos: {money(month.unused)}. Valores liberados são destinados à próxima dívida na ordem do plano.</p></details>)}{monthsVisible < data.simulation.months.length && <button className="ghost-button" onClick={() => setMonthsVisible(n => n + 6)}>Mostrar mais 6 meses</button>}</section>}
      {modal && <DebtDialog key={`${modal.type}-${modal.debt?.id || "new"}`} modal={modal} close={() => setModal(null)} data={data} currentUserId={currentUserId} busy={busy} mutate={mutate} setModal={setModal} />}
    </>}
  </section>;
}
function DebtDialog({ modal, close, data, currentUserId, busy, mutate, setModal }) {
  const dialog = useRef(null), debt = modal.debt;
  const [localError, setLocalError] = useState("");
  useEffect(() => { dialog.current.showModal(); const previous = document.activeElement; return () => previous?.focus?.(); }, []);
  const submit = async e => {
    e.preventDefault(); setLocalError("");
    const form = new FormData(e.currentTarget), body = Object.fromEntries(form);
    body.shared = body.shared === "on";
    const path = modal.type === "negotiate" ? `/debts/${encodeURIComponent(debt.id)}/negotiate` : modal.type === "edit" ? `/debts/${encodeURIComponent(debt.id)}/update` : "/debts";
    if (await mutate(path, body)) close(); else setLocalError("Não foi possível salvar. Confira a mensagem no plano e recarregue se necessário.");
  };
  const field = (name, label, options = {}) => <label key={name}>{label}<input name={name} defaultValue={options.value ?? debt?.[name] ?? ""} {...Object.fromEntries(Object.entries(options).filter(([k]) => k !== "value"))} /></label>;
  const currency = (name, label, value) => field(name, label, { type: "number", min: "0", max: "1000000000000", step: "0.01", required: true, value: value == null ? "" : String(value / 100), readOnly: modal.type === "edit" && debt?.sourceKey && !debt.balanceOverride });
  return <dialog className="dp-dialog debt-plan" ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else close(); }} aria-labelledby="dp-dialog-title"><div className="dp-section-head"><h2 id="dp-dialog-title">{modal.type === "add" ? "Adicionar dívida" : modal.type === "negotiate" ? "Negociar dívida" : modal.type === "paid" ? "Confirmar quitação" : modal.type === "edit" ? "Editar dívida" : debt.name}</h2><button className="ghost-button" disabled={busy} onClick={close} aria-label="Fechar">×</button></div>
    {localError && <p role="alert" className="dp-critical">{localError}</p>}
    {modal.type === "paid" ? <><p>Confirmar que o saldo de {money(debt.currentBalance)} de {debt.name} foi quitado?</p><p>Isso atualiza o plano e preserva o histórico. Para refletir a saída no saldo da conta, registre o pagamento nos lançamentos.</p><button disabled={busy} onClick={async () => { if (await mutate(`/debts/${encodeURIComponent(debt.id)}/mark-paid`)) close(); else setLocalError("Não foi possível confirmar. Recarregue o plano."); }}>Confirmar quitação</button></> : modal.type === "details" ? <>
      <dl className="dp-facts">{[["Tipo", data.catalog.types[debt.debtType]], ["Situação principal", statuses[debt.status]], ["Descrição", debt.description], ["Valor original", money(debt.originalBalance)], ["Saldo atual", money(debt.currentBalance)], ["Parcela", money(debt.minimumPayment)], ["Juros mensais", debt.interestRateMonthly == null ? "Não informados" : `${debt.interestRateMonthly}%`], ["Vencimento original", debt.originalDueDate || debt.dueDate], ["Negativação", debt.negativeListingActive], ["Origem", debt.negativeListingSource], ["Protesto", debt.protestActive], ["Dívida ativa", debt.activeDebtRegistered], ["Credor", debt.creditor], ["Órgão", debt.creditorAgency], ["Cartório", debt.notaryName], ["Responsável", debt.shared ? "Compartilhada" : data.members.find(m => m.id === debt.ownerUserId)?.name], ["Observações", debt.notes]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
      {debt.sourceKey && <p>Vinculada a lançamentos existentes. {debt.balanceOverride ? "O saldo do plano segue a negociação ou quitação registrada." : "O saldo acompanha os pagamentos registrados na origem."}</p>}
      <h3>Histórico de negociações</h3>{debt.negotiations?.length ? debt.negotiations.map((n, i) => <div className="dp-notice" key={i}><div><strong>{n.negotiatedAt}</strong><p>{money(n.previousBalance)} → {money(n.negotiatedBalance)} · Desconto: {money(n.discountAmount)}</p><p>Parcela: {money(n.previousInstallment)} → {money(n.newInstallment)} · Juros: {n.newInterestRate == null ? "não informados" : `${n.newInterestRate}% a.m.`}</p><p>{n.notes}</p></div></div>) : <p>Nenhuma negociação registrada.</p>}
      {modal.canEdit && <button onClick={() => setModal({ type: "edit", debt })}>Editar dados</button>}
    </> : <form onSubmit={submit}><fieldset disabled={busy} className="dp-form">
      {modal.type !== "negotiate" && <>{field("name", "Nome", { required: true, maxLength: 160 })}{field("description", "Descrição", { maxLength: 300 })}{currency("originalBalance", "Valor original (R$)", debt?.originalBalance)}</>}
      {modal.type === "negotiate" && <p>Valor atual: {money(debt.currentBalance)}. O desconto será calculado ao salvar.</p>}
      {currency("currentBalance", modal.type === "negotiate" ? "Novo saldo negociado (R$)" : "Saldo devedor atual (R$)", debt?.currentBalance)}
      {currency("minimumPayment", modal.type === "negotiate" ? "Nova parcela (R$)" : "Parcela mensal (R$)", debt?.minimumPayment)}
      {field("interestRateMonthly", "Juros mensais (%) — opcional", { type: "number", min: 0, max: 1000, step: "0.000001" })}
      {modal.type !== "negotiate" && field("interestRateAnnual", "Juros anuais (%) — referência opcional", { type: "number", min: 0, max: 1000, step: "0.000001" })}
      {field("dueDate", modal.type === "negotiate" ? "Novo vencimento" : "Próximo vencimento", { type: "date", required: true })}
      {field("remainingInstallments", modal.type === "negotiate" ? "Novo número de parcelas" : "Parcelas restantes", { type: "number", min: 0, max: 1200, step: 1 })}
      {modal.type === "negotiate" ? field("negotiatedAt", "Data da negociação", { type: "date", required: true, value: today() }) : <>
        {field("totalInstallments", "Total de parcelas", { type: "number", min: 0, max: 1200, step: 1 })}
        <label>Tipo da dívida<select name="debtType" defaultValue={debt?.debtType || "OTHER"}>{Object.entries(data.catalog.types).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>Situação da dívida<select name="status" defaultValue={debt?.status || "ACTIVE"}>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        {field("originalDueDate", "Data de vencimento original", { type: "date", value: debt?.originalDueDate || debt?.dueDate })}{field("firstOverdueDate", "Data do primeiro atraso", { type: "date" })}
        <label>Negativação do CPF<select name="negativeListingActive" defaultValue={debt?.negativeListingActive || "UNKNOWN"}><option value="YES">Sim</option><option value="NO">Não</option><option value="UNKNOWN">Não sei</option></select></label><label>Origem da negativação<select name="negativeListingSource" defaultValue={debt?.negativeListingSource || "UNSPECIFIED"}><option value="UNSPECIFIED">Não informado</option><option value="SERASA">Serasa</option><option value="SPC">SPC</option><option value="BOA_VISTA">Boa Vista</option><option value="OTHER">Outro</option></select></label>
        {field("negativeListingDate", "Data da negativação", { type: "date" })}{field("negativeListingEndDate", "Fim da negativação", { type: "date" })}
        <label>Protesto ativo<select name="protestActive" defaultValue={debt?.protestActive || "UNKNOWN"}><option value="YES">Sim</option><option value="NO">Não</option><option value="UNKNOWN">Não sei</option></select></label><label>Inscrita em dívida ativa<select name="activeDebtRegistered" defaultValue={debt?.activeDebtRegistered || "UNKNOWN"}><option value="YES">Sim</option><option value="NO">Não</option><option value="UNKNOWN">Não sei</option></select></label>
        {field("notaryName", "Cartório", { maxLength: 160 })}{field("notaryCity", "Cidade do cartório", { maxLength: 160 })}{field("notaryState", "UF do cartório", { maxLength: 2 })}{field("protestDate", "Data do protesto", { type: "date" })}{field("creditorAgency", "Órgão credor", { maxLength: 160 })}<label>Esfera da dívida ativa<select name="activeDebtLevel" defaultValue={debt?.activeDebtLevel || "OTHER"}><option value="MUNICIPAL">Municipal</option><option value="STATE">Estadual</option><option value="FEDERAL">Federal</option><option value="OTHER">Outra</option></select></label>{field("registrationNumber", "Número de inscrição", { maxLength: 160 })}{field("processNumber", "Número do processo", { maxLength: 160 })}
        {field("creditor", "Credor", { maxLength: 160 })}{field("category", "Categoria", { maxLength: 50 })}{field("startDate", "Data de início", { type: "date" })}{field("expectedEndDate", "Término previsto no contrato", { type: "date" })}
        {data.spaceType === "couple" && <><label><input type="checkbox" name="shared" defaultChecked={debt?.shared} />Dívida compartilhada</label><label>Responsável<select name="ownerUserId" defaultValue={debt?.ownerUserId || currentUserId} disabled={modal.type === "edit"}>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p>Esta dívida ficará visível às pessoas deste espaço. Cadastre dívidas privadas no espaço Individual.</p></>}
      </>}
      <label className="dp-full">Observações<textarea name="notes" defaultValue={modal.type === "negotiate" ? "" : debt?.notes || ""} maxLength={1000} /></label>
      <p className="dp-full dp-muted">Taxas desconhecidas podem ficar vazias. A simulação usa apenas a taxa mensal informada. O cadastro do plano não movimenta o saldo das contas.</p>
      <button className="dp-full" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
    </fieldset></form>}
  </dialog>;
}
