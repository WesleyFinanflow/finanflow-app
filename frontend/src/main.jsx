import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./layout-fix.css";
import "./product-fix.css";
import "./green-wallet-theme.css";
import "./premium-redesign.css";
import "./orion-theme.css";
import { resolveBrand } from "./orion-tokens.js";

// ORION fica desligado por padrão. Prévia: abrir /?brand=orion (volta ao normal com /?brand=finanflow).
const BRAND_KEY = "finanflow_brand_preview";
function readStoredBrand() {
  try { return localStorage.getItem(BRAND_KEY); } catch { return null; }
}
const brand = resolveBrand({ envFlag: import.meta.env.VITE_ORION_BRAND, search: window.location.search, stored: readStoredBrand() });
try {
  const requested = new URLSearchParams(window.location.search).get("brand");
  if (requested === "orion") localStorage.setItem(BRAND_KEY, "orion");
  if (requested === "finanflow") localStorage.removeItem(BRAND_KEY);
} catch { /* armazenamento indisponível: a prévia vale só para esta página */ }
document.documentElement.dataset.brand = brand;
if (brand === "orion") {
  document.title = "ORION - Seu Assistente Pessoal";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0B1F3A");
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
  });
}
