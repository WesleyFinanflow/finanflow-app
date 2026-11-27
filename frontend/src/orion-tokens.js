// Fonte única da paleta ORION (provisória até a entrega dos arquivos aprovados de marca).
// orion-theme.css repete estes valores; orion-tokens.test.js garante que não divergem.
export const ORION_PALETTE = {
  navy900: "#0B1F3A",
  navy800: "#12294A",
  silver300: "#C7D0DC",
  sky300: "#6CB2FF",
  blue700: "#1F5FB0",
  slate600: "#51607A",
  mist50: "#F4F7FB",
  white: "#FFFFFF"
};

// [texto, fundo] que o produto usa na prática; todos devem atingir WCAG AA (4.5:1).
export const ORION_CONTRAST_PAIRS = [
  ["white", "navy900"],
  ["silver300", "navy900"],
  ["sky300", "navy900"],
  ["silver300", "navy800"],
  ["sky300", "navy800"],
  ["navy900", "mist50"],
  ["blue700", "white"],
  ["slate600", "mist50"]
];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Decide a marca exibida. O padrão é sempre FinanFlow: ORION só aparece quando habilitado
// de forma explícita (variável de build, ?brand=orion ou prévia salva no navegador).
export function resolveBrand({ envFlag, search = "", stored = null } = {}) {
  const fromUrl = new URLSearchParams(search).get("brand");
  if (fromUrl === "finanflow") return "finanflow";
  if (fromUrl === "orion") return "orion";
  if (envFlag === "true") return "orion";
  if (stored === "orion") return "orion";
  return "finanflow";
}
