import { test, expect } from "@playwright/test";
import { totp } from "../../backend/src/mfa-crypto.js";
const api="http://127.0.0.1:5392", password="Browser-test-only-947!";
const email=(project,kind)=>`${project}.${kind}@example.test`;
async function login(page,address,path="/admin"){
 await page.goto(path);
 await page.getByRole("textbox",{name:"E-mail",exact:true}).fill(address);
 await page.getByLabel("Senha",{exact:true}).fill(password);
 const readyRequests=[];
 const track=request=>{if(new URL(request.url()).pathname==="/api/ready")readyRequests.push(request);};
 page.on("request",track);
 const response=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/auth/login" && response.request().method()==="POST");
 await page.getByRole("button",{name:"Entrar",exact:true}).click();
 expect((await response).status()).toBe(200);
 page.off("request",track);expect(readyRequests).toHaveLength(0);
}
async function logout(page){
 await page.getByRole("button",{name:"Abrir menu do perfil",exact:true}).click();
 await page.getByRole("button",{name:/Sair da conta/}).or(page.getByRole("menuitem",{name:"Sair da conta",exact:true})).click();
 await expect(page.getByRole("heading",{name:"Entrar",exact:true})).toBeVisible();
}
test.beforeEach(async({context})=>{
 // Fail closed: browser requests cannot reach production or external integrations.
 await context.route("**/*",route=>{
  const url=new URL(route.request().url());
  return ["127.0.0.1","localhost","[::1]"].includes(url.hostname)?route.continue():route.abort("blockedbyclient");
 });
});
test("usuário comum: permissão administrativa negada e logout revoga sessão",async({page},info)=>{
 await login(page,email(info.project.name,"user"));
 await expect(page.getByRole("heading",{name:"Acesso administrativo negado",exact:true})).toBeVisible();
 expect((await page.request.get(api+"/api/admin/bootstrap")).status()).toBe(403);
 const me=await page.request.get(api+"/api/me");expect(me.status()).toBe(200);expect((await me.json()).user.isAdmin).toBe(false);
 const cookies=await page.context().cookies();
 await page.goto("/planejamento/dividas");
 await expect(page.getByRole("heading",{name:"Plano mensal para quitar dívidas",exact:true})).toBeVisible();
 await page.goto("/");
 await expect(page.getByRole("button",{name:"Abrir menu do perfil",exact:true})).toBeVisible();
 await logout(page);
 expect((await page.request.get(api+"/api/me")).status()).toBe(401);
 const replay=await page.request.get(api+"/api/me",{headers:{Cookie:cookies.map(c=>`${c.name}=${c.value}`).join("; ")}});
 expect(replay.status()).toBe(401);
});
test("admin libera cortesia Premium sem prazo para cliente com teste expirado",async({page,browser},info)=>{
 const project=info.project.name;
 await login(page,email(project,"owner"));
 await expect(page.getByRole("heading",{name:"Painel administrativo",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Clientes",exact:true}).click();
 await page.getByPlaceholder("Buscar nome ou e-mail").fill(email(project,"courtesy"));
 await page.locator(".admin-client-list article").filter({hasText:email(project,"courtesy")}).getByRole("button",{name:"Ver cliente",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:`${project} courtesy`});
 await expect(dialog).toBeVisible();
 await dialog.getByRole("button",{name:"PREMIUM",exact:true}).click();
 await expect(dialog.getByRole("status")).toHaveText("Acesso atualizado com sucesso.");
 await expect(dialog.getByText("Cortesia sem vencimento",{exact:true})).toBeVisible();
 await expect(dialog.getByText("Sem vencimento",{exact:true})).toBeVisible();
 await expect(dialog).toHaveAttribute("aria-busy","false");
 await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();
 // Separate browser session: the user's own login must reflect the admin action.
 const userContext=await browser.newContext({baseURL:"http://127.0.0.1:5392"});
 try{
  await userContext.route("**/*",route=>["127.0.0.1","localhost"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const userPage=await userContext.newPage();await login(userPage,email(project,"courtesy"),"/");
  await expect(userPage.getByRole("button",{name:"Abrir menu do perfil",exact:true})).toBeVisible();
  const current=await userPage.request.get(api+"/api/me");expect(current.status()).toBe(200);
  expect((await current.json()).user).toMatchObject({role:"USER",isAdmin:false,planCode:"PREMIUM",accessOrigin:"COURTESY",trialStatus:"CONVERTED",trialEndsAt:null});
  expect((await userPage.request.get(api+"/api/admin/bootstrap")).status()).toBe(403);
 }finally{await userContext.close();}
});
test("MFA: configura, impede acesso sem código, rejeita repetição e permite recuperação",async({page},info)=>{
 const address=email(info.project.name,"mfa");
 await login(page,address);await expect(page.getByRole("heading",{name:"Painel administrativo",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Proteger minha conta com segundo fator",exact:true}).click();
 await page.getByLabel("Senha atual",{exact:true}).fill(password);
 await page.getByRole("button",{name:"Começar configuração",exact:true}).click();
 const secret=await page.locator(".mfa-secret").innerText();expect(secret).toMatch(/^[A-Z2-7]{32}$/);
 const code=totp(secret,Math.floor(Date.now()/30000));
 await page.getByLabel("Código de 6 dígitos",{exact:true}).fill(code);
 await page.getByRole("button",{name:"Ativar segundo fator",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Guarde seus códigos de recuperação",exact:true})).toBeVisible();
 const codes=await page.locator(".mfa-codes code").allTextContents();expect(codes).toHaveLength(10);
 await page.getByRole("button",{name:"Guardei os códigos, continuar",exact:true}).click();
 await expect(page.getByRole("button",{name:"Segurança: segundo fator ativo",exact:true})).toBeVisible();
 await logout(page);
 await login(page,address);
 await expect(page.getByRole("heading",{name:"Confirme seu acesso",exact:true})).toBeVisible();
 const before=await page.request.get(api+"/api/admin/bootstrap");expect(before.status()).toBe(403);expect((await before.json()).code).toBe("MFA_REQUIRED");
 expect((await page.request.get(api+"/api/spaces")).status()).toBe(403);
 await page.getByLabel("Código de 6 dígitos",{exact:true}).fill(code);
 await page.getByRole("button",{name:"Confirmar acesso",exact:true}).click();
 await expect(page.getByRole("alert")).toHaveText("Código inválido ou já utilizado.");
 await page.getByRole("button",{name:"Usar código de recuperação",exact:true}).click();
 await page.getByLabel("Código de recuperação",{exact:true}).fill(codes[0]);
 await page.getByRole("button",{name:"Confirmar acesso",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Painel administrativo",exact:true})).toBeVisible();
 expect((await page.request.get(api+"/api/admin/bootstrap")).status()).toBe(200);
 const reuse=await page.request.post(api+"/api/auth/mfa/verify",{headers:{Origin:"http://127.0.0.1:5392"},data:{recoveryCode:codes[0]}});expect(reuse.status()).toBe(400);
 await page.getByRole("button",{name:"Segurança: segundo fator ativo",exact:true}).click();
 await expect(page.getByText("Códigos de recuperação disponíveis: 9.",{exact:true})).toBeVisible();
});
