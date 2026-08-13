import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Branch, MAX_BRANCHES_PER_BUSINESS } from "../models/Branch.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { CreditWallet } from "../models/CreditWallet.js";
import { TryonJob } from "../models/TryonJob.js";
import { MAX_CATEGORIES_PER_BUSINESS } from "../models/Category.js";

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
  d.setDate(d.getDate() - n);
  return d;
}

// Builds a continuous day-by-day series (fills gaps with 0) for the last `days`.
function buildSeries(rows, days) {
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

// Aggregates all B2B KPIs for a single business (the owner User id).
export async function buildStats(businessId, { seriesDays = 14 } = {}) {
  const bid = oid(businessId);
  const jobMatch = { user: bid, channel: "b2b" };

  const [
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
    seriesRows,
    popular,
  ] = await Promise.all([
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
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: startOfToday() } }),
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: daysAgo(7) } }),
    TryonJob.countDocuments({ ...jobMatch, createdAt: { $gte: daysAgo(30) } }),
    TryonJob.aggregate([
      { $match: { ...jobMatch, createdAt: { $gte: daysAgo(seriesDays - 1) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
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
      max: MAX_BRANCHES_PER_BUSINESS,
    },
    credits: {
      balance: wallet ? wallet.balance : 0,
      purchased: ledger.purchase, // positive
      consumed: Math.abs(ledger.consume), // stored negative → show positive
      refunded: ledger.adjust, // positive adjustments (refunds)
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
    series: buildSeries(seriesRows, seriesDays),
    popular,
  };
}
