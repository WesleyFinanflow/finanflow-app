import test from "node:test";
import assert from "node:assert/strict";
import { getCoupleMenuState } from "./space-menu.js";

test("mantém casal indisponível quando não existe espaço vinculado", () => {
  assert.deepEqual(getCoupleMenuState(null), { enabled: false, status: "unavailable", subtitle: "Não configurado" });
});

test("mantém convite pendente bloqueado", () => {
  assert.deepEqual(getCoupleMenuState({ memberCount: 1 }), { enabled: false, status: "pending", subtitle: "Convite pendente" });
});

test("libera alternância quando o convite foi aceito", () => {
  assert.deepEqual(getCoupleMenuState({ memberCount: 2 }), { enabled: true, status: "ready", subtitle: "Espaço compartilhado" });
});
