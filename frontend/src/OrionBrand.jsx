// Símbolo orbital PROVISÓRIO (inspirado na letra O). Trocar pelo arquivo aprovado quando for entregue.
export default function OrionBrand() {
  return (
    <>
      <svg className="orion-mark" viewBox="0 0 48 48" role="img" aria-label="Símbolo do ORION" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="24" cy="24" r="14" />
        <ellipse cx="24" cy="24" rx="21" ry="8" transform="rotate(-28 24 24)" opacity="0.75" />
        <circle cx="38.5" cy="15.5" r="2.6" fill="currentColor" stroke="none" />
      </svg>
      <div className="orion-wordmark">
        <strong>ORION</strong>
        <span>Seu Assistente Pessoal</span>
      </div>
    </>
  );
}
