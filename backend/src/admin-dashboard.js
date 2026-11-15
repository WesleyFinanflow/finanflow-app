export async function adminDashboard(models, page = 1) {
  const { User, Space, Member, Transaction, Account, PurchasePlan, Invite, Subscription } = models;
  const now = new Date(), day = 86400000;
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(now)}T00:00:00-03:00`);
  const pageSize = 100;
  const count = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
  const recent = (field, days) => ({ $gte: [field, new Date(now - days * day)] });
  const validTrial = { $and: [{ $eq: ["$trialStatus", "ACTIVE"] }, { $gt: ["$trialEndsAt", now] }] };
  const trialRange = (start, end) => ({ $and: [{ $eq: ["$trialStatus", "ACTIVE"] }, { $gte: ["$trialEndsAt", start] }, { $lt: ["$trialEndsAt", end] }] });
  const [userAgg, users, spaceAgg, txAgg, subsAgg, accounts, goals, pendingInvites, activeCouples, monthly] = await Promise.all([
    User.aggregate([{ $group: { _id: null, users: { $sum: 1 }, active: count({ $ne: ["$accessStatus", "blocked"] }), blocked: count({ $eq: ["$accessStatus", "blocked"] }), newToday: count({ $gte: ["$createdAt", today] }), new7: count(recent("$createdAt", 7)), new30: count(recent("$createdAt", 30)), trials: count(validTrial), trialsToday: count(trialRange(today, new Date(+today + day))), trials3: count(trialRange(now, new Date(+now + 3 * day))), trials7: count(trialRange(now, new Date(+now + 7 * day))), trialsExpired: count({ $or: [{ $eq: ["$trialStatus", "EXPIRED"] }, { $and: [{ $eq: ["$trialStatus", "ACTIVE"] }, { $lte: ["$trialEndsAt", now] }] }] }) } }]),
    User.find().select("name email profilePhoto role accessStatus lastLoginAt createdAt trialStartedAt trialEndsAt trialStatus planCode blockedAt").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Space.aggregate([{ $group: { _id: null, spaces: { $sum: 1 }, individualSpaces: count({ $eq: ["$type", "individual"] }), coupleSpaces: count({ $eq: ["$type", "couple"] }) } }]),
    Transaction.aggregate([{ $facet: {
      counts: [{ $group: { _id: null, transactions: { $sum: 1 }, transactions7: count(recent("$createdAt", 7)), transactions30: count(recent("$createdAt", 30)) } }],
      activity: [{ $match: { createdAt: { $gte: new Date(now - 30 * day) } } }, { $group: { _id: "$createdBy", last: { $max: "$createdAt" } } }, { $group: { _id: null, activeToday: count(recent("$last", 1)), active7: count(recent("$last", 7)), active30: { $sum: 1 } } }]
    } }]),
    Subscription.aggregate([{ $group: { _id: null, subscriptionsActive: count({ $and: [{ $in: ["$status", ["ACTIVE", "MANUAL"]] }, { $or: [{ $eq: [{ $ifNull: ["$endsAt", null] }, null] }, { $gt: ["$endsAt", now] }] }] }), subscriptionsManual: count({ $eq: ["$origin", "ADMIN"] }), subscriptionsExpired: count({ $or: [{ $eq: ["$status", "EXPIRED"] }, { $and: [{ $ne: [{ $ifNull: ["$endsAt", null] }, null] }, { $lte: ["$endsAt", now] }] }] }), subscriptionsCancelled: count({ $eq: ["$status", "CANCELLED"] }) } }]),
    Account.countDocuments(), PurchasePlan.countDocuments(), Invite.countDocuments({ usedAt: { $exists: false }, expiresAt: { $gt: now } }),
    Member.aggregate([{ $group: { _id: "$spaceId", count: { $sum: 1 } } }, { $match: { count: { $gte: 2 } } }, { $lookup: { from: Space.collection.name, localField: "_id", foreignField: "_id", as: "space" } }, { $match: { "space.type": "couple" } }, { $count: "total" }]),
    User.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "America/Fortaleza" } }, users: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 12 }, { $sort: { _id: 1 } }])
  ]);
  const ids = users.map(u => u._id);
  const [members, activity] = await Promise.all([
    Member.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", spaces: { $sum: 1 } } }]),
    Transaction.aggregate([{ $match: { createdBy: { $in: ids } } }, { $group: { _id: "$createdBy", transactions: { $sum: 1 }, goals: count({ $eq: ["$type", "meta"] }), lastActivity: { $max: "$createdAt" } } }])
  ]);
  const memberMap = new Map(members.map(x => [String(x._id), x.spaces]));
  const activityMap = new Map(activity.map(x => [String(x._id), x]));
  const keys = ["users","active","blocked","newToday","new7","new30","spaces","individualSpaces","coupleSpaces","transactions","transactions7","transactions30","activeToday","active7","active30","trials","trialsToday","trials3","trials7","trialsExpired","subscriptionsActive","subscriptionsManual","subscriptionsExpired","subscriptionsCancelled"];
  const stats = { ...Object.fromEntries(keys.map(k => [k, 0])), ...userAgg[0], ...spaceAgg[0], ...txAgg[0]?.counts[0], ...txAgg[0]?.activity[0], ...subsAgg[0], accounts, goals, pendingInvites, activeCouples: activeCouples[0]?.total || 0 };
  delete stats._id;
  return { stats, monthly, pagination: { page, pageSize, total: stats.users, pages: Math.max(1, Math.ceil(stats.users / pageSize)) }, users: users.map(u => ({ ...u, spaces: memberMap.get(String(u._id)) || 0, transactions: activityMap.get(String(u._id))?.transactions || 0, goals: activityMap.get(String(u._id))?.goals || 0, lastActivity: activityMap.get(String(u._id))?.lastActivity || u.lastLoginAt || null })) };
}
