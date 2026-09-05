import test from "node:test";
import assert from "node:assert/strict";
import { findSimilarTransaction, parseReceiptText } from "./receipt-ocr.js";

test("extrai comprovante Pix", () => { const result=parseReceiptText("Banco do Brasil\nPix enviado\nDestinatário: Kamila Alves de Souza\nVALOR DA TRANSAÇÃO R$ 250,00\n04/09/2026 10:15:22\nID E318724"); assert.equal(result.amount,250); assert.equal(result.description,"Kamila Alves de Souza"); assert.equal(result.paymentMethod,"Pix"); assert.equal(result.date,"2026-09-04"); });
test("sugere Saúde para farmácia", () => { const result=parseReceiptText("DROGASIL\nCNPJ: 61.585.865/0001-51\nTOTAL R$ 53,70\n04/09/2026 14:32"); assert.equal(result.amount,53.7); assert.equal(result.category,"Saúde"); });
test("sugere Alimentação para supermercado", () => { const result=parseReceiptText("São Luiz Supermercados\nTOTAL R$ 89,58\n04/09/2026 19:21\nCartão de Débito"); assert.equal(result.category,"Alimentação"); assert.equal(result.paymentMethod,"Cartão de débito"); });
test("extrai conta sem inventar campos ausentes", () => { const result=parseReceiptText("ENEL ENERGIA\nTOTAL A PAGAR 142,90\n10/09/2026"); assert.equal(result.amount,142.9); assert.equal(result.category,"Moradia"); assert.equal(result.time,""); });
test("imagem ilegível produz campos vazios", () => { const result=parseReceiptText("### 1lI"); assert.equal(result.amount,null); assert.equal(result.date,""); assert.equal(result.category,""); });
test("detecta provável duplicidade", () => { assert.ok(findSimilarTransaction([{amount:89.58,date:"2026-09-04",description:"São Luiz"}],{amount:89.58,date:"2026-09-04",description:"São Luiz Supermercados"})); });
