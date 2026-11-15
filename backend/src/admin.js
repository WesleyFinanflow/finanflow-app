import mongoose from "mongoose";
import { userSearch } from "./admin-search.js";
import { adminDashboard } from "./admin-dashboard.js";
import { InputError, oneOf, requiredText } from "./validation.js";
import { extendTrial, grantManualPlan, subscriptionPayload, reconcileSubscription } from "./access-management.js";
import { redeemCoupon } from "./coupon-redemption.js";

const { Schema } = mongoose;
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const Plan = model("Plan", new Schema({ code:{type:String,unique:true,uppercase:true,trim:true}, name:String, description:String, referencePrice:{type:Number,default:0}, billingCycle:{type:String,enum:["MONTHLY","ANNUAL"],default:"MONTHLY"}, active:{type:Boolean,default:true}, features:[String] },{timestamps:true}));
export const Subscription = model("Subscription", new Schema({ userId:{type:Schema.Types.ObjectId,ref:"User",index:true}, planCode:String, startsAt:Date, endsAt:Date, status:{type:String,enum:["TRIAL","ACTIVE","EXPIRED","CANCELLED","MANUAL"],default:"MANUAL"}, origin:{type:String,enum:["TRIAL","ADMIN","FUTURE_PAYMENT_GATEWAY"],default:"ADMIN"} },{timestamps:true}));
const couponBenefits=["EXTRA_TRIAL_DAYS","PLUS_DAYS","PREMIUM_DAYS","PERCENT_DISCOUNT","AMOUNT_DISCOUNT"];
export const Coupon = model("Coupon", new Schema({
  code:{type:String,unique:true,uppercase:true,trim:true,required:true},description:{type:String,trim:true,maxlength:300},benefitType:{type:String,enum:couponBenefits,default:"EXTRA_TRIAL_DAYS"},benefitValue:{type:Number,min:0,required:true,default:0},
  maxUses:{type:Number,min:0,default:0},maxUsesPerUser:{type:Number,min:0,default:1},startsAt:{type:Date,default:Date.now},endsAt:Date,active:{type:Boolean,default:true},allowedPlan:{type:String,enum:["ALL","FREE","PLUS","PREMIUM"],default:"ALL"},allowedAudience:{type:String,enum:["ALL","USERS","ADMINS"],default:"ALL"},stackable:{type:Boolean,default:false},dailyLimit:{type:Number,min:0,default:0},autoExpireAtLimit:{type:Boolean,default:true},newUsersOnly:{type:Boolean,default:false},trialUsersOnly:{type:Boolean,default:false},allowAfterTrialExpired:{type:Boolean,default:false},
  usageCount:{type:Number,min:0,default:0},redemptionVersion:{type:Number,default:0},disabledAt:Date,
  percentOff:{type:Number,default:0},amountOff:{type:Number,default:0},extraTrialDays:{type:Number,default:0},planCode:String,validUntil:Date,usageLimit:{type:Number,default:0}
},{timestamps:true}));
export const CouponUsage = model("CouponUsage",new Schema({couponId:{type:Schema.Types.ObjectId,ref:"Coupon",index:true,required:true},code:{type:String,index:true},userId:{type:Schema.Types.ObjectId,ref:"User",index:true,required:true},userName:String,userEmail:String,benefitType:String,benefitValue:Number,benefitApplied:String,status:{type:String,enum:["SUCCESS","REJECTED"],default:"SUCCESS"},reason:String,usedAt:{type:Date,default:Date.now,index:true}},{timestamps:true}));
export const FeatureFlag = model("FeatureFlag", new Schema({ key:{type:String,unique:true}, name:String, description:String, audience:{type:String,enum:["ALL","PREMIUM","ADMINS","TEST_GROUP"],default:"ALL"}, active:{type:Boolean,default:true} },{timestamps:true}));
export const AdminAudit = model("AdminAudit", new Schema({ adminId:{type:Schema.Types.ObjectId,ref:"User"}, adminName:String, targetUserId:{type:Schema.Types.ObjectId,ref:"User"}, targetName:String, action:String, details:Schema.Types.Mixed },{timestamps:true}));
export const Announcement = model("Announcement", new Schema({ title:String, message:String, startsAt:Date, endsAt:Date, audience:{type:String,enum:["ALL","FREE","PLUS","PREMIUM","TRIAL","ADMINS"],default:"ALL"}, active:{type:Boolean,default:true}, createdBy:{type:Schema.Types.ObjectId,ref:"User"} },{timestamps:true}));
export const SupportTicket = model("SupportTicket", new Schema({ userId:{type:Schema.Types.ObjectId,ref:"User",index:true}, subject:String, message:String, category:{type:String,enum:["QUESTION","PROBLEM","SUGGESTION"],default:"QUESTION"}, status:{type:String,enum:["OPEN","IN_PROGRESS","RESOLVED","CLOSED"],default:"OPEN"}, adminReply:String, assignedTo:{type:Schema.Types.ObjectId,ref:"User"} },{timestamps:true}));
export const AdminNote = model("AdminNote", new Schema({ userId:{type:Schema.Types.ObjectId,ref:"User",index:true}, text:String, authorId:{type:Schema.Types.ObjectId,ref:"User"}, authorName:String },{timestamps:true}));
export const AppConfig = model("AppConfig", new Schema({ key:{type:String,unique:true,default:"global"}, productName:{type:String,default:"FinanFlow"}, trialEnabled:{type:Boolean,default:true}, defaultTrialDays:{type:Number,default:30}, trialPlanCode:{type:String,default:"PREMIUM"}, defaultPlanCode:{type:String,default:"FREE"}, registrationsOpen:{type:Boolean,default:true}, maintenanceMode:{type:Boolean,default:false}, maintenanceMessage:{type:String,default:"FinanFlow está em manutenção. Voltaremos em breve."}, globalNoticeEnabled:{type:Boolean,default:false}, globalNotice:{type:String,default:""}, supportEnabled:{type:Boolean,default:true}, couponsEnabled:{type:Boolean,default:true} },{timestamps:true}));

const daysFromNow = (days) => new Date(Date.now()+Number(days)*86400000);
const startOf = (days) => new Date(Date.now()-Number(days)*86400000);
const safeUser = (u) => ({ _id:u._id,name:u.name,email:u.email,profilePhoto:u.profilePhoto||"",role:u.role||"USER",accessStatus:u.accessStatus||"active",lastLoginAt:u.lastLoginAt||null,createdAt:u.createdAt,trialStartedAt:u.trialStartedAt||null,trialEndsAt:u.trialEndsAt||null,trialStatus:u.trialStatus||"NOT_STARTED",planCode:u.planCode||"FREE",accessOrigin:u.accessOrigin||null,blockedAt:u.blockedAt||null });
const couponLimit=(coupon)=>Number(coupon.maxUses||coupon.usageLimit||0);
export function couponStatus(coupon,now=new Date()){const count=Number(coupon.usageCount||0),limit=couponLimit(coupon),starts=coupon.startsAt?new Date(coupon.startsAt):null,ends=coupon.endsAt||coupon.validUntil?new Date(coupon.endsAt||coupon.validUntil):null;if(limit>0&&count>=limit)return "EXHAUSTED";if(!coupon.active)return "DISABLED";if(ends&&ends<now)return "EXPIRED";if(starts&&starts>now)return "SCHEDULED";return "ACTIVE";}
const couponView=(coupon)=>{const item=coupon.toObject?coupon.toObject():coupon;const maxUses=couponLimit(item);return {...item,maxUses,startsAt:item.startsAt||item.createdAt,endsAt:item.endsAt||item.validUntil,benefitType:item.benefitType||(item.extraTrialDays?"EXTRA_TRIAL_DAYS":item.percentOff?"PERCENT_DISCOUNT":item.amountOff?"AMOUNT_DISCOUNT":"EXTRA_TRIAL_DAYS"),benefitValue:Number(item.benefitValue||item.extraTrialDays||item.percentOff||item.amountOff||0),remainingUses:maxUses>0?Math.max(0,maxUses-Number(item.usageCount||0)):null,status:couponStatus(item)};};

export async function seedAdminDefaults(){
  await AppConfig.updateOne({key:"global"},{$setOnInsert:{key:"global"}},{upsert:true});
  await AppConfig.updateOne({key:"global",defaultTrialDays:7},{$set:{defaultTrialDays:30}});
  const plans=[
    {code:"FREE",name:"Gratuito",description:"Recursos essenciais para organização financeira.",referencePrice:0,features:["Lançamentos","Contas"]},
    {code:"PLUS",name:"Plus",description:"Planejamento e relatórios ampliados.",referencePrice:29.9,features:["Lançamentos","Contas","Planejamento","Relatórios"]},
    {code:"PREMIUM",name:"Premium",description:"Experiência completa do FinanFlow.",referencePrice:59.9,features:["Lançamentos","Contas","Planejamento","Modo casal","Relatórios","Exportação","Histórico completo"]},
  ];
  for(const plan of plans) await Plan.updateOne({code:plan.code},{$setOnInsert:plan},{upsert:true});
  const flags=["Modo casal","Planejamento","Relatórios","Exportação","Nova tela em teste"];
  for(const name of flags){const key=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g,"_");await FeatureFlag.updateOne({key},{$setOnInsert:{key,name,description:`Controle do recurso ${name}`,active:name!=="Nova tela em teste",audience:"ALL"}},{upsert:true});}
}

export function registerAdminRoutes(app,{auth,adminOnly,superAdminOnly,User,Space,Member,Account,Transaction,PurchasePlan,Invite,publicUser,canManageUser,deleteAccount,sendRecovery}){
  const audit=async(req,action,target,details={})=>AdminAudit.create({adminId:req.user._id,adminName:req.user.name,targetUserId:target?._id,targetName:target?.name,action,details});
  app.get("/api/platform/config",async(_req,res)=>{const c=await AppConfig.findOne({key:"global"}).lean();res.json({maintenanceMode:c?.maintenanceMode||false,maintenanceMessage:c?.maintenanceMessage,registrationsOpen:c?.registrationsOpen!==false,globalNoticeEnabled:c?.globalNoticeEnabled||false,globalNotice:c?.globalNotice||"",supportEnabled:c?.supportEnabled!==false,couponsEnabled:c?.couponsEnabled!==false});});
  app.get("/api/platform/features",auth,async(req,res)=>{const flags=await FeatureFlag.find().lean();const role=req.user.role||"USER",plan=req.user.planCode||"FREE";res.json({features:Object.fromEntries(flags.map(f=>[f.key,Boolean(f.active&&(f.audience==="ALL"||f.audience==="PREMIUM"&&plan==="PREMIUM"||f.audience==="ADMINS"&&role!=="USER"||f.audience==="TEST_GROUP"&&req.user.trialStatus==="ACTIVE"))]))});});
  app.get("/api/announcements/current",auth,async(req,res)=>{const now=new Date();const userPlan=req.user.planCode||"FREE";const audience=["ALL",userPlan,req.user.role!=="USER"?"ADMINS":null,req.user.trialStatus==="ACTIVE"?"TRIAL":null].filter(Boolean);res.json({announcements:await Announcement.find({active:true,audience:{$in:audience},startsAt:{$lte:now},endsAt:{$gte:now}}).sort({createdAt:-1}).lean()});});
  app.post("/api/support",auth,async(req,res,next)=>{const c=await AppConfig.findOne({key:"global"}).lean();if(c?.supportEnabled===false)return res.status(403).json({message:"O suporte está temporariamente desativado."});next();},async(req,res)=>res.status(201).json({ticket:await SupportTicket.create({userId:req.user._id,subject:requiredText(req.body?.subject,"Assunto",160),message:requiredText(req.body?.message,"Mensagem",3000),category:oneOf(req.body?.category||"QUESTION",["QUESTION","PROBLEM","SUGGESTION"],"Categoria")})}));
  app.get("/api/support/me",auth,async(req,res)=>res.json({tickets:await SupportTicket.find({userId:req.user._id}).sort({createdAt:-1}).lean()}));

  app.get("/api/admin/bootstrap",auth,adminOnly,async(req,res)=>{
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page,10)||1));
    const dashboard = await adminDashboard({User,Space,Member,Transaction,Account,PurchasePlan,Invite,Subscription},page,req.query);
    const sections={subscriptions:[Subscription,200],plans:[Plan,100],coupons:[Coupon,200],features:[FeatureFlag,100],communication:[Announcement,100],support:[SupportTicket,200],audit:[AdminAudit,200]};
    const selected=sections[req.query.section];
    const offset=section=>req.query.section===section&&selected?(page-1)*selected[1]:0;
    const total=selected?await selected[0].countDocuments():0;
    const listPagination=selected?{page,pageSize:selected[1],total,pages:Math.max(1,Math.ceil(total/selected[1]))}:null;
    const [subscriptions,plans,coupons,flags,announcements,tickets,audits,config]=await Promise.all([
      Subscription.find().sort({createdAt:-1,_id:-1}).skip(offset("subscriptions")).limit(200).lean(),Plan.find().sort({referencePrice:1,_id:1}).skip(offset("plans")).limit(100).lean(),Coupon.find().sort({createdAt:-1,_id:-1}).skip(offset("coupons")).limit(200).lean(),FeatureFlag.find().sort({_id:1}).skip(offset("features")).limit(100).lean(),Announcement.find().sort({createdAt:-1,_id:-1}).skip(offset("communication")).limit(100).lean(),SupportTicket.find().populate("userId","name email").sort({createdAt:-1,_id:-1}).skip(offset("support")).limit(200).lean(),AdminAudit.find().sort({createdAt:-1,_id:-1}).skip(offset("audit")).limit(200).lean(),AppConfig.findOne({key:"global"}).lean()
    ]);
    res.json({...dashboard,listPagination,me:publicUser(req.user),users:dashboard.users.map(u=>({...u,role:publicUser(u).role,isAdmin:publicUser(u).isAdmin,canManage:canManageUser(req.user,u)})),plans,subscriptions,coupons:coupons.map(couponView),flags,announcements,tickets,audits,config});
  });
  app.get("/api/admin/users/:id",auth,adminOnly,async(req,res)=>{const u=await User.findById(req.params.id).select("-passwordHash").lean();if(!u)return res.status(404).json({message:"Usuário não encontrado."});const memberships=await Member.find({userId:u._id}).select("spaceId").lean(),spaceIds=memberships.map(m=>m.spaceId);const [transactions,accounts,goals,invites,notes,subscription]=await Promise.all([Transaction.countDocuments({createdBy:u._id}),Account.countDocuments({spaceId:{$in:spaceIds}}),PurchasePlan.countDocuments({createdBy:u._id}),Invite.countDocuments({createdBy:u._id,usedAt:{$exists:false}}),AdminNote.find({userId:u._id}).sort({createdAt:-1}).lean(),Subscription.findOne({userId:u._id}).sort({createdAt:-1}).lean()]);res.json({user:{...safeUser(u),spaces:memberships.length,transactions,accounts,goals,pendingInvites:invites},notes,subscription});});
  app.patch("/api/admin/users/:id",auth,adminOnly,async(req,res)=>{
    const action=oneOf(req.body.action,["block","unblock","sessions","role","trial","end_trial","plan"],"Ação");
    const result=await mongoose.connection.transaction(async session=>{
      const u=await User.findById(req.params.id).session(session);
      if(!u)throw Object.assign(new InputError("Usuário não encontrado."),{status:404});
      if(!canManageUser(req.user,u))throw Object.assign(new InputError("Esta conta administrativa está protegida."),{status:403});
      if(action==="block"){u.accessStatus="blocked";u.blockedAt=new Date();u.passwordVersion=(u.passwordVersion||0)+1;}
      if(action==="unblock"){u.accessStatus="active";u.blockedAt=undefined;}
      if(action==="sessions")u.passwordVersion=(u.passwordVersion||0)+1;
      if(action==="role"){
        if(req.user.role!=="SUPER_ADMIN")throw Object.assign(new InputError("Somente SUPER_ADMIN altera perfis."),{status:403});
        u.role=oneOf(req.body.role,["USER","ADMIN","SUPER_ADMIN"],"Perfil");u.passwordVersion=(u.passwordVersion||0)+1;
      }
      if(action==="trial")extendTrial(u,req.body);
      if(action==="end_trial"){u.trialStatus="CANCELLED";u.accessStatus="active";u.trialEndsAt=undefined;u.planCode="FREE";u.accessOrigin="FREE";}
      if(action==="plan")grantManualPlan(u,req.body.planCode);
      if(["trial","end_trial","plan"].includes(action)){
        await Subscription.updateMany({userId:u._id,status:{$in:["TRIAL","ACTIVE","MANUAL"]}},{$set:{status:"CANCELLED"}},{session});
        if(action==="trial")await Subscription.create([{userId:u._id,planCode:u.planCode,startsAt:new Date(),endsAt:u.trialEndsAt,status:"TRIAL",origin:"TRIAL"}],{session});
      }
      await u.save({session});
      await AdminAudit.create([{adminId:req.user._id,adminName:req.user.name,targetUserId:u._id,targetName:u.name,action,details:{days:req.body.days,planCode:req.body.planCode,role:req.body.role}}],{session});
      return safeUser(u);
    });
    res.json({user:result});
  });
  app.post("/api/admin/users/:id/recovery",auth,adminOnly,async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"Usuário não encontrado."});await sendRecovery(u);await audit(req,"password_recovery",u);res.json({message:"Recuperação de senha enviada."});});
  app.post("/api/admin/users/:id/notes",auth,adminOnly,async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"Usuário não encontrado."});const note=await AdminNote.create({userId:u._id,text:String(req.body.text||"").slice(0,1000),authorId:req.user._id,authorName:req.user.name});await audit(req,"note_created",u);res.status(201).json({note});});
  app.delete("/api/admin/users/:id",auth,superAdminOnly,async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"Usuário não encontrado."});if(!canManageUser(req.user,u))return res.status(403).json({message:"Esta conta administrative está protegida."});await deleteAccount(u._id);await audit(req,"user_deleted",null,{removedUserId:String(u._id)});res.json({message:"Conta e dados vinculados excluídos definitivamente."});});
  const couponPayload=(body={})=>({code:String(body.code||"").trim().toUpperCase(),description:String(body.description||"").trim(),benefitType:body.benefitType,benefitValue:Number(body.benefitValue||0),maxUses:Number(body.maxUses||0),maxUsesPerUser:Number(body.maxUsesPerUser||0),startsAt:body.startsAt||new Date(),endsAt:body.endsAt||null,active:body.active!==false,allowedPlan:body.allowedPlan||"ALL",allowedAudience:body.allowedAudience||"ALL",stackable:Boolean(body.stackable),dailyLimit:Number(body.dailyLimit||0),autoExpireAtLimit:body.autoExpireAtLimit!==false,newUsersOnly:Boolean(body.newUsersOnly),trialUsersOnly:Boolean(body.trialUsersOnly),allowAfterTrialExpired:Boolean(body.allowAfterTrialExpired)});
  app.post("/api/admin/coupons",auth,adminOnly,async(req,res)=>{try{const item=await Coupon.create(couponPayload(req.body));await audit(req,"coupon_created",null,{id:item._id,code:item.code});res.status(201).json({item:couponView(item)});}catch(error){res.status(error?.code===11000?409:400).json({message:error?.code===11000?"Este código de cupom já existe.":error.message});}});
  app.patch("/api/admin/coupons/:id",auth,adminOnly,async(req,res)=>{try{const current=await Coupon.findById(req.params.id);if(!current)return res.status(404).json({message:"Cupom não encontrado."});const item=await Coupon.findByIdAndUpdate(req.params.id,{$set:couponPayload({...current.toObject(),...req.body})},{new:true,runValidators:true});await audit(req,"coupon_updated",null,{id:item._id,code:item.code,changes:req.body});res.json({item:couponView(item)});}catch(error){res.status(error?.code===11000?409:400).json({message:error?.code===11000?"Este código de cupom já existe.":error.message});}});
  app.post("/api/admin/coupons/:id/toggle",auth,adminOnly,async(req,res)=>{const item=await Coupon.findById(req.params.id);if(!item)return res.status(404).json({message:"Cupom não encontrado."});item.active=!item.active;item.disabledAt=item.active?undefined:new Date();await item.save();await audit(req,item.active?"coupon_activated":"coupon_disabled",null,{id:item._id,code:item.code});res.json({item:couponView(item)});});
  app.post("/api/admin/coupons/:id/duplicate",auth,adminOnly,async(req,res)=>{const source=await Coupon.findById(req.params.id).lean();if(!source)return res.status(404).json({message:"Cupom não encontrado."});delete source._id;delete source.createdAt;delete source.updatedAt;delete source.__v;source.code=`${source.code}-COPIA-${Date.now().toString().slice(-4)}`;source.usageCount=0;source.active=false;const item=await Coupon.create(source);await audit(req,"coupon_duplicated",null,{sourceId:req.params.id,id:item._id,code:item.code});res.status(201).json({item:couponView(item)});});
  app.get("/api/admin/coupons/:id/usages",auth,adminOnly,async(req,res)=>{const coupon=await Coupon.findById(req.params.id).lean();if(!coupon)return res.status(404).json({message:"Cupom não encontrado."});const usages=await CouponUsage.find({couponId:coupon._id}).sort({usedAt:-1}).lean();res.json({coupon:couponView(coupon),usages});});
  app.delete("/api/admin/coupons/:id",auth,adminOnly,async(req,res)=>{const item=await Coupon.findById(req.params.id);if(!item)return res.status(404).json({message:"Cupom não encontrado."});await audit(req,"coupon_deleted",null,{id:item._id,code:item.code,usageCount:item.usageCount});await Promise.all([CouponUsage.deleteMany({couponId:item._id}),item.deleteOne()]);res.json({ok:true});});
  app.post("/api/coupons/redeem",auth,async(req,res)=>{
    const config=await AppConfig.findOne({key:"global"}).lean();if(config?.couponsEnabled===false)return res.status(403).json({message:"O resgate de cupons está temporariamente desativado."});
    const result=await redeemCoupon({User,Coupon,CouponUsage,Subscription,AdminAudit,couponStatus},req.user,requiredText(req.body?.code,"Cupom",80).toUpperCase());
    res.json(result);
  });
  const crud=(path,Model)=>{app.post(path,auth,adminOnly,async(req,res)=>{const item=await Model.create(req.body);await audit(req,`${Model.modelName}_created`,null,{id:item._id});res.status(201).json({item});});app.patch(`${path}/:id`,auth,adminOnly,async(req,res)=>{const item=await Model.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});await audit(req,`${Model.modelName}_updated`,null,{id:item?._id});res.json({item});});app.delete(`${path}/:id`,auth,adminOnly,async(req,res)=>{await Model.findByIdAndDelete(req.params.id);await audit(req,`${Model.modelName}_deleted`,null,{id:req.params.id});res.json({ok:true});});};
  crud("/api/admin/plans",Plan);crud("/api/admin/announcements",Announcement);crud("/api/admin/features",FeatureFlag);
  app.post("/api/admin/subscriptions",auth,adminOnly,async(req,res)=>{
    const payload=subscriptionPayload(req.body);const user=await User.findById(payload.userId);
    if(!user)return res.status(404).json({message:"Usuário não encontrado."});if(!canManageUser(req.user,user))return res.status(403).json({message:"Conta protegida."});
    const item=await Subscription.create(payload);user.accessOrigin="SUBSCRIPTION";user.trialStatus="CONVERTED";user.trialEndsAt=undefined;user.accessStatus="active";await user.save();await reconcileSubscription(user,Subscription);await audit(req,"subscription_created",user,{planCode:item.planCode});res.status(201).json({item});
  });
  app.patch("/api/admin/subscriptions/:id",auth,adminOnly,async(req,res)=>{
    const item=await Subscription.findById(req.params.id);if(!item)return res.status(404).json({message:"Assinatura não encontrada."});
    if(req.body.userId&&String(req.body.userId)!==String(item.userId))throw new InputError("O titular da assinatura não pode ser alterado.");
    const user=await User.findById(item.userId);if(!user||!canManageUser(req.user,user))return res.status(403).json({message:"Conta protegida."});
    Object.assign(item,subscriptionPayload(req.body,item.toObject()));await item.save();if(user.accessOrigin!=="COURTESY"){user.accessOrigin="SUBSCRIPTION";await reconcileSubscription(user,Subscription);}await audit(req,"subscription_updated",user,{status:item.status});res.json({item});
  });
  app.patch("/api/admin/tickets/:id",auth,adminOnly,async(req,res)=>{const item=await SupportTicket.findByIdAndUpdate(req.params.id,{...req.body,assignedTo:req.user._id},{new:true});await audit(req,"ticket_updated",null,{id:item?._id,status:item?.status});res.json({item});});
  app.patch("/api/admin/config",auth,superAdminOnly,async(req,res)=>{const item=await AppConfig.findOneAndUpdate({key:"global"},req.body,{new:true,upsert:true,runValidators:true});await audit(req,"config_updated",null,req.body);res.json({config:item});});
  app.get("/api/admin/export/:kind",auth,adminOnly,async(req,res)=>{const maps={users:()=>User.find(userSearch(req.query).filter).select("name email role accessStatus planCode accessOrigin trialStatus trialEndsAt createdAt").sort(userSearch(req.query).sort).limit(10000).lean(),plans:()=>Plan.find().lean(),subscriptions:()=>Subscription.find().lean(),coupons:()=>Coupon.find().lean(),audit:()=>AdminAudit.find().lean(),config:()=>AppConfig.find().lean()};if(req.params.kind==="users"&&await User.countDocuments(userSearch(req.query).filter)>10000)throw new InputError("Refine a pesquisa para exportar até 10.000 clientes por arquivo.");const fn=maps[req.params.kind];if(!fn)return res.status(404).json({message:"Exportação inexistente."});res.json({exportedAt:new Date(),kind:req.params.kind,data:await fn()});});
}
