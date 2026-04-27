import exporess, {Request, Response} from 'express';
import vectorRoute from './routes/vectorRoute';
import uploadRoute from './routes/uploadRoute';

const router = exporess.Router();

router.use('/vector', vectorRoute);
router.use('/upload', uploadRoute);

export default router;
