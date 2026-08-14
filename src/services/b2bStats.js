import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Branch } from "../models/Branch.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { CreditWallet } from "../models/CreditWallet.js";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";
import { MAX_CATEGORIES_PER_BUSINESS } from "../models/Category.js";
import { cacheAside, keys, TTL } from "./cache.js";

function oid(id) {
  return new mongoose.Types.ObjectId(id);
}

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

function buildCountSeries(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r.count]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: map.get(key) || 0 });
  }
  return out;
}

function buildAmountSeries(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r.amount]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, amount: map.get(key) || 0 });
  }
  return out;
}

// Aggregates all B2B KPIs for a single business (the owner User id).
export async function buildStats(businessId, { seriesDays = 14 } = {}) {
  return cacheAside(keys.b2bStats(businessId, seriesDays), TTL.stats, () =>
    buildStatsUncached(businessId, { seriesDays })
  );
}

async function buildStatsUncached(businessId, { seriesDays = 14 } = {}) {
  const bid = oid(businessId);
  const jobMatch = { user: bid, channel: "b2b" };
  const payMatch = { user: bid, purpose: "b2b_credits", status: "paid" };
  const seriesFrom = daysAgo(seriesDays - 1);
  const today = startOfToday();

  const [
    owner,
    activeProducts,
    totalProducts,
    categories,
    branchCount,
    wallet,
    ledgerByType,
    jobsByStatus,
    totalJobs,
    todayJobs,
    last7Jobs,
    last30Jobs,
    tryonSeriesRows,
    creditUseSeriesRows,
    spendSeriesRows,
    spendTotalRows,
    spendTodayRows,
    spend7Rows,
    spend30Rows,
    popular,
  ] = await Promise.all([
    User.findById(bid).select("business.currency"),
    Product.countDocuments({ business: bid, status: "active" }),
    Product.countDocuments({ business: bid }),
    Category.countDocuments({ business: bid }),
    Branch.countDocuments({ business: bid }),
    CreditWallet.findOne({ business: bid }),
    CreditLedger.aggregate([
      { $match: { business: bid } },
      { $group: { _id: "$type", total: { $sum: "$amount" } } },
    ]),
    TryonJob.aggregate([
      { $match: jobMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    TryonJob.countDocuments(jobMatch),
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: today } }),
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: daysAgo(7) } }),
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: daysAgo(30) } }),
    TryonJob.aggregate([
      { $match: { ...jobMatch, createdAt: { $gte: seriesFrom } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
    CreditLedger.aggregate([
      {
        $match: {
          business: bid,
          type: "consume",
          createdAt: { $gte: seriesFrom },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          // consume amounts are negative — store positive usage
          count: { $sum: { $abs: "$amount" } },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { ...payMatch, createdAt: { $gte: seriesFrom } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          amount: { $sum: "$amount" },
        },
      },
    ]),
    Payment.aggregate([
      { $match: payMatch },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...payMatch, createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...payMatch, createdAt: { $gte: daysAgo(7) } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Payment.aggregate([
      { $match: { ...payMatch, createdAt: { $gte: daysAgo(30) } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    TryonJob.aggregate([
      { $match: { ...jobMatch, product: { $ne: null } } },
      { $group: { _id: "$product", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          count: 1,
          name: "$product.name",
          imageUrl: { $arrayElemAt: ["$product.imageUrls", 0] },
        },
      },
    ]),
  ]);

  const ledger = { purchase: 0, consume: 0, adjust: 0 };
  for (const row of ledgerByType) ledger[row._id] = row.total;

  const status = { completed: 0, failed: 0, processing: 0, awaiting_payment: 0 };
  for (const row of jobsByStatus) status[row._id] = row.count;

  const successRate =
    totalJobs > 0 ? Math.round((status.completed / totalJobs) * 100) : 0;

  const money = (rows) => (rows[0] ? rows[0].total : 0);
  const currency = owner?.business?.currency || "KES";

  const tryonSeries = buildCountSeries(tryonSeriesRows, seriesDays);
  // Backward-compatible flat series (try-ons) used by older clients.
  const series = tryonSeries;

  return {
    catalog: {
      activeProducts,
      totalProducts,
      archivedProducts: totalProducts - activeProducts,
      categories,
      maxCategories: MAX_CATEGORIES_PER_BUSINESS,
    },
    branches: {
      count: branchCount,
    },
    credits: {
      balance: wallet ? wallet.balance : 0,
      purchased: ledger.purchase,
      consumed: Math.abs(ledger.consume),
      refunded: ledger.adjust,
    },
    tryons: {
      total: totalJobs,
      completed: status.completed,
      failed: status.failed,
      processing: status.processing,
      today: todayJobs,
      last7: last7Jobs,
      last30: last30Jobs,
      successRate,
    },
    finance: {
      currency,
      spentTotal: money(spendTotalRows),
      spentToday: money(spendTodayRows),
      spentLast7: money(spend7Rows),
      spentLast30: money(spend30Rows),
    },
    series,
    charts: {
      tryons: tryonSeries,
      creditsUsed: buildCountSeries(creditUseSeriesRows, seriesDays),
      spend: buildAmountSeries(spendSeriesRows, seriesDays),
    },
    popular,
  };
}
