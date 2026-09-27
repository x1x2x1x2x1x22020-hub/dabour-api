import { Router } from "express";
import { db, clientsTable, activityLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateClientBody, UpdateClientBody, UpdateClientParams, DeleteClientParams, GetClientParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res): Promise<void> => {
  try {
    const clients = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
    res.json(clients.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list clients");
    res.status(500).json({ error: "Failed to list clients" });
  }
});

router.post("/", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const [client] = await db.insert(clientsTable).values(parsed.data).returning();
    await db.insert(activityLogTable).values({
      type: "client_added",
      description: `New client added: ${client.name}`,
      descriptionAr: `تم إضافة عميل جديد: ${client.nameAr ?? client.name}`,
      clientId: client.id,
      clientName: client.name,
    });
    res.status(201).json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to create client");
    res.status(500).json({ error: "Failed to create client" });
  }
});

router.get("/:id", async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, parsed.data.id));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to get client");
    res.status(500).json({ error: "Failed to get client" });
  }
});

router.patch("/:id", async (req, res): Promise<void> => {
  const paramsParsed = UpdateClientParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateClientBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const [client] = await db
      .update(clientsTable)
      .set(bodyParsed.data)
      .where(eq(clientsTable.id, paramsParsed.data.id))
      .returning();
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to update client");
    res.status(500).json({ error: "Failed to update client" });
  }
});

router.delete("/:id", async (req, res): Promise<void> => {
  const parsed = DeleteClientParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(clientsTable).where(eq(clientsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete client");
    res.status(500).json({ error: "Failed to delete client" });
  }
});

export default router;
