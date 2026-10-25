import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import marketsRouter from "./markets.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketsRouter);

export default router;
