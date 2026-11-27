import symbol from "./assets/orion/orion-symbol.webp";
import wordmark from "./assets/orion/orion-wordmark.webp";

// Marca oficial do ORION (arquivos aprovados, com fundo removido para uso sobre azul-marinho).
// A assinatura "Seu Assistente Pessoal" continua como texto para ficar legível e acessível.
export default function OrionBrand() {
  return (
    <>
      <img className="orion-mark" src={symbol} alt="" aria-hidden="true" width="42" height="40" />
      <div className="orion-wordmark">
        <img src={wordmark} alt="ORION" width="130" height="24" />
        <span>Seu Assistente Pessoal</span>
      </div>
    </>
  );
}
