import app from "./app";
import { logger } from "./lib/logger";
import { ensureListsLoaded } from "./lib/aml-lists";

// The dev front-end proxies /api here, and .replit maps local port 8080 to
// external 80 — so 8080 is the canonical default. The server must NEVER die on
// startup: AML name screening and every other API screen depend on it.
const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Warm the OFAC SDN + UN sanctions lists in the background (weekly cache,
  // never blocks, never throws) so the very first AML search is already
  // authoritative instead of waiting for the download.
  ensureListsLoaded();
});
