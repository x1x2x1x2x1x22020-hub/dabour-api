import { Router } from "express";
import { db, accountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateAccountBody, UpdateAccountBody, UpdateAccountParams, DeleteAccountParams, ListAccountsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  const parsed = ListAccountsQueryParams.safeParse(req.query);
  try {
    const accounts = parsed.success && parsed.data.clientId
      ? await db.select().from(accountsTable).where(eq(accountsTable.clientId, parsed.data.clientId))
      : await db.select().from(accountsTable);
    res.json(accounts.map((a) => ({
      ...a,
      balance: Number(a.balance),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list accounts");
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

router.post("/", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const [account] = await db.insert(accountsTable).values({
      ...parsed.data,
      balance: "0",
    }).returning();
    res.status(201).json({ ...account, balance: Number(account.balance) });
  } catch (err) {
    req.log.error({ err }, "Failed to create account");
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.patch("/:id", async (req, res): Promise<void> => {
  const paramsParsed = UpdateAccountParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateAccountBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const [account] = await db
      .update(accountsTable)
      .set(bodyParsed.data)
      .where(eq(accountsTable.id, paramsParsed.data.id))
      .returning();
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ ...account, balance: Number(account.balance) });
  } catch (err) {
    req.log.error({ err }, "Failed to update account");
    res.status(500).json({ error: "Failed to update account" });
  }
});

router.delete("/:id", async (req, res): Promise<void> => {
  const parsed = DeleteAccountParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(accountsTable).where(eq(accountsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete account");
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export default router;
