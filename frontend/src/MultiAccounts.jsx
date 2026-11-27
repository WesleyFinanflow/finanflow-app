import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, History, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { calculateAccountBalances } from "./account-balances.js";

// Tela de Contas do recurso Multiconta (só aparece com a chave ligada, no modo individual).
const MAX_ACCOUNTS = 6;
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export default function MultiAccounts({ accounts, transactions, api, spaceId, reload, setMessage }) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", balance: "" });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletedAccounts, setDeletedAccounts] = useState([]);

  const balances = useMemo(() => calculateAccountBalances(accounts, transactions), [accounts, transactions]);
  const balanceById = useMemo(() => new Map(balances.accounts.map((item) => [String(item.id), item.balance])), [balances]);
  const active = accounts.filter((account) => !account.archived);
  const archived = accounts.filter((account) => account.archived);
  const atLimit = active.length >= MAX_ACCOUNTS;
  const base = `/api/spaces/${spaceId}/accounts`;

  async function loadDeleted() {
    try {
      const data = await api(`${base}/deleted`);
      setDeletedAccounts(data.deleted || []);
    } catch {
      setDeletedAccounts([]);
    }
  }
  useEffect(() => { if (spaceId) loadDeleted(); }, [spaceId]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      await reload();
      await loadDeleted();
      setMessage(success);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function submitCreate(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return setMessage("Informe o nome da conta.");
    const balance = form.balance === "" ? 0 : Number(form.balance);
    if (!Number.isFinite(balance)) return setMessage("Informe um saldo inicial válido.");
    run(async () => {
      await api(base, { method: "POST", body: JSON.stringify({ name, balance }) });
      setForm({ name: "", balance: "" });
      setCreating(false);
    }, `Conta ${name} criada.`);
  }

  function submitEdit(event) {
    event.preventDefault();
    const name = editing.name.trim();
    if (!name) return setMessage("Informe o nome da conta.");
    const balance = editing.balance === "" ? 0 : Number(editing.balance);
    if (!Number.isFinite(balance)) return setMessage("Informe um saldo inicial válido.");
    run(async () => {
      await api(`${base}/${editing.id}`, { method: "PUT", body: JSON.stringify({ name, balance }) });
      setEditing(null);
    }, "Conta atualizada.");
  }

  const setArchived = (account, value) => run(() => api(`${base}/${account._id}`, { method: "PUT", body: JSON.stringify({ archived: value }) }), value ? `Conta ${account.name} arquivada.` : `Conta ${account.name} reativada.`);

  function confirmDelete(account) {
    run(async () => {
      await api(`${base}/${account._id}`, { method: "DELETE", body: JSON.stringify({ confirmName: deleting.confirm }) });
      setDeleting(null);
    }, `Conta ${account.name} excluída.`);
  }

  async function restoreAccount(entry) {
    setBusy(true);
    try {
      const data = await api(`${base}/restore/${entry._id}`, { method: "POST", body: JSON.stringify({}) });
      await reload();
      await loadDeleted();
      const count = data.restoredTransactions || 0;
      setMessage(`Conta ${data.account.name} restaurada (${count} lançamento${count === 1 ? "" : "s"}).${data.renamed ? " O nome mudou porque já existe uma conta com esse nome." : ""}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const startEdit = (account) => { setDeleting(null); setEditing({ id: account._id, name: account.name, balance: String(account.balance ?? 0) }); };
  const startDelete = (account) => { setEditing(null); setDeleting({ id: account._id, confirm: "" }); };
  const lastActive = (account) => !account.archived && active.length <= 1;
  const onlyAccount = accounts.length <= 1;

  function renderCard(account) {
    const current = balanceById.get(String(account._id)) ?? 0;
    const linked = transactions.filter((item) => String(item.accountId) === String(account._id)).length;
    const isEditing = editing?.id === account._id;
    const isDeleting = deleting?.id === account._id;
    const cannotRemove = lastActive(account) || onlyAccount;
    return (
      <li key={account._id} className={`multi-account-card ${account.archived ? "is-archived" : ""}`}>
        <div className="multi-account-main">
          <span className="multi-account-icon" aria-hidden="true"><Landmark size={20} /></span>
          <div className="multi-account-title">
            <strong>{account.name}</strong>
            <small>{account.archived ? "Arquivada" : account.ownerName || "Individual"}</small>
          </div>
          <div className="multi-account-balance">
            <span>Saldo atual</span>
            <strong data-money>{money(current)}</strong>
            <small>Saldo inicial <span data-money>{money(account.balance)}</span></small>
          </div>
        </div>
        <div className="multi-account-actions">
          {!account.archived && <button type="button" className="ghost-button" disabled={busy} onClick={() => startEdit(account)} aria-label={`Editar ${account.name}`}><Pencil size={16} aria-hidden="true" /> Editar</button>}
          {account.archived
            ? <button type="button" className="ghost-button" disabled={busy || atLimit} title={atLimit ? `Limite de ${MAX_ACCOUNTS} contas ativas` : undefined} onClick={() => setArchived(account, false)} aria-label={`Reativar ${account.name}`}><ArchiveRestore size={16} aria-hidden="true" /> Reativar</button>
            : <button type="button" className="ghost-button" disabled={busy || cannotRemove} title={cannotRemove ? "Mantenha pelo menos uma conta ativa" : undefined} onClick={() => setArchived(account, true)} aria-label={`Arquivar ${account.name}`}><Archive size={16} aria-hidden="true" /> Arquivar</button>}
          <button type="button" className="danger-button" disabled={busy || cannotRemove} title={cannotRemove ? "Mantenha pelo menos uma conta ativa" : undefined} onClick={() => startDelete(account)} aria-label={`Excluir ${account.name}`}><Trash2 size={16} aria-hidden="true" /> Excluir</button>
        </div>
        {isEditing && (
          <form className="multi-account-form" onSubmit={submitEdit}>
            <label>Nome da conta<input value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required /></label>
            <label>Saldo inicial<input type="number" step="0.01" inputMode="decimal" value={editing.balance} onChange={(event) => setEditing({ ...editing, balance: event.target.value })} /></label>
            <div className="multi-account-form-actions">
              <button disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button>
              <button type="button" className="ghost-button" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </form>
        )}
        {isDeleting && (
          <div className="multi-account-delete" role="group" aria-label={`Confirmar exclusão de ${account.name}`}>
            <p><strong>Excluir a conta {account.name}?</strong> Isso apaga também <b>{linked} lançamento{linked === 1 ? "" : "s"}</b> dela. Uma cópia fica guardada no histórico. Se só quiser tirá-la da lista, use <em>Arquivar</em>.</p>
            <label>Digite o nome da conta para confirmar<input value={deleting.confirm} onChange={(event) => setDeleting({ ...deleting, confirm: event.target.value })} autoComplete="off" /></label>
            <div className="multi-account-form-actions">
              <button type="button" className="danger-button" disabled={busy || !sameName(deleting.confirm, account.name)} onClick={() => confirmDelete(account)}>{busy ? "Excluindo..." : "Excluir definitivamente"}</button>
              <button type="button" className="ghost-button" onClick={() => setDeleting(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <section className="multi-accounts">
      <section className="panel multi-accounts-head">
        <div className="panel-head">
          <div><span className="eyebrow">Suas contas</span><h2>Contas</h2></div>
          <button type="button" disabled={busy || atLimit} title={atLimit ? `Limite de ${MAX_ACCOUNTS} contas ativas` : undefined} onClick={() => { setCreating((open) => !open); setEditing(null); setDeleting(null); }}><Plus size={16} aria-hidden="true" /> Nova conta</button>
        </div>
        <div className="multi-accounts-total">
          <span>Saldo total</span>
          <strong data-money>{money(balances.total)}</strong>
          <small>{active.length} de {MAX_ACCOUNTS} contas ativas. O total soma todas as contas, inclusive as arquivadas.</small>
        </div>
        {creating && (
          <form className="multi-account-form" onSubmit={submitCreate}>
            <label>Nome da conta<input value={form.name} maxLength={80} placeholder="Ex.: Nubank" onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus /></label>
            <label>Saldo inicial<input type="number" step="0.01" inputMode="decimal" value={form.balance} placeholder="0,00" onChange={(event) => setForm({ ...form, balance: event.target.value })} /></label>
            <div className="multi-account-form-actions">
              <button disabled={busy}>{busy ? "Salvando..." : "Criar conta"}</button>
              <button type="button" className="ghost-button" onClick={() => setCreating(false)}>Cancelar</button>
            </div>
          </form>
        )}
      </section>

      <ul className="multi-account-list" aria-label="Contas ativas">{active.map(renderCard)}</ul>

      {balances.unassigned !== 0 && (
        <p className="multi-account-note" role="note">Há {money(balances.unassigned)} em lançamentos sem conta definida; eles já estão incluídos no saldo total.</p>
      )}

      {archived.length > 0 && (
        <details className="multi-account-archived">
          <summary>Contas arquivadas ({archived.length})</summary>
          <ul className="multi-account-list" aria-label="Contas arquivadas">{archived.map(renderCard)}</ul>
        </details>
      )}

      {deletedAccounts.length > 0 && (
        <details className="multi-account-deleted">
          <summary><History size={16} aria-hidden="true" /> Contas excluídas recentemente ({deletedAccounts.length})</summary>
          <ul className="multi-account-list" aria-label="Contas excluídas recentemente">
            {deletedAccounts.map((entry) => {
              const blocked = !entry.archived && atLimit;
              return (
                <li key={entry._id} className="multi-account-card is-archived">
                  <div className="multi-account-main">
                    <span className="multi-account-icon" aria-hidden="true"><Landmark size={20} /></span>
                    <div className="multi-account-title">
                      <strong>{entry.name}</strong>
                      <small>{entry.transactionCount} lançamento{entry.transactionCount === 1 ? "" : "s"} · excluída em {new Date(entry.createdAt).toLocaleDateString("pt-BR")}</small>
                    </div>
                  </div>
                  <div className="multi-account-actions">
                    <button type="button" className="ghost-button" disabled={busy || blocked} title={blocked ? `Limite de ${MAX_ACCOUNTS} contas ativas: arquive ou exclua uma antes` : undefined} onClick={() => restoreAccount(entry)} aria-label={`Restaurar ${entry.name}`}><ArchiveRestore size={16} aria-hidden="true" /> Restaurar</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
