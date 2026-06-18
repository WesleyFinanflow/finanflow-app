import { useEffect, useMemo, useState } from "react";

function getApiUrl() {
  const host = window.location.hostname;

  if (host.endsWith("app.github.dev") && host.includes("-5173")) {
    return `${window.location.protocol}//${host.replace("-5173", "-3000")}`;
  }

  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  return "http://localhost:3000";
}

const API_URL = getApiUrl();
const today = new Date().toISOString().slice(0, 10);
const menu = ["Início", "Lançamentos", "Contas", "Planejamento", "Configurações"];

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("finanflow_user") || "null"));
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [activeMenu, setActiveMenu] = useState("Início");
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", balance: "" });
  const [txForm, setTxForm] = useState({ type: "despesa", description: "", amount: "", date: today, category: "Moradia", status: "pendente" });
  const [buyForm, setBuyForm] = useState({ item: "", total: "", installments: "1" });
  const [reserve, setReserve] = useState(300);
  const [coupleInvite, setCoupleInvite] = useState(null);

  const firstName = user?.name?.split(" ")?.[0] || "Wesley";
  const coupleSpace = spaces.find((space) => space.type === "couple");

  const summary = useMemo(() => {
    const balance = accounts.reduce((total, item) => total + Number(item.balance || 0), 0);
    const income = transactions.filter((item) => item.type === "receita").reduce((total, item) => total + Number(item.amount || 0), 0);
    const expenses = transactions.filter((item) => item.type === "despesa").reduce((total, item) => total + Number(item.amount || 0), 0);
    const debt = transactions.filter((item) => item.type === "divida").reduce((total, item) => total + Number(item.amount || 0), 0);
    const goals = transactions.filter((item) => item.type === "meta").reduce((total, item) => total + Number(item.amount || 0), 0);
    const commitments = expenses + debt + goals;
    return { balance, income, expenses, debt, goals, commitments, free: balance + income - commitments - reserve };
  }, [accounts, transactions, reserve]);

  const hasData = summary.balance || summary.income || summary.commitments || transactions.length > 0;

  async function loadSpaceData(spaceId) {
    if (!spaceId) return;
    const [accountData, txData] = await Promise.all([api(`/api/spaces/${spaceId}/accounts`), api(`/api/spaces/${spaceId}/transactions`)]);
    setAccounts(accountData.accounts || []);
    setTransactions(txData.transactions || []);
  }

  async function loadSpaces() {
    const data = await api("/api/spaces");
    const loaded = data.spaces || [];
    setSpaces(loaded);
    const individual = loaded.find((space) => space.type === "individual");
    const selected = activeSpaceId || individual?._id || loaded[0]?._id || "";
    setActiveSpaceId(selected);
    if (selected) await loadSpaceData(selected);
  }

  useEffect(() => { if (user) loadSpaces().catch((error) => setMessage(error.message)); }, [user]);

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
    await api(`/api/spaces/${activeSpaceId}/accounts`, { method: "POST", body: JSON.stringify({ name: accountForm.name, balance: Number(accountForm.balance || 0), ownerName: firstName }) });
    setAccountForm({ name: "", balance: "" });
    await loadSpaceData(activeSpaceId);
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (!txForm.description.trim()) return setMessage("Informe a descrição.");
    if (!txForm.amount) return setMessage("Informe o valor.");
    await api(`/api/spaces/${activeSpaceId}/transactions`, { method: "POST", body: JSON.stringify({ ...txForm, amount: Number(txForm.amount || 0), responsibleName: firstName }) });
    setTxForm({ ...txForm, description: "", amount: "" });
    await loadSpaceData(activeSpaceId);
  }

  async function createCouple() {
    const data = await api("/api/spaces/couple", { method: "POST", body: JSON.stringify({ partnerName: "Parceira" }) });
    setCoupleInvite(data.invite);
    await loadSpaces();
  }

  function logout() {
    localStorage.removeItem("finanflow_token");
    localStorage.removeItem("finanflow_user");
    setUser(null);
  }

  if (!user) {
    return <main className="auth-page"><section className="auth-card"><span className="eyebrow">FinanFlow</span><h1>{authMode === "login" ? "Entrar" : "Criar conta"}</h1><p>{authMode === "login" ? "Acesse seu painel financeiro." : "Crie seu acesso para começar."}</p><form className="form" onSubmit={handleAuth}>{authMode === "register" && <label>Nome<input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="Seu nome" /></label>}<label>E-mail<input value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="seuemail@exemplo.com" type="email" /></label><label>Senha<input value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="Mínimo 6 caracteres" type="password" /></label><button disabled={loading}>{loading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}</button></form><button className="ghost-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>{authMode === "login" ? "Ainda não tenho conta" : "Já tenho conta"}</button>{message && <div className="status-box">{message}</div>}</section></main>;
  }

  return <main className="finanflow-real"><aside className="real-sidebar"><div className="brand-row"><div className="brand-icon">♙</div><div><strong>FinanFlow</strong><span>Modo individual</span></div></div><nav>{menu.map((item) => <button key={item} className={activeMenu === item ? "active" : ""} onClick={() => setActiveMenu(item)}>{item}</button>)}</nav><button className="couple-button" onClick={() => setActiveMenu("Casal")}>Ir para casal</button><button className="danger-button" onClick={() => setMessage("Função de exclusão segura será criada depois.")}>Zerar dados</button></aside><section className="real-content"><Hero firstName={firstName} />{activeMenu === "Início" && <Inicio summary={summary} hasData={hasData} setActiveMenu={setActiveMenu} buyForm={buyForm} setBuyForm={setBuyForm} reserve={reserve} transactions={transactions} />}{activeMenu === "Lançamentos" && <Lancamentos txForm={txForm} setTxForm={setTxForm} addTransaction={addTransaction} transactions={transactions} />}{activeMenu === "Contas" && <Contas accounts={accounts} accountForm={accountForm} setAccountForm={setAccountForm} addAccount={addAccount} firstName={firstName} />}{activeMenu === "Planejamento" && <Planejamento summary={summary} buyForm={buyForm} setBuyForm={setBuyForm} />}{activeMenu === "Configurações" && <Config reserve={reserve} setReserve={setReserve} firstName={firstName} coupleSpace={coupleSpace} setActiveMenu={setActiveMenu} />}{activeMenu === "Casal" && <Casal coupleSpace={coupleSpace} coupleInvite={coupleInvite} createCouple={createCouple} firstName={firstName} />}<button className="logout-fixed" onClick={logout}>Sair</button>{message && <div className="floating-message">{message}</div>}</section></main>;
}

function Hero({ firstName }) { return <section className="hero-real"><div><span className="eyebrow">Controle financeiro individual</span><h1>{firstName}</h1><p>Você está no modo individual. Cadastre seus dados; o modo casal só começa depois do convite.</p></div><div className="month-card"><span>Mês analisado</span><strong>{new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong></div></section>; }
function Inicio({ summary, hasData, setActiveMenu, buyForm, setBuyForm, reserve, transactions }) { const pending = transactions.filter((item) => item.status === "pendente" && item.type !== "receita"); return <><section className="start-real"><span className="eyebrow">Comece por aqui</span><h2>Cadastre seus primeiros dados</h2><p>O FinanFlow começa individual. Cadastre seus saldos, receitas e despesas. O modo casal só será ativado quando você criar ou aceitar um convite.</p><div className="quick-actions"><button onClick={() => setActiveMenu("Contas")}>Adicionar saldo</button><button onClick={() => setActiveMenu("Lançamentos")}>Adicionar receita</button><button onClick={() => setActiveMenu("Lançamentos")}>Adicionar despesa</button></div></section><section className="kpi-grid"><Kpi title="Saldo atual" value={hasData ? money(summary.balance) : "Aguardando dados"} text="Contas + movimentações pagas" tone="cyan" /><Kpi title="Receitas previstas" value={hasData ? money(summary.income) : "Aguardando dados"} text="Ainda pendentes no mês" tone="green" /><Kpi title="Compromissos" value={hasData ? money(summary.commitments) : "Aguardando dados"} text="Contas, dívidas e metas pendentes" tone="yellow" /><Kpi title="Saldo livre seguro" value={hasData ? money(summary.free) : "Aguardando dados"} text={`Reserva protegida: ${money(reserve)}`} tone="blue" /></section><section className="two-columns"><Decision buyForm={buyForm} setBuyForm={setBuyForm} ready={hasData} free={summary.free} /><section className="real-panel"><span className="eyebrow">Próximos vencimentos</span><h2>O que ainda precisa pagar</h2>{pending.length ? pending.map((item) => <div className="row" key={item._id}><span>{item.description}</span><strong>{money(item.amount)}</strong></div>) : <Empty title="Aguardando os primeiros dados" text="Depois que você cadastrar despesas pendentes, elas aparecerão aqui." />}</section></section></>; }
function Lancamentos({ txForm, setTxForm, addTransaction, transactions }) { return <section className="two-columns top-align"><form className="real-panel" onSubmit={addTransaction}><span className="eyebrow">Novo lançamento</span><h2>Adicionar movimentação</h2><div className="type-tabs">{["receita", "despesa", "divida", "meta"].map((type) => <button type="button" key={type} className={txForm.type === type ? "selected" : ""} onClick={() => setTxForm({ ...txForm, type })}>{type === "meta" ? "Meta / reserva" : type}</button>)}</div><div className="form-grid"><label>Descrição<input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Ex: mercado, salário" /></label><label>Valor<input type="number" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} placeholder="0,00" /></label><label>Data / vencimento<input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} /></label><label>Categoria<select value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })}><option>Moradia</option><option>Alimentação</option><option>Transporte</option><option>Renda</option><option>Dívida</option><option>Reserva</option></select></label></div><button>Salvar lançamento</button></form><section className="real-panel"><span className="eyebrow">Extrato do mês</span><h2>Lançamentos</h2>{transactions.length ? transactions.map((item) => <div className="row" key={item._id}><span>{item.description}</span><strong>{money(item.amount)}</strong></div>) : <Empty title="Nenhum lançamento neste mês" text="Cadastre receitas, despesas, dívidas ou metas para começar." />}</section></section>; }
function Contas({ accounts, accountForm, setAccountForm, addAccount, firstName }) { return <section className="real-panel"><span className="eyebrow">Contas</span><h2>Saldos manuais</h2>{accounts.map((item) => <div className="account-row" key={item._id}><input value={item.name} readOnly /><select><option>{firstName}</option></select><input value={item.balance} readOnly /><strong>{money(item.balance)}</strong></div>)}<form className="account-row" onSubmit={addAccount}><input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Nome da conta" /><select><option>{firstName}</option></select><input type="number" value={accountForm.balance} onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })} placeholder="Saldo" /><button>Adicionar</button></form></section>; }
function Planejamento({ summary, buyForm, setBuyForm }) { return <section className="two-columns"><Decision buyForm={buyForm} setBuyForm={setBuyForm} ready={summary.balance || summary.income || summary.commitments} free={summary.free} /><section className="real-panel"><span className="eyebrow">Resumo do mês</span><h2>Para entender o que pode fazer</h2><div className="summary-list"><div><span>Receitas do mês</span><strong>{summary.income ? money(summary.income) : "Aguardando dados"}</strong></div><div><span>Despesas do mês</span><strong>{summary.expenses ? money(summary.expenses) : "Aguardando dados"}</strong></div><div><span>Dívidas do mês</span><strong>{summary.debt ? money(summary.debt) : "Aguardando dados"}</strong></div><div><span>Metas / reserva</span><strong>{summary.goals ? money(summary.goals) : "Aguardando dados"}</strong></div><div className="highlight-row"><span>Saldo livre seguro</span><strong>{summary.free ? money(summary.free) : "Aguardando dados"}</strong></div></div></section></section>; }
function Config({ reserve, setReserve, firstName, coupleSpace, setActiveMenu }) { return <><section className="real-panel"><span className="eyebrow">Configuração</span><h2>Dados individuais</h2><div className="form-grid"><label>Seu nome<input value={firstName} readOnly /></label><label>Reserva mínima protegida<input type="number" value={reserve} onChange={(e) => setReserve(Number(e.target.value || 0))} /></label></div><button>Salvar configurações</button></section><section className="real-panel"><span className="eyebrow">Modo casal</span><h2>{coupleSpace ? "Espaço do casal criado" : "Espaço do casal ainda não criado"}</h2><div className="couple-strip"><span>{coupleSpace ? coupleSpace.name : "Crie um convite para iniciar o modo casal."}</span><button onClick={() => setActiveMenu("Casal")}>Ir para casal</button></div></section></>; }
function Casal({ coupleSpace, coupleInvite, createCouple, firstName }) { const code = coupleInvite?.code || "FF-AGUARDANDO"; const link = `${window.location.origin}/convite-casal?code=${code}&from=${firstName}`; return <section className="real-panel couple-card"><span className="eyebrow">Modo casal</span><h2>{coupleSpace ? "Espaço do casal criado" : "Criar espaço do casal"}</h2>{!coupleSpace && <button onClick={createCouple}>Criar convite do casal</button>}{coupleSpace && <div className="invite-area"><div className="fake-qr">▦</div><div><p>Compartilhe este convite para a outra pessoa entrar no mesmo espaço financeiro do casal. Seus dados individuais continuam separados.</p><div className="invite-link">{link}</div><div className="quick-actions"><button>Copiar link</button><button>Enviar WhatsApp</button><button>Imprimir QR</button></div><div className="warning">Aviso: seus dados individuais continuam separados.</div></div></div>}</section>; }
function Kpi({ title, value, text, tone }) { return <article className={`kpi ${tone}`}><span>{title}</span><strong>{value}</strong><p>{text}</p></article>; }
function Empty({ title, text }) { return <div className="empty"><strong>{title}</strong><p>{text}</p></div>; }
function Decision({ buyForm, setBuyForm, ready, free }) { const canBuy = Number(buyForm.total || 0) > 0 && free >= Number(buyForm.total || 0); return <section className="real-panel"><span className="eyebrow">Decisão financeira</span><h2>Posso comprar?</h2><div className="buy-grid"><label>Compra<input value={buyForm.item} onChange={(e) => setBuyForm({ ...buyForm, item: e.target.value })} placeholder="Ex: geladeira" /></label><label>Valor total<input type="number" value={buyForm.total} onChange={(e) => setBuyForm({ ...buyForm, total: e.target.value })} placeholder="0,00" /></label><label>Parcelas<input type="number" value={buyForm.installments} onChange={(e) => setBuyForm({ ...buyForm, installments: e.target.value })} /></label></div><div className={canBuy ? "decision ok" : "decision bad"}>{ready ? (canBuy ? "Compra parece possível." : "Compra não recomendada agora.") : "Aguardando dados. Cadastre saldo, receita e despesas antes de simular uma compra."}</div></section>; }
