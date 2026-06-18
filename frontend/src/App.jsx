import { useEffect, useMemo, useState } from "react";

function getApiUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  const currentHost = window.location.hostname;
  if (currentHost.endsWith("app.github.dev") && currentHost.includes("-5173")) {
    const backendHost = currentHost.replace("-5173", "-3000");
    return `${window.location.protocol}//${backendHost}`;
  }

  return "http://localhost:3000";
}

const API_URL = getApiUrl();

const menuItems = [
  { id: "resumo", label: "Resumo" },
  { id: "lancamentos", label: "Receitas e Despesas" },
  { id: "dividas", label: "Dívidas e Score" },
  { id: "plano", label: "Plano" },
  { id: "metas", label: "Metas" },
  { id: "casal", label: "Casal" },
  { id: "aprender", label: "Aprender e Evoluir" },
  { id: "config", label: "Configurações" },
];

function formatMoney(value, hidden = false) {
  if (hidden) return "R$ •••••";
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function api(path, options = {}) {
  const token = localStorage.getItem("finanflow_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Erro na comunicação com a API.");
  return data;
}

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("finanflow_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [activeMenu, setActiveMenu] = useState("resumo");
  const [showValues, setShowValues] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", balance: "" });
  const [newTransaction, setNewTransaction] = useState({
    type: "despesa",
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    category: "Geral",
    status: "pendente",
  });

  const activeSpace = spaces.find((space) => space._id === activeSpaceId);
  const firstName = user?.name?.split(" ")?.[0] || "Wesley";

  const summary = useMemo(() => {
    const balance = accounts.reduce((total, account) => total + Number(account.balance || 0), 0);
    const income = transactions.filter((item) => item.type === "receita").reduce((total, item) => total + Number(item.amount || 0), 0);
    const outcome = transactions.filter((item) => item.type !== "receita").reduce((total, item) => total + Number(item.amount || 0), 0);
    const debt = transactions.filter((item) => item.type === "divida").reduce((total, item) => total + Number(item.amount || 0), 0);
    const goals = transactions.filter((item) => item.type === "meta").reduce((total, item) => total + Number(item.amount || 0), 0);
    const free = balance + income - outcome;

    return { balance, income, outcome, debt, goals, free };
  }, [accounts, transactions]);

  async function loadSpaceData(spaceId) {
    if (!spaceId) return;
    const [accountData, transactionData] = await Promise.all([
      api(`/api/spaces/${spaceId}/accounts`),
      api(`/api/spaces/${spaceId}/transactions`),
    ]);
    setAccounts(accountData.accounts || []);
    setTransactions(transactionData.transactions || []);
  }

  async function loadSpaces() {
    const data = await api("/api/spaces");
    const loadedSpaces = data.spaces || [];
    setSpaces(loadedSpaces);
    const selected = activeSpaceId || loadedSpaces[0]?._id || "";
    setActiveSpaceId(selected);
    if (selected) await loadSpaceData(selected);
  }

  useEffect(() => {
    if (user) loadSpaces().catch((error) => setMessage(error.message));
  }, [user]);

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, { method: "POST", body: JSON.stringify(form) });
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

  async function handleSelectSpace(spaceId) {
    setActiveSpaceId(spaceId);
    await loadSpaceData(spaceId);
  }

  async function handleAddAccount(event) {
    event.preventDefault();
    if (!activeSpaceId) return setMessage("Selecione um espaço financeiro.");
    if (!newAccount.name.trim()) return setMessage("Informe o nome da conta.");

    await api(`/api/spaces/${activeSpaceId}/accounts`, {
      method: "POST",
      body: JSON.stringify({ name: newAccount.name, balance: Number(newAccount.balance || 0) }),
    });

    setNewAccount({ name: "", balance: "" });
    await loadSpaceData(activeSpaceId);
  }

  async function handleAddTransaction(event) {
    event.preventDefault();
    if (!activeSpaceId) return setMessage("Selecione um espaço financeiro.");
    if (!newTransaction.description.trim()) return setMessage("Informe a descrição.");
    if (!newTransaction.amount) return setMessage("Informe o valor.");

    await api(`/api/spaces/${activeSpaceId}/transactions`, {
      method: "POST",
      body: JSON.stringify({ ...newTransaction, amount: Number(newTransaction.amount || 0) }),
    });

    setNewTransaction({ ...newTransaction, description: "", amount: "" });
    await loadSpaceData(activeSpaceId);
  }

  function logout() {
    localStorage.removeItem("finanflow_token");
    localStorage.removeItem("finanflow_user");
    setUser(null);
    setSpaces([]);
    setAccounts([]);
    setTransactions([]);
    setActiveSpaceId("");
  }

  function renderMainContent() {
    if (activeMenu === "lancamentos") {
      return (
        <section className="screen-grid">
          <form className="panel compact-panel" onSubmit={handleAddTransaction}>
            <h2>Novo lançamento</h2>
            <div className="form-grid">
              <label>Tipo<select value={newTransaction.type} onChange={(e) => setNewTransaction({ ...newTransaction, type: e.target.value })}><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="divida">Dívida</option><option value="meta">Meta</option></select></label>
              <label>Valor<input value={newTransaction.amount} onChange={(e) => setNewTransaction({ ...newTransaction, amount: e.target.value })} placeholder="0,00" type="number" /></label>
              <label>Descrição<input value={newTransaction.description} onChange={(e) => setNewTransaction({ ...newTransaction, description: e.target.value })} placeholder="Ex: Mercado, salário" /></label>
              <label>Data<input value={newTransaction.date} onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })} type="date" /></label>
            </div>
            <button>Adicionar lançamento</button>
          </form>
          <section className="panel">
            <h2>Últimos lançamentos</h2>
            {transactions.length === 0 ? <p>Nenhum lançamento cadastrado ainda.</p> : transactions.map((item) => <div className="data-row" key={item._id}><span>{item.description}</span><strong>{formatMoney(item.amount, !showValues)}</strong></div>)}
          </section>
        </section>
      );
    }

    if (activeMenu === "dividas") {
      return <Placeholder title="Dívidas e Score" text="Aqui vamos mostrar suas dívidas, risco financeiro, score interno e prioridades de pagamento." value={formatMoney(summary.debt, !showValues)} />;
    }

    if (activeMenu === "plano") {
      return <Placeholder title="Plano financeiro" text="Aqui entra o plano completo com rotas, próximos passos e simulação do que pode ou não comprar." value="Ver plano completo" />;
    }

    if (activeMenu === "metas") {
      return <Placeholder title="Metas" text="Aqui vamos organizar metas individuais, prazo, progresso e impacto no saldo livre." value={formatMoney(summary.goals, !showValues)} />;
    }

    if (activeMenu === "casal") {
      return <Placeholder title="Modo casal" text="Aqui ficará o convite, visão compartilhada, metas do casal e plano financeiro do casal." value="Criar ou entrar no casal" />;
    }

    if (activeMenu === "aprender") {
      return <Placeholder title="Aprender e Evoluir" text="Conteúdos financeiros, imposto de renda, dívidas, investimentos e hábitos. Essa área fica fora do casal." value="Trilha inicial" />;
    }

    if (activeMenu === "config") {
      return <Placeholder title="Configurações" text="Perfil, segurança, privacidade, ocultar valores, preferências e integrações futuras." value="Ajustar app" />;
    }

    return (
      <>
        <section className="metric-grid">
          <Metric label="Saldo em contas" value={formatMoney(summary.balance, !showValues)} />
          <Metric label="Receitas" value={formatMoney(summary.income, !showValues)} />
          <Metric label="Compromissos" value={formatMoney(summary.outcome, !showValues)} />
          <Metric label="Saldo livre" value={formatMoney(summary.free, !showValues)} highlight />
        </section>

        <section className="screen-grid">
          <section className="panel">
            <div className="panel-head"><h2>Resumo da rota</h2><span>Atenção</span></div>
            <p>Seu painel individual já está ativo. Adicione contas e lançamentos para o FinanFlow calcular sua rota financeira.</p>
            <div className="route-card">Sua rota financeira precisa de dados para ficar precisa.</div>
          </section>

          <form className="panel compact-panel" onSubmit={handleAddAccount}>
            <h2>Nova conta</h2>
            <label>Nome da conta<input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="Ex: Nubank, carteira" /></label>
            <label>Saldo atual<input value={newAccount.balance} onChange={(e) => setNewAccount({ ...newAccount, balance: e.target.value })} placeholder="0,00" type="number" /></label>
            <button>Adicionar conta</button>
          </form>
        </section>

        <section className="screen-grid">
          <section className="panel"><h2>Contas</h2>{accounts.map((account) => <div className="data-row" key={account._id}><span>{account.name}</span><strong>{formatMoney(account.balance, !showValues)}</strong></div>)}</section>
          <section className="panel"><h2>Últimos lançamentos</h2>{transactions.length === 0 ? <p>Nenhum lançamento cadastrado ainda.</p> : transactions.slice(0, 5).map((item) => <div className="data-row" key={item._id}><span>{item.description}</span><strong>{formatMoney(item.amount, !showValues)}</strong></div>)}</section>
        </section>
      </>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">FinanFlow</span>
          <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>
          <p>{mode === "login" ? "Acesse seu painel financeiro." : "Crie seu acesso para começar."}</p>
          <form className="form" onSubmit={handleAuth}>
            {mode === "register" && <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Seu nome" /></label>}
            <label>E-mail<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="seuemail@exemplo.com" type="email" /></label>
            <label>Senha<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" type="password" /></label>
            <button disabled={loading}>{loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}</button>
          </form>
          <button className="ghost-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Ainda não tenho conta" : "Já tenho conta"}</button>
          {message && <div className="status-box">{message}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className={`finance-app ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <aside className="sidebar">
        <button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
        <div className="brand">FinanFlow</div>
        <nav>{menuItems.map((item) => <button key={item.id} className={activeMenu === item.id ? "nav-active" : ""} onClick={() => setActiveMenu(item.id)}>{item.label}</button>)}</nav>
      </aside>

      <section className="main-area">
        <header className="top-card">
          <div className="avatar">{firstName.charAt(0)}</div>
          <div className="top-text"><span>Olá, {firstName}</span><strong>{activeSpace ? activeSpace.name : "Espaço individual"}</strong></div>
          <div className="free-balance"><small>Saldo livre estimado</small><strong>{formatMoney(summary.free, !showValues)}</strong></div>
          <button className="ghost-button" onClick={() => setShowValues(!showValues)}>{showValues ? "Ocultar" : "Mostrar"}</button>
          <button className="ghost-button" onClick={logout}>Sair</button>
        </header>

        <section className="space-tabs">{spaces.map((space) => <button key={space._id} className={space._id === activeSpaceId ? "active-tab" : ""} onClick={() => handleSelectSpace(space._id)}>{space.type === "couple" ? "Casal" : "Individual"}</button>)}</section>

        {renderMainContent()}
        {message && <div className="status-box floating-message">{message}</div>}
      </section>
    </main>
  );
}

function Metric({ label, value, highlight }) {
  return <article className={highlight ? "metric-card metric-highlight" : "metric-card"}><span>{label}</span><strong>{value}</strong></article>;
}

function Placeholder({ title, text, value }) {
  return <section className="panel placeholder-panel"><span className="eyebrow">Em desenvolvimento</span><h2>{title}</h2><p>{text}</p><div className="route-card">{value}</div></section>;
}
