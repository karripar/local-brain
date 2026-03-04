import exporess, { Request, Response } from "express";
import milvusRoute from "./routes/MilvusRoute";

const router = exporess.Router();

router.use('/milvus', milvusRoute);

export default router;
