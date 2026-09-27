import { Router } from "express";
import { db, journalEntriesTable, journalEntryLinesTable, accountsTable, activityLogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateJournalEntryBody,
  UpdateJournalEntryBody,
  UpdateJournalEntryParams,
  DeleteJournalEntryParams,
  GetJournalEntryParams,
  ListJournalEntriesQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  const parsed = ListJournalEntriesQueryParams.safeParse(req.query);
  try {
    let entries;
    if (parsed.success && parsed.data.clientId) {
      entries = await db.select().from(journalEntriesTable)
        .where(eq(journalEntriesTable.clientId, parsed.data.clientId))
        .orderBy(desc(journalEntriesTable.createdAt));
    } else {
      entries = await db.select().from(journalEntriesTable)
        .orderBy(desc(journalEntriesTable.createdAt));
    }

    const result = await Promise.all(entries.map(async (entry) => {
      const lines = await db.select({
        id: journalEntryLinesTable.id,
        accountId: journalEntryLinesTable.accountId,
        accountName: accountsTable.name,
        accountCode: accountsTable.code,
        description: journalEntryLinesTable.description,
        debit: journalEntryLinesTable.debit,
        credit: journalEntryLinesTable.credit,
      })
        .from(journalEntryLinesTable)
        .leftJoin(accountsTable, eq(journalEntryLinesTable.accountId, accountsTable.id))
        .where(eq(journalEntryLinesTable.entryId, entry.id));

      return {
        ...entry,
        totalDebit: Number(entry.totalDebit),
        totalCredit: Number(entry.totalCredit),
        createdAt: entry.createdAt.toISOString(),
        lines: lines.map((l) => ({
          ...l,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list journal entries");
    res.status(500).json({ error: "Failed to list journal entries" });
  }
});

router.post("/", async (req, res): Promise<void> => {
  const parsed = CreateJournalEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const { lines, ...entryData } = parsed.data;
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);

    const [entry] = await db.insert(journalEntriesTable).values({
      ...entryData,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
    }).returning();

    const insertedLines = await db.insert(journalEntryLinesTable).values(
      lines.map((l) => ({
        entryId: entry.id,
        accountId: l.accountId,
        description: l.description,
        debit: (l.debit ?? 0).toString(),
        credit: (l.credit ?? 0).toString(),
      }))
    ).returning();

    await db.insert(activityLogTable).values({
      type: "journal_posted",
      description: `Journal entry posted: ${entry.reference}`,
      descriptionAr: `تم ترحيل القيد اليومي: ${entry.reference}`,
      clientId: entry.clientId,
    });

    res.status(201).json({
      ...entry,
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit),
      createdAt: entry.createdAt.toISOString(),
      lines: insertedLines.map((l) => ({
        ...l,
        debit: Number(l.debit),
        credit: Number(l.credit),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create journal entry");
    res.status(500).json({ error: "Failed to create journal entry" });
  }
});

router.get("/:id", async (req, res): Promise<void> => {
  const parsed = GetJournalEntryParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, parsed.data.id));
    if (!entry) {
      res.status(404).json({ error: "Journal entry not found" });
      return;
    }
    const lines = await db.select({
      id: journalEntryLinesTable.id,
      accountId: journalEntryLinesTable.accountId,
      accountName: accountsTable.name,
      accountCode: accountsTable.code,
      description: journalEntryLinesTable.description,
      debit: journalEntryLinesTable.debit,
      credit: journalEntryLinesTable.credit,
    })
      .from(journalEntryLinesTable)
      .leftJoin(accountsTable, eq(journalEntryLinesTable.accountId, accountsTable.id))
      .where(eq(journalEntryLinesTable.entryId, entry.id));

    res.json({
      ...entry,
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit),
      createdAt: entry.createdAt.toISOString(),
      lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get journal entry");
    res.status(500).json({ error: "Failed to get journal entry" });
  }
});

router.patch("/:id", async (req, res): Promise<void> => {
  const paramsParsed = UpdateJournalEntryParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateJournalEntryBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const [entry] = await db
      .update(journalEntriesTable)
      .set(bodyParsed.data)
      .where(eq(journalEntriesTable.id, paramsParsed.data.id))
      .returning();
    if (!entry) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
    res.json({
      ...entry,
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit),
      createdAt: entry.createdAt.toISOString(),
      lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update journal entry");
    res.status(500).json({ error: "Failed to update journal entry" });
  }
});

router.delete("/:id", async (req, res): Promise<void> => {
  const parsed = DeleteJournalEntryParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, parsed.data.id));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete journal entry");
    res.status(500).json({ error: "Failed to delete journal entry" });
  }
});

export default router;
