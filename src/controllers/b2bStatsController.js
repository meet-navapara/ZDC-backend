import ExcelJS from "exceljs";
import { User } from "../models/User.js";
import { buildStats } from "../services/b2bStats.js";
import { listLedger } from "../services/credits.js";

export async function getStats(req, res, next) {
  try {
    const stats = await buildStats(req.user.sub, { seriesDays: 14 });
    return res.json({ stats });
  } catch (err) {
    return next(err);
  }
}

const LEDGER_LABEL = { purchase: "Purchase", consume: "Try-on", adjust: "Adjustment" };

export async function exportReport(req, res, next) {
  try {
    const businessId = req.user.sub;
    const [user, stats, ledger] = await Promise.all([
      User.findById(businessId),
      buildStats(businessId, { seriesDays: 30 }),
      listLedger(businessId, { limit: 200 }),
    ]);

    const shopName = user?.business?.name || user?.email || "ZDC Business";
    const generatedAt = new Date();

    const wb = new ExcelJS.Workbook();
    wb.creator = "ZDC";
    wb.created = generatedAt;

    const brand = "FF2E7D5B"; // sage
    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: brand },
    };
    const headerFont = { bold: true, color: { argb: "FFFFFFFF" } };

    // ---- Summary sheet ----
    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 24 },
    ];
    summary.getRow(1).eachCell((c) => {
      c.fill = headerFill;
      c.font = headerFont;
    });
    summary.addRows([
      { metric: "Business", value: shopName },
      { metric: "Generated", value: generatedAt.toLocaleString() },
      {},
      { metric: "Total catalogue items", value: stats.catalog.activeProducts },
      { metric: "Categories", value: `${stats.catalog.categories}/${stats.catalog.maxCategories}` },
      { metric: "Credits balance", value: stats.credits.balance },
      { metric: "Credits utilized (all-time)", value: stats.credits.consumed },
      { metric: "Credits purchased (all-time)", value: stats.credits.purchased },
      {},
      { metric: "Try-ons (all-time)", value: stats.tryons.total },
      { metric: "Try-ons today", value: stats.tryons.today },
      { metric: "Try-ons last 7 days", value: stats.tryons.last7 },
      { metric: "Try-ons last 30 days", value: stats.tryons.last30 },
      { metric: "Render success rate", value: `${stats.tryons.successRate}%` },
    ]);

    // ---- Try-ons by day ----
    const daily = wb.addWorksheet("Try-ons by day");
    daily.columns = [
      { header: "Date", key: "date", width: 16 },
      { header: "Try-ons", key: "count", width: 12 },
    ];
    daily.getRow(1).eachCell((c) => {
      c.fill = headerFill;
      c.font = headerFont;
    });
    daily.addRows(stats.series);

    // ---- Popular styles ----
    const popular = wb.addWorksheet("Popular styles");
    popular.columns = [
      { header: "Rank", key: "rank", width: 8 },
      { header: "Product", key: "name", width: 34 },
      { header: "Try-ons", key: "count", width: 12 },
    ];
    popular.getRow(1).eachCell((c) => {
      c.fill = headerFill;
      c.font = headerFont;
    });
    popular.addRows(
      stats.popular.map((p, i) => ({ rank: i + 1, name: p.name, count: p.count }))
    );

    // ---- Credit ledger ----
    const led = wb.addWorksheet("Credit ledger");
    led.columns = [
      { header: "Date", key: "date", width: 22 },
      { header: "Type", key: "type", width: 14 },
      { header: "Amount", key: "amount", width: 12 },
      { header: "Balance after", key: "balanceAfter", width: 14 },
      { header: "Note", key: "note", width: 40 },
    ];
    led.getRow(1).eachCell((c) => {
      c.fill = headerFill;
      c.font = headerFont;
    });
    led.addRows(
      ledger.map((e) => ({
        date: new Date(e.createdAt).toLocaleString(),
        type: LEDGER_LABEL[e.type] || e.type,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        note: e.note || "",
      }))
    );

    const safeName = shopName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const fileName = `zdc-report-${safeName}-${generatedAt
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return next(err);
  }
}
