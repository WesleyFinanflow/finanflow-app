import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, HandCoins, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import "./debt-plan.css";

const money = cents => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = month => month ? new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`)) : "Sem previsão";
const strategies = { recommended: "Recomendado pelo FinanFlow", avalanche: "Avalanche", snowball: "Bola de neve" };
const statuses = { ACTIVE: "Ativa", OVERDUE: "Em atraso", NEGOTIATED: "Negociada", PAID: "Quitada" };
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
function Kpi({ label, value, tone = "" }) {
  return <article className={`dp-kpi ${tone}`}><small>{label}</small><strong>{value}</strong></article>;
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
export default function DebtPlanPage({ api, spaceId, currentUserId, back }) {
  const { data, error, busy, load, mutate } = usePlan(api, spaceId);
  const [modal, setModal] = useState(null), [filter, setFilter] = useState("all"), [extra, setExtra] = useState(""), [monthsVisible, setMonthsVisible] = useState(6);
  const [custom, setCustom] = useState(false);
  useEffect(() => { if (data) { setExtra(String(data.requestedExtra / 100)); setCustom(data.requestedExtra !== data.capacity.recommended); } }, [data]);
  return <section className="debt-plan">
    <header className="dp-header"><div><button className="ghost-button" onClick={back}><ArrowLeft size={16} /> Planejamento</button><span className="eyebrow">Um passo de cada vez</span><h1>Plano para sair das dívidas</h1><p>Organize prioridades e acompanhe seu caminho até a quitação.</p></div><button onClick={() => setModal({ type: "add" })} disabled={!data || busy}><Plus size={18} />Adicionar dívida</button></header>
    {error && <div className="dp-notice danger" role="alert">{error} <button onClick={load}>Recarregar plano</button></div>}
    {!data ? !error && <div className="panel" role="status">Carregando seu plano…</div> : <>
      <div className="dp-grid"><Kpi label="Total em dívidas" value={money(data.summary.remaining)} /><Kpi label="Valor mensal comprometido" value={money(data.summary.monthlyCommitment)} /><Kpi label="Dívidas ativas" value={data.summary.active} /><Kpi label="Dívidas em atraso" value={data.summary.overdue} tone={data.summary.overdue ? "danger" : ""} /><Kpi label="Disponível para acelerar / mês" value={money(data.extra)} tone="positive" /><Kpi label="Previsão para ficar sem dívidas" value={data.status === "EMPTY" ? "Aguardando dívidas" : dateLabel(data.simulation.endDate)} /></div>
      {data.status === "EMPTY" ? <div className="panel dp-empty"><HandCoins size={38} /><h2>Você ainda não cadastrou dívidas.</h2><p>Registre uma dívida para montar seu plano.</p><button onClick={() => setModal({ type: "add" })}>Adicionar primeira dívida</button></div> : data.status === "COMPLETED" && <div className="dp-notice positive"><Check /><h2>Parabéns! Você está sem dívidas.</h2><p>Seu histórico continua disponível abaixo.</p></div>}
      <section className="panel"><div className="dp-section-head"><h2>Seu plano mensal</h2><button className="ghost-button" disabled={busy} onClick={() => mutate("/debt-plan/recalculate")}><RefreshCw size={16} />Recalcular</button></div>
        <div className="dp-notice"><ShieldCheck size={22} /><div><strong>Você pode direcionar até {money(data.capacity.recommended)} neste mês sem ultrapassar seu limite protegido.</strong><p>A estimativa usa receitas recebidas, obrigações e reserva de {money(data.capacity.protectedAmount)}. Confirme novamente a cada mês.</p></div></div>
        {data.spaceType === "couple" && <p className="dp-muted">Este plano inclui apenas dívidas deste espaço. Os dados privados individuais não são importados. A capacidade usa somente valores registrados no espaço compartilhado.</p>}
        <details><summary>Como calculamos o valor disponível</summary><dl className="dp-facts"><div><dt>Receitas realizadas no mês</dt><dd>{money(data.capacity.received)}</dd></div><div><dt>Obrigações já pagas no mês</dt><dd>{money(data.capacity.paid)}</dd></div><div><dt>Obrigações pendentes e atrasadas</dt><dd>{money(data.capacity.pending)}</dd></div><div><dt>Compromissos conhecidos do próximo mês</dt><dd>{money(data.capacity.future)}</dd></div><div><dt>Parcelas exclusivas do plano</dt><dd>{money(data.capacity.unlinkedMinimums)}</dd></div><div><dt>Saldo disponível após proteção</dt><dd>{money(data.capacity.safeFree)}</dd></div></dl></details>
        <form className="dp-settings" onSubmit={async e => { e.preventDefault(); await mutate("/debt-plan", { strategy: data.strategy, monthlyExtraAmount: custom ? extra : null }, "PUT"); }}>
          <label><input type="radio" name="capacity" checked={!custom} onChange={() => setCustom(false)} />Usar valor recomendado</label><label><input type="radio" name="capacity" checked={custom} onChange={() => setCustom(true)} />Definir outro valor</label>
          {custom && <label>Valor extra por mês (R$)<input type="number" value={extra} onChange={e => setExtra(e.target.value)} min="0" max={data.capacity.recommended / 100} step="0.01" required /></label>}<button disabled={busy}>Salvar valor</button>
        </form>
        {data.requestedExtra > data.extra && <p className="dp-notice warning">O valor salvo foi limitado à capacidade atual para preservar sua proteção financeira.</p>}
        <div className="dp-strategies" aria-label="Estratégia">{Object.entries(strategies).map(([key, label]) => <button key={key} className={data.strategy === key ? "selected" : ""} aria-pressed={data.strategy === key} disabled={busy} onClick={() => mutate("/debt-plan", { strategy: key, monthlyExtraAmount: custom ? String(data.extra / 100) : null }, "PUT")}><strong>{label}</strong><small>{key === "avalanche" ? "Maior taxa de juros primeiro" : key === "snowball" ? "Menor saldo primeiro" : "Atraso, juros e impacto da parcela"}</small></button>)}</div>
        <details><summary>Entenda a prioridade recomendada</summary><p>Pontuação de 0 a 100: atraso até 40 pontos, juros conhecidos até 30, proporção parcela/saldo até 20 e saldo menor até 10. Empates são resolvidos pelo menor saldo e identificador. Juros ausentes não recebem pontuação de juros.</p></details>
      </section>
      {data.status !== "EMPTY" && <section className="panel"><h2>Meu caminho até ficar sem dívidas</h2><p>{money(data.summary.paid)} pagos e {money(data.summary.negotiatedDiscount)} em descontos de {money(data.summary.original)} iniciais.</p><Progress value={data.summary.progress} label="Dívidas quitadas" />
        <div className="dp-grid"><Kpi label="Meses restantes" value={data.simulation.monthsRemaining ?? "Indeterminado"} /><Kpi label="Juros futuros estimados" value={data.simulation.estimatedInterest == null ? "Indisponível" : money(data.simulation.estimatedInterest)} /><Kpi label="Economia estimada de juros" value={data.savings == null ? "Indisponível" : money(data.savings)} /></div>
        {!data.simulation.ratesKnown && <p className="dp-notice warning">Economia de juros indisponível. Informe as taxas das dívidas para calcular. A previsão considera apenas o saldo informado nas dívidas sem taxa.</p>}
        {data.simulation.ratesKnown && data.savings == null && <p>Economia indisponível: não foi possível concluir a simulação de referência.</p>}
        {!data.simulation.complete && <p className="dp-notice danger">{data.simulation.reason === "insufficient_payment" ? "Os pagamentos não reduzem o saldo. Revise as parcelas ou negocie as dívidas." : "Não foi possível projetar a quitação dentro do limite de 600 meses e dos valores suportados."}</p>}
        <p className="dp-muted">Simulação mensal com juros sobre o saldo inicial, pagamentos ao fim do mês e orçamento constante. Não inclui multas desconhecidas nem novas dívidas. A economia compara o plano com o pagamento apenas das parcelas, sem transferência entre dívidas.</p>
        {data.fasterBy100 > 0 && <p className="dp-notice">Se houver capacidade adicional de R$ 100 por mês, a simulação antecipa a quitação em {data.fasterBy100} mês(es).</p>}
        {data.summary.active === 1 && <p className="dp-notice positive">Falta apenas 1 dívida.</p>}
      </section>}
      {data.spaceType === "couple" && <section className="panel"><h2>Plano compartilhado</h2><p>Total do casal: {money(data.summary.remaining)} · Compartilhadas: {money(data.debts.filter(d => d.shared).reduce((s, d) => s + d.currentBalance, 0))}</p><div className="dp-grid">{data.members.map(m => { const total = data.debts.filter(d => !d.shared && d.ownerUserId === m.id).reduce((s, d) => s + d.currentBalance, 0); return <Kpi key={m.id} label={`${m.name} · ${data.summary.remaining ? Math.round(total / data.summary.remaining * 100) : 0}% do total`} value={money(total)} />; })}</div><p className="dp-muted">Dívidas compartilhadas são exibidas separadamente, sem atribuir percentuais arbitrários às pessoas.</p></section>}
      <section className="panel"><div className="dp-section-head"><h2>Ordem de ataque</h2>{data.spaceType === "couple" && <label>Filtrar dívidas<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas</option><option value="shared">Compartilhadas</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}</div>
        <div className="dp-debts">{data.debts.filter(d => filter === "all" || (filter === "shared" ? d.shared : !d.shared && d.ownerUserId === filter)).map(debt => {
          const canEdit = debt.shared || debt.ownerUserId === String(currentUserId), position = data.debts.indexOf(debt) + 1;
          const dueIn = Math.round((Date.parse(debt.dueDate) - Date.parse(today())) / 86400000);
          const progress = debt.originalBalance ? Math.min(100, Math.max(0, (debt.originalBalance - debt.currentBalance) / debt.originalBalance * 100)) : 0;
          return <article key={debt.id} className={`dp-debt ${debt.status === "OVERDUE" ? "overdue" : ""}`}>
            <div className="dp-section-head"><h3><span className="dp-rank">{debt.status === "PAID" ? "✓" : position}</span>{debt.name}</h3><span className={`dp-badge ${debt.status.toLowerCase()}`}>{statuses[debt.status]}</span></div>
            <strong className="dp-amount">{money(debt.currentBalance)} <small>restantes</small></strong><p>Parcela: {money(debt.minimumPayment)} · Juros: {debt.interestRateMonthly == null ? "não informados" : `${debt.interestRateMonthly}% a.m.`}</p>
            <p>Previsão: {debt.status === "PAID" ? "Quitada" : dateLabel(debt.payoffDate)} · Prioridade {debt.priorityScore >= 50 ? "alta" : debt.priorityScore >= 25 ? "média" : "normal"}</p>
            <Progress value={progress} label={`Progresso de ${debt.name}`} />
            {debt.overdueDays > 0 && <p className="dp-critical">Esta dívida está atrasada há {debt.overdueDays} dia(s).</p>}
            {debt.currentBalance > 0 && dueIn >= 0 && dueIn <= 3 && <p className="dp-critical">{dueIn === 0 ? "Sua parcela vence hoje." : `Sua parcela vence em ${dueIn} dia(s).`}</p>}
            {debt.currentBalance > 0 && debt.interestRateMonthly > 0 && debt.interestRateMonthly === Math.max(...data.debts.filter(d => d.currentBalance > 0).map(d => d.interestRateMonthly ?? 0)) && <p>Esta dívida tem a maior taxa de juros entre as cadastradas.</p>}
            {debt.sourceRecurring && <p className="dp-notice warning">Lançamento recorrente: confirme se o saldo cadastrado representa toda a dívida.</p>}
            {debt.sourceMissing && <p className="dp-notice warning">Lançamento de origem não encontrado. Confira o saldo salvo antes de usar a previsão.</p>}
            <div className="dp-actions"><button className="ghost-button" onClick={() => setModal({ type: "details", debt, canEdit })}>Ver detalhes</button>{canEdit && debt.status !== "PAID" && <><button className="ghost-button" disabled={busy} onClick={() => setModal({ type: "negotiate", debt })}>Negociar</button><button disabled={busy} onClick={() => setModal({ type: "paid", debt })}>Marcar como quitada</button></>}</div>
          </article>;
        })}</div>
      </section>
      {data.simulation.months.length > 0 && <section className="panel"><h2>Próximos pagamentos recomendados</h2><p>Os valores abaixo são uma simulação. Registre os pagamentos efetivos nos lançamentos habituais.</p>{data.simulation.months.slice(0, monthsVisible).map((month, i) => <details className="dp-month" key={month.month} open={i === 0}><summary>{dateLabel(month.month)} · {money(month.rows.reduce((s, r) => s + r.normal + r.extra, 0))}</summary>{month.rows.map(row => <div className="dp-payment" key={row.debtId}><strong>{row.name}</strong><span>Pagamento normal: {money(row.normal)}</span><span>Extra recomendado: {money(row.extra)}</span><span>Saldo final: {money(row.closingBalance)}{row.closingBalance === 0 ? " · Quitada" : ""}</span></div>)}<p>Sobra após distribuir os pagamentos: {money(month.unused)}. Valores liberados são destinados à próxima dívida na ordem do plano.</p></details>)}{monthsVisible < data.simulation.months.length && <button className="ghost-button" onClick={() => setMonthsVisible(n => n + 6)}>Mostrar mais 6 meses</button>}</section>}
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
      <dl className="dp-facts">{[["Descrição", debt.description], ["Valor original", money(debt.originalBalance)], ["Saldo atual", money(debt.currentBalance)], ["Parcela", money(debt.minimumPayment)], ["Juros mensais", debt.interestRateMonthly == null ? "Não informados" : `${debt.interestRateMonthly}%`], ["Juros anuais (referência)", debt.interestRateAnnual == null ? "Não informados" : `${debt.interestRateAnnual}%`], ["Vencimento", debt.dueDate], ["Parcelas restantes / total", `${debt.remainingInstallments ?? "—"} / ${debt.totalInstallments ?? "—"}`], ["Status", statuses[debt.status]], ["Credor", debt.creditor], ["Categoria", debt.category], ["Início", debt.startDate], ["Término informado", debt.expectedEndDate], ["Responsável", debt.shared ? "Compartilhada" : data.members.find(m => m.id === debt.ownerUserId)?.name], ["Observações", debt.notes]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
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
        <label>Status<select name="status" defaultValue={debt?.status || "ACTIVE"}>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        {field("creditor", "Credor", { maxLength: 160 })}{field("category", "Categoria", { maxLength: 50 })}{field("startDate", "Data de início", { type: "date" })}{field("expectedEndDate", "Término previsto no contrato", { type: "date" })}
        {data.spaceType === "couple" && <><label><input type="checkbox" name="shared" defaultChecked={debt?.shared} />Dívida compartilhada</label><label>Responsável<select name="ownerUserId" defaultValue={debt?.ownerUserId || currentUserId} disabled={modal.type === "edit"}>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p>Esta dívida ficará visível às pessoas deste espaço. Cadastre dívidas privadas no espaço Individual.</p></>}
      </>}
      <label className="dp-full">Observações<textarea name="notes" defaultValue={modal.type === "negotiate" ? "" : debt?.notes || ""} maxLength={1000} /></label>
      <p className="dp-full dp-muted">Taxas desconhecidas podem ficar vazias. A simulação usa apenas a taxa mensal informada. O cadastro do plano não movimenta o saldo das contas.</p>
      <button className="dp-full" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
    </fieldset></form>}
  </dialog>;
}
