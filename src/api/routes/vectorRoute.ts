import express from 'express';
import { ingest, search, deleteDocs } from '../controllers/VectorController';
import mlvsClient from '../../client';

const router = express.Router();

router.post('/ingest', ingest);
router.post('/search', search);
router.delete('/documents', deleteDocs);
router.delete('/drop', async (req, res, next) => {
  try {
    await mlvsClient.dropCollection({ collection_name: 'rag_documents' });
    res.json({ dropped: true });
  } catch (err) {
    console.error('Error dropping collection:', err);
    next(err);
  }
});


export default router;
