import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspacesRouter from "./workspaces";
import { requireAuth } from "../middlewares/requireAuth";
import storageRouter from "./storage";
import documentsRouter from "./documents";
import assistantRouter from "./assistant";
import analysisRouter from "./analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(workspacesRouter);
router.use(storageRouter);
router.use(documentsRouter);
router.use(assistantRouter);
router.use(analysisRouter);

export default router;
