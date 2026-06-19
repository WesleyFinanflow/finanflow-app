import { useEffect, useMemo, useState } from "react";
import { calculatePurchase, calculateSummary } from "./finance.js";

function getApiUrl() {
  const host = window.location.hostname;

  if (host.endsWith("app.github.dev") && host.includes("-5173")) {
    return "";
  }

  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3000";
  return null;
}

const API_URL = getApiUrl();
const today = new Date().toISOString().slice(0, 10);
const menu = ["Início", "Lançamentos", "Contas", "Planejamento", "Casal", "Configurações"];

function getInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code || window.location.pathname !== "/convite-casal") return null;
  return { code, from: params.get("from") || "" };
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function moneyOrWaiting(value, hasData) {
  return hasData ? money(value) : "Aguardando dados";
}

async function api(path, options = {}) {
  if (!API_URL) throw new Error("API não configurada. Defina VITE_API_URL no ambiente do frontend.");
  const token = localStorage.getItem("finanflow_token");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token) window.dispatchEvent(new Event("finanflow:unauthorized"));
      throw new Error(data.message || "A API não conseguiu concluir esta operação.");
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("A API demorou para responder. Tente novamente.");
    if (error instanceof TypeError) throw new Error("Não foi possível conectar à API. Verifique sua internet e tente novamente.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("finanflow_user") || "null"));
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [activeMenu, setActiveMenu] = useState("Início");
  const [activeMode, setActiveMode] = useState("individual");
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", balance: "", ownerName: "" });
  const [txForm, setTxForm] = useState({ type: "despesa", description: "", amount: "", date: today, category: "Moradia", status: "pendente", accountId: "" });
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [buyForm, setBuyForm] = useState({ item: "", total: "", installments: "1" });
  const [reserve, setReserve] = useState(300);
  const [coupleInvite, setCoupleInvite] = useState(null);
  const [pendingInvite, setPendingInvite] = useState(() => getInviteFromUrl());
  const [inviteInfo, setInviteInfo] = useState(null);

  const firstName = user?.name?.split(" ")?.[0] || "Wesley";
  const individualSpace = spaces.find((space) => space.type === "individual");
  const coupleSpace = spaces.find((space) => space.type === "couple");
  const coupleReady = Boolean(coupleSpace && Number(coupleSpace.memberCount || 0) > 1);
  const activeCoupleSpace = activeMode === "couple" && coupleReady ? coupleSpace : null;

  const summary = useMemo(() => calculateSummary(accounts, transactions, reserve), [accounts, transactions, reserve]);

  const hasData = summary.balance || summary.income || summary.commitments || transactions.length > 0;

  async function loadSpaceData(spaceId) {
    if (!spaceId) return;
    const [accountData, txData] = await Promise.all([api(`/api/spaces/${spaceId}/accounts`), api(`/api/spaces/${spaceId}/transactions`)]);
    setAccounts(accountData.accounts || []);
    setTransactions(txData.transactions || []);
  }

  async function loadSpaces(mode = "individual") {
    const data = await api("/api/spaces");
    const loaded = data.spaces || [];
    setSpaces(loaded);
    const individual = loaded.find((space) => space.type === "individual");
    const couple = loaded.find((space) => space.type === "couple");
    const readyCouple = couple && Number(couple.memberCount || 0) > 1;
    const selectedSpace = mode === "couple" && readyCouple ? couple : individual || loaded[0] || null;
    const selected = selectedSpace?._id || "";
    setActiveMode(mode === "couple" && readyCouple ? "couple" : "individual");
    setActiveSpaceId(selected);
    setReserve(Number(selectedSpace?.reserve ?? 300));
    if (selected) await loadSpaceData(selected);
  }

  useEffect(() => { if (user) loadSpaces().catch((error) => setMessage(error.message)); }, [user]);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem("finanflow_token");
      localStorage.removeItem("finanflow_user");
      setUser(null);
      setMessage("Sua sessão expirou. Entre novamente.");
    };
    window.addEventListener("finanflow:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("finanflow:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!pendingInvite?.code) return;
    api(`/api/invites/${pendingInvite.code}`)
      .then((data) => setInviteInfo(data.invite))
      .catch((error) => setMessage(error.message));
  }, [pendingInvite?.code]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (activeMenu !== "Casal" || !coupleSpace || coupleReady) return undefined;
    const timer = window.setInterval(() => refreshCoupleStatus({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [activeMenu, coupleSpace?._id, coupleReady]);

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, { method: "POST", body: JSON.stringify(authForm) });
      localStorage.setItem("finanflow_token", data.token);
      localStorage.setItem("finanflow_user", JSON.stringify(data.user));
      setUser(data.user);
      setMessage("Acesso realizado com sucesso.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function addAccount(event) {
    event.preventDefault();
    if (!accountForm.name.trim()) return setMessage("Informe o nome da conta.");
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/accounts`, { method: "POST", body: JSON.stringify({ name: accountForm.name, balance: Number(accountForm.balance || 0), ownerName: accountForm.ownerName || (activeCoupleSpace ? "Casal" : firstName) }) });
      setAccountForm({ name: "", balance: "", ownerName: "" });
      await loadSpaceData(activeSpaceId);
      setMessage("Conta adicionada.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateAccount(account) {
    if (!account.name.trim()) return setMessage("Informe o nome da conta.");
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/accounts/${account._id}`, { method: "PUT", body: JSON.stringify({ name: account.name, ownerName: account.ownerName || firstName, balance: Number(account.balance || 0) }) });
      await loadSpaceData(activeSpaceId);
      setMessage("Conta atualizada.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAccount(accountId) {
    if (!window.confirm("Deseja excluir esta conta? Os lançamentos ligados a ela ficarão sem conta.")) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/accounts/${accountId}`, { method: "DELETE" });
      await loadSpaceData(activeSpaceId);
      setMessage("Conta excluída.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (!txForm.description.trim()) return setMessage("Informe a descrição.");
    if (!txForm.amount) return setMessage("Informe o valor.");
    const payload = { ...txForm, amount: Number(txForm.amount || 0), accountId: txForm.accountId || null, responsibleName: firstName };
    const path = editingTransactionId ? `/api/spaces/${activeSpaceId}/transactions/${editingTransactionId}` : `/api/spaces/${activeSpaceId}/transactions`;
    setLoading(true);
    try {
      await api(path, { method: editingTransactionId ? "PUT" : "POST", body: JSON.stringify(payload) });
      setEditingTransactionId("");
      setTxForm({ type: "despesa", description: "", amount: "", date: today, category: "Moradia", status: "pendente", accountId: "" });
      await loadSpaceData(activeSpaceId);
      setMessage(editingTransactionId ? "Lançamento atualizado." : "Lançamento salvo.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function editTransaction(transaction) {
    setEditingTransactionId(transaction._id);
    setTxForm({
      type: transaction.type,
      description: transaction.description,
      amount: String(transaction.amount || ""),
      date: transaction.date || today,
      category: transaction.category || "Moradia",
      status: transaction.status || "pendente",
      accountId: transaction.accountId || "",
    });
    setActiveMenu("Lançamentos");
  }

  async function deleteTransaction(transactionId) {
    if (!window.confirm("Deseja excluir este lançamento?")) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/transactions/${transactionId}`, { method: "DELETE" });
      await loadSpaceData(activeSpaceId);
      setMessage("Lançamento excluído.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createCouple(partnerName) {
    setLoading(true);
    try {
      const data = await api("/api/spaces/couple", { method: "POST", body: JSON.stringify({ partnerName: partnerName?.trim() || "Parceiro(a)" }) });
      setCoupleInvite(data.invite || null);
      await loadSpaces("individual");
      setActiveMenu("Casal");
      setMessage(data.invite ? "Convite do casal criado. O modo casal será liberado quando a outra pessoa aceitar." : "O espaço do casal já está ativo.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshCoupleStatus({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const data = await api("/api/spaces");
      const loaded = data.spaces || [];
      const updatedCouple = loaded.find((space) => space.type === "couple");
      setSpaces(loaded);
      if (updatedCouple && Number(updatedCouple.memberCount || 0) > 1) {
        setCoupleInvite(null);
        if (!silent) setMessage("Convite aceito. O modo casal está ativo.");
      } else if (!silent) {
        setMessage("O convite ainda está aguardando aceite.");
      }
    } catch (error) {
      if (!silent) setMessage(error.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function goToCouple() {
    if (!coupleSpace) {
      setActiveMenu("Casal");
      return;
    }
    if (!coupleReady) {
      setActiveMenu("Casal");
      return;
    }
    setActiveMode("couple");
    setActiveSpaceId(coupleSpace._id);
    setReserve(Number(coupleSpace.reserve ?? 300));
    setActiveMenu("Início");
    try {
      await loadSpaceData(coupleSpace._id);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function goToIndividual() {
    const selected = individualSpace?._id || spaces.find((space) => space.type !== "couple")?._id || "";
    setActiveMode("individual");
    setActiveSpaceId(selected);
    setReserve(Number(individualSpace?.reserve ?? 300));
    setActiveMenu("Início");
    try {
      if (selected) await loadSpaceData(selected);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resetSpaceData() {
    if (!activeSpaceId) return;
    const confirmed = window.confirm("Tem certeza que deseja zerar os dados deste espaço? Esta ação apagará contas e lançamentos deste espaço.");
    if (!confirmed) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/reset`, { method: "DELETE" });
      setEditingTransactionId("");
      setTxForm({ type: "despesa", description: "", amount: "", date: today, category: "Moradia", status: "pendente", accountId: "" });
      await loadSpaceData(activeSpaceId);
      setMessage("Dados financeiros zerados.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveReserve() {
    setLoading(true);
    try {
      const data = await api(`/api/spaces/${activeSpaceId}/settings`, { method: "PATCH", body: JSON.stringify({ reserve }) });
      setSpaces((current) => current.map((space) => space._id === data.space._id ? data.space : space));
      setReserve(Number(data.space.reserve ?? 0));
      setMessage("Reserva protegida salva neste espaço.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("finanflow_token");
    localStorage.removeItem("finanflow_user");
    setUser(null);
  }

  async function deleteUserAccount() {
    const confirmed = window.confirm("Tem certeza que deseja apagar sua conta? Esta ação remove seus dados individuais e tira você dos espaços compartilhados.");
    if (!confirmed) return;
    setLoading(true);
    try {
      await api("/api/me", { method: "DELETE" });
      logout();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvite() {
    if (!pendingInvite?.code) return;
    setLoading(true);
    setMessage("");
    try {
      await api(`/api/invites/${pendingInvite.code}/accept`, { method: "POST" });
      setPendingInvite(null);
      setInviteInfo(null);
      window.history.replaceState({}, "", "/");
      await loadSpaces("couple");
      setMessage("Convite aceito. O modo casal está ativo.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return <main className="auth-page"><section className="auth-card">{pendingInvite && <div className="invite-warning">Você recebeu um convite para o FinanFlow Casal. Entre ou crie sua conta para aceitar.</div>}<span className="eyebrow">FinanFlow</span><h1>{authMode === "login" ? "Entrar" : "Criar conta"}</h1><p>{authMode === "login" ? "Acesse seu painel financeiro." : "Crie seu acesso para começar."}</p><form className="form" onSubmit={handleAuth}>{authMode === "register" && <label>Nome<input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="Seu nome" /></label>}<label>E-mail<input value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="seuemail@exemplo.com" type="email" /></label><label>Senha<input value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="Mínimo 6 caracteres" type="password" /></label><button disabled={loading}>{loading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}</button></form><button className="ghost-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? "Ainda não tenho conta" : "Já tenho conta"}</button>{message && <div className="status-box" role="status" aria-live="polite">{message}</div>}</section></main>;
  }

  if (pendingInvite) {
    return <InviteAccept invite={inviteInfo} loading={loading} message={message} acceptInvite={acceptInvite} />;
  }

  return (
    <main className="finanflow-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">F</div>
          <div>
            <strong>FinanFlow</strong>
            <span>{activeCoupleSpace ? "Modo casal ativo" : "Modo individual"}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {menu.map((item) => (
            <button key={item} className={activeMenu === item ? "active" : ""} onClick={() => setActiveMenu(item)}>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="mode-button" onClick={activeCoupleSpace ? goToIndividual : goToCouple}>
            {activeCoupleSpace ? "Ir para individual" : coupleSpace && !coupleReady ? "Ver convite" : "Ir para casal"}
          </button>
        </div>
      </aside>

      <section className="main-content">
        <Hero firstName={firstName} coupleSpace={activeCoupleSpace} summary={summary} hasData={hasData} />
        {activeMenu === "Início" && <Inicio summary={summary} hasData={hasData} setActiveMenu={setActiveMenu} buyForm={buyForm} setBuyForm={setBuyForm} reserve={reserve} transactions={transactions} />}
        {activeMenu === "Lançamentos" && <Lancamentos txForm={txForm} setTxForm={setTxForm} addTransaction={addTransaction} transactions={transactions} accounts={accounts} editingTransactionId={editingTransactionId} setEditingTransactionId={setEditingTransactionId} editTransaction={editTransaction} deleteTransaction={deleteTransaction} loading={loading} />}
        {activeMenu === "Contas" && <Contas accounts={accounts} setAccounts={setAccounts} accountForm={accountForm} setAccountForm={setAccountForm} addAccount={addAccount} updateAccount={updateAccount} deleteAccount={deleteAccount} firstName={firstName} activeMode={activeMode} loading={loading} />}
        {activeMenu === "Planejamento" && <Planejamento summary={summary} hasData={hasData} buyForm={buyForm} setBuyForm={setBuyForm} />}
        {activeMenu === "Configurações" && <Config reserve={reserve} setReserve={setReserve} saveReserve={saveReserve} firstName={firstName} coupleSpace={coupleSpace} coupleReady={coupleReady} setActiveMenu={setActiveMenu} goToCouple={goToCouple} goToIndividual={goToIndividual} activeMode={activeMode} logout={logout} resetSpaceData={resetSpaceData} deleteUserAccount={deleteUserAccount} loading={loading} />}
        {activeMenu === "Casal" && <Casal coupleSpace={coupleSpace} coupleReady={coupleReady} coupleInvite={coupleInvite} createCouple={createCouple} goToCouple={goToCouple} refreshCoupleStatus={refreshCoupleStatus} setMessage={setMessage} firstName={firstName} loading={loading} />}
        {message && <div className="floating-message" role="status" aria-live="polite">{message}</div>}
      </section>
    </main>
  );
}

function Hero({ firstName, coupleSpace, summary, hasData }) {
  const isCouple = Boolean(coupleSpace);
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">{isCouple ? "Controle financeiro compartilhado" : "Controle financeiro individual"}</span>
        <h1>{isCouple ? coupleSpace.name : `Olá, ${firstName}`}</h1>
        <p>
          {isCouple
            ? "Você está no espaço do casal. Cadastre os dados compartilhados para calcular o saldo livre."
            : "Você está no modo individual. Cadastre seus dados; o modo casal só começa depois do convite."}
        </p>
      </div>
      <div className="balance-focus">
        <span>Saldo livre seguro</span>
        <strong>{hasData ? money(summary.free) : "Aguardando dados"}</strong>
      </div>
    </section>
  );
}

function Inicio({ summary, hasData, setActiveMenu, buyForm, setBuyForm, reserve, transactions }) {
  const pending = transactions.filter((item) => item.status === "pendente" && item.type !== "receita");

  return (
    <>
      <section className="quick-start panel">
        <div>
          <span className="eyebrow">Comece por aqui</span>
          <h2>Cadastre seus primeiros dados</h2>
          <p>O FinanFlow começa individual. Cadastre saldos, receitas e despesas. O modo casal só será ativado quando você criar ou aceitar um convite.</p>
        </div>
        <div className="quick-actions">
          <button onClick={() => setActiveMenu("Contas")}>Adicionar saldo</button>
          <button onClick={() => setActiveMenu("Lançamentos")}>Adicionar receita</button>
          <button onClick={() => setActiveMenu("Lançamentos")}>Adicionar despesa</button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard title="Saldo atual" value={hasData ? money(summary.balance) : "Aguardando dados"} text="Contas cadastradas no espaço atual" tone="cyan" />
        <StatCard title="Receitas previstas" value={hasData ? money(summary.income) : "Aguardando dados"} text="Entradas pendentes no mês" tone="green" />
        <StatCard title="Compromissos" value={hasData ? money(summary.commitments) : "Aguardando dados"} text="Despesas, dívidas e metas pendentes" tone="yellow" />
        <StatCard title="Livre seguro" value={hasData ? money(summary.free) : "Aguardando dados"} text={`Reserva protegida: ${money(reserve)}`} tone="blue" />
      </section>

      <section className="grid-two">
        <Decision buyForm={buyForm} setBuyForm={setBuyForm} ready={hasData} free={summary.free} />
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Próximos vencimentos</span>
              <h2>O que ainda precisa pagar</h2>
            </div>
          </div>
          <div className="upcoming-list">
            {pending.length ? pending.map((item) => <DataRow key={item._id} label={item.description} value={money(item.amount)} />) : <Empty title="Aguardando os primeiros dados" text="Depois que você cadastrar despesas pendentes, elas aparecerão aqui." />}
          </div>
        </section>
      </section>
    </>
  );
}

function Lancamentos({ txForm, setTxForm, addTransaction, transactions, accounts, editingTransactionId, setEditingTransactionId, editTransaction, deleteTransaction, loading }) {
  const resetForm = () => {
    setEditingTransactionId("");
    setTxForm({ type: "despesa", description: "", amount: "", date: today, category: "Moradia", status: "pendente", accountId: "" });
  };

  return (
    <section className="grid-two top-align">
      <form className="panel" onSubmit={addTransaction}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">{editingTransactionId ? "Editar lançamento" : "Novo lançamento"}</span>
            <h2>{editingTransactionId ? "Salvar movimentação" : "Adicionar movimentação"}</h2>
          </div>
        </div>
        <div className="type-grid">
          {["receita", "despesa", "divida", "meta"].map((type) => (
            <button type="button" key={type} className={txForm.type === type ? "selected" : ""} onClick={() => setTxForm({ ...txForm, type })}>
              {type === "meta" ? "Meta" : type}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <label>Descrição<input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Ex: mercado, salário" /></label>
          <label>Valor<input type="number" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} placeholder="0,00" /></label>
          <label>Data / vencimento<input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} /></label>
          <label>Categoria<select value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })}><option>Moradia</option><option>Alimentação</option><option>Transporte</option><option>Renda</option><option>Dívida</option><option>Reserva</option></select></label>
          <label>Status<select value={txForm.status} onChange={(e) => setTxForm({ ...txForm, status: e.target.value })}><option value="pendente">Pendente</option><option value="pago">Pago</option></select></label>
          <label>Conta<select value={txForm.accountId || ""} onChange={(e) => setTxForm({ ...txForm, accountId: e.target.value })}><option value="">Sem conta</option>{accounts.map((account) => <option key={account._id} value={account._id}>{account.name}</option>)}</select></label>
        </div>
        <div className="action-row">
          <button disabled={loading}>{loading ? "Salvando..." : editingTransactionId ? "Salvar edição" : "Salvar lançamento"}</button>
          {editingTransactionId && <button type="button" className="ghost-button" onClick={resetForm}>Cancelar edição</button>}
        </div>
      </form>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Extrato do mês</span>
            <h2>Lançamentos</h2>
          </div>
        </div>
        <div className="transaction-list">
          {transactions.length ? transactions.map((item) => (
            <article className={`transaction-row ${item.type}`} key={item._id}>
              <div className="transaction-main">
                <strong>{item.description}</strong>
                <span>{item.category} · {item.status}</span>
              </div>
              <em>{money(item.amount)}</em>
              <div className="row-actions">
                <button type="button" className="ghost-button" disabled={loading} onClick={() => editTransaction(item)}>Editar</button>
                <button type="button" className="danger-button inline-danger" disabled={loading} onClick={() => deleteTransaction(item._id)}>Excluir</button>
              </div>
            </article>
          )) : <Empty title="Nenhum lançamento neste mês" text="Cadastre receitas, despesas, dívidas ou metas para começar." />}
        </div>
      </section>
    </section>
  );
}

function Contas({ accounts, setAccounts, accountForm, setAccountForm, addAccount, updateAccount, deleteAccount, firstName, activeMode, loading }) {
  const updateLocalAccount = (accountId, field, value) => setAccounts(accounts.map((item) => item._id === accountId ? { ...item, [field]: value } : item));
  const ownerOptions = activeMode === "couple" ? [firstName, "Casal"] : [firstName, "Individual"];

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Contas</span>
          <h2>Saldos manuais</h2>
        </div>
      </div>
      <div className="account-list">
        {accounts.map((item) => (
          <article className="account-row account-row-editable" key={item._id}>
            <div className="account-edit-grid">
              <label>Conta<input value={item.name} onChange={(e) => updateLocalAccount(item._id, "name", e.target.value)} /></label>
              <label>Dono<select value={item.ownerName || ownerOptions[0]} onChange={(e) => updateLocalAccount(item._id, "ownerName", e.target.value)}>{ownerOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label>Saldo atual<input type="number" value={item.balance} onChange={(e) => updateLocalAccount(item._id, "balance", e.target.value)} /></label>
            </div>
            <em>{money(item.balance)}</em>
            <div className="row-actions">
              <button type="button" disabled={loading} onClick={() => updateAccount(item)}>{loading ? "Salvando..." : "Salvar"}</button>
              <button type="button" className="danger-button inline-danger" disabled={loading} onClick={() => deleteAccount(item._id)}>Excluir</button>
            </div>
          </article>
        ))}
        <form className="account-row account-row-editable" onSubmit={addAccount}>
          <div className="account-edit-grid">
            <label>Conta<input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Nome da conta" /></label>
            <label>Dono<select value={accountForm.ownerName || ownerOptions[0]} onChange={(e) => setAccountForm({ ...accountForm, ownerName: e.target.value })}>{ownerOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Saldo atual<input type="number" value={accountForm.balance} onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })} placeholder="Saldo" /></label>
          </div>
          <em>{money(accountForm.balance)}</em>
          <div className="row-actions"><button disabled={loading}>{loading ? "Adicionando..." : "Adicionar"}</button></div>
        </form>
      </div>
    </section>
  );
}

function Planejamento({ summary, hasData, buyForm, setBuyForm }) {
  return (
    <section className="grid-two">
      <Decision buyForm={buyForm} setBuyForm={setBuyForm} ready={hasData} free={summary.free} />
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Resumo do mês</span>
            <h2>Para entender o que pode fazer</h2>
          </div>
        </div>
        <div className="summary-list">
          <DataRow label="Receitas pendentes" value={moneyOrWaiting(summary.income, hasData)} />
          <DataRow label="Receitas já pagas" value={moneyOrWaiting(summary.received, hasData)} />
          <DataRow label="Despesas pendentes" value={moneyOrWaiting(summary.expenses, hasData)} />
          <DataRow label="Despesas já pagas" value={moneyOrWaiting(summary.paidExpenses, hasData)} />
          <DataRow label="Dívidas pendentes" value={moneyOrWaiting(summary.debt, hasData)} />
          <DataRow label="Metas / reserva pendentes" value={moneyOrWaiting(summary.goals, hasData)} />
          <DataRow className="highlight-row" label="Saldo livre seguro" value={moneyOrWaiting(summary.free, hasData)} />
        </div>
      </section>
    </section>
  );
}

function Config({ reserve, setReserve, saveReserve, firstName, coupleSpace, coupleReady, setActiveMenu, goToCouple, goToIndividual, activeMode, logout, resetSpaceData, deleteUserAccount, loading }) {
  return (
    <section className="settings-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Configurações</span>
            <h2>Dados individuais</h2>
          </div>
        </div>
        <div className="field-grid">
          <label>Seu nome<input value={firstName} readOnly /></label>
          <label>Espaço ativo<input value={activeMode === "couple" ? "Casal" : "Individual"} readOnly /></label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Proteção</span>
            <h2>Reserva mínima protegida</h2>
          </div>
        </div>
        <div className="setting-control">
          <label>Valor reservado<input type="number" min="0" step="0.01" value={reserve} onChange={(e) => setReserve(Number(e.target.value || 0))} /></label>
          <button type="button" disabled={loading} onClick={saveReserve}>{loading ? "Salvando..." : "Salvar reserva"}</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Modo casal</span>
            <h2>{coupleReady ? "Espaço do casal ativo" : coupleSpace ? "Convite do casal pendente" : "Modo casal ainda não criado"}</h2>
          </div>
        </div>
        <div className="mode-inline">
          <div>
            <strong>{coupleSpace ? coupleSpace.name : "Crie um convite para iniciar o modo casal"}</strong>
            <span>{coupleReady ? "Os dados individuais e compartilhados continuam separados por espaço." : "O modo casal só libera lançamentos compartilhados depois que a outra pessoa aceitar."}</span>
          </div>
          <button onClick={coupleReady ? goToCouple : () => setActiveMenu("Casal")}>{coupleReady ? "Entrar no casal" : coupleSpace ? "Ver convite" : "Criar convite"}</button>
          {activeMode === "couple" && <button className="ghost-button" onClick={goToIndividual}>Ir para individual</button>}
        </div>
      </section>

      <section className="panel danger-zone">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Segurança e conta</span>
            <h2>Ações da conta</h2>
          </div>
        </div>
        <div className="security-actions">
          <button className="ghost-button" onClick={logout}>Sair da conta</button>
          <button className="danger-button" disabled={loading} onClick={resetSpaceData}>Zerar dados financeiros</button>
          <button className="danger-button" disabled={loading} onClick={deleteUserAccount}>Apagar conta</button>
        </div>
      </section>
    </section>
  );
}

function Casal({ coupleSpace, coupleReady, coupleInvite, createCouple, goToCouple, refreshCoupleStatus, setMessage, firstName, loading }) {
  const [partnerName, setPartnerName] = useState("");
  const [copied, setCopied] = useState(false);
  const code = coupleInvite?.code || "";
  const link = code ? `${window.location.origin}/convite-casal?code=${code}&from=${encodeURIComponent(firstName)}` : "";
  const whatsappText = encodeURIComponent(`Entre no nosso FinanFlow Casal: ${link}`);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <section className="panel invite-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Modo casal</span>
          <h2>{coupleReady ? "Espaço do casal ativo" : coupleSpace ? "Convite do casal pendente" : "Modo casal ainda não criado"}</h2>
        </div>
      </div>

      {!coupleSpace && (
        <div className="invite-placeholder">
          <h3>Crie um convite para iniciar o modo casal</h3>
          <p>O espaço compartilhado só será usado depois que você criar ou aceitar um convite e entrar no modo casal.</p>
          <label>Nome da outra pessoa<input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} placeholder="Ex: Ana" /></label>
          <button disabled={loading || !partnerName.trim()} onClick={() => createCouple(partnerName)}>{loading ? "Criando..." : "Criar convite do casal"}</button>
        </div>
      )}

      {coupleSpace && !coupleInvite && !coupleReady && (
        <div className="invite-placeholder">
          <h3>Convite pendente</h3>
          <p>Gere um novo link para a outra pessoa aceitar. O modo casal permanece inativo até o aceite.</p>
          <button disabled={loading} onClick={() => createCouple(partnerName)}>Gerar novo link</button>
          <button className="ghost-button" disabled={loading} onClick={() => refreshCoupleStatus()}>{loading ? "Verificando..." : "Verificar aceite"}</button>
        </div>
      )}

      {coupleReady && !coupleInvite && (
        <div className="invite-placeholder">
          <h3>Modo casal ativo</h3>
          <p>O espaço compartilhado já está liberado para as duas pessoas.</p>
          <button onClick={goToCouple}>Entrar no modo casal</button>
        </div>
      )}

      {coupleSpace && coupleInvite && (
        <div className="invite-grid">
          <div className="qr-card">
            <div className="invite-code-mark">FF</div>
            <small>Código: {code}</small>
          </div>
          <div className="invite-content">
            <p>Compartilhe este convite para a outra pessoa entrar no mesmo espaço financeiro do casal. Seus dados individuais continuam separados.</p>
            <div className="invite-link-box">{link}</div>
            <div className="invite-actions">
              <button type="button" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setMessage("Não foi possível copiar automaticamente. Selecione o link acima.");
                }
              }}>{copied ? "Link copiado" : "Copiar link"}</button>
              <button type="button" className="ghost-button" onClick={() => window.open(`https://wa.me/?text=${whatsappText}`, "_blank", "noopener,noreferrer")}>Enviar WhatsApp</button>
              <button type="button" className="ghost-button" disabled={loading} onClick={() => refreshCoupleStatus()}>{loading ? "Verificando..." : "Verificar aceite"}</button>
              <button type="button" disabled={!coupleReady} onClick={goToCouple}>{coupleReady ? "Entrar no modo casal" : "Aguardando aceite"}</button>
            </div>
            <div className="invite-warning">Seus dados individuais continuam separados. O modo casal só fica ativo depois que a outra pessoa aceitar este convite.</div>
          </div>
        </div>
      )}
    </section>
  );
}

function InviteAccept({ invite, loading, message, acceptInvite }) {
  const unavailable = invite?.used || invite?.expired || Number(invite?.memberCount || 0) >= 2;
  return (
    <main className="finanflow-app invite-shell">
      <section className="main-content">
        <section className="panel invite-accept-card">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Convite recebido</span>
              <h2>Entrar no FinanFlow Casal</h2>
            </div>
          </div>
          <p>{invite ? `${invite.ownerName} convidou você para o espaço ${invite.spaceName}.` : "Carregando dados do convite..."}</p>
          {invite && unavailable && <div className="invite-warning">Este convite não está disponível. Ele pode ter expirado, já ter sido usado ou o casal já estar completo.</div>}
          {message && <div className="status-box" role="status" aria-live="polite">{message}</div>}
          <div className="invite-actions">
            <button type="button" disabled={!invite || unavailable || loading} onClick={acceptInvite}>{loading ? "Aceitando..." : "Aceitar convite"}</button>
            <button type="button" className="ghost-button" onClick={() => { window.history.replaceState({}, "", "/"); window.location.reload(); }}>Voltar ao FinanFlow</button>
          </div>
          <div className="invite-warning">Ao aceitar, será criado um espaço financeiro compartilhado. Seus dados individuais continuam separados.</div>
        </section>
      </section>
    </main>
  );
}

function StatCard({ title, value, text, tone }) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </article>
  );
}

function DataRow({ label, value, className = "" }) {
  return (
    <div className={`data-row ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Empty({ title, text }) {
  return <div className="empty-state"><strong>{title}</strong><p>{text}</p></div>;
}

function Decision({ buyForm, setBuyForm, ready, free }) {
  const total = Number(buyForm.total || 0);
  const { monthlyImpact, canBuy } = calculatePurchase(total, buyForm.installments, free);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Decisão financeira</span>
          <h2>Posso comprar?</h2>
        </div>
      </div>
      <div className="buy-grid">
        <label>Compra<input value={buyForm.item} onChange={(e) => setBuyForm({ ...buyForm, item: e.target.value })} placeholder="Ex: geladeira" /></label>
        <label>Valor total<input type="number" value={buyForm.total} onChange={(e) => setBuyForm({ ...buyForm, total: e.target.value })} placeholder="0,00" /></label>
        <label>Parcelas<input type="number" value={buyForm.installments} onChange={(e) => setBuyForm({ ...buyForm, installments: e.target.value })} /></label>
      </div>
      <div className={canBuy ? "decision-box ok" : "decision-box bad"}>
        {ready ? (total > 0 ? (canBuy ? `Compra parece possível. Parcela estimada: ${money(monthlyImpact)}.` : `Compra não recomendada agora. Parcela estimada: ${money(monthlyImpact)}.`) : "Informe uma compra para simular.") : "Aguardando dados. Cadastre saldo, receita e despesas antes de simular uma compra."}
      </div>
    </section>
  );
}
