import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { actor, useActor, call, transaction, month, base } from "../financial-fixtures.js";
async function nav(page,name){await page.getByRole("button",{name,exact:true}).click();}
// O lembrete de vencimentos abre sozinho depois que os lançamentos carregam (a fixture de série tem parcela atrasada) e, no celular,
// cobre botões do extrato. Um isVisible() pontual corre contra esse carregamento; o handler fecha o aviso sempre que ele aparecer
// e bloquear uma ação, independente de quando renderizar.
test.beforeEach(async({page})=>{
 await page.addLocatorHandler(page.getByRole("button",{name:"Fechar lembrete",exact:true}),async button=>{await button.click();});
});
async function manual(page,{type,description,amount,status="pago",count="1"}){
 await nav(page,"Lançamentos");
 const fresh=page.getByRole("button",{name:"Novo lançamento",exact:true});if(await fresh.isVisible())await fresh.click();
 await page.getByRole("button",{name:/Lançamento manual/}).click();
 const form=page.locator("form.transaction-form-panel");
 await form.getByRole("combobox",{name:"Tipo",exact:true}).selectOption(type);
 await form.getByLabel("Descrição",{exact:true}).fill(description);
 await form.getByRole("combobox",{name:"Parcelamento",exact:true}).selectOption(count);
 await form.getByLabel(count==="1"?"Valor":"Valor de cada parcela",{exact:true}).fill(String(amount));
 await form.getByLabel("Data / vencimento",{exact:true}).fill(month()+"-10");
 await form.getByRole("combobox",{name:"Categoria",exact:true}).selectOption(type==="receita"?"Salário":"Moradia");
 await form.getByRole("combobox",{name:"Status",exact:true}).selectOption(status);
 const saved=page.waitForResponse(r=>r.request().method()==="POST"&&/\/transactions$/.test(new URL(r.url()).pathname));
 await form.getByRole("button",{name:"Salvar lançamento",exact:true}).click();
 const response=await saved;expect(response.status()).toBe(201);await expect(form).not.toBeVisible();return response.json();
}
async function balance(page,value){await nav(page,"Contas");await expect(page.locator(".primary-balance strong")).toHaveText(value);}
test("lançamentos, parcelas, recorrência, saldo e exportações conferem com valores conhecidos",async({page,context},info)=>{
 test.setTimeout(90000);
 const fixture=await actor(info.project.name,"finance");await useActor(context,fixture);await page.goto("/");
 await balance(page,/1\.000,00/);
 await page.getByLabel("Saldo inicial",{exact:true}).fill("1000.01");
 const update=page.waitForResponse(r=>r.request().method()==="PUT"&&r.url().includes("/accounts/"));
 await page.getByRole("button",{name:"Salvar saldo inicial",exact:true}).click();expect((await update).status()).toBe(200);
 await manual(page,{type:"receita",description:"Salary fixture",amount:500.02});
 await manual(page,{type:"despesa",description:"Market fixture",amount:50.03});
 const installments=await manual(page,{type:"despesa",description:"Installment fixture",amount:33.33,status:"pendente",count:"3"});
 expect(installments.transactions).toHaveLength(3);expect(installments.transactions.map(t=>t.amount)).toEqual([33.33,33.33,33.33]);expect(installments.transactions[0].totalAmount).toBe(99.99);
 const fixed=await call(page.request,`/api/spaces/${fixture.spaceId}/transactions`,transaction({description:"Monthly fixture",amount:10,recurrence:"monthly"}));
 expect(fixed.status).toBe(201);expect(fixed.body.transactions).toHaveLength(24);
 const meal=await call(page.request,`/api/spaces/${fixture.spaceId}/transactions`,transaction({type:"receita",description:"Meal fixture",amount:200,status:"pago",fundingSource:"meal"}));expect(meal.status).toBe(201);
 const pending=await call(page.request,`/api/spaces/${fixture.spaceId}/transactions`,transaction({description:"=1+1",amount:100}));expect(pending.status).toBe(201);
 await page.reload();await balance(page,/1\.450,00/);
 await expect(page.locator(".balance-value strong")).toHaveText(/1\.256,67/);
 // Persisted base balance must not be changed as paid transactions are accumulated in the UI.
 const accounts=await call(page.request,`/api/spaces/${fixture.spaceId}/accounts`);expect(accounts.body.accounts[0].balance).toBe(1000.01);
 await nav(page,"Lançamentos");const row=page.locator(".transaction-row").filter({hasText:"Market fixture"});await row.getByRole("button",{name:"Editar",exact:true}).click();
 await page.getByLabel("Valor",{exact:true}).fill("60.03");
 const edited=page.waitForResponse(r=>r.request().method()==="PUT"&&r.url().includes("/transactions/"));await page.getByRole("button",{name:"Salvar edição",exact:true}).click();expect((await edited).status()).toBe(200);
 await balance(page,/1\.440,00/);
 await nav(page,"Relatórios");
 await expect(page.locator(".report-kpi").filter({hasText:"Saldo inicial"}).locator("strong")).toHaveText(/1\.000,01/);
 await expect(page.locator(".report-kpi").filter({hasText:"Receitas recebidas"}).locator("strong")).toHaveText(/500,02/);
 await expect(page.locator(".report-kpi").filter({hasText:"Saldo final"}).locator("strong")).toHaveText(/1\.440,00/);
 const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"Planilha",exact:true}).click();const download=await downloading;
 const csv=await readFile(await download.path(),"utf8");expect(csv).toContain('"\t=1+1"');expect(csv).toContain('"60,03"');expect(csv).toContain('"Salary fixture"');expect(csv).not.toContain('"=1+1"');
 // The PDF action uses browser printing; exercise it, then render the print document in Chromium.
 await page.evaluate(()=>{window.__printCalled=false;window.print=()=>window.__printCalled=true;});
 await expect(page.getByRole("button",{name:"PDF",exact:true})).toBeEnabled();
 await expect(page.locator(".dp-report [role=status]")).not.toBeVisible();
 await page.getByRole("button",{name:"PDF",exact:true}).click();expect(await page.evaluate(()=>window.__printCalled)).toBe(true);
 await page.emulateMedia({media:"print"});await expect(page.locator(".report-print-header")).toBeVisible();await expect(page.locator(".floating-message")).not.toBeVisible();await expect(page.locator(".due-reminder-fab")).not.toBeVisible();
 const pdf=await page.pdf({path:info.outputPath("financial-report.pdf"),format:"A4",printBackground:true});expect(pdf.subarray(0,4).toString()).toBe("%PDF");expect(pdf.length).toBeGreaterThan(5000);
 await page.screenshot({path:info.outputPath("financial-report-print.png"),fullPage:true});await page.emulateMedia({media:"screen"});
 await nav(page,"Lançamentos");await page.locator(".transaction-row").filter({hasText:"Installment fixture"}).getByRole("button",{name:"Excluir",exact:true}).click();
 const deleted=page.waitForResponse(r=>r.request().method()==="DELETE"&&r.url().includes("/transactions/"));await page.getByRole("button",{name:"Excluir lançamento",exact:true}).click();expect((await deleted).status()).toBe(200);
 const transactions=await call(page.request,`/api/spaces/${fixture.spaceId}/transactions`);expect(transactions.body.transactions.some(t=>t.description==="Installment fixture")).toBe(false);
 await balance(page,/1\.440,00/);
});
test("casal compartilha o livro financeiro, protege espaços individuais e isola o plano de dívidas",async({page,context,browser},info)=>{
 test.setTimeout(90000);
 const a=await actor(info.project.name,"partnerA"),b=await actor(info.project.name,"partnerB");await useActor(context,a);
 const partnerContext=await browser.newContext({baseURL:base});await useActor(partnerContext,b);
 try{
  const shared=await call(page.request,"/api/spaces/couple",{partnerName:"Partner fixture"});expect(shared.status).toBe(201);const couple=shared.body.space._id;
  expect((await call(partnerContext.request,`/api/invites/${shared.body.invite.code}/accept`,{})).status).toBe(200);
  expect((await call(page.request,`/api/spaces/${a.spaceId}/transactions`,transaction({description:"Partner A expense",amount:50,status:"pago"}))).status).toBe(201);
  const btx=await call(partnerContext.request,`/api/spaces/${b.spaceId}/transactions`,transaction({description:"Partner B expense",amount:100,status:"pago"}));expect(btx.status).toBe(201);
  expect((await call(partnerContext.request,`/api/spaces/${a.spaceId}/transactions`)).status).toBe(403);
  expect((await call(page.request,`/api/spaces/${couple}/transactions/${btx.body.transaction._id}`,null,"DELETE")).status).toBe(403);
  expect((await call(page.request,`/api/spaces/${couple}/transactions/${btx.body.transaction._id}/pending-series`,{},"PATCH")).status).toBe(403);
  const privateDebt=await call(page.request,`/api/spaces/${a.spaceId}/debts`,{name:"Private individual plan",originalBalance:"300",currentBalance:"300",minimumPayment:"100",dueDate:month()+"-20",interestRateMonthly:"0",shared:false,revision:0});expect(privateDebt.status).toBe(200);
  expect((await call(partnerContext.request,`/api/spaces/${a.spaceId}/debt-plan`)).status).toBe(403);
  const initial=await call(page.request,`/api/spaces/${couple}/debt-plan`);expect(initial.body.debts).toHaveLength(0);
  const beforeAccounts=(await call(page.request,`/api/spaces/${couple}/accounts`)).body.accounts;
  const beforeTx=(await call(page.request,`/api/spaces/${couple}/transactions`)).body.transactions;
  const debt=await call(page.request,`/api/spaces/${couple}/debts`,{name:"Shared loan",originalBalance:"400",currentBalance:"400",minimumPayment:"100",dueDate:month()+"-20",interestRateMonthly:"0",shared:true,revision:initial.body.revision});expect(debt.status).toBe(200);
  const simulated=await call(page.request,`/api/spaces/${couple}/debt-plan`,{revision:debt.body.revision,strategy:"snowball",monthlyPaymentAmount:"100",generate:true},"PUT");expect(simulated.status).toBe(200);expect(simulated.body.simulation.monthsRemaining).toBe(4);
  const id=simulated.body.debts[0].id;const paid=await call(partnerContext.request,`/api/spaces/${couple}/debts/${id}/mark-paid`,{revision:simulated.body.revision});expect(paid.status).toBe(200);expect(paid.body.status).toBe("COMPLETED");
  expect((await call(page.request,`/api/spaces/${couple}/accounts`)).body.accounts).toEqual(beforeAccounts);
  expect((await call(page.request,`/api/spaces/${couple}/transactions`)).body.transactions).toEqual(beforeTx);
  expect((await call(partnerContext.request,`/api/spaces/${couple}/debt-plan`)).body.debts.some(d=>d.name==="Private individual plan")).toBe(false);
  await context.addInitScript(()=>localStorage.setItem("finanflow_active_mode","couple"));await page.goto("/");
  await balance(page,/1\.850,00/);await expect(page.getByRole("heading",{name:"Conta conjunta",exact:true})).toBeVisible();
  await nav(page,"Lançamentos");await expect(page.locator(".transaction-row").filter({hasText:"Partner A expense"})).toBeVisible();await expect(page.locator(".transaction-row").filter({hasText:"Partner B expense"})).toBeVisible();
 }finally{await partnerContext.close();}
});


test("edição da escolhida e pendentes seguintes preserva pagamentos e identificadores",async({page,context},info)=>{
 const fixture=await actor(info.project.name,"series");await useActor(context,fixture);
 const now=new Date(),previousMonth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,10)).toISOString().slice(0,10),basePath=`/api/spaces/${fixture.spaceId}/transactions`;
 const created=await call(page.request,basePath,transaction({description:"Series editing fixture",amount:10,date:previousMonth,status:"pago",installmentCount:4}));expect(created.status).toBe(201);
 expect((await call(page.request,basePath+"/"+created.body.transactions[2]._id+"/status",{status:"pago"},"PATCH")).status).toBe(200);
 const before=(await call(page.request,basePath)).body.transactions.sort((a,b)=>a.installmentNumber-b.installmentNumber);
 await page.goto("/");await nav(page,"Lançamentos");const selected=page.locator(".transaction-row").filter({hasText:"Series editing fixture"});await selected.getByRole("button",{name:"Editar",exact:true}).click();
 await expect(page.getByRole("note")).toContainText("Esta parcela e as pendentes seguintes");
 await expect(page.getByRole("combobox",{name:"Frequência",exact:true})).toBeDisabled();await expect(page.getByRole("combobox",{name:"Parcelamento",exact:true})).toBeDisabled();
 await page.getByLabel("Descrição",{exact:true}).fill("Updated series fixture");await page.getByLabel("Valor por parcela pendente",{exact:true}).fill("20");await page.getByLabel("Data / vencimento",{exact:true}).fill(month()+"-20");await page.getByRole("combobox",{name:"Status",exact:true}).selectOption("pago");
 const saving=page.waitForResponse(response=>response.request().method()==="PATCH"&&response.url().endsWith("/pending-series"));await page.getByRole("button",{name:"Salvar edição",exact:true}).click();expect((await saving).status()).toBe(200);
 const after=(await call(page.request,basePath)).body.transactions.sort((a,b)=>a.installmentNumber-b.installmentNumber);
 expect(after.map(row=>row._id)).toEqual(before.map(row=>row._id));expect(after[0]).toEqual(before[0]);expect(after[2]).toEqual(before[2]);expect(after.map(row=>row.amount)).toEqual([10,20,10,20]);expect(after.map(row=>row.status)).toEqual(["pago","pago","pago","pendente"]);expect(after[3].date).toMatch(/-20$/);
 await expect(page.locator(".transaction-row").filter({hasText:"Updated series fixture"}).locator(".transaction-value small")).toHaveText(/Total.*60,00/);
});
