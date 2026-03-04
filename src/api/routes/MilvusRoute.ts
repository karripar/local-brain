import express from 'express';
import {body} from 'express-validator';
import {validationErrors} from '../../middlewares';
import {queryMilvus} from '../controllers/MilvusControllers';

const router = express.Router();

router.post(
  '/query',
  body('query').isString().notEmpty().withMessage('query is required'),
  validationErrors,
  queryMilvus,
);

export default router;
