import express from 'express';
import {
  ingest,
  search,
  deleteDocs,
  readStore,
  askWithRag,
} from '../controllers/VectorController';
import mlvsClient from '../../client';
import {body} from 'express-validator';
import {validationErrors} from '../../middlewares';

const router = express.Router();

// Ingest: items[] with doc_id and text (and optional source)
router.post(
  '/ingest',
  [
    body('items')
      .isArray({min: 1})
      .withMessage('items[] is required and must be a non-empty array'),
    body('items.*.doc_id')
      .exists()
      .withMessage('Each item must have doc_id')
      .bail()
      .isString()
      .withMessage('doc_id must be a string'),
    body('items.*.text')
      .exists()
      .withMessage('Each item must have text')
      .bail()
      .isString()
      .withMessage('text must be a string'),
    body('items.*.source')
      .optional()
      .isString()
      .withMessage('source must be a string when provided'),
  ],
  validationErrors,
  ingest,
);

// Search: query + optional topK (number)
router.post(
  '/search',
  [
    body('query')
      .exists()
      .withMessage('query (string) is required')
      .bail()
      .isString()
      .withMessage('query must be a string'),
    body('tenant_id')
      .exists()
      .withMessage('tenant_id (string) is required')
      .bail()
      .isString()
      .withMessage('tenant_id must be a string')
      .bail()
      .notEmpty()
      .withMessage('tenant_id must not be empty'),
    body('topK')
      .optional()
      .isInt({min: 1, max: 100})
      .withMessage('topK must be an integer between 1 and 100'),
  ],
  validationErrors,
  search,
);

// Ask with RAG: query + optional topK (number). /ask route is for testing, in real use chat-service will handle the RAG flow and call vector-service's /search route internally. This is just for testing the full RAG flow in one step.
router.post(
  '/ask',
  [
    body('query')
      .exists()
      .withMessage('query (string) is required')
      .bail()
      .isString()
      .withMessage('query must be a string'),
    body('tenant_id')
      .exists()
      .withMessage('tenant_id (string) is required')
      .bail()
      .isString()
      .withMessage('tenant_id must be a string')
      .bail()
      .notEmpty()
      .withMessage('tenant_id must not be empty'),
    body('topK')
      .optional()
      .isInt({min: 1, max: 20})
      .withMessage('topK must be an integer between 1 and 20'),
  ],
  validationErrors,
  askWithRag,
);

// Read store: no inputs, controller handles limit internally
router.get('/read', readStore);

// Delete docs: doc_ids[]
router.delete(
  '/documents',
  [
    body('doc_ids')
      .isArray({min: 1})
      .withMessage('doc_ids[] is required and must be a non-empty array'),
    body('doc_ids.*').isString().withMessage('each doc_id must be a string'),
  ],
  validationErrors,
  deleteDocs,
);

router.delete('/drop', async (req, res, next) => {
  try {
    await mlvsClient.dropCollection({collection_name: 'rag_documents'});
    res.json({dropped: true});
  } catch (err) {
    console.error('Error dropping collection:', err);
    next(err);
  }
});

export default router;
