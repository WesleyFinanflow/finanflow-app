import test from "node:test";
import assert from "node:assert/strict";
import { InputError } from "./validation.js";
import {
  MAX_ACCOUNTS_PER_PERSON, MULTI_ACCOUNT_FLAG, ConflictError, featureEnabledForUser, parseAccountInput,
  assertCanCreate, assertCanUpdate, assertCanDelete, chooseAccountForTransaction, accountDeleteAudit
} from "./accounts.js";

const acc = (id, name, extra = {}) => ({ _id: id, name, balance: 0, archived: false, ...extra });
const user = { name: "Wesley" };

test("a chave da multiconta existe e o limite é de 6 contas por pessoa", () => {
  assert.equal(MULTI_ACCOUNT_FLAG, "multiconta");
  assert.equal(MAX_ACCOUNTS_PER_PERSON, 6);
});

test("a multiconta só liga se a chave existir e estiver ativa (chave ausente = desligada)", () => {
  assert.equal(featureEnabledForUser(null, user, "USER"), false);
  assert.equal(featureEnabledForUser(undefined, user, "USER"), false);
  assert.equal(featureEnabledForUser({ active: false, audience: "ALL" }, user, "USER"), false);
  assert.equal(featureEnabledForUser({ active: true, audience: "ALL" }, user, "USER"), true);
});

test("o público da chave é respeitado (administradores primeiro)", () => {
  const admins = { active: true, audience: "ADMINS" };
  assert.equal(featureEnabledForUser(admins, user, "USER"), false);
  assert.equal(featureEnabledForUser(admins, user, "ADMIN"), true);
  assert.equal(featureEnabledForUser(admins, user, "SUPER_ADMIN"), true);
  const premium = { active: true, audience: "PREMIUM" };
  assert.equal(featureEnabledForUser(premium, { planCode: "FREE" }, "USER"), false);
  assert.equal(featureEnabledForUser(premium, { planCode: "PREMIUM" }, "USER"), true);
  const testGroup = { active: true, audience: "TEST_GROUP" };
  assert.equal(featureEnabledForUser(testGroup, { trialStatus: "ACTIVE" }, "USER"), true);
  assert.equal(featureEnabledForUser(testGroup, { trialStatus: "EXPIRED" }, "USER"), false);
  assert.equal(featureEnabledForUser({ active: true, audience: "OUTRO" }, user, "SUPER_ADMIN"), false);
});

test("parseAccountInput normaliza nome, saldo e responsável", () => {
  assert.deepEqual(parseAccountInput({ name: "  Nubank  ", balance: 150.5 }, user), { name: "Nubank", ownerName: "Wesley", balance: 150.5 });
  assert.deepEqual(parseAccountInput({ name: "Santander" }, user), { name: "Santander", ownerName: "Wesley", balance: 0 });
  assert.equal(parseAccountInput({ name: "MP", ownerName: "Casal" }, user).ownerName, "Casal");
});

test("parseAccountInput rejeita entradas inválidas", () => {
  for (const body of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: { $ne: 1 } }, { name: ["a"] }, { name: "A", balance: "abc" }, { name: "A", balance: Infinity }, { name: "A", balance: 1e15 }, null, "texto"]) {
    assert.throws(() => parseAccountInput(body, user), InputError, JSON.stringify(body));
  }
});

test("parseAccountInput aceita saldo negativo (conta no vermelho)", () => {
  assert.equal(parseAccountInput({ name: "Cheque especial", balance: -250 }, user).balance, -250);
});

test("parseAccountInput em edição aceita só os campos enviados e o campo arquivada", () => {
  assert.deepEqual(parseAccountInput({ archived: true }, user, { partial: true }), { archived: true });
  assert.deepEqual(parseAccountInput({ name: "Novo nome" }, user, { partial: true }), { name: "Novo nome" });
  assert.deepEqual(parseAccountInput({ balance: 10 }, user, { partial: true }), { balance: 10 });
  assert.throws(() => parseAccountInput({ archived: "sim" }, user, { partial: true }), InputError);
  assert.throws(() => parseAccountInput({}, user, { partial: true }), InputError);
});

test("parseAccountInput ignora campos de identidade enviados pelo cliente", () => {
  const result = parseAccountInput({ name: "Nubank", spaceId: "x", userId: "y", userCreated: false, _id: "z" }, user);
  assert.deepEqual(Object.keys(result).sort(), ["balance", "name", "ownerName"]);
});

test("criação respeita o limite de 6 contas ativas", () => {
  const five = Array.from({ length: 5 }, (_, i) => acc(String(i), `Conta ${i}`));
  assert.doesNotThrow(() => assertCanCreate(five, "Nova"));
  const six = [...five, acc("5", "Conta 5")];
  assert.throws(() => assertCanCreate(six, "Outra"), (error) => error instanceof ConflictError && error.status === 409 && /6/.test(error.message));
});

test("contas arquivadas não ocupam vaga no limite", () => {
  const list = [...Array.from({ length: 6 }, (_, i) => acc(String(i), `Conta ${i}`, { archived: i < 2 }))];
  assert.doesNotThrow(() => assertCanCreate(list, "Nova"));
});

test("nome repetido entre contas ativas é recusado, ignorando maiúsculas e espaços", () => {
  const list = [acc("1", "Nubank")];
  assert.throws(() => assertCanCreate(list, "  nubank "), ConflictError);
  assert.doesNotThrow(() => assertCanCreate([acc("1", "Nubank", { archived: true })], "Nubank"));
});

test("arquivar a única conta ativa é recusado; arquivar outra é permitido", () => {
  const list = [acc("1", "Principal"), acc("2", "Nubank")];
  assert.doesNotThrow(() => assertCanUpdate({ account: list[1], patch: { archived: true }, accounts: list }));
  assert.throws(() => assertCanUpdate({ account: list[0], patch: { archived: true }, accounts: [list[0], acc("2", "Nubank", { archived: true })] }), ConflictError);
  assert.throws(() => assertCanUpdate({ account: list[0], patch: { archived: true }, accounts: [list[0]] }), ConflictError);
});

test("reativar uma conta respeita o limite de 6", () => {
  const six = Array.from({ length: 6 }, (_, i) => acc(String(i), `Conta ${i}`));
  const archived = acc("9", "Antiga", { archived: true });
  assert.throws(() => assertCanUpdate({ account: archived, patch: { archived: false }, accounts: [...six, archived] }), ConflictError);
  assert.doesNotThrow(() => assertCanUpdate({ account: archived, patch: { archived: false }, accounts: [...six.slice(0, 5), archived] }));
});

test("renomear não pode colidir com outra conta ativa, mas pode manter o próprio nome", () => {
  const list = [acc("1", "Principal"), acc("2", "Nubank")];
  assert.throws(() => assertCanUpdate({ account: list[1], patch: { name: "principal" }, accounts: list }), ConflictError);
  assert.doesNotThrow(() => assertCanUpdate({ account: list[1], patch: { name: "NUBANK" }, accounts: list }));
});

test("excluir exige digitar o nome da conta", () => {
  const list = [acc("1", "Principal"), acc("2", "Nubank")];
  assert.doesNotThrow(() => assertCanDelete({ account: list[1], accounts: list, confirmName: "nubank " }));
  for (const confirmName of [undefined, "", "outro", { $ne: 1 }]) {
    assert.throws(() => assertCanDelete({ account: list[1], accounts: list, confirmName }), InputError, String(confirmName));
  }
});

test("nunca exclui a única conta nem a última conta ativa", () => {
  const only = [acc("1", "Principal")];
  assert.throws(() => assertCanDelete({ account: only[0], accounts: only, confirmName: "Principal" }), ConflictError);
  const onlyActive = [acc("1", "Principal"), acc("2", "Velha", { archived: true })];
  assert.throws(() => assertCanDelete({ account: onlyActive[0], accounts: onlyActive, confirmName: "Principal" }), ConflictError);
  assert.doesNotThrow(() => assertCanDelete({ account: onlyActive[1], accounts: onlyActive, confirmName: "Velha" }));
});

test("sem conta informada, o lançamento vai para a conta principal ativa", () => {
  const list = [acc("2", "Nubank"), acc("1", "Conta principal")];
  assert.equal(chooseAccountForTransaction({ accounts: list })._id, "1");
  assert.equal(chooseAccountForTransaction({ accounts: [acc("2", "Nubank"), acc("3", "Conta conjunta")] })._id, "3");
  assert.equal(chooseAccountForTransaction({ accounts: [acc("2", "Nubank"), acc("3", "Santander")] })._id, "2");
  assert.equal(chooseAccountForTransaction({ accounts: [acc("1", "Conta principal", { archived: true }), acc("2", "Nubank")] })._id, "2");
});

test("com conta informada, ela precisa existir no espaço e estar ativa", () => {
  const list = [acc("1", "Conta principal"), acc("2", "Nubank"), acc("3", "Velha", { archived: true })];
  assert.equal(chooseAccountForTransaction({ requestedId: "2", accounts: list })._id, "2");
  assert.throws(() => chooseAccountForTransaction({ requestedId: "999", accounts: list }), InputError);
  assert.throws(() => chooseAccountForTransaction({ requestedId: "3", accounts: list }), InputError);
});

test("ids como objeto com toString são comparados como texto", () => {
  const objectId = { toString: () => "507f1f77bcf86cd799439011" };
  const list = [acc(objectId, "Conta principal")];
  assert.equal(chooseAccountForTransaction({ requestedId: "507f1f77bcf86cd799439011", accounts: list })._id, objectId);
});

test("editar um lançamento que já está numa conta arquivada continua permitido", () => {
  const list = [acc("1", "Conta principal"), acc("3", "Velha", { archived: true })];
  assert.equal(chooseAccountForTransaction({ requestedId: "3", currentAccountId: "3", accounts: list })._id, "3");
  assert.throws(() => chooseAccountForTransaction({ requestedId: "3", currentAccountId: "1", accounts: list }), InputError);
});

test("sem nenhuma conta ativa não há onde lançar", () => {
  assert.throws(() => chooseAccountForTransaction({ accounts: [acc("1", "Velha", { archived: true })] }), InputError);
  assert.throws(() => chooseAccountForTransaction({ accounts: [] }), InputError);
});

test("a cópia de auditoria da exclusão guarda a conta e todos os lançamentos", () => {
  const account = acc("2", "Nubank", { balance: 100 });
  const transactions = [{ _id: "t1", amount: 10 }, { _id: "t2", amount: 20 }];
  const audit = accountDeleteAudit({ account, transactions });
  assert.equal(audit.summary, "Conta excluída: Nubank (2 lançamentos)");
  assert.deepEqual(audit.before, { account, transactions });
  assert.ok(audit.summary.length <= 180);
  assert.equal(accountDeleteAudit({ account: acc("3", "X".repeat(80)), transactions: [] }).summary.length <= 180, true);
  assert.equal(accountDeleteAudit({ account, transactions: [transactions[0]] }).summary, "Conta excluída: Nubank (1 lançamento)");
});
