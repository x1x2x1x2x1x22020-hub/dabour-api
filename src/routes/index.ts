import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import accountsRouter from "./accounts";
import journalRouter from "./journal";
import reportsRouter from "./reports";
import analysisRouter from "./analysis";
import dashboardRouter from "./dashboard";
import samiCopilotRouter from "./sami-copilot";
import amlScreenRouter from "./aml-screen";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/clients", clientsRouter);
router.use("/accounts", accountsRouter);
router.use("/journal-entries", journalRouter);
router.use("/reports", reportsRouter);
router.use("/analysis", analysisRouter);
router.use("/dashboard", dashboardRouter);
router.use(samiCopilotRouter);
router.use(amlScreenRouter);

export default router;
