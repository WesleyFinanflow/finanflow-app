import test from "node:test";
import assert from "node:assert/strict";
import { createTransactionForm } from "./form-state.js";

test("atalho de receita abre o tipo e a categoria corretos", () => {
  assert.deepEqual(createTransactionForm("receita", "2026-06-20"), {
    type: "receita",
    description: "",
    amount: "",
    date: "2026-06-20",
    category: "Renda",
    status: "pendente",
    accountId: "",
  });
});

test("novo lançamento continua iniciando como despesa", () => {
  const form = createTransactionForm("despesa", "2026-06-20");
  assert.equal(form.type, "despesa");
  assert.equal(form.category, "Moradia");
});
