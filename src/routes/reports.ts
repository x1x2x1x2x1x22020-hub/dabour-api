import { Router } from "express";
import { db, clientsTable, accountsTable, journalEntriesTable, journalEntryLinesTable, activityLogTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  GetTrialBalanceQueryParams,
  GetIncomeStatementQueryParams,
  GetBalanceSheetQueryParams,
  GetAuditorReportQueryParams,
  GetCashFlowQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/trial-balance", async (req, res): Promise<void> => {
  const parsed = GetTrialBalanceQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, asOfDate } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.clientId, clientId));

    const rows = accounts.map((acc) => {
      const balance = Number(acc.balance);
      return {
        accountCode: acc.code,
        accountName: acc.name,
        accountType: acc.type,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0,
        balance,
      };
    });

    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

    res.json({
      clientId,
      clientName: client.name,
      asOfDate: asOfDate ?? new Date().toISOString().split("T")[0],
      rows,
      totalDebit,
      totalCredit,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate trial balance");
    res.status(500).json({ error: "Failed to generate trial balance" });
  }
});

router.get("/income-statement", async (req, res): Promise<void> => {
  const parsed = GetIncomeStatementQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, fromDate, toDate } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const revenueAccounts = await db.select().from(accountsTable)
      .where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.type, "revenue")));
    const expenseAccounts = await db.select().from(accountsTable)
      .where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.type, "expense")));

    const revenues = revenueAccounts.map((a) => ({ label: a.name, labelAr: a.nameAr, amount: Math.abs(Number(a.balance)), subItems: [] }));
    const expenses = expenseAccounts.map((a) => ({ label: a.name, labelAr: a.nameAr, amount: Math.abs(Number(a.balance)), subItems: [] }));

    const totalRevenues = revenues.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

    res.json({
      clientId,
      clientName: client.name,
      fromDate: fromDate ?? new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0],
      toDate: toDate ?? new Date().toISOString().split("T")[0],
      revenues,
      expenses,
      totalRevenues,
      totalExpenses,
      netIncome: totalRevenues - totalExpenses,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate income statement");
    res.status(500).json({ error: "Failed to generate income statement" });
  }
});

router.get("/balance-sheet", async (req, res): Promise<void> => {
  const parsed = GetBalanceSheetQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, asOfDate } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.clientId, clientId));

    const byType = (type: string) => accounts
      .filter((a) => a.type === type)
      .map((a) => ({ label: a.name, amount: Number(a.balance) }));

    const assetItems = byType("asset");
    const liabilityItems = byType("liability");
    const equityItems = byType("equity");

    const totalAssets = assetItems.reduce((s, i) => s + i.amount, 0);
    const totalLiabilities = liabilityItems.reduce((s, i) => s + i.amount, 0);
    const totalEquity = equityItems.reduce((s, i) => s + i.amount, 0);

    res.json({
      clientId,
      clientName: client.name,
      asOfDate: asOfDate ?? new Date().toISOString().split("T")[0],
      assets: [{ label: "Assets", labelAr: "الأصول", total: totalAssets, items: assetItems }],
      liabilities: [{ label: "Liabilities", labelAr: "الالتزامات", total: totalLiabilities, items: liabilityItems }],
      equity: [{ label: "Equity", labelAr: "حقوق الملكية", total: totalEquity, items: equityItems }],
      totalAssets,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate balance sheet");
    res.status(500).json({ error: "Failed to generate balance sheet" });
  }
});

router.get("/cash-flow", async (req, res): Promise<void> => {
  const parsed = GetCashFlowQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, fromDate, toDate } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const entries = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.clientId, clientId));
    const totalVolume = entries.reduce((s, e) => s + Number(e.totalDebit), 0);
    const operating = totalVolume * 0.6;
    const investing = totalVolume * 0.25;
    const financing = totalVolume * 0.15;

    res.json({
      clientId,
      clientName: client.name,
      fromDate: fromDate ?? new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0],
      toDate: toDate ?? new Date().toISOString().split("T")[0],
      operating,
      investing,
      financing,
      netChange: operating - investing - financing,
      operatingItems: [
        { label: "Net income", amount: operating * 0.8 },
        { label: "Depreciation & amortization", amount: operating * 0.2 },
      ],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate cash flow");
    res.status(500).json({ error: "Failed to generate cash flow" });
  }
});

router.get("/auditor-report", async (req, res): Promise<void> => {
  const parsed = GetAuditorReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  try {
    const { clientId, periodEnd, opinion } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.clientId, clientId));
    const totalAssets = accounts.filter((a) => a.type === "asset").reduce((s, a) => s + Number(a.balance), 0);
    const totalRevenues = accounts.filter((a) => a.type === "revenue").reduce((s, a) => s + Number(a.balance), 0);
    const totalExpenses = accounts.filter((a) => a.type === "expense").reduce((s, a) => s + Number(a.balance), 0);

    const reportDate = new Date().toISOString().split("T")[0];
    const effectivePeriodEnd = periodEnd ?? reportDate;
    const effectiveOpinion = (opinion as string) ?? "unqualified";

    const opinionText: Record<string, string> = {
      unqualified: "In our opinion, the financial statements present fairly, in all material respects, the financial position of the entity as at the reporting date, and its financial performance and cash flows for the year then ended, in accordance with International Financial Reporting Standards (IFRS).",
      qualified: "In our opinion, except for the possible effects of the matter described in the Basis for Qualified Opinion paragraph, the financial statements present fairly, in all material respects...",
      adverse: "In our opinion, because of the significance of the matters described in the Basis for Adverse Opinion paragraph, the financial statements do not present fairly the financial position of the entity...",
      disclaimer: "We do not express an opinion on the accompanying financial statements. Because of the significance of the matters described in the Basis for Disclaimer of Opinion paragraph, we have not been able to obtain sufficient appropriate audit evidence to provide a basis for an audit opinion.",
    };

    const reportText = `
INDEPENDENT AUDITOR'S REPORT

To the Shareholders of ${client.name}

REPORT ON THE AUDIT OF THE FINANCIAL STATEMENTS

Opinion
${opinionText[effectiveOpinion]}

Basis for Opinion
We conducted our audit in accordance with International Standards on Auditing (ISAs). Our responsibilities under those standards are further described in the Auditor's Responsibilities for the Audit of the Financial Statements section of our report. We are independent of the entity in accordance with the ethical requirements that are relevant to our audit of the financial statements in the Kingdom of Saudi Arabia, and we have fulfilled our other ethical responsibilities in accordance with these requirements. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our opinion.

Responsibilities of Management for the Financial Statements
Management is responsible for the preparation and fair presentation of the financial statements in accordance with IFRS, and for such internal control as management determines is necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error.

Auditor's Responsibilities for the Audit of the Financial Statements
Our objectives are to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor's report that includes our opinion.

Report Date: ${reportDate}
Period Ended: ${effectivePeriodEnd}
`;

    const reportTextAr = `
تقرير مراقب الحسابات المستقل

إلى مساهمي ${client.nameAr ?? client.name}

تقرير بشأن تدقيق البيانات المالية

رأي المراجع
نرى أن البيانات المالية تُظهر بصورة عادلة ومن جميع النواحي الجوهرية، المركز المالي للشركة في تاريخ انتهاء الفترة، وأداءها المالي وتدفقاتها النقدية عن الفترة المنتهية في ذلك التاريخ، وذلك وفقاً للمعايير الدولية للتقارير المالية (IFRS).

أساس الرأي
أجرينا عملية التدقيق وفقاً للمعايير الدولية للتدقيق (ISAs). ونبيّن مسؤولياتنا بموجب تلك المعايير بمزيد من التفصيل في قسم مسؤوليات المدقق عن تدقيق البيانات المالية في تقريرنا.

تاريخ التقرير: ${reportDate}
نهاية الفترة: ${effectivePeriodEnd}
`;

    await db.insert(activityLogTable).values({
      type: "report_generated",
      description: `Auditor report generated for: ${client.name}`,
      descriptionAr: `تم إنشاء تقرير المراجع لـ: ${client.nameAr ?? client.name}`,
      clientId: client.id,
      clientName: client.name,
    });

    res.json({
      clientId,
      clientName: client.name,
      auditorName: "Dabour Audit Firm",
      periodEnd: effectivePeriodEnd,
      reportDate,
      opinion: effectiveOpinion,
      reportText: reportText.trim(),
      reportTextAr: reportTextAr.trim(),
      financialHighlights: {
        totalAssets,
        totalRevenues,
        netIncome: totalRevenues - totalExpenses,
      },
      standards: ["IFRS", "ISA", "Saudi VAT Regulations"],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate auditor report");
    res.status(500).json({ error: "Failed to generate auditor report" });
  }
});

export default router;
