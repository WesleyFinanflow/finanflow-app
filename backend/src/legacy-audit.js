// Raw collection reads only. Do not import server.js: startup seeds and migrates.
const spaceCollections = ['members','accounts','transactions','purchaseplans','invites','debtplans','auditlogs','backupsnapshots'];
export const referenceChecks = [
  ...spaceCollections.map(collection=>({collection,field:'spaceId',parent:'spaces',kind:'missing_space'})),
  ...['members','debtplans','merchantcategorymaps','subscriptions','couponusages','supporttickets','adminnotes','sessions','mfacredentials'].map(collection=>({collection,field:'userId',parent:'users',kind:'missing_user'})),
  {collection:'spaces',field:'ownerId',parent:'users',kind:'missing_owner'},
  {collection:'transactions',field:'accountId',parent:'accounts',kind:'missing_account',optional:true},
  // A departed creator in a surviving shared space can be legitimate; never delete by this finding.
  ...['transactions','purchaseplans','invites','backupsnapshots'].map(collection=>({collection,field:'createdBy',parent:'users',kind:'missing_creator_review'})),
  {collection:'couponusages',field:'couponId',parent:'coupons',kind:'missing_coupon'},
];
const options={maxTimeMS:30000,allowDiskUse:false,readConcern:{level:'majority'}};
export async function legacyAudit(db,now=new Date()) {
  const startedAt=now.toISOString(), references=[];
  for(const check of referenceChecks){
    const pipeline=[
      ...(check.optional?[{$match:{[check.field]:{$ne:null}}}]:[]),
      {$project:{[check.field]:1}},
      {$lookup:{from:check.parent,localField:check.field,foreignField:'_id',as:'parent'}},
      {$match:{'parent.0':{$exists:false}}},
      {$facet:{count:[{$count:'value'}],sample:[{$sort:{_id:1}},{$limit:100},{$project:{_id:1}}]}},
    ];
    const [result]=await db.collection(check.collection).aggregate(pipeline,options).toArray();
    const count=result?.count[0]?.value||0;
    references.push({...check,count,sampleIds:(result?.sample||[]).map(row=>String(row._id)),samplesTruncated:count>100});
  }
  const users=await db.collection('users').find({}, {projection:{_id:1,planCode:1,accessOrigin:1,accessStatus:1,trialStatus:1,trialEndsAt:1},maxTimeMS:30000,readConcern:{level:'majority'}}).toArray();
  const plans={legacyPaidOriginUnknown:[],trialMetadataMismatch:[],courtesyMetadataMismatch:[],subscriptionWithoutValidRecord:[],subscriptionPlanMismatch:[]};
  for(const user of users){
    const row={userId:String(user._id),planCode:user.planCode||'FREE',accessOrigin:user.accessOrigin||null,accessStatus:user.accessStatus||null};
    if(['PLUS','PREMIUM'].includes(user.planCode)&&!user.accessOrigin)plans.legacyPaidOriginUnknown.push(row);
    if(user.trialStatus==='ACTIVE'&&user.accessStatus!=='trial')plans.trialMetadataMismatch.push(row);
    if(user.accessOrigin==='COURTESY'&&(user.trialEndsAt||user.trialStatus!=='CONVERTED'||user.accessStatus!=='active'))plans.courtesyMetadataMismatch.push(row);
    if(user.accessOrigin==='SUBSCRIPTION'){
      const valid=await db.collection('subscriptions').findOne({userId:user._id,status:{$in:['ACTIVE','MANUAL']},startsAt:{$lte:now},$or:[{endsAt:null},{endsAt:{$gt:now}}]}, {projection:{planCode:1},sort:{createdAt:-1},maxTimeMS:30000,readConcern:{level:'majority'}});
      if(!valid)plans.subscriptionWithoutValidRecord.push(row);
      else if(valid.planCode!==user.planCode)plans.subscriptionPlanMismatch.push(row);
    }
  }
  return {schemaVersion:1,readOnly:true,startedAt,completedAt:new Date().toISOString(),references,plans,limitations:['Sequential majority reads are not an atomic snapshot; recheck findings before any change.','Missing creators can be legitimate in surviving shared spaces. IDs are candidates for review, never deletion instructions.','Legacy access origins are ambiguous; do not infer courtesy or revoke access automatically.','Checks cover top-level references listed here, not every nested historical snapshot. No emails, names, secrets or financial values are selected.']};
}
