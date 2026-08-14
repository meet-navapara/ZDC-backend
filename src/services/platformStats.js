import { User } from "../models/User.js";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { CreditWallet } from "../models/CreditWallet.js";
import { cacheAside, keys, TTL } from "./cache.js";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// Fills a continuous day-by-day series (zeros for missing days) for `days`.
// `mapper(row)` turns a matched aggregation row into the output fields; missing
// days get `zero`.
function fillSeries(rows, days, mapper, zero) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    out.push({ date: key, ...(row ? mapper(row) : zero) });
  }
  return out;
}

// Aggregates platform-wide KPIs for the Super Admin analytics console.
export async function buildPlatformStats({ seriesDays = 30 } = {}) {
  return cacheAside(keys.platformStats(seriesDays), TTL.stats, () =>
    buildPlatformStatsUncached({ seriesDays })
  );
}

async function buildPlatformStatsUncached({ seriesDays = 30 } = {}) {
  const today = startOfToday();
  const from7 = daysAgo(7);
  const from30 = daysAgo(30);
  const seriesFrom = daysAgo(seriesDays - 1);

  const [
    // users
    totalUsers,
    b2c,
    b2b,
    admins,
    pendingB2B,
    suspended,
    newUsersToday,
    newUsers7,
    newUsers30,
    // try-ons
    totalTryons,
    tryonsToday,
    tryons7,
    tryons30,
    tryonsByChannel,
    tryonsByStatus,
    tryonSeries,
    // revenue
    paidByPurpose,
    paidToday,
    paid7,
    paid30,
    revenueSeries,
    // credits
    ledgerByType,
    walletSum,
    // leaderboards
    topBusinesses,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "b2c" }),
    User.countDocuments({ role: "b2b" }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ role: "b2b", status: "pending" }),
    User.countDocuments({ status: "suspended" }),
    User.countDocuments({ createdAt: { $gte: today } }),
    User.countDocuments({ createdAt: { $gte: from7 } }),
    User.countDocuments({ createdAt: { $gte: from30 } }),

    TryonJob.countDocuments({}),
    TryonJob.countDocuments({ createdAt: { $gte: today } }),
    TryonJob.countDocuments({ createdAt: { $gte: from7 } }),
    TryonJob.countDocuments({ createdAt: { $gte: from30 } }),
    TryonJob.aggregate([
      { $group: { _id: "$channel", count: { $sum: 1 } } },
    ]),
    TryonJob.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    TryonJob.aggregate([
      { $match: { createdAt: { $gte: seriesFrom } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          b2c: { $sum: { $cond: [{ $eq: ["$channel", "b2c"] }, 1, 0] } },
          b2b: { $sum: { $cond: [{ $eq: ["$channel", "b2b"] }, 1, 0] } },
        },
      },
    ]),

    Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: "$purpose", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { status: "paid", createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { status: "paid", createdAt: { $gte: from7 } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { status: "paid", createdAt: { $gte: from30 } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { status: "paid", createdAt: { $gte: seriesFrom } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: "$amount" },
        },
      },
    ]),

    CreditLedger.aggregate([
      { $group: { _id: "$type", total: { $sum: "$amount" } } },
    ]),
    CreditWallet.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]),

    TryonJob.aggregate([
      { $match: { channel: "b2b", user: { $ne: null } } },
      {
        $group: {
          _id: "$user",
          tryons: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        },
      },
      { $sort: { tryons: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          userId: { $toString: "$_id" },
          tryons: 1,
          completed: 1,
          name: { $ifNull: ["$user.business.name", "$user.email"] },
          category: "$user.business.category",
        },
      },
    ]),
  ]);

  const channel = { b2c: 0, b2b: 0 };
  for (const row of tryonsByChannel) channel[row._id] = row.count;

  const status = { completed: 0, failed: 0, processing: 0, awaiting_payment: 0 };
  for (const row of tryonsByStatus) status[row._id] = row.count;

  const successRate =
    totalTryons > 0 ? Math.round((status.completed / totalTryons) * 100) : 0;

  const revenueByPurpose = { b2c_tryon: 0, b2b_credits: 0 };
  let revenueTotal = 0;
  for (const row of paidByPurpose) {
    revenueByPurpose[row._id] = row.total;
    revenueTotal += row.total;
  }

  const ledger = { purchase: 0, consume: 0, adjust: 0 };
  for (const row of ledgerByType) ledger[row._id] = row.total;

  const first = (rows) => (rows[0] ? rows[0].total : 0);

  return {
    users: {
      total: totalUsers,
      b2c,
      b2b,
      admins,
      pendingB2B,
      suspended,
      newToday: newUsersToday,
      new7: newUsers7,
      new30: newUsers30,
    },
    tryons: {
      total: totalTryons,
      today: tryonsToday,
      last7: tryons7,
      last30: tryons30,
      channel,
      status,
      successRate,
    },
    revenue: {
      currency: "KES",
      total: revenueTotal,
      today: first(paidToday),
      last7: first(paid7),
      last30: first(paid30),
      byPurpose: revenueByPurpose,
    },
    credits: {
      purchased: ledger.purchase,
      consumed: Math.abs(ledger.consume),
      refunded: ledger.adjust,
      outstanding: walletSum[0] ? walletSum[0].total : 0,
    },
    series: {
      tryons: fillSeries(
        tryonSeries,
        seriesDays,
        (r) => ({ count: r.count, b2c: r.b2c, b2b: r.b2b }),
        { count: 0, b2c: 0, b2b: 0 }
      ),
      revenue: fillSeries(
        revenueSeries,
        seriesDays,
        (r) => ({ amount: r.total }),
        { amount: 0 }
      ),
    },
    topBusinesses,
  };
}
