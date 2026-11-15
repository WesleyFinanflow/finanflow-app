import mongoose from "mongoose";

export async function deleteUserData(models, userId) {
  const { User, Space, Member, Account, Transaction, PurchasePlan, Invite, DebtPlan, AuditLog, BackupSnapshot, MerchantCategoryMap, Subscription, CouponUsage, SupportTicket, AdminNote, AdminAudit, Session } = models;
  await mongoose.connection.transaction(async session => {
    const memberships = await Member.find({ userId }).session(session).lean();
    const owned = await Space.find({ ownerId: userId }).session(session).lean();
    const ids = [...new Set([...memberships.map(m => String(m.spaceId)), ...owned.map(s => String(s._id))])];
    for (const id of ids) {
      const space = await Space.findById(id).session(session);
      if (!space) continue;
      const remaining = await Member.find({ spaceId: id, userId: { $ne: userId } }).session(session).lean();
      if (space.type === "individual" || !remaining.length) {
        for (const Model of [Transaction, PurchasePlan, Account, Invite, Member, DebtPlan, AuditLog, BackupSnapshot]) await Model.deleteMany({ spaceId: id }, { session });
        await Space.deleteOne({ _id: id }, { session });
      } else {
        await Member.deleteMany({ spaceId: id, userId }, { session });
        if (String(space.ownerId) === String(userId)) await Space.updateOne({ _id: id }, { ownerId: remaining[0].userId }, { session });
        // Shared debts survive, but private items belonging to the departing user do not.
        const plan = await DebtPlan.findOne({ spaceId: id }).session(session);
        if (plan) {
          plan.items = plan.items.filter(item => String(item.ownerUserId) !== String(userId) || item.shared);
          for (const item of plan.items) if (String(item.ownerUserId) === String(userId)) item.ownerUserId = remaining[0].userId;
          if (String(plan.userId) === String(userId)) plan.userId = remaining[0].userId;
          await plan.save({ session });
        }
      }
    }
    await SupportTicket.updateMany({ assignedTo: userId }, { $unset: { assignedTo: 1 } }, { session });
    const filters = [
      [Member, { userId }], [DebtPlan, { userId }], [AuditLog, { userId }], [BackupSnapshot, { createdBy: userId }],
      [Invite, { createdBy: userId }], [MerchantCategoryMap, { userId }], [Subscription, { userId }], [CouponUsage, { userId }],
      [SupportTicket, { userId }], [AdminNote, { $or: [{ userId }, { authorId: userId }] }],
      [AdminAudit, { $or: [{ adminId: userId }, { targetUserId: userId }] }], [Session, { userId }], [User, { _id: userId }]
    ];
    for (const [Model, filter] of filters) await Model.deleteMany(filter, { session });
  });
}
