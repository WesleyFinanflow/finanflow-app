import mongoose from 'mongoose';
const options={maxTimeMS:30000,readConcern:{level:'majority'}};
const objectId=value=>new mongoose.Types.ObjectId(value);
export async function inspectLegacyCandidates(db,report){
  const users=[];
  for(const candidate of report.plans.legacyPaidOriginUnknown){
    const user=await db.collection('users').findOne({_id:objectId(candidate.userId)},{...options,projection:{_id:1,planCode:1,accessOrigin:1,accessStatus:1,trialStatus:1,trialEndsAt:1,role:1,updatedAt:1,__v:1}});
    const subscriptions=await db.collection('subscriptions').find({userId:objectId(candidate.userId)},{...options,projection:{_id:1,planCode:1,status:1,startsAt:1,endsAt:1,origin:1,updatedAt:1}}).sort({_id:1}).toArray();
    users.push({user,subscriptions});
  }
  const spaces=[];
  for(const id of report.references.find(row=>row.collection==='spaces'&&row.kind==='missing_owner').sampleIds){
    const spaceId=objectId(id),space=await db.collection('spaces').findOne({_id:spaceId},{...options,projection:{_id:1,type:1,ownerId:1,updatedAt:1,__v:1}});
    const members=await db.collection('members').find({spaceId},{...options,projection:{_id:1,userId:1,role:1,updatedAt:1}}).sort({_id:1}).toArray();
    const existingUsers=await db.collection('users').find({_id:{$in:members.map(row=>row.userId)}},{...options,projection:{_id:1}}).toArray();
    const collections=['accounts','transactions','purchaseplans','debtplans','auditlogs','backupsnapshots','invites'];
    const counts={};for(const name of collections)counts[name]=await db.collection(name).countDocuments({spaceId},options);
    spaces.push({space,members,existingUserIds:existingUsers.map(row=>String(row._id)).sort(),counts});
  }
  return {users,spaces};
}
