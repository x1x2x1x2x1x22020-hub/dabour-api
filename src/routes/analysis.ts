import { Router } from "express";
import { db } from "@workspace/db";
import { accountsTable, clientsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { GetFinancialRatiosQueryParams, AnalyzeTextReplaceBody } from "@workspace/api-zod";

const router = Router();

router.get("/ratios", async (req, res): Promise<void> => {
  const parsed = GetFinancialRatiosQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, periodEnd } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.clientId, clientId));

    // 1. الأصول الثابتة الإجمالية (بدون المجمعات)
    const assetAccounts = accounts.filter(a => a && a.nameAr && (
      a.type === "asset" || a.nameAr.includes("الأراضي") || a.nameAr.includes("المباني") || a.nameAr.includes("السيارات") || a.nameAr.includes("الأثاث") || a.nameAr.includes("ممتلكات") || a.nameAr.includes("معدات")
    ) && !a.nameAr.includes("مجمع") && !a.nameAr.includes("مخصص"));

    const depreciationAccounts = accounts.filter(a => a && a.nameAr && a.nameAr.includes("مجمع"));
    const totalGrossAssets = assetAccounts.reduce((s, a) => s + Number(a.balance || 0), 0);
    const totalAccumulatedDepreciation = depreciationAccounts.reduce((s, a) => s + Number(a.balance || 0), 0);
    
    // الصافي الصحيح
    const totalNetAssets = totalGrossAssets + totalAccumulatedDepreciation;

    // 2. النقدية وما في حكمها
    const cashAccounts = accounts.filter(a => a && a.nameAr && (a.nameAr.includes("النقدية") || a.nameAr.includes("الصندوق") || a.nameAr.includes("الخزينة") || a.nameAr.includes("البنك") || a.nameAr.includes("بنوك")));
    const totalCashAndEquivalents = cashAccounts.reduce((s, a) => s + Number(a.balance || 0), 0);

    // 3. الالتزامات 
    const liabilitiesAccounts = accounts.filter(a => a && a.nameAr && (a.type === "liability" || a.nameAr.includes("الموردون") || a.nameAr.includes("الدائنون") || a.nameAr.includes("قروض") || a.nameAr.includes("التزامات")));
    const totalLiabilities = Math.abs(liabilitiesAccounts.reduce((s, a) => s + Number(a.balance || 0), 0));

    // 4. حقوق الملكية 
    const equityAccounts = accounts.filter(a => a && a.nameAr && (a.type === "equity" || a.nameAr.includes("حقوق") || a.nameAr.includes("رأس المال") || a.nameAr.includes("أرباح") || a.nameAr.includes("احتياطي")));
    const totalEquity = Math.abs(equityAccounts.reduce((s, a) => s + Number(a.balance || 0), 0));

    // 5. الإيرادات والمصروفات وصافي الربح
    const revenueAccounts = accounts.filter(a => a && a.nameAr && (a.type === "revenue" || a.nameAr.includes("المبيعات") || a.nameAr.includes("إيرادات") || a.nameAr.includes("ايرادات")));
    const expenseAccounts = accounts.filter(a => a && a.nameAr && (a.type === "expense" || a.nameAr.includes("تكلفة") || a.nameAr.includes("مصروفات") || a.nameAr.includes("مشتريات") || a.nameAr.includes("أجور")));

    const totalRevenues = Math.abs(revenueAccounts.reduce((s, a) => s + Number(a.balance || 0), 0));
    const totalExpenses = Math.abs(expenseAccounts.reduce((s, a) => s + Number(a.balance || 0), 0));
    const netIncome = totalRevenues - totalExpenses;

    const currentRatio = totalLiabilities > 0 ? totalNetAssets / totalLiabilities : null;
    const debtToEquity = totalEquity > 0 ? totalLiabilities / totalEquity : null;
    const returnOnEquity = totalEquity > 0 ? netIncome / totalEquity : null;
    const returnOnAssets = totalNetAssets > 0 ? netIncome / totalNetAssets : null; 
    const grossMargin = totalRevenues > 0 ? (totalRevenues - totalExpenses) / totalRevenues : null;
    const netMargin = totalRevenues > 0 ? netIncome / totalRevenues : null;
    const assetTurnover = totalNetAssets > 0 ? totalRevenues / totalNetAssets : null; 

    const discrepancies: string[] = [];

    res.json({
      clientId,
      periodEnd: periodEnd ?? new Date().toISOString().split("T")[0],
      currentRatio,
      quickRatio: currentRatio ? currentRatio * 0.85 : null,
      debtToEquity,
      returnOnEquity,
      returnOnAssets,
      grossMargin,
      netMargin,
      assetTurnover,
      totalNetAssets,
      totalCashAndEquivalents,
      discrepancies,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute financial ratios");
    res.status(500).json({ error: "Failed to compute financial ratios" });
  }
});

// Text replacement map
const TEXT_REPLACEMENTS: Array<{ patterns: RegExp[]; to: string; from: string }> = [
  {
    from: "idea / ايديا",
    to: "sami",
    patterns: [/\bidea\b/gi, /\bايديا\b/g, /\bأيديا\b/g, /\bاِيديا\b/g],
  },
  {
    from: "halo- / هالو",
    to: "zaza",
    patterns: [/\bhalo-\b/gi, /\bhalo\b/gi, /\bهالو\b/g, /\bهالو-\b/g],
  },
];

router.post("/text-replace", async (req, res): Promise<void> => {
  const parsed = AnalyzeTextReplaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    let replaced = parsed.data.text;
    const replacements: Array<{ from: string; to: string; count: number }> = [];

    for (const rule of TEXT_REPLACEMENTS) {
      let totalCount = 0;
      for (const pattern of rule.patterns) {
        const matches = replaced.match(pattern);
        if (matches) {
          totalCount += matches.length;
          replaced = replaced.replace(pattern, rule.to);
        }
      }
      if (totalCount > 0) {
        replacements.push({ from: rule.from, to: rule.to, count: totalCount });
      }
    }

    res.json({
      original: parsed.data.text,
      replaced,
      replacements,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to perform text replacement");
    res.status(500).json({ error: "Failed to perform text replacement" });
  }
});

export default router;
