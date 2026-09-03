import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BarChart3, CalendarClock, CalendarDays, Camera, ChartPie, Check, ChevronDown, CircleDollarSign, Database, Download, Eye, EyeOff, FileDown, Fuel, HandCoins, HeartHandshake, History, House, LockKeyhole, LogOut, MonitorSmartphone, Music2, Printer, ReceiptText, RotateCcw, Settings, ShieldCheck, ShoppingCart, Smartphone, Trash2, TrendingUp, UserRound, Utensils, Wallet, X } from "lucide-react";
import { calculatePurchase, calculateSummary } from "./finance.js";
import { createTransactionForm } from "./form-state.js";
import { getCoupleMenuState } from "./space-menu.js";
import wesleyAvatar from "./assets/wesley-avatar.jpeg";
import balanceWalletIcon from "./assets/financial-icons/balance-wallet.webp";
import incomeWalletIcon from "./assets/financial-icons/income-wallet.webp";
import commitmentsCalendarIcon from "./assets/financial-icons/commitments-calendar.webp";
import safeShieldIcon from "./assets/financial-icons/safe-shield.webp";
import navHomeIcon from "./assets/navigation/home.webp";
import navTransactionsIcon from "./assets/navigation/transactions.webp";
import navAccountsIcon from "./assets/navigation/accounts.webp";
import navPlanningIcon from "./assets/navigation/planning.webp";
import navReportsIcon from "./assets/navigation/reports.webp";

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
const currentMonthKey = today.slice(0, 7);
const MAX_MONEY = 1_000_000_000_000;
const ACTIVE_MODE_KEY = "finanflow_active_mode";
const transactionCategories = {
  receita: ["Salário", "Renda extra", "Benefícios", "Investimentos", "Reembolso", "Presente", "Outras receitas"],
  despesa: ["Alimentação", "Moradia", "Transporte", "Saúde", "Educação", "Lazer", "Assinaturas", "Compras", "Serviços", "Impostos", "Pets", "Família", "Outras despesas"],
  divida: ["Cartão de crédito", "Empréstimo", "Financiamento", "Moradia", "Veículo", "Impostos", "Educação", "Saúde", "Outras dívidas"],
};
const menu = [
  { label: "Início", shortLabel: "Início", icon: House, iconImage: navHomeIcon },
  { label: "Lançamentos", shortLabel: "Lançar", icon: ArrowLeftRight, iconImage: navTransactionsIcon },
  { label: "Contas", shortLabel: "Contas", icon: Wallet, iconImage: navAccountsIcon },
  { label: "Planejamento", shortLabel: "Planejar", icon: ChartPie, iconImage: navPlanningIcon },
  { label: "Relatórios", shortLabel: "Relatórios", icon: BarChart3, iconImage: navReportsIcon },
];

function getInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code || window.location.pathname !== "/convite-casal") return null;
  return { code, from: params.get("from") || "" };
}

function getPasswordResetFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  return window.location.pathname === "/recuperar-senha" && token ? token : "";
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function moneyOrWaiting(value, hasData) {
  return hasData ? money(value) : "Aguardando dados";
}

function monthDate(monthKey) {
  const [year, month] = String(monthKey || currentMonthKey).split("-").map(Number);
  return new Date(year, Math.max(0, (month || 1) - 1), 1, 12);
}

function monthLabel(monthKey, style = "long") {
  return new Intl.DateTimeFormat("pt-BR", { month: style, year: "numeric" }).format(monthDate(monthKey)).replace(".", "");
}

function compactMonthLabel(monthKey) {
  const date = monthDate(monthKey);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "");
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}/${date.getFullYear()}`;
}

function monthOptions() {
  const offsets = [0, -1, ...Array.from({ length: 12 }, (_, index) => index + 1)];
  return offsets.map((offset) => {
    const date = monthDate(currentMonthKey);
    date.setMonth(date.getMonth() + offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: compactMonthLabel(key) };
  });
}

function DashboardSelect({ value, onChange, options, label, icon: Icon, compact = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`dashboard-select ${compact ? "compact" : ""} ${open ? "is-open" : ""}`} ref={rootRef}>
      <button type="button" className="dashboard-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {Icon && <Icon size={compact ? 15 : 18} aria-hidden="true" />}
        <span>{selected?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <div className="dashboard-select-menu" role="listbox" aria-label={label}>
        {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}</button>)}
      </div>}
    </div>
  );
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("finanflow_user") || "null");
  } catch {
    localStorage.removeItem("finanflow_token");
    localStorage.removeItem("finanflow_user");
    return null;
  }
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
  const [user, setUser] = useState(() => readStoredUser());
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [activeMenu, setActiveMenu] = useState("Início");
  const [activeMode, setActiveMode] = useState(() => localStorage.getItem(ACTIVE_MODE_KEY) === "couple" ? "couple" : "individual");
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [txForm, setTxForm] = useState(() => createTransactionForm());
  const [transactionFormOpen, setTransactionFormOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ description: "", amount: "" });
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [buyForm, setBuyForm] = useState({ item: "", total: "", installments: "1" });
  const [reserve, setReserve] = useState(300);
  const [coupleInvite, setCoupleInvite] = useState(null);
  const [pendingInvite, setPendingInvite] = useState(() => getInviteFromUrl());
  const [inviteInfo, setInviteInfo] = useState(null);
  const [passwordResetToken, setPasswordResetToken] = useState(() => getPasswordResetFromUrl());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey);
  const [dueReminderOpen, setDueReminderOpen] = useState(true);
  const spaceRequestId = useRef(0);
  const profileMenuRef = useRef(null);

  const firstName = user?.name?.split(" ")?.[0] || "Wesley";
  const individualSpace = spaces.find((space) => space.type === "individual");
  const coupleSpace = spaces.find((space) => space.type === "couple");
  const coupleReady = Boolean(coupleSpace && Number(coupleSpace.memberCount || 0) > 1);
  const coupleMenuState = getCoupleMenuState(coupleSpace);
  const activeCoupleSpace = activeMode === "couple" && coupleReady ? coupleSpace : null;

  const summary = useMemo(() => calculateSummary(accounts, transactions, reserve, selectedMonthKey), [accounts, transactions, reserve, selectedMonthKey]);
  const dueTransactions = useMemo(() => transactions
    .filter((item) => item.type !== "meta" && item.status === "pendente" && item.date <= today && String(item.createdBy || "") === String(user?.id || user?._id || ""))
    .sort((left, right) => String(left.date).localeCompare(String(right.date))), [transactions, user]);

  const hasData = accounts.length > 0 || transactions.length > 0;

  async function loadSpaceData(spaceId) {
    if (!spaceId) return;
    const requestId = ++spaceRequestId.current;
    const [accountData, txData] = await Promise.all([api(`/api/spaces/${spaceId}/accounts`), api(`/api/spaces/${spaceId}/transactions`)]);
    if (requestId !== spaceRequestId.current) return;
    setAccounts(accountData.accounts || []);
    setTransactions(txData.transactions || []);
  }

  async function loadSpaces(mode = localStorage.getItem(ACTIVE_MODE_KEY) === "couple" ? "couple" : "individual") {
    const data = await api("/api/spaces");
    const loaded = data.spaces || [];
    setSpaces(loaded);
    const individual = loaded.find((space) => space.type === "individual");
    const couple = loaded.find((space) => space.type === "couple");
    const readyCouple = couple && Number(couple.memberCount || 0) > 1;
    const selectedSpace = mode === "couple" && readyCouple ? couple : individual || loaded[0] || null;
    const selected = selectedSpace?._id || "";
    setActiveMode(mode === "couple" && readyCouple ? "couple" : "individual");
    localStorage.setItem(ACTIVE_MODE_KEY, mode === "couple" && readyCouple ? "couple" : "individual");
    setActiveSpaceId(selected);
    setReserve(Number(selectedSpace?.reserve ?? 300));
    if (selected) await loadSpaceData(selected);
  }

  useEffect(() => { if (user) loadSpaces().catch((error) => setMessage(error.message)); }, [user]);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem("finanflow_token");
      localStorage.removeItem("finanflow_user");
      clearUserState();
      setAuthMode("login");
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
    if (!profileMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (activeMenu !== "Casal" || !coupleSpace || coupleReady) return undefined;
    const timer = window.setInterval(() => refreshCoupleStatus({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [activeMenu, coupleSpace?._id, coupleReady]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setMessage("FinanFlow instalado com sucesso.");
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setMessage("Instalação iniciada.");
    setInstallPrompt(null);
  }

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, { method: "POST", body: JSON.stringify(authForm) });
      clearUserState();
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

  async function updateAccount(account) {
    if (!activeSpaceId) return setMessage("Espaço financeiro ainda não carregado.");
    if (!account.name.trim()) return setMessage("Informe o nome da conta.");
    if (account.name.trim().length > 80) return setMessage("O nome da conta deve ter até 80 caracteres.");
    const balance = Number(account.balance || 0);
    if (!Number.isFinite(balance) || Math.abs(balance) > MAX_MONEY) return setMessage("Informe um saldo válido.");
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/accounts/${account._id}`, { method: "PUT", body: JSON.stringify({ name: account.name.trim(), ownerName: account.ownerName || firstName, balance }) });
      await loadSpaceData(activeSpaceId);
      setMessage("Saldo inicial atualizado.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (!activeSpaceId) return setMessage("Espaço financeiro ainda não carregado.");
    if (!txForm.description.trim()) return setMessage("Informe a descrição.");
    if (txForm.description.trim().length > 160) return setMessage("A descrição deve ter até 160 caracteres.");
    const amount = Number(txForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) return setMessage("Informe um valor maior que zero.");
    if (Number(txForm.installmentCount || 1) > 1 && amount * Number(txForm.installmentCount) > MAX_MONEY) return setMessage("O valor total do parcelamento ultrapassa o limite permitido.");
    if (!txForm.date) return setMessage("Informe a data do lançamento.");
    if (!txForm.category.trim()) return setMessage("Selecione uma categoria.");
    const requestId = txForm.requestId || crypto.randomUUID();
    if (!editingTransactionId && !txForm.requestId) setTxForm((current) => ({ ...current, requestId }));
    const payload = { ...txForm, requestId: editingTransactionId ? undefined : requestId, description: txForm.description.trim(), category: txForm.category.trim() || "Outro", amount, installmentCount: Number(txForm.installmentCount || 1), accountId: txForm.accountId || null, responsibleName: firstName };
    const path = editingTransactionId ? `/api/spaces/${activeSpaceId}/transactions/${editingTransactionId}` : `/api/spaces/${activeSpaceId}/transactions`;
    setLoading(true);
    try {
      await api(path, { method: editingTransactionId ? "PUT" : "POST", body: JSON.stringify(payload) });
      setEditingTransactionId("");
      setTxForm(createTransactionForm());
      setTransactionFormOpen(false);
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
      recurrence: transaction.recurrence || "none",
      installmentCount: String(transaction.installmentCount || 1),
    });
    setTransactionFormOpen(true);
    setActiveMenu("Lançamentos");
  }

  async function saveGoal(event) {
    event.preventDefault();
    const description = goalForm.description.trim();
    const amount = Number(goalForm.amount);
    if (!description) return setMessage("Informe o nome da meta ou reserva.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) return setMessage("Informe um valor maior que zero.");
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/transactions`, { method: "POST", body: JSON.stringify({ type: "meta", description, amount, date: today, category: "Planejamento", status: "pago", recurrence: "none", installmentCount: 1, responsibleName: firstName }) });
      setGoalForm({ description: "", amount: "" });
      await loadSpaceData(activeSpaceId);
      setMessage("Dinheiro separado para o planejamento.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function markTransactionPaid(transaction) {
    if (!activeSpaceId) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/transactions/${transaction._id}/status`, { method: "PATCH", body: JSON.stringify({ status: "pago" }) });
      await loadSpaceData(activeSpaceId);
      setMessage(transaction.type === "receita" ? "Recebimento confirmado." : "Pagamento confirmado.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTransaction(transaction) {
    if (!activeSpaceId) return setMessage("Selecione um espaço antes de excluir o lançamento.");
    const grouped = transaction.seriesId && (transaction.recurrence === "monthly" || Number(transaction.installmentCount || 1) > 1);
    if (!window.confirm(grouped ? "Deseja excluir toda esta série, incluindo os próximos meses?" : "Deseja excluir este lançamento?")) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/transactions/${transaction._id}`, { method: "DELETE" });
      await loadSpaceData(activeSpaceId);
      setMessage("Lançamento excluído.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createCouple(partnerName) {
    const normalizedPartnerName = partnerName?.trim() || "Parceiro(a)";
    if (normalizedPartnerName.length > 80) return setMessage("O nome da outra pessoa deve ter até 80 caracteres.");
    setLoading(true);
    try {
      const data = await api("/api/spaces/couple", { method: "POST", body: JSON.stringify({ partnerName: normalizedPartnerName }) });
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
    try {
      const data = await api("/api/spaces");
      const loaded = data.spaces || [];
      const refreshedCouple = loaded.find((space) => space.type === "couple") || coupleSpace;
      setSpaces(loaded);
      setActiveMode("couple");
      localStorage.setItem(ACTIVE_MODE_KEY, "couple");
      setActiveSpaceId(refreshedCouple._id);
      setReserve(Number(refreshedCouple.reserve ?? 300));
      setAccounts([]);
      setTransactions([]);
      setActiveMenu("Início");
      await loadSpaceData(refreshedCouple._id);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function goToIndividual() {
    const selected = individualSpace?._id || spaces.find((space) => space.type !== "couple")?._id || "";
    setActiveMode("individual");
    localStorage.setItem(ACTIVE_MODE_KEY, "individual");
    setActiveSpaceId(selected);
    setReserve(Number(individualSpace?.reserve ?? 300));
    setAccounts([]);
    setTransactions([]);
    setActiveMenu("Início");
    try {
      if (selected) await loadSpaceData(selected);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resetSpaceData() {
    if (!activeSpaceId) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${activeSpaceId}/reset`, { method: "DELETE" });
      setEditingTransactionId("");
      setTxForm(createTransactionForm());
      setTransactionFormOpen(false);
      setGoalForm({ description: "", amount: "" });
      await loadSpaceData(activeSpaceId);
      setMessage("Dados financeiros zerados.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveReserve() {
    if (!activeSpaceId) return setMessage("Selecione um espaço antes de salvar a reserva.");
    const normalizedReserve = Number(reserve);
    if (!Number.isFinite(normalizedReserve) || normalizedReserve < 0 || normalizedReserve > MAX_MONEY) return setMessage("Informe uma reserva válida.");
    setLoading(true);
    try {
      const data = await api(`/api/spaces/${activeSpaceId}/settings`, { method: "PATCH", body: JSON.stringify({ reserve: normalizedReserve }) });
      setSpaces((current) => current.map((space) => space._id === data.space._id ? data.space : space));
      setReserve(Number(data.space.reserve ?? 0));
      setMessage("Limite protegido salvo neste espaço.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function clearUserState() {
    setSpaces([]);
    setActiveSpaceId("");
    setAccounts([]);
    setTransactions([]);
    setActiveMode("individual");
    localStorage.removeItem(ACTIVE_MODE_KEY);
    setActiveMenu("Início");
    setTxForm(createTransactionForm());
    setTransactionFormOpen(false);
    setGoalForm({ description: "", amount: "" });
    setEditingTransactionId("");
    setBuyForm({ item: "", total: "", installments: "1" });
    setReserve(300);
    setCoupleInvite(null);
    setAuthForm({ name: "", email: "", password: "" });
    spaceRequestId.current += 1;
  }

  function logout() {
    localStorage.removeItem("finanflow_token");
    localStorage.removeItem("finanflow_user");
    clearUserState();
    setAuthMode("login");
    setMessage("");
    setUser(null);
  }

  async function deleteUserAccount() {
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

  if (passwordResetToken) {
    return <ResetPasswordScreen token={passwordResetToken} onComplete={() => {
      window.history.replaceState({}, "", "/");
      setPasswordResetToken("");
      setAuthMode("login");
    }} />;
  }

  async function leaveCoupleSpace() {
    if (!coupleSpace?._id) return;
    setLoading(true);
    try {
      await api(`/api/spaces/${coupleSpace._id}/members/me`, { method: "DELETE" });
      setCoupleInvite(null);
      await loadSpaces("individual");
      setActiveMenu("Início");
      setMessage("Você saiu do espaço do casal. Seus dados individuais continuam preservados.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return <AuthScreen pendingInvite={pendingInvite} authMode={authMode} setAuthMode={setAuthMode} authForm={authForm} setAuthForm={setAuthForm} handleAuth={handleAuth} loading={loading} message={message} setMessage={setMessage} />;
  }

  if (pendingInvite) {
    return <InviteAccept invite={inviteInfo} loading={loading} message={message} acceptInvite={acceptInvite} />;
  }

  return (
    <main className="finanflow-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 64 44" role="presentation"><path d="M3 14c12 7 20 7 31 0S51 7 61 10" /><path d="M3 24c12 7 20 7 31 0s17-7 27-4" /><path d="M3 34c12 7 20 7 31 0s17-7 27-4" /></svg>
          </div>
          <div>
            <strong>FinanFlow</strong>
            <span>Sua vida financeira em fluxo.</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {menu.map(({ label, shortLabel, icon: Icon, iconImage }) => (
            <button key={label} className={activeMenu === label ? "active" : ""} onClick={() => setActiveMenu(label)} aria-label={label}>
              {iconImage ? <img className="premium-nav-icon" src={iconImage} alt="" aria-hidden="true" /> : <Icon size={18} strokeWidth={2} aria-hidden="true" />}
              <span className="nav-label-full">{label}</span>
              <span className="nav-label-short">{shortLabel}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-user-zone">
        <div className={`sidebar-profile-area ${profileMenuOpen ? "is-open" : ""}`} ref={profileMenuRef}>
          {profileMenuOpen && (
            <section className="profile-space-menu" role="menu" aria-label="Alternar espaço financeiro">
              <div className="profile-menu-head"><Avatar name={user.name} photo={user.profilePhoto} /><span><strong>{firstName}</strong><small>Espaço atual</small></span></div>
              <span className="profile-menu-label">Meus espaços</span>
              <button type="button" className={`profile-space-option ${activeMode === "individual" ? "active" : ""}`} role="menuitemradio" aria-checked={activeMode === "individual"} onClick={() => { setProfileMenuOpen(false); goToIndividual(); }}>
                <UserRound size={19} aria-hidden="true" /><span><strong>Individual</strong><small>Dados somente seus</small></span>{activeMode === "individual" && <Check size={18} aria-hidden="true" />}
              </button>
              <button type="button" className={`profile-space-option ${activeMode === "couple" ? "active" : ""}`} role="menuitemradio" aria-checked={activeMode === "couple"} disabled={!coupleMenuState.enabled} onClick={() => { if (!coupleMenuState.enabled) return; setProfileMenuOpen(false); goToCouple(); }}>
                <HeartHandshake size={19} aria-hidden="true" /><span><strong>Casal</strong><small>{coupleMenuState.subtitle}</small></span>{activeMode === "couple" ? <Check size={18} aria-hidden="true" /> : !coupleMenuState.enabled ? <LockKeyhole size={16} aria-hidden="true" /> : null}
              </button>
              {!coupleMenuState.enabled && coupleSpace && <button type="button" className="profile-menu-invite" onClick={() => { setProfileMenuOpen(false); setActiveMenu("Casal"); }}>Ver convite</button>}
              <div className="profile-menu-divider" />
              <button type="button" className="profile-menu-action" role="menuitem" onClick={() => { setProfileMenuOpen(false); setActiveMenu("Configurações"); }}><Settings size={18} aria-hidden="true" />Configurações</button>
              <button type="button" className="profile-menu-action logout" role="menuitem" onClick={() => { setProfileMenuOpen(false); logout(); }}><LogOut size={18} aria-hidden="true" />Sair da conta</button>
            </section>
          )}
          <button type="button" className="sidebar-profile profile-menu-trigger" aria-label="Abrir menu do perfil" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
            {activeCoupleSpace?.members?.length ? (
              <span className="sidebar-couple-avatars" aria-label="Perfis do casal">
                {activeCoupleSpace.members.slice(0, 2).map((member) => {
                  const isCurrentUser = String(member.id) === String(user?.id || user?._id);
                  return <Avatar key={member.id || member.name} name={member.firstName || member.name} photo={isCurrentUser ? (user.profilePhoto || member.profilePhoto) : member.profilePhoto} />;
                })}
              </span>
            ) : <Avatar name={user.name} photo={user.profilePhoto} />}
            <span className="profile-trigger-copy"><strong>{firstName}</strong><span>{activeCoupleSpace ? "Modo casal" : "Modo individual"}</span></span>
            <ChevronDown className="profile-chevron" size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="sidebar-footer">
          <button className="mode-button" aria-label={activeCoupleSpace ? "Ir para individual" : coupleSpace && !coupleReady ? "Ver convite" : "Ir para casal"} onClick={activeCoupleSpace ? goToIndividual : goToCouple}>
            <HeartHandshake size={18} aria-hidden="true" />
            <span>{activeCoupleSpace ? "Ir para individual" : coupleSpace && !coupleReady ? "Ver convite" : "Ir para casal"}</span>
          </button>
        </div>
        </div>
      </aside>

      <section className="main-content">
        <Hero firstName={firstName} user={user} coupleSpace={activeCoupleSpace} summary={summary} hasData={hasData} activeMenu={activeMenu} />
        {activeMenu === "Início" && <Inicio summary={summary} hasData={hasData} setActiveMenu={setActiveMenu} reserve={reserve} transactions={transactions} selectedMonthKey={selectedMonthKey} activeMode={activeMode} />}
        {activeMenu === "Lançamentos" && <Lancamentos txForm={txForm} setTxForm={setTxForm} addTransaction={addTransaction} transactions={transactions} accounts={accounts} editingTransactionId={editingTransactionId} setEditingTransactionId={setEditingTransactionId} editTransaction={editTransaction} deleteTransaction={deleteTransaction} loading={loading} formOpen={transactionFormOpen} setFormOpen={setTransactionFormOpen} selectedMonthKey={selectedMonthKey} setSelectedMonthKey={setSelectedMonthKey} activeMode={activeMode} />}
        {activeMenu === "Contas" && <Contas accounts={accounts} setAccounts={setAccounts} updateAccount={updateAccount} summary={summary} activeMode={activeMode} loading={loading} />}
        {activeMenu === "Planejamento" && <Planejamento summary={summary} hasData={hasData} buyForm={buyForm} setBuyForm={setBuyForm} transactions={transactions} goalForm={goalForm} setGoalForm={setGoalForm} saveGoal={saveGoal} loading={loading} />}
        {activeMenu === "Relatórios" && <Relatorios transactions={transactions} selectedMonthKey={selectedMonthKey} activeMode={activeMode} />}
        {activeMenu === "Configurações" && <Config reserve={reserve} setReserve={setReserve} saveReserve={saveReserve} user={user} setUser={setUser} firstName={firstName} email={user.email} coupleSpace={coupleSpace} coupleReady={coupleReady} setActiveMenu={setActiveMenu} activeMode={activeMode} activeSpaceId={activeSpaceId} refreshSpaceData={() => loadSpaceData(activeSpaceId)} leaveCoupleSpace={leaveCoupleSpace} logout={logout} resetSpaceData={resetSpaceData} deleteUserAccount={deleteUserAccount} loading={loading} installPrompt={installPrompt} isInstalled={isInstalled} installApp={installApp} accounts={accounts} transactions={transactions} />}
        {activeMenu === "Casal" && <Casal coupleSpace={coupleSpace} coupleReady={coupleReady} coupleInvite={coupleInvite} createCouple={createCouple} goToCouple={goToCouple} refreshCoupleStatus={refreshCoupleStatus} setMessage={setMessage} firstName={firstName} loading={loading} />}
        {dueTransactions.length > 0 && <DueReminder transactions={dueTransactions} open={dueReminderOpen} setOpen={setDueReminderOpen} markPaid={markTransactionPaid} loading={loading} />}
        {message && <div className="floating-message" role="status" aria-live="polite">{message}</div>}
      </section>
    </main>
  );
}

function AuthScreen({ pendingInvite, authMode, setAuthMode, authForm, setAuthForm, handleAuth, loading, message, setMessage }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState(authForm.email || "");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const isLogin = authMode === "login";

  function changeMode() {
    setShowPassword(false);
    setMessage("");
    setAuthMode(isLogin ? "register" : "login");
  }

  function forgotPassword() {
    setRecoveryEmail(authForm.email || "");
    setRecoveryMessage("");
    setShowRecovery(true);
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    setRecoveryLoading(true);
    setRecoveryMessage("");
    try {
      const data = await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: recoveryEmail }) });
      setRecoveryMessage(data.message);
    } catch (error) {
      setRecoveryMessage(error.message);
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        {pendingInvite && <div className="invite-warning">Você recebeu um convite para o FinanFlow Casal. Entre ou crie sua conta para aceitar.</div>}
        <span className="eyebrow">FinanFlow</span>
        <h1>{isLogin ? "Entrar" : "Criar conta"}</h1>
        <p>{isLogin ? "Acesse seu painel financeiro." : "Crie seu acesso para começar."}</p>
        <form className="form" onSubmit={handleAuth}>
          {!isLogin && <label>Nome<input value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Seu nome" autoComplete="name" required maxLength={80} /></label>}
          <label>E-mail<input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="seuemail@exemplo.com" type="email" autoComplete="email" required maxLength={254} /></label>
          <div className="password-field">
            <label htmlFor="auth-password">Senha</label>
            <span className="password-input">
              <input id="auth-password" aria-label="Senha" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Mínimo 6 caracteres" type={showPassword ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} required minLength={6} maxLength={128} />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
              </button>
            </span>
          </div>
          {isLogin && <button className="auth-forgot" type="button" onClick={forgotPassword}>Esqueci minha senha</button>}
          <button className="auth-submit" disabled={loading}>{loading ? "Aguarde..." : isLogin ? "Entrar" : "Criar conta"}</button>
        </form>
        <button className="ghost-button auth-switch" onClick={changeMode}>{isLogin ? "Ainda não tenho conta" : "Já tenho conta"}</button>
        {message && <div className="status-box" role="status" aria-live="polite">{message}</div>}
      </section>
      {showRecovery && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRecovery(false); }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <button className="modal-close" type="button" onClick={() => setShowRecovery(false)} aria-label="Fechar recuperação" title="Fechar"><X size={20} aria-hidden="true" /></button>
            <span className="eyebrow">Segurança da conta</span>
            <h2 id="recovery-title">Recuperar senha</h2>
            <p>Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link de confirmação válido por 30 minutos.</p>
            <form className="form" onSubmit={requestPasswordReset}>
              <label>E-mail da conta<input type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="seuemail@exemplo.com" required maxLength={254} autoComplete="email" /></label>
              <button disabled={recoveryLoading}>{recoveryLoading ? "Enviando..." : "Enviar link de recuperação"}</button>
            </form>
            {recoveryMessage && <div className="status-box" role="status" aria-live="polite">{recoveryMessage}</div>}
          </section>
        </div>
      )}
    </main>
  );
}

function DueReminder({ transactions, open, setOpen, markPaid, loading }) {
  const overdue = transactions.filter((item) => item.date < today).length;
  if (!open) return <button type="button" className="due-reminder-fab" onClick={() => setOpen(true)} aria-label={`Ver ${transactions.length} pagamentos pendentes`}><CalendarClock size={21} /><strong>{transactions.length}</strong></button>;
  return (
    <aside className="due-reminder" aria-label="Lembretes de vencimento">
      <div className="due-reminder-head"><span><CalendarClock size={21} /><span><strong>{overdue ? `${overdue} ${overdue === 1 ? "conta atrasada" : "contas atrasadas"}` : "Vencimentos de hoje"}</strong><small>Confirme o que já foi pago ou recebido.</small></span></span><button type="button" onClick={() => setOpen(false)} aria-label="Lembrar depois"><X size={17} /></button></div>
      <div className="due-reminder-list">
        {transactions.slice(0, 5).map((item) => <article key={item._id}><span><strong>{item.description}</strong><small>{item.date < today ? `Venceu em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${item.date}T12:00:00`))}` : "Vence hoje"}</small></span><em className={item.type === "receita" ? "income" : ""}>{item.type === "receita" ? "+" : "−"}{money(item.amount)}</em><button type="button" disabled={loading} onClick={() => markPaid(item)}>{item.type === "receita" ? "Marcar recebido" : "Marcar pago"}</button></article>)}
      </div>
      {transactions.length > 5 && <small className="due-reminder-more">Mais {transactions.length - 5} pendências no extrato.</small>}
      <button type="button" className="due-reminder-later" onClick={() => setOpen(false)}>Continuar pendente e lembrar depois</button>
    </aside>
  );
}

function ResetPasswordScreen({ token, onComplete }) {
  const [form, setForm] = useState({ password: "", confirmation: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (form.password !== form.confirmation) return setMessage("As senhas não coincidem.");
    setLoading(true);
    try {
      const data = await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password: form.password }) });
      setMessage(data.message);
      window.setTimeout(onComplete, 1200);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">Segurança da conta</span>
        <h1>Crie uma nova senha</h1>
        <p>O link só pode ser usado uma vez.</p>
        <form className="form" onSubmit={submit}>
          <PasswordInput id="reset-password" label="Nova senha" value={form.password} onChange={(value) => setForm({ ...form, password: value })} visible={showPassword} toggle={() => setShowPassword((current) => !current)} autoComplete="new-password" />
          <label>Confirmar nova senha<input type={showPassword ? "text" : "password"} value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} required minLength={6} maxLength={128} autoComplete="new-password" /></label>
          <button disabled={loading}>{loading ? "Salvando..." : "Redefinir senha"}</button>
        </form>
        {message && <div className="status-box" role="status" aria-live="polite">{message}</div>}
      </section>
    </main>
  );
}

function PasswordInput({ id, label, value, onChange, visible, toggle, autoComplete }) {
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} type={visible ? "text" : "password"} required minLength={6} maxLength={128} autoComplete={autoComplete} />
        <button className="password-toggle" type="button" onClick={toggle} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} title={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button>
      </span>
    </div>
  );
}

function Hero({ firstName, user, coupleSpace, summary, hasData, activeMenu }) {
  const isCouple = Boolean(coupleSpace);
  const coupleMembers = (coupleSpace?.members?.slice(0, 2) || []).map((member) => String(member.id) === String(user?.id || user?._id) ? { ...member, profilePhoto: user?.profilePhoto || member.profilePhoto } : member);
  const coupleName = coupleMembers.length
    ? coupleMembers.map((member) => member.firstName || String(member.name || "Pessoa").split(/\s+/)[0]).join(" e ")
    : String(coupleSpace?.name || "Casal").split("&").map((name) => name.trim().split(/\s+/)[0]).join(" e ");
  return (
    <section className={`hero ${activeMenu === "Configurações" ? "settings-hero" : ""}`}>
      <div className="hero-copy">
        {isCouple && coupleMembers.length ? <span className="couple-avatars" aria-label={`Participantes: ${coupleName}`}>{coupleMembers.map((member) => <Avatar key={member.id || member.name} name={member.firstName || member.name} photo={member.profilePhoto} size="large" />)}</span> : <Avatar name={firstName} photo={user?.profilePhoto} size="large" />}
        <div>
        <span className="eyebrow">{isCouple ? "Controle financeiro compartilhado" : "Controle financeiro individual"}</span>
        <h1>{isCouple ? coupleName : `Olá, ${firstName}!`}</h1>
        <p>
          {activeMenu === "Configurações"
            ? <><span>Gerencie suas configurações e mantenha tudo</span><span>sob controle com segurança e tranquilidade.</span></>
            : isCouple
            ? <><span>Você está no espaço do casal.</span><span>Organize as finanças compartilhadas com tranquilidade.</span></>
            : <><span>Você está no modo individual.</span><span>Gerencie suas finanças com foco e tranquilidade.</span></>}
        </p>
        </div>
      </div>
      <div className="balance-focus">
        <div className="balance-label"><span>Saldo livre seguro</span></div>
        <strong>{hasData ? money(summary.free) : "Aguardando dados"}</strong>
        <small>Protegido pela sua reserva financeira.</small>
      </div>
    </section>
  );
}

function Inicio({ summary, hasData, setActiveMenu, reserve, transactions, selectedMonthKey, activeMode }) {
  return (
    <>
      <section className="stats-grid">
        <StatCard title="Saldo atual" value={hasData ? money(summary.balance) : "Aguardando dados"} text="Contas cadastradas no espaço atual" tone="cyan" />
        <StatCard title="Receitas previstas" value={hasData ? money(summary.income) : "Aguardando dados"} text="Entradas pendentes no mês" tone="green" />
        <StatCard title="Compromissos" value={hasData ? money(summary.commitments) : "Aguardando dados"} text="Despesas, dívidas e metas pendentes" tone="yellow" />
        <StatCard title="Livre seguro" value={hasData ? money(summary.free) : "Aguardando dados"} text={`Limite protegido: ${money(reserve)}`} tone="blue" />
      </section>

      {activeMode === "couple" && <CoupleContributions transactions={transactions} selectedMonthKey={selectedMonthKey} />}

      <section className="dashboard-grid">
        <MonthlyOverview transactions={transactions} selectedMonthKey={selectedMonthKey} />
        <RecentTransactions transactions={transactions} setActiveMenu={setActiveMenu} selectedMonthKey={selectedMonthKey} activeMode={activeMode} />
      </section>

      <section className="quick-start panel">
        <div>
          <span className="eyebrow">Dica para suas finanças</span>
          <h2>{hasData ? "Planeje hoje para ter mais tranquilidade amanhã" : "Comece seu planejamento financeiro"}</h2>
          <p>{hasData ? "Acompanhe metas e proteja sua reserva para tomar decisões com mais segurança." : "Cadastre seus primeiros dados e organize seus próximos objetivos."}</p>
        </div>
        <span className="tip-plant" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="presentation">
            <defs><linearGradient id="leafGradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#80d49a" /><stop offset="1" stopColor="#23955d" /></linearGradient><linearGradient id="potGradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c89572" /><stop offset="1" stopColor="#825642" /></linearGradient></defs>
            <path d="M32 40V20M32 28c-8-10-17-8-21-10 2 11 9 17 21 14M32 25c7-11 17-11 22-12-2 11-9 18-22 16" fill="none" stroke="#277b50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M31 31C19 32 12 26 11 18c10-1 18 2 21 11M33 28c3-9 11-14 21-15-1 9-8 16-21 17" fill="url(#leafGradient)" opacity=".96" />
            <path d="M20 39h25l-4 18H24z" fill="url(#potGradient)" /><path d="M18 37h29v6H18z" rx="2" fill="#a66e51" /><path d="M26 47h13" stroke="#d8aa87" strokeWidth="2" strokeLinecap="round" opacity=".7" />
          </svg>
        </span>
        <button type="button" className="planning-cta" onClick={() => setActiveMenu("Planejamento")}>Ir para Planejamento <span aria-hidden="true">→</span></button>
      </section>
    </>
  );
}

function Lancamentos({ txForm, setTxForm, addTransaction, transactions, accounts, editingTransactionId, setEditingTransactionId, editTransaction, deleteTransaction, loading, formOpen, setFormOpen, selectedMonthKey, setSelectedMonthKey, activeMode }) {
  const resetForm = () => {
    setEditingTransactionId("");
    setTxForm(createTransactionForm());
    setFormOpen(false);
  };
  const monthTransactions = transactions.filter((item) => String(item.date || "").slice(0, 7) === selectedMonthKey && item.type !== "meta");
  const categories = Array.from(new Set([...(transactionCategories[txForm.type] || transactionCategories.despesa), ...transactions.filter((item) => item.type === txForm.type).map((item) => item.category).filter(Boolean)]));
  const isInstallment = txForm.recurrence !== "monthly" && Number(txForm.installmentCount || 1) > 1;

  return (
    <section className={`transactions-layout ${formOpen ? "with-form" : ""}`}>
      <div className="transactions-toolbar">
        <div className="transactions-period"><span className="eyebrow">Movimentações</span><DashboardSelect compact label="Mês do extrato" icon={CalendarDays} value={selectedMonthKey} onChange={setSelectedMonthKey} options={monthOptions().map((item) => ({ value: item.key, label: item.label }))} /></div>
        {!formOpen && <button type="button" onClick={() => { setTxForm(createTransactionForm()); setEditingTransactionId(""); setFormOpen(true); }}>Novo lançamento</button>}
      </div>
      {formOpen && <form className="panel transaction-form-panel" onSubmit={addTransaction}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">{editingTransactionId ? "Editar lançamento" : "Novo lançamento"}</span>
            <h2>{editingTransactionId ? "Salvar movimentação" : "Adicionar à conta principal"}</h2>
          </div>
          <button type="button" className="icon-close" aria-label="Fechar formulário" onClick={resetForm}><X size={18} /></button>
        </div>
        <div className="field-grid">
          <label>Tipo<select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value, category: e.target.value === "receita" ? "Salário" : "" })}><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="divida">Dívida</option></select></label>
          <label>Descrição<input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Ex: mercado, salário" required maxLength={160} /></label>
          <label>{isInstallment ? "Valor de cada parcela" : "Valor"}<input type="number" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} placeholder="0,00" required min="0.01" max={MAX_MONEY} step="0.01" inputMode="decimal" /></label>
          <label>Data / vencimento<input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} required /></label>
          <label>Categoria<select value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })} required><option value="" disabled>Selecione uma categoria</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
          <label>Status<select value={txForm.status} onChange={(e) => setTxForm({ ...txForm, status: e.target.value })}><option value="pendente">Pendente</option><option value="pago">{txForm.type === "receita" ? "Recebido" : txForm.type === "meta" ? "Separado" : "Pago"}</option></select></label>
          <label>Frequência<select value={txForm.recurrence} onChange={(e) => setTxForm({ ...txForm, recurrence: e.target.value, installmentCount: e.target.value === "monthly" ? "1" : txForm.installmentCount })}><option value="none">Uma vez ou parcelado</option><option value="monthly">Conta fixa todo mês</option></select></label>
          {txForm.recurrence !== "monthly" && <label>Parcelamento<select value={txForm.installmentCount} onChange={(e) => setTxForm({ ...txForm, installmentCount: e.target.value })}>{Array.from({ length: 24 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count === 1 ? "Somente uma vez" : `${count} parcelas`}</option>)}</select></label>}
          {isInstallment && <div className="installment-preview"><ReceiptText size={18} /><span><strong>{txForm.installmentCount}x de {money(Number(txForm.amount || 0))}</strong><small>Total: {money(Number(txForm.amount || 0) * Number(txForm.installmentCount || 1))}. Ao salvar, as parcelas serão atualizadas nos próximos meses.</small></span></div>}
          <div className="automatic-account-note"><Wallet size={18} aria-hidden="true" /><span><strong>{accounts[0]?.name || "Conta principal"}</strong><small>Este lançamento movimentará automaticamente esta conta quando for concluído.</small></span></div>
        </div>
        <div className="action-row">
          <button disabled={loading}>{loading ? "Salvando..." : editingTransactionId ? "Salvar edição" : "Salvar lançamento"}</button>
          {editingTransactionId && <button type="button" className="ghost-button" onClick={resetForm}>Cancelar edição</button>}
        </div>
      </form>}

      <section className="panel transaction-statement">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Extrato do mês</span>
            <h2>{monthTransactions.length} {monthTransactions.length === 1 ? "lançamento" : "lançamentos"}</h2>
          </div>
        </div>
        <div className="transaction-list">
          {monthTransactions.length ? monthTransactions.map((item) => (
            <article className={`transaction-row ${item.type}`} key={item._id}>
              <div className="transaction-main">
                <strong>{item.description}</strong>
                {activeMode === "couple" && <span className="transaction-owner"><UserRound size={12} aria-hidden="true" />{item.responsibleName || "Casal"}</span>}
                <span>{item.category} · {item.status === "pago" ? item.type === "receita" ? "recebido" : "pago" : "pendente"}{item.recurrence === "monthly" ? " · fixa mensal" : ""}{Number(item.installmentCount || 1) > 1 ? ` · parcela ${item.installmentNumber}/${item.installmentCount}` : ""}</span>
              </div>
              <div className="transaction-value"><em>{item.type === "receita" ? "+" : "−"}{money(item.amount)}</em>{Number(item.installmentCount || 1) > 1 && <small>Total {money(item.totalAmount)}</small>}</div>
              <div className="row-actions">
                <button type="button" className="ghost-button" disabled={loading} onClick={() => editTransaction(item)}>Editar</button>
                <button type="button" className="danger-button inline-danger" disabled={loading} onClick={() => deleteTransaction(item)}>Excluir</button>
              </div>
            </article>
          )) : <Empty title="Nenhum lançamento neste mês" text="Use Novo lançamento para cadastrar receitas, despesas ou dívidas." />}
        </div>
      </section>
    </section>
  );
}

function Contas({ accounts, setAccounts, updateAccount, summary, activeMode, loading }) {
  const account = accounts[0];
  const updateInitialBalance = (value) => setAccounts(accounts.map((item, index) => index === 0 ? { ...item, balance: value } : item));

  return (
    <section className="primary-account-layout">
      <section className="panel primary-account-card">
        <div className="panel-head">
          <div><span className="eyebrow">Conta automática</span><h2>{activeMode === "couple" ? "Conta conjunta" : "Conta principal"}</h2></div>
          <span className="automatic-badge"><span />Atualização automática</span>
        </div>
        <div className="primary-balance">
          <span>Saldo disponível agora</span>
          <strong>{money(summary.balance)}</strong>
          <small>Receitas recebidas entram; despesas, dívidas e valores separados saem automaticamente.</small>
        </div>
        {account && (
          <div className="initial-balance-form">
            <label>Saldo inicial<input type="number" value={account.balance} onChange={(event) => updateInitialBalance(event.target.value)} min={-MAX_MONEY} max={MAX_MONEY} step="0.01" inputMode="decimal" /></label>
            <button type="button" disabled={loading} onClick={() => updateAccount(account)}>{loading ? "Salvando..." : "Salvar saldo inicial"}</button>
          </div>
        )}
      </section>
      <section className="panel account-flow-panel">
        <div className="panel-head"><div><span className="eyebrow">Movimentação da conta</span><h2>Como o saldo foi formado</h2></div></div>
        <div className="account-flow-list">
          <div><span>Saldo inicial</span><strong>{money(summary.baseBalance)}</strong></div>
          <div className="positive"><span>Receitas recebidas</span><strong>+ {money(summary.totalReceived)}</strong></div>
          <div className="negative"><span>Despesas pagas</span><strong>− {money(summary.totalPaidExpenses)}</strong></div>
          <div className="negative"><span>Dívidas pagas</span><strong>− {money(summary.totalPaidDebt)}</strong></div>
          <div className="reserved"><span>Separado para objetivos</span><strong>− {money(summary.savedGoals)}</strong></div>
          <div className="flow-total"><span>Saldo atual</span><strong>{money(summary.balance)}</strong></div>
        </div>
      </section>
    </section>
  );
}

function Planejamento({ summary, hasData, buyForm, setBuyForm, transactions, goalForm, setGoalForm, saveGoal, loading }) {
  const goals = Array.from(transactions.reduce((map, item) => {
    if (item.type !== "meta" || item.status !== "pago") return map;
    const name = item.description?.trim() || "Objetivo";
    map.set(name, (map.get(name) || 0) + Number(item.amount || 0));
    return map;
  }, new Map())).map(([name, amount]) => ({ name, amount }));
  return (
    <>
      <section className="panel planning-wallet">
        <div className="panel-head">
          <div><span className="eyebrow">Dinheiro separado</span><h2>Metas, reservas e sonhos</h2><p>Valores separados deixam a conta principal, mas continuam sendo seus.</p></div>
        </div>
        <form className="goal-form" onSubmit={saveGoal}>
          <label>Nome da meta<input value={goalForm.description} onChange={(event) => setGoalForm({ ...goalForm, description: event.target.value })} placeholder="Ex: reserva, viagem, casa" maxLength={160} required /></label>
          <label>Valor a separar<input type="number" value={goalForm.amount} onChange={(event) => setGoalForm({ ...goalForm, amount: event.target.value })} placeholder="0,00" min="0.01" max={MAX_MONEY} step="0.01" required /></label>
          <button disabled={loading}>{loading ? "Separando..." : "Separar dinheiro"}</button>
        </form>
        <div className="planning-total"><span>Total separado</span><strong>{money(summary.savedGoals)}</strong></div>
        {goals.length ? <div className="goal-wallet-grid">{goals.map((goal) => <article key={goal.name}><span className="goal-icon"><ShieldCheck size={19} aria-hidden="true" /></span><div><strong>{goal.name}</strong><small>Objetivo protegido</small></div><em>{money(goal.amount)}</em></article>)}</div> : <div className="planning-empty"><ShieldCheck size={26} aria-hidden="true" /><span><strong>Nenhum valor separado ainda</strong><small>Crie uma reserva, um sonho ou outro objetivo.</small></span></div>}
      </section>
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
            <DataRow label="Receitas já recebidas" value={moneyOrWaiting(summary.received, hasData)} />
            <DataRow label="Despesas pendentes" value={moneyOrWaiting(summary.expenses, hasData)} />
            <DataRow label="Despesas já pagas" value={moneyOrWaiting(summary.paidExpenses, hasData)} />
            <DataRow label="Dívidas pendentes" value={moneyOrWaiting(summary.debt, hasData)} />
            <DataRow label="Objetivos pendentes" value={moneyOrWaiting(summary.goals, hasData)} />
            <DataRow className="highlight-row" label="Saldo livre seguro" value={moneyOrWaiting(summary.free, hasData)} />
          </div>
        </section>
      </section>
    </>
  );
}

function Relatorios({ transactions, selectedMonthKey, activeMode }) {
  const [periodMonths, setPeriodMonths] = useState(6);
  const periodOptions = [{ value: "1", label: "Mês atual" }, { value: "3", label: "3 meses" }, { value: "6", label: "6 meses" }, { value: "12", label: "1 ano" }];
  const monthNumber = (key) => { const [year, month] = String(key).split("-").map(Number); return (year * 12) + month - 1; };
  const endMonth = monthNumber(selectedMonthKey);
  const startMonth = endMonth - periodMonths + 1;
  const previousStart = startMonth - periodMonths;
  const inRange = (item, start, end) => { const value = monthNumber(String(item.date || "").slice(0, 7)); return value >= start && value <= end; };
  const realized = transactions.filter((item) => item.status === "pago" && item.type !== "meta" && inRange(item, startMonth, endMonth));
  const previous = transactions.filter((item) => item.status === "pago" && item.type !== "meta" && inRange(item, previousStart, startMonth - 1));
  const pending = transactions.filter((item) => item.status !== "pago" && item.type !== "meta" && inRange(item, startMonth, endMonth));
  const totals = (items) => items.reduce((result, item) => {
    const amount = Number(item.amount || 0);
    if (item.type === "receita") result.income += amount;
    if (item.type === "despesa") result.expenses += amount;
    if (item.type === "divida") result.debt += amount;
    return result;
  }, { income: 0, expenses: 0, debt: 0 });
  const currentTotals = totals(realized);
  const previousTotals = totals(previous);
  const net = currentTotals.income - currentTotals.expenses - currentTotals.debt;
  const previousNet = previousTotals.income - previousTotals.expenses - previousTotals.debt;
  const change = previousNet === 0 ? null : ((net - previousNet) / Math.abs(previousNet)) * 100;
  const categories = Array.from(realized.reduce((map, item) => {
    if (item.type === "receita") return map;
    const category = item.category || "Outro";
    map.set(category, (map.get(category) || 0) + Number(item.amount || 0));
    return map;
  }, new Map())).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  const maxCategory = Math.max(1, ...categories.map((item) => item.amount));
  const evolution = Array.from({ length: periodMonths }, (_, index) => {
    const absolute = startMonth + index;
    const year = Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const values = totals(realized.filter((item) => String(item.date || "").slice(0, 7) === key));
    return { key, label: monthLabel(key, "short"), income: values.income, outflow: values.expenses + values.debt, net: values.income - values.expenses - values.debt };
  });
  const maxEvolution = Math.max(1, ...evolution.flatMap((item) => [item.income, item.outflow]));
  const largestExpenses = realized.filter((item) => item.type !== "receita").sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 5);
  const people = Array.from(realized.reduce((map, item) => {
    const name = String(item.responsibleName || "Casal").trim() || "Casal";
    const current = map.get(name) || { name, income: 0, outflow: 0 };
    if (item.type === "receita") current.income += Number(item.amount || 0); else current.outflow += Number(item.amount || 0);
    map.set(name, current);
    return map;
  }, new Map()).values());
  const periodLabel = periodMonths === 1 ? monthLabel(selectedMonthKey) : `${monthLabel(evolution[0].key, "short")} a ${monthLabel(selectedMonthKey, "short")}`;

  function exportCsv() {
    const rows = [["Data", "Tipo", "Descrição", "Categoria", "Responsável", "Status", "Valor"], ...transactions.filter((item) => inRange(item, startMonth, endMonth) && item.type !== "meta").map((item) => [item.date, item.type, item.description, item.category, item.responsibleName || "", item.status, Number(item.amount || 0).toFixed(2).replace(".", ",")])];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = `finanflow-relatorio-${selectedMonthKey}-${periodMonths}m.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="reports-page">
      <header className="reports-toolbar">
        <div><span className="eyebrow">Análise financeira</span><h2>Relatórios</h2><p>{activeMode === "couple" ? "Visão compartilhada, com cada lançamento identificado." : "Uma visão clara das suas finanças pessoais."}</p></div>
        <div className="reports-actions">
          <DashboardSelect compact label="Período do relatório" value={String(periodMonths)} onChange={(value) => setPeriodMonths(Number(value))} options={periodOptions} />
          <button type="button" className="report-action secondary" onClick={exportCsv}><FileDown size={16} />Planilha</button>
          <button type="button" className="report-action" onClick={() => window.print()}><Printer size={16} />PDF</button>
        </div>
      </header>

      <div className="report-period"><CalendarDays size={16} /><span>Período analisado</span><strong>{periodLabel}</strong></div>
      <section className="report-summary-grid">
        <article className="report-kpi income"><span>Receitas recebidas</span><strong>{money(currentTotals.income)}</strong><small>{realized.filter((item) => item.type === "receita").length} lançamentos</small></article>
        <article className="report-kpi expense"><span>Despesas pagas</span><strong>{money(currentTotals.expenses)}</strong><small>{realized.filter((item) => item.type === "despesa").length} lançamentos</small></article>
        <article className="report-kpi debt"><span>Dívidas pagas</span><strong>{money(currentTotals.debt)}</strong><small>{realized.filter((item) => item.type === "divida").length} lançamentos</small></article>
        <article className={`report-kpi balance ${net < 0 ? "negative" : ""}`}><span>Resultado do período</span><strong>{money(net)}</strong><small>{change === null ? "Sem período anterior para comparar" : `${change >= 0 ? "+" : ""}${change.toFixed(1).replace(".", ",")}% sobre o período anterior`}</small></article>
      </section>

      {activeMode === "couple" && <section className="panel report-people"><div className="report-section-head"><div><span className="eyebrow">Modo casal</span><h2>Movimentações por pessoa</h2></div><small>Somas combinadas no resumo acima</small></div>{people.length ? <div className="report-people-grid">{people.map((person) => <article key={person.name}><span className="contributor-avatar">{person.name.slice(0, 1).toUpperCase()}</span><strong>{person.name.split(/\s+/)[0]}</strong><dl><div><dt>Receitas</dt><dd>{money(person.income)}</dd></div><div><dt>Saídas</dt><dd>{money(person.outflow)}</dd></div></dl></article>)}</div> : <Empty title="Ainda não há movimentações do casal" text="Os lançamentos de cada pessoa aparecerão separados aqui." />}</section>}

      <section className="reports-grid">
        <article className="panel report-evolution"><div className="report-section-head"><div><span className="eyebrow">Evolução</span><h2>Entradas e saídas</h2></div><small>Valores realizados</small></div>{realized.length ? <div className="report-bars">{evolution.map((item) => <div className="report-month" key={item.key}><div className="report-bar-pair"><i className="income" style={{ height: `${Math.max(4, (item.income / maxEvolution) * 100)}%` }} title={`Receitas: ${money(item.income)}`} /><i className="outflow" style={{ height: `${Math.max(4, (item.outflow / maxEvolution) * 100)}%` }} title={`Saídas: ${money(item.outflow)}`} /></div><strong>{item.label.split(" ")[0]}</strong><small className={item.net < 0 ? "negative" : ""}>{money(item.net)}</small></div>)}</div> : <Empty title="Sem dados para este período" text="Os gráficos serão formados conforme você registrar lançamentos." />}</article>

        <article className="panel report-categories"><div className="report-section-head"><div><span className="eyebrow">Distribuição</span><h2>Gastos por categoria</h2></div><small>{money(currentTotals.expenses + currentTotals.debt)}</small></div>{categories.length ? <div className="category-report-list">{categories.slice(0, 7).map((item) => <div key={item.name}><span><strong>{item.name}</strong><em>{money(item.amount)}</em></span><i><b style={{ width: `${(item.amount / maxCategory) * 100}%` }} /></i></div>)}</div> : <Empty title="Nenhum gasto realizado" text="As categorias aparecerão aqui quando houver despesas pagas." />}</article>

        <article className="panel report-largest"><div className="report-section-head"><div><span className="eyebrow">Destaques</span><h2>Maiores saídas</h2></div><small>Top 5 do período</small></div>{largestExpenses.length ? <div className="largest-expense-list">{largestExpenses.map((item, index) => <div key={item._id || `${item.date}-${index}`}><span className="expense-rank">{index + 1}</span><span><strong>{item.description}</strong><small>{activeMode === "couple" && `${item.responsibleName || "Casal"} · `}{item.category}</small></span><em>{money(item.amount)}</em></div>)}</div> : <Empty title="Nenhuma saída registrada" text="Despesas e dívidas pagas aparecerão nesta lista." />}</article>

        <article className="panel report-comparison"><div className="report-section-head"><div><span className="eyebrow">Comparativo</span><h2>Período anterior</h2></div><small>{periodMonths} {periodMonths === 1 ? "mês" : "meses"}</small></div><div className="comparison-list"><DataRow label="Receitas anteriores" value={money(previousTotals.income)} /><DataRow label="Saídas anteriores" value={money(previousTotals.expenses + previousTotals.debt)} /><DataRow label="Resultado anterior" value={money(previousNet)} /><DataRow className="highlight-row" label="Pendências atuais" value={money(pending.reduce((sum, item) => sum + Number(item.amount || 0), 0))} /></div></article>
      </section>
    </section>
  );
}

function Config({ reserve, setReserve, saveReserve, user, setUser, firstName, email, coupleSpace, coupleReady, setActiveMenu, activeMode, activeSpaceId, refreshSpaceData, leaveCoupleSpace, logout, resetSpaceData, deleteUserAccount, loading, installPrompt, isInstalled, installApp, accounts, transactions }) {
  const [confirmation, setConfirmation] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(() => user?.profilePhoto || localStorage.getItem("finanflow_profile_photo") || "");
  const [pendingPhoto, setPendingPhoto] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileName, setProfileName] = useState(user?.name || firstName);
  const [history, setHistory] = useState([]);
  const [historyMessage, setHistoryMessage] = useState("");
  const photoInputRef = useRef(null);

  async function loadHistory() {
    if (!activeSpaceId) return;
    try {
      const data = await api(`/api/spaces/${activeSpaceId}/history`);
      setHistory(data.history || []);
    } catch (error) {
      setHistoryMessage(error.message);
    }
  }

  useEffect(() => { loadHistory(); }, [activeSpaceId]);

  async function restoreHistoryItem(item) {
    setHistoryMessage("Restaurando...");
    try {
      await api(`/api/spaces/${activeSpaceId}/history/${item._id}/restore`, { method: "POST" });
      await Promise.all([loadHistory(), refreshSpaceData()]);
      setHistoryMessage("Lançamento restaurado com sucesso.");
    } catch (error) {
      setHistoryMessage(error.message);
    }
  }

  async function confirmDestructiveAction() {
    const action = confirmation?.action;
    setConfirmation(null);
    if (action) await action();
  }

  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2_000_000) return setProfileMessage("Escolha uma imagem de até 2 MB.");
    try {
      const nextPhoto = await resizeProfilePhoto(file);
      setPendingPhoto(nextPhoto);
      setProfileMessage("");
    } catch {
      setProfileMessage("Não foi possível preparar esta imagem.");
    }
  }

  async function saveProfile() {
    const nextPhoto = pendingPhoto || photoPreview;
    setProfileMessage("Salvando...");
    try {
      const data = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify({ name: profileName.trim(), profilePhoto: nextPhoto }) });
      localStorage.removeItem("finanflow_profile_photo");
      localStorage.setItem("finanflow_user", JSON.stringify(data.user));
      setUser(data.user);
      setPhotoPreview(data.user.profilePhoto || "");
      setPendingPhoto("");
      setProfileMessage("Perfil salvo e compartilhado com seu espaço do casal.");
    } catch (error) {
      setProfileMessage(error.message);
    }
  }

  function exportData() {
    const payload = { exportedAt: new Date().toISOString(), space: activeMode, accounts, transactions, protectedAmount: reserve };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `finanflow-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visiblePhoto = pendingPhoto || photoPreview;
  return (
    <section className="settings-premium-grid">
      <section className="settings-card settings-profile">
        <SettingsTitle number="1" icon={UserRound} title="Perfil" />
        <div className="settings-profile-layout">
          <div className="profile-photo-actions">
            <span className="settings-avatar">{visiblePhoto ? <img src={visiblePhoto} alt="Foto de perfil" /> : <Avatar name={firstName} size="large" />}</span>
            <input ref={photoInputRef} className="visually-hidden" type="file" accept="image/*" onChange={selectPhoto} />
            <button type="button" className="settings-outline" onClick={() => photoInputRef.current?.click()}><Camera size={16} />{visiblePhoto ? "Trocar foto" : "Adicionar foto"}</button>
            {visiblePhoto && <button type="button" className="settings-remove" onClick={() => { setPendingPhoto(""); setPhotoPreview(""); setProfileMessage("Clique em Salvar perfil para confirmar."); }}><Trash2 size={16} />Remover foto</button>}
          </div>
          <div className="profile-fields">
            <label>Seu nome<input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={80} required /></label>
            <label>E-mail<input value={email || ""} readOnly /></label>
            <p>Use uma foto sua para personalizar a conta. Nome e e-mail permanecem vinculados ao seu acesso.</p>
            <button type="button" onClick={saveProfile}>Salvar perfil</button>
            {profileMessage && <small className="settings-inline-message">{profileMessage}</small>}
          </div>
        </div>
      </section>

      <PasswordSettings logout={logout} />

      <section className="settings-card settings-protection">
        <SettingsTitle number="4" icon={ShieldCheck} title="Proteção financeira" />
        <h3>Limite mínimo protegido</h3>
        <p>Defina um valor mínimo que deve ficar livre para garantir sua segurança financeira.</p>
        <label>Valor mínimo que deve ficar livre<input type="number" min="0" step="0.01" value={reserve} onChange={(e) => setReserve(Number(e.target.value || 0))} /></label>
        <button type="button" disabled={loading} onClick={saveReserve}>{loading ? "Salvando..." : "Salvar proteção"}</button>
      </section>

      <section className="settings-card settings-couple">
        <SettingsTitle number="5" icon={HeartHandshake} title="Modo casal" />
        <div className="couple-settings-box">
          <span className="couple-settings-icon"><HeartHandshake size={25} /></span>
          <div><h3>{coupleReady ? "Espaço do casal ativo" : coupleSpace ? "Convite do casal pendente" : "Modo casal ainda não criado"}</h3><p>{coupleReady ? "O espaço compartilhado está disponível para as duas pessoas." : "O modo casal só libera lançamentos compartilhados depois que a outra pessoa aceitar."}</p></div>
          <div className="couple-settings-actions"><button type="button" onClick={() => setActiveMenu("Casal")}>{coupleReady ? "Entrar no casal" : coupleSpace ? "Ver convite" : "Criar convite"}</button>{coupleSpace && <button type="button" className="settings-remove" onClick={() => setConfirmation({ eyebrow: "Espaço compartilhado", title: "Sair do modo casal?", description: "Você perderá o acesso aos dados compartilhados, mas seus dados individuais continuarão preservados.", note: "Os lançamentos do casal permanecerão com a outra pessoa. Se o convite ainda estiver pendente, o espaço vazio será removido.", confirmLabel: "Sair do casal", action: leaveCoupleSpace })}><LogOut size={16} />Sair do casal</button>}</div>
          <small><LockKeyhole size={14} />Seus dados continuam privados até a aceitação do convite.</small>
        </div>
      </section>

      <section className="settings-card settings-app-card">
        <SettingsTitle number="6" icon={Download} title="Aplicativo" />
        <div className="settings-app-content"><div><h3>{isInstalled ? "FinanFlow instalado" : "Instalar FinanFlow"}</h3><p>Tenha o FinanFlow sempre à mão e gerencie suas finanças de qualquer lugar.</p><button type="button" disabled={isInstalled || !installPrompt} onClick={installApp}><Download size={17} />{isInstalled ? "Aplicativo instalado" : "Instalar aplicativo"}</button></div><span className="phone-illustration" aria-hidden="true"><Smartphone size={70} /><i>≈</i></span></div>
      </section>

      <section className="settings-card settings-history-card">
        <SettingsTitle icon={History} title="Histórico e recuperação" />
        <p>Veja quem alterou os dados. Lançamentos apagados podem ser recuperados por aqui.</p>
        <div className="settings-history-list">
          {history.slice(0, 10).map((item) => <div className="settings-history-item" key={item._id}><span><strong>{item.summary}</strong><small>{item.userName} • {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span>{item.canRestore && <button type="button" className="settings-outline" onClick={() => restoreHistoryItem(item)}><RotateCcw size={15} />Restaurar</button>}</div>)}
          {!history.length && <small>Nenhuma alteração registrada ainda.</small>}
        </div>
        {historyMessage && <small className="settings-inline-message">{historyMessage}</small>}
      </section>

      <section className="settings-card settings-data-card">
        <SettingsTitle number="7" icon={Database} title="Dados e conta" danger />
        <div className="data-action-grid">
          <button type="button" className="data-action" onClick={exportData}><FileDown size={24} /><span><strong>Exportar dados</strong><small>Baixe seus dados financeiros.</small></span></button>
          <button type="button" className="data-action" onClick={logout}><LogOut size={24} /><span><strong>Sair da conta</strong><small>Encerre sua sessão neste dispositivo.</small></span></button>
          <button type="button" className="data-action danger" disabled={loading} onClick={() => setConfirmation({ eyebrow: "Recomeçar este espaço", title: "Zerar dados financeiros?", description: "Todos os lançamentos e saldos cadastrados neste espaço serão apagados.", note: "Seu acesso, configurações e outros espaços continuarão preservados.", confirmLabel: "Zerar dados", action: resetSpaceData })}><Database size={24} /><span><strong>Zerar dados financeiros</strong><small>Remove lançamentos e saldos.</small></span></button>
          <button type="button" className="data-action danger" disabled={loading} onClick={() => setConfirmation({ eyebrow: "Exclusão definitiva", title: "Apagar sua conta?", description: "Seus dados individuais serão removidos e você sairá dos espaços compartilhados.", note: "Esta ação não pode ser desfeita.", confirmLabel: "Apagar minha conta", action: deleteUserAccount })}><Trash2 size={24} /><span><strong>Apagar conta</strong><small>Ação irreversível.</small></span></button>
        </div>
      </section>

      {confirmation && <ConfirmationModal confirmation={confirmation} loading={loading} close={() => setConfirmation(null)} confirm={confirmDestructiveAction} />}
    </section>
  );
}

function SettingsTitle({ icon: Icon, title, danger = false }) {
  return <div className={`settings-title ${danger ? "danger" : ""}`}><span><Icon size={20} /></span><h2>{title}</h2></div>;
}

function ConfirmationModal({ confirmation, loading, close, confirm }) {
  return (
    <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) close(); }}>
      <section className="modal-card confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
        <button className="modal-close" type="button" disabled={loading} onClick={close} aria-label="Fechar confirmação" title="Fechar"><X size={20} aria-hidden="true" /></button>
        <span className="confirmation-icon" aria-hidden="true"><ReceiptText size={25} /></span><span className="eyebrow">{confirmation.eyebrow}</span><h2 id="confirmation-title">{confirmation.title}</h2><p id="confirmation-description">{confirmation.description}</p>
        <div className="confirmation-note"><ShieldCheck size={18} aria-hidden="true" /><span>{confirmation.note}</span></div>
        <div className="confirmation-actions"><button type="button" className="ghost-button" disabled={loading} onClick={close}>Cancelar</button><button type="button" className="confirmation-danger" disabled={loading} onClick={confirm}>{loading ? "Aguarde..." : confirmation.confirmLabel}</button></div>
      </section>
    </div>
  );
}

function MonthlyOverview({ transactions, selectedMonthKey }) {
  const [period, setPeriod] = useState("6");
  const periodCount = Number(period);
  const selectedDate = monthDate(selectedMonthKey);
  const points = periodCount === 1
    ? Array.from({ length: 6 }, (_, index) => {
        const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
        const day = Math.round(1 + (lastDay - 1) * (index / 5));
        return { key: `${selectedMonthKey}-${String(day).padStart(2, "0")}`, label: String(day).padStart(2, "0"), value: 0, day };
      })
    : Array.from({ length: periodCount }, (_, index) => {
        const date = monthDate(selectedMonthKey);
        date.setMonth(date.getMonth() - (periodCount - 1 - index));
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        return { key, label: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""), value: 0 };
      });
  if (periodCount === 1) {
    transactions.filter((item) => item.type !== "meta" && String(item.date || "").slice(0, 7) === selectedMonthKey).forEach((item) => {
      const day = Number(String(item.date || "").slice(8, 10));
      const amount = (item.type === "receita" ? 1 : -1) * Number(item.amount || 0);
      points.forEach((point) => { if (day <= point.day) point.value += amount; });
    });
  } else {
    const byMonth = new Map(points.map((item) => [item.key, item]));
    transactions.forEach((item) => {
      if (item.type === "meta") return;
      const month = byMonth.get(String(item.date || "").slice(0, 7));
      if (!month) return;
      month.value += (item.type === "receita" ? 1 : -1) * Number(item.amount || 0);
    });
  }
  const hasMovement = points.some((item) => item.value !== 0);
  const min = Math.min(0, ...points.map((item) => item.value));
  const max = Math.max(0, ...points.map((item) => item.value));
  const range = Math.max(max - min, 1);
  const compactMoney = (value) => new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const chartPoints = points.map((item, index) => ({ x: 32 + index * (256 / Math.max(points.length - 1, 1)), y: 112 - ((item.value - min) / range) * 88 }));
  const linePath = chartPoints.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    if (index === chartPoints.length - 1) return `${path} Q ${chartPoints[index - 1].x} ${chartPoints[index - 1].y} ${point.x} ${point.y}`;
    const next = chartPoints[index + 1];
    return `${path} Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }, "");
  const areaPath = `${linePath} L 288 122 L 32 122 Z`;
  const currentValue = points.at(-1)?.value || 0;
  const periodLabels = { 1: "Mês selecionado", 3: "Últimos 3 meses", 6: "Últimos 6 meses", 12: "Último ano" };

  return (
    <section className="panel monthly-overview">
      <div className="panel-head dashboard-panel-head">
        <div><span className="eyebrow">{periodLabels[period]}</span><h2>Evolução financeira</h2></div>
        <DashboardSelect compact label="Período do gráfico" value={period} onChange={setPeriod} options={[{ value: "1", label: "Mês atual" }, { value: "3", label: "3 meses" }, { value: "6", label: "6 meses" }, { value: "12", label: "1 ano" }]} />
      </div>
      {hasMovement ? (
        <div className="balance-chart">
          <span className="chart-current">{money(currentValue)}</span>
          <svg viewBox="0 0 300 145" role="img" aria-label={`Evolução financeira: ${periodLabels[period].toLowerCase()}`}>
            <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#36b979" stopOpacity=".28" /><stop offset="1" stopColor="#36b979" stopOpacity="0" /></linearGradient></defs>
            {[24, 68, 112].map((y) => <line key={y} x1="28" y1={y} x2="290" y2={y} className="chart-grid-line" />)}
            <text x="2" y="28" className="chart-value-label">{compactMoney(max)}</text>
            <text x="2" y="72" className="chart-value-label">{compactMoney((max + min) / 2)}</text>
            <text x="2" y="116" className="chart-value-label">{compactMoney(min)}</text>
            <line x1="28" y1="122" x2="290" y2="122" className="chart-axis" />
            <path d={areaPath} fill="url(#chartFill)" />
            <path d={linePath} className="chart-line" />
            {chartPoints.map((point, index) => <circle key={points[index].key} cx={point.x} cy={point.y} r={index === chartPoints.length - 1 ? "4.6" : "3.4"} className={index === chartPoints.length - 1 ? "chart-point chart-point-current" : "chart-point"} />)}
            {points.map((item, index) => <text key={item.key} x={32 + index * (256 / Math.max(points.length - 1, 1))} y="139" textAnchor="middle" className="chart-month-label">{item.label}</text>)}
          </svg>
        </div>
      ) : <Empty title="A evolução aparecerá aqui" text="Cadastre lançamentos para construir seu histórico financeiro real." />}
    </section>
  );
}

function CoupleContributions({ transactions, selectedMonthKey }) {
  const contributors = Array.from(transactions
    .filter((item) => String(item.date || "").slice(0, 7) === selectedMonthKey && item.type !== "meta")
    .reduce((map, item) => {
      const name = String(item.responsibleName || "Casal").trim() || "Casal";
      const current = map.get(name) || { name, income: 0, outflow: 0, count: 0 };
      current.count += 1;
      if (item.type === "receita") current.income += Number(item.amount || 0);
      else current.outflow += Number(item.amount || 0);
      map.set(name, current);
      return map;
    }, new Map()).values());

  if (!contributors.length) return null;

  return (
    <section className="couple-contributions" aria-label="Movimentações por pessoa no modo casal">
      <div className="couple-contributions-head">
        <div><span className="eyebrow">Espaço compartilhado</span><h2>Movimentações por pessoa</h2></div>
        <small>Os totais acima representam o casal</small>
      </div>
      <div className="couple-contribution-list">
        {contributors.map((person) => (
          <article key={person.name}>
            <span className="contributor-avatar"><UserRound size={17} aria-hidden="true" /></span>
            <div><strong>{person.name}</strong><small>{person.count} {person.count === 1 ? "lançamento" : "lançamentos"} neste mês</small></div>
            <dl><div><dt>Entradas</dt><dd>+{money(person.income)}</dd></div><div><dt>Saídas</dt><dd>−{money(person.outflow)}</dd></div></dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecentTransactions({ transactions, setActiveMenu, selectedMonthKey, activeMode }) {
  const recent = transactions
    .filter((item) => item.type !== "meta" && String(item.date || "").slice(0, 7) === selectedMonthKey)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")) || String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, 5);
  const icons = { receita: ArrowDownLeft, despesa: ArrowUpRight, divida: ReceiptText, meta: TrendingUp };
  const categoryIcons = { renda: Banknote, alimentação: ShoppingCart, alimentacao: ShoppingCart, transporte: Fuel, assinaturas: Music2, lazer: Music2, restaurante: Utensils };
  return (
    <section className={`panel recent-panel ${recent.length <= 1 ? "is-sparse" : ""}`}>
      <div className="panel-head dashboard-panel-head">
        <div><span className="eyebrow">Movimentações</span><h2>Lançamentos recentes</h2></div>
        {recent.length > 0 && <button type="button" className="text-action" onClick={() => setActiveMenu("Lançamentos")}>Ver todos</button>}
      </div>
      {recent.length ? (
        <div className="recent-list">
          {recent.map((item) => {
            const categoryKey = String(item.category || "").trim().toLocaleLowerCase("pt-BR");
            const Icon = categoryIcons[categoryKey] || icons[item.type] || CircleDollarSign;
            return (
              <article className={`recent-item ${item.type}`} key={item._id}>
                <span className="recent-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="recent-copy"><strong>{item.description}</strong><small>{activeMode === "couple" && <b>{item.responsibleName || "Casal"} · </b>}{item.category} · {item.status === "pago" ? item.type === "receita" ? "recebido" : item.type === "meta" ? "separado" : "pago" : "pendente"} · {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${item.date}T12:00:00`)).replace(".", "")}</small></span>
                <strong className="recent-value">{item.type === "receita" ? "+" : "−"}{money(item.amount)}</strong>
              </article>
            );
          })}
          <div className="recent-summary"><span>{recent.length} {recent.length === 1 ? "movimentação" : "movimentações"} no período</span><strong>{money(recent.reduce((total, item) => total + (item.type === "receita" ? Number(item.amount || 0) : -Number(item.amount || 0)), 0))}</strong></div>
        </div>
      ) : <Empty title="Nenhum lançamento recente" text="Suas receitas e despesas mais recentes aparecerão nesta lista." />}
    </section>
  );
}

function PasswordSettings({ logout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmation: "" });
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (form.newPassword !== form.confirmation) return setMessage("As senhas não coincidem.");
    setLoading(true);
    setMessage("");
    try {
      const data = await api("/api/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      setMessage(data.message);
      window.setTimeout(logout, 1200);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-card settings-security password-settings">
      <SettingsTitle number="2" icon={LockKeyhole} title="Segurança" />
      <form className="password-settings-form" onSubmit={submit}>
        <PasswordInput id="current-password" label="Senha atual" value={form.currentPassword} onChange={(value) => setForm({ ...form, currentPassword: value })} visible={visible} toggle={() => setVisible((current) => !current)} autoComplete="current-password" />
        <PasswordInput id="new-password-settings" label="Nova senha" value={form.newPassword} onChange={(value) => setForm({ ...form, newPassword: value })} visible={visible} toggle={() => setVisible((current) => !current)} autoComplete="new-password" />
        <PasswordInput id="confirm-password-settings" label="Confirmar nova senha" value={form.confirmation} onChange={(value) => setForm({ ...form, confirmation: value })} visible={visible} toggle={() => setVisible((current) => !current)} autoComplete="new-password" />
        <button disabled={loading}>{loading ? "Alterando..." : "Alterar senha"}</button>
      </form>
      {message && <div className="status-box" role="status" aria-live="polite">{message}</div>}
      <div className="active-sessions"><span className="session-icon"><MonitorSmartphone size={23} /></span><div><strong>Sessões ativas</strong><small>Você está conectado em 1 dispositivo.</small></div><button type="button" className="settings-outline" onClick={logout}><LogOut size={17} />Sair de todos os dispositivos</button></div>
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
          <label>Nome da outra pessoa<input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} placeholder="Ex: Ana" maxLength={80} /></label>
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
  const icons = { cyan: balanceWalletIcon, green: incomeWalletIcon, yellow: commitmentsCalendarIcon, blue: safeShieldIcon };
  return (
    <article className={`stat-card ${tone}`}>
      <span className="stat-icon"><img src={icons[tone] || balanceWalletIcon} alt="" aria-hidden="true" /></span>
      <div className="stat-card-copy">
        <span className="stat-card-label">{title}</span>
        <strong>{value}</strong>
        <p>{text}</p>
      </div>
    </article>
  );
}

function resizeProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const size = 180;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = (image.naturalWidth - sourceSize) / 2;
        const sourceY = (image.naturalHeight - sourceSize) / 2;
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", .78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Avatar({ name, photo = "", size = "small" }) {
  const initials = String(name || "F").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const isWesley = /^wesley\b/i.test(String(name || "").trim());
  return (
    <span className={`user-avatar ${size}`} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : isWesley ? <img src={wesleyAvatar} alt="" /> : initials || "F"}
    </span>
  );
}

function DataRow({ label, value, className = "" }) {
  return (
    <div className={`data-row ${className}`}>
      <span className="data-row-copy"><span className="data-row-icon"><ReceiptText size={17} aria-hidden="true" /></span><span>{label}<small>Compromisso pendente</small></span></span>
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
        <label>Valor total<input type="number" value={buyForm.total} onChange={(e) => setBuyForm({ ...buyForm, total: e.target.value })} placeholder="0,00" min="0" max={MAX_MONEY} step="0.01" inputMode="decimal" /></label>
        <label>Parcelas<input type="number" value={buyForm.installments} onChange={(e) => setBuyForm({ ...buyForm, installments: e.target.value })} min="1" max="600" step="1" inputMode="numeric" /></label>
      </div>
      <div className={canBuy ? "decision-box ok" : "decision-box bad"}>
        {ready ? (total > 0 ? (canBuy ? `Compra parece possível. Parcela estimada: ${money(monthlyImpact)}.` : `Compra não recomendada agora. Parcela estimada: ${money(monthlyImpact)}.`) : "Informe uma compra para simular.") : "Aguardando dados. Cadastre saldo, receita e despesas antes de simular uma compra."}
      </div>
    </section>
  );
}
