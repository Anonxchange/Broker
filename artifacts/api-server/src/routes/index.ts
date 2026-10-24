import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketsRouter from "./markets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketsRouter);

export default router;
