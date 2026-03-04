import express from 'express';
import {body} from 'express-validator';
import {validationErrors} from '../../middlewares';
import {queryMilvus, seedMilvus, dropCollections, debugListDocuments} from '../controllers/MilvusControllers';

const router = express.Router();

router.post(
  '/query',
  body('query').isString().notEmpty().withMessage('query is required'),
  validationErrors,
  queryMilvus,
);

router.post('/seed', seedMilvus);

router.get('/debug/list-documents', async (req, res, next) => {
  try {
    const docs = await debugListDocuments();
    res.json({documents: docs});
  } catch (err) {
    next(err);
  }
});

router.delete('/collections', async (req, res, next) => {
  try {
    await dropCollections();
    res.json({ok: true, message: 'Collections dropped'});
  } catch (err) {
    next(err);
  }
});

export default router;
