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

function formatMoney(value) {
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

  const summary = useMemo(() => {
    const balance = accounts.reduce((total, account) => total + Number(account.balance || 0), 0);
    const income = transactions
      .filter((item) => item.type === "receita")
      .reduce((total, item) => total + Number(item.amount || 0), 0);
    const outcome = transactions
      .filter((item) => item.type !== "receita")
      .reduce((total, item) => total + Number(item.amount || 0), 0);

    return {
      balance,
      income,
      outcome,
      free: balance + income - outcome,
    };
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
    if (user) {
      loadSpaces().catch((error) => setMessage(error.message));
    }
  }, [user]);

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify(form),
      });

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
      body: JSON.stringify({
        name: newAccount.name,
        balance: Number(newAccount.balance || 0),
      }),
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
      body: JSON.stringify({
        ...newTransaction,
        amount: Number(newTransaction.amount || 0),
      }),
    });

    setNewTransaction({
      ...newTransaction,
      description: "",
      amount: "",
    });
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

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">FinanFlow</span>
          <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>
          <p>{mode === "login" ? "Acesse seu painel financeiro." : "Crie seu acesso para começar."}</p>

          <form className="form" onSubmit={handleAuth}>
            {mode === "register" && (
              <label>
                Nome
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Seu nome"
                />
              </label>
            )}

            <label>
              E-mail
              <input
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="seuemail@exemplo.com"
                type="email"
              />
            </label>

            <label>
              Senha
              <input
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="Mínimo 6 caracteres"
                type="password"
              />
            </label>

            <button disabled={loading}>{loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}</button>
          </form>

          <button className="ghost-button" onClick={() => setMode(mode === "login" ? "register" : "login")}> 
            {mode === "login" ? "Ainda não tenho conta" : "Já tenho conta"}
          </button>

          {message && <div className="status-box">{message}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">FinanFlow</span>
          <h1>Olá, {user.name}</h1>
          <p>{activeSpace ? `Espaço atual: ${activeSpace.name}` : "Seu painel financeiro inicial."}</p>
        </div>
        <button className="ghost-button" onClick={logout}>Sair</button>
      </header>

      <section className="space-tabs">
        {spaces.map((space) => (
          <button
            key={space._id}
            className={space._id === activeSpaceId ? "active-tab" : ""}
            onClick={() => handleSelectSpace(space._id)}
          >
            {space.type === "couple" ? "Casal" : "Individual"} · {space.name}
          </button>
        ))}
      </section>

      <section className="stats-grid">
        <article>
          <span>Saldo em contas</span>
          <strong>{formatMoney(summary.balance)}</strong>
        </article>
        <article>
          <span>Receitas</span>
          <strong>{formatMoney(summary.income)}</strong>
        </article>
        <article>
          <span>Despesas e compromissos</span>
          <strong>{formatMoney(summary.outcome)}</strong>
        </article>
        <article>
          <span>Saldo livre estimado</span>
          <strong>{formatMoney(summary.free)}</strong>
        </article>
      </section>

      <section className="content-grid">
        <form className="panel" onSubmit={handleAddAccount}>
          <h2>Nova conta</h2>
          <label>
            Nome da conta
            <input
              value={newAccount.name}
              onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })}
              placeholder="Ex: Nubank, dinheiro, carteira"
            />
          </label>
          <label>
            Saldo atual
            <input
              value={newAccount.balance}
              onChange={(event) => setNewAccount({ ...newAccount, balance: event.target.value })}
              placeholder="0,00"
              type="number"
            />
          </label>
          <button>Adicionar conta</button>
        </form>

        <form className="panel" onSubmit={handleAddTransaction}>
          <h2>Novo lançamento</h2>
          <label>
            Tipo
            <select value={newTransaction.type} onChange={(event) => setNewTransaction({ ...newTransaction, type: event.target.value })}>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
              <option value="divida">Dívida</option>
              <option value="meta">Meta</option>
            </select>
          </label>
          <label>
            Descrição
            <input
              value={newTransaction.description}
              onChange={(event) => setNewTransaction({ ...newTransaction, description: event.target.value })}
              placeholder="Ex: Internet, mercado, salário"
            />
          </label>
          <label>
            Valor
            <input
              value={newTransaction.amount}
              onChange={(event) => setNewTransaction({ ...newTransaction, amount: event.target.value })}
              placeholder="0,00"
              type="number"
            />
          </label>
          <label>
            Data
            <input
              value={newTransaction.date}
              onChange={(event) => setNewTransaction({ ...newTransaction, date: event.target.value })}
              type="date"
            />
          </label>
          <button>Adicionar lançamento</button>
        </form>
      </section>

      <section className="content-grid">
        <section className="panel">
          <h2>Contas</h2>
          {accounts.length === 0 ? <p>Nenhuma conta cadastrada ainda.</p> : accounts.map((account) => (
            <div className="data-row" key={account._id}>
              <span>{account.name}</span>
              <strong>{formatMoney(account.balance)}</strong>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Lançamentos</h2>
          {transactions.length === 0 ? <p>Nenhum lançamento cadastrado ainda.</p> : transactions.map((transaction) => (
            <div className="data-row" key={transaction._id}>
              <span>{transaction.description}</span>
              <strong>{formatMoney(transaction.amount)}</strong>
            </div>
          ))}
        </section>
      </section>

      {message && <div className="status-box floating-message">{message}</div>}
    </main>
  );
}
