import mongoose from "mongoose";
import { InputError, MAX_MONEY } from "./validation.js";
import { addMonthsToIsoDate } from "./recurrence.js";
const id=value=>String(value);
function conflict(message){const error=new Error(message);error.status=409;throw error;}
export function seriesSnapshot(rows){return rows.map(row=>({id:id(row._id ?? row.id),updatedAt:row.updatedAt ? new Date(row.updatedAt).toISOString():null,revision:Number(row.__v ?? row.revision ?? 0)})).sort((a,b)=>a.id.localeCompare(b.id));}
export function assertSnapshot(rows,snapshot){
 if(!Array.isArray(snapshot)||!snapshot.length||snapshot.length>120||snapshot.some(row=>!row||typeof row.id!=="string"||!/^[a-f0-9]{24}$/i.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<0||(row.updatedAt!==null&&(typeof row.updatedAt!=="string"||!Number.isFinite(Date.parse(row.updatedAt))))))throw new InputError("Recarregue a série antes de editar.");
 if(new Set(snapshot.map(row=>row.id)).size!==snapshot.length)throw new InputError("Lista de parcelas inválida.");
 if(JSON.stringify(seriesSnapshot(rows))!==JSON.stringify(seriesSnapshot(snapshot)))conflict("A série mudou em outra operação. Recarregue os lançamentos antes de salvar.");
}
export function planPendingChanges(rows,selectedId,input){
 const numbered=rows.every(row=>Number.isInteger(row.installmentNumber)&&row.installmentNumber>0);
 const ordered=[...rows].sort((a,b)=>(numbered?a.installmentNumber-b.installmentNumber:0)||String(a.date).localeCompare(String(b.date))||id(a._id).localeCompare(id(b._id)));
 const start=ordered.findIndex(row=>id(row._id)===id(selectedId));
 if(start<0)throw new InputError("Parcela não encontrada.");
 const selected=ordered[start];
 if(selected.status!=="pendente")conflict("Escolha uma parcela pendente. Pagamentos concluídos são preservados.");
 const changes=ordered.flatMap((row,index)=>{
  if(index<start||row.status!=="pendente")return [];
  const offset=numbered?row.installmentNumber-selected.installmentNumber:index-start;
  return [{before:row,update:{...input,date:addMonthsToIsoDate(input.date,offset),status:index===start?input.status:"pendente"}}];
 });
 if(Number(selected.installmentCount||1)>1){
  const amounts=new Map(changes.map(change=>[id(change.before._id),Math.round(change.update.amount*100)]));
  const total=ordered.reduce((sum,row)=>sum+(amounts.get(id(row._id))??Math.round(row.amount*100)),0)/100;
  if(total>MAX_MONEY)throw new InputError("O novo total da série ultrapassa o limite permitido.");
  for(const change of changes)change.update.totalAmount=total;
 }
 return changes;
}
export async function updatePendingSeries({Transaction,AuditLog,selectedId,viewIds,user,input,snapshot,structure}){
 let result;
 await mongoose.connection.transaction(async session=>{
  const selected=await Transaction.findOne({_id:selectedId,spaceId:{$in:viewIds}}).session(session).lean();
  if(!selected){const error=new Error("Lançamento não encontrado.");error.status=404;throw error;}
  if(id(selected.createdBy)!==id(user._id)){const error=new Error("Somente quem criou a série pode editá-la.");error.status=403;throw error;}
  if(!selected.seriesId)throw new InputError("Este lançamento não pertence a uma série.");
  if(structure.recurrence!==(selected.recurrence||"none")||structure.installmentCount!==Number(selected.installmentCount||1))throw new InputError("A quantidade e a frequência da série não podem mudar nesta edição.");
  const rows=await Transaction.find({spaceId:selected.spaceId,seriesId:selected.seriesId}).session(session).lean();
  if(rows.some(row=>id(row.createdBy)!==id(user._id)))conflict("A série possui autoria inconsistente. Nenhum pagamento foi alterado.");
  assertSnapshot(rows,snapshot);
  const changes=planPendingChanges(rows,selectedId,input),updated=[];
  for(const change of changes){
   const saved=await Transaction.findOneAndUpdate({_id:change.before._id,status:"pendente"},{$set:change.update,$inc:{__v:1}},{new:true,runValidators:true,session});
   if(!saved)conflict("Uma parcela mudou durante a edição. Recarregue antes de salvar.");
   updated.push(saved.toObject());
  }
  await AuditLog.create([{spaceId:selected.spaceId,userId:user._id,userName:String(user.name||"Usuário").split(/\s+/)[0],action:"update",entityType:"transaction",entityId:id(selectedId),summary:`Parcela e pendentes seguintes atualizadas: ${input.description}`,before:changes.map(change=>change.before),after:updated}],{session});
  result={transaction:updated.find(row=>id(row._id)===id(selectedId)),transactions:updated,updatedCount:updated.length,preservedPaidCount:rows.filter(row=>row.status==="pago").length};
 });
 return result;
}
