import { useState } from "react";

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

export default function App() {
  const [status, setStatus] = useState("Ainda não testado");
  const [loading, setLoading] = useState(false);

  async function testApi() {
    setLoading(true);
    setStatus("Testando conexão...");
    try {
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      setStatus(data.ok ? `API online - banco: ${data.database}` : "API respondeu, mas sem status OK");
    } catch (error) {
      setStatus(`Erro ao conectar na API: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <span className="eyebrow">FinanFlow</span>
        <h1>App financeiro individual e casal</h1>
        <p>
          Esta é a nova base limpa do projeto. O frontend vai rodar na Vercel,
          o backend na Railway e os dados no MongoDB Atlas.
        </p>
        <button onClick={testApi} disabled={loading}>
          {loading ? "Testando..." : "Testar conexão com backend"}
        </button>
        <div className="status-box">{status}</div>
      </section>

      <section className="steps-grid">
        <article>
          <strong>1. Backend</strong>
          <span>API Node.js, Express e MongoDB.</span>
        </article>
        <article>
          <strong>2. Login</strong>
          <span>Cadastro, login e sessão segura.</span>
        </article>
        <article>
          <strong>3. Individual</strong>
          <span>Espaço financeiro pessoal automático.</span>
        </article>
        <article>
          <strong>4. Casal</strong>
          <span>Convite para compartilhar o espaço financeiro.</span>
        </article>
      </section>
    </main>
  );
}
