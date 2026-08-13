import { CreditWallet } from "../models/CreditWallet.js";
import { CreditLedger } from "../models/CreditLedger.js";

// Error thrown when a business tries to consume more credits than it has.
export class InsufficientCreditsError extends Error {
  constructor(balance, requested) {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
    this.balance = balance;
    this.requested = requested;
    this.statusCode = 402;
  }
}

export async function getOrCreateWallet(businessId) {
  let wallet = await CreditWallet.findOne({ business: businessId });
  if (!wallet) {
    wallet = await CreditWallet.create({ business: businessId, balance: 0 });
  }
  return wallet;
}

export async function getBalance(businessId) {
  const wallet = await getOrCreateWallet(businessId);
  return wallet.balance;
}

// Adds credits and writes a ledger entry. Returns the new balance.
export async function addCredits(
  businessId,
  amount,
  { type = "purchase", reference = null, note = null, payment = null, job = null } = {}
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Credit amount must be a positive number");
  }
  await getOrCreateWallet(businessId);
  const wallet = await CreditWallet.findOneAndUpdate(
    { business: businessId },
    { $inc: { balance: amount } },
    { new: true }
  );
  await CreditLedger.create({
    business: businessId,
    type,
    amount,
    balanceAfter: wallet.balance,
    reference,
    note,
    payment,
    job,
  });
  return wallet.balance;
}

// Atomically consumes credits only if the balance is sufficient. Throws
// InsufficientCreditsError otherwise. Returns the new balance.
export async function consumeCredits(
  businessId,
  amount,
  { reference = null, note = null, job = null } = {}
) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Credit amount must be a positive integer");
  }
  await getOrCreateWallet(businessId);
  // Conditional decrement: only succeeds when balance >= amount, so concurrent
  // requests can never drive the balance negative.
  const wallet = await CreditWallet.findOneAndUpdate(
    { business: businessId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (!wallet) {
    const current = await getBalance(businessId);
    throw new InsufficientCreditsError(current, amount);
  }
  await CreditLedger.create({
    business: businessId,
    type: "consume",
    amount: -amount,
    balanceAfter: wallet.balance,
    reference,
    note,
    job,
  });
  return wallet.balance;
}

// Refunds previously consumed credits (e.g. when a render fails). Best-effort.
export async function refundCredits(businessId, amount, { note = null, job = null } = {}) {
  try {
    await addCredits(businessId, amount, { type: "adjust", note: note || "refund", job });
  } catch (err) {
    console.error("[credits] refund failed:", err.message);
  }
}

export async function listLedger(businessId, { limit = 50 } = {}) {
  const entries = await CreditLedger.find({ business: businessId })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200));
  return entries.map((e) => e.toJSONSafe());
}
