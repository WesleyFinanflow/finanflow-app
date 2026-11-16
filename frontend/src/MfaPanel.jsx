import { useEffect, useState } from "react";
import "./mfa.css";
export default function MfaPanel({ api, user, onUser, onClose, onLogout, challenge = false }) {
  const [status, setStatus] = useState(null), [setup, setSetup] = useState(null), [codes, setCodes] = useState(null);
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [recovery, setRecovery] = useState(false), [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { let live = true; api("/api/auth/mfa/status").then(data => { if (live) setStatus(data); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [api]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (challenge || reauth) {
        const data = await api("/api/auth/mfa/verify", { method: "POST", body: JSON.stringify(recovery ? { recoveryCode: code } : { code }) });
        setCode(""); onUser(data.user);
        if (reauth) { setReauth(false); setRecovery(false); setStatus({ ...status, enabled: false }); }
      } else if (!setup) {
        const data = await api("/api/auth/mfa/setup", { method: "POST", body: JSON.stringify({ password }) });
        setPassword(""); setSetup(data);
      } else {
        const data = await api("/api/auth/mfa/confirm", { method: "POST", body: JSON.stringify({ code }) });
        setSetup(null); setCode(""); setCodes(data.recoveryCodes); setStatus({ enabled: true, recoveryRemaining: data.recoveryCodes.length });
        // Keep the recovery screen mounted until its owner acknowledges saving the codes.
        localStorage.setItem("finanflow_user", JSON.stringify(data.user));
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function finish() { onUser({ ...user, mfaEnabled: true, mfaRequired: false }); onClose?.(); }
  return <main className="mfa-page"><section className="mfa-card" aria-labelledby="mfa-title">
    <span className="eyebrow">Segurança da conta</span>
    <h1 id="mfa-title">{codes ? "Guarde seus códigos de recuperação" : (challenge || reauth) ? "Confirme seu acesso" : "Autenticação em duas etapas"}</h1>
    {error && <p role="alert" className="mfa-error">{error}</p>}
    {codes ? <><p>O segundo fator está ativo. Cada código abaixo funciona uma única vez se você perder o autenticador. Guarde-os em um gerenciador de senhas ou local seguro. Eles não serão exibidos novamente.</p><ul className="mfa-codes">{codes.map(value => <li key={value}><code>{value}</code></li>)}</ul><button onClick={finish}>Guardei os códigos, continuar</button></> : <>
      {(challenge || reauth) ? <p>{recovery ? "Use um dos códigos de recuperação guardados" : "Digite o código do aplicativo autenticador"} para confirmar o acesso de {user.email}.</p> : status?.enabled ? <><p>Segundo fator ativo. Nos próximos acessos, sua senha ou login Google será seguido pelo código do autenticador.</p><p>Códigos de recuperação disponíveis: {status.recoveryRemaining}.</p><button onClick={() => { setReauth(true); setCode(""); }}>Trocar autenticador e renovar códigos</button></> : <p>Adicione proteção ao seu acesso administrativo. A ativação acontece somente depois de confirmar um código do autenticador. Suas outras sessões serão encerradas.</p>}
      {(challenge || reauth || (status && !status.enabled)) && <form onSubmit={submit}>
        {!challenge && !reauth && !setup && status?.hasPassword && <label>Senha atual<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128}/></label>}
        {!challenge && !reauth && !setup && status && !status.hasPassword && <p>Para configurar, seu login com Google precisa ter sido feito nos últimos cinco minutos.</p>}
        {setup && <><p>No aplicativo autenticador, adicione uma conta com chave de configuração. Use o tipo “baseado em tempo” e a chave abaixo para a conta {user.email}.</p><code className="mfa-secret">{setup.secret}</code><p>A configuração expira em dez minutos.</p><button type="button" className="ghost-button" disabled={busy} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Recomeçar configuração</button></>}
        {(challenge || reauth || setup) && <label>{recovery ? "Código de recuperação" : "Código de 6 dígitos"}<input autoFocus autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} value={code} onChange={e => setCode(e.target.value.trim())} pattern={recovery ? "[A-Fa-f0-9-]{20,23}" : "[0-9]{6}"} maxLength={recovery ? 23 : 6} required /></label>}
        <button disabled={busy}>{busy ? "Verificando..." : (challenge || reauth) ? "Confirmar acesso" : setup ? "Ativar segundo fator" : "Começar configuração"}</button>
      </form>}
      {(challenge || reauth) && <button className="ghost-button" disabled={busy} onClick={() => { setRecovery(!recovery); setCode(""); setError(""); }}>{recovery ? "Usar autenticador" : "Usar código de recuperação"}</button>}
      {!challenge && <button className="ghost-button" disabled={busy} onClick={onClose}>Voltar ao admin</button>}
      <button className="ghost-button" disabled={busy} onClick={onLogout}>Sair da conta</button>
    </>}
  </section></main>;
}
