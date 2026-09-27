import { Router } from "express";
import { db, clientsTable, accountsTable, journalEntriesTable, activityLogTable } from "@workspace/db";
import { eq, desc, sql, count } from "drizzle-orm";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/stats", async (req, res): Promise<void> => {
  try {
    const [clientStats] = await db.select({
      total: count(),
      active: sql<number>`COUNT(*) FILTER (WHERE status = 'active')`,
    }).from(clientsTable);

    const [accountStats] = await db.select({ total: count() }).from(accountsTable);
    const [journalStats] = await db.select({ total: count() }).from(journalEntriesTable);

    const [recentClients] = await db.select({ cnt: sql<number>`COUNT(*)` })
      .from(clientsTable)
      .where(sql`created_at > NOW() - INTERVAL '30 days'`);

    const [volumeResult] = await db.select({
      totalDebit: sql<number>`COALESCE(SUM(total_debit::numeric), 0)`,
    }).from(journalEntriesTable);

    // Monthly activity for the last 6 months
    const monthlyRows = await db.select({
      month: sql<string>`TO_CHAR(created_at, 'YYYY-MM')`,
      entries: count(),
      volume: sql<number>`COALESCE(SUM(total_debit::numeric), 0)`,
    })
      .from(journalEntriesTable)
      .where(sql`created_at > NOW() - INTERVAL '6 months'`)
      .groupBy(sql`TO_CHAR(created_at, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(created_at, 'YYYY-MM')`);

    res.json({
      totalClients: Number(clientStats?.total ?? 0),
      activeClients: Number(clientStats?.active ?? 0),
      totalJournalEntries: Number(journalStats?.total ?? 0),
      totalAccounts: Number(accountStats?.total ?? 0),
      recentClientsCount: Number(recentClients?.cnt ?? 0),
      pendingReports: 0,
      totalDebitVolume: Number(volumeResult?.totalDebit ?? 0),
      monthlyActivity: monthlyRows.map((r) => ({
        month: r.month,
        entries: Number(r.entries),
        volume: Number(r.volume),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard stats");
    res.status(500).json({ error: "Failed to get dashboard stats" });
  }
});

router.get("/recent-activity", async (req, res): Promise<void> => {
  const parsed = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = (parsed.success && parsed.data.limit) ? parsed.data.limit : 20;
  try {
    const activities = await db.select().from(activityLogTable)
      .orderBy(desc(activityLogTable.createdAt))
      .limit(limit);
    res.json(activities.map((a) => ({
      ...a,
      timestamp: a.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to get recent activity");
    res.status(500).json({ error: "Failed to get recent activity" });
  }
});

router.get("/client-summary", async (req, res): Promise<void> => {
  try {
    const clients = await db.select().from(clientsTable);

    const summaries = await Promise.all(clients.map(async (client) => {
      const [journalCount] = await db.select({ cnt: count() })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.clientId, client.id));

      const [accountCount] = await db.select({ cnt: count() })
        .from(accountsTable)
        .where(eq(accountsTable.clientId, client.id));

      const [lastActivity] = await db.select({ createdAt: journalEntriesTable.createdAt })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.clientId, client.id))
        .orderBy(desc(journalEntriesTable.createdAt))
        .limit(1);

      const accounts = await db.select().from(accountsTable).where(eq(accountsTable.clientId, client.id));
      const totalAssets = accounts.filter((a) => a.type === "asset").reduce((s, a) => s + Number(a.balance), 0);
      const totalRevenues = accounts.filter((a) => a.type === "revenue").reduce((s, a) => s + Number(a.balance), 0);
      const totalExpenses = accounts.filter((a) => a.type === "expense").reduce((s, a) => s + Number(a.balance), 0);

      return {
        clientId: client.id,
        clientName: client.name,
        status: client.status,
        journalEntriesCount: Number(journalCount?.cnt ?? 0),
        accountsCount: Number(accountCount?.cnt ?? 0),
        lastActivity: lastActivity?.createdAt?.toISOString() ?? null,
        totalAssets: totalAssets || null,
        netIncome: (totalRevenues - totalExpenses) || null,
      };
    }));

    res.json(summaries);
  } catch (err) {
    req.log.error({ err }, "Failed to get client summary");
    res.status(500).json({ error: "Failed to get client summary" });
  }
});

export default router;
