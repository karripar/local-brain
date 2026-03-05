import exporess, { Request, Response } from "express";
import vectorRoute from "./routes/vectorRoute";

const router = exporess.Router();

router.use('/vector', vectorRoute);

export default router;
