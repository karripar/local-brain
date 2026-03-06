import express from 'express';
import { ingest, search, deleteDocs, readStore, askWithRag} from '../controllers/VectorController';
import mlvsClient from '../../client';

const router = express.Router();

router.post('/ingest', ingest);
router.post('/search', search);
router.post('/ask', askWithRag); // New endpoint for RAG-based question answering.
router.get('/read', readStore); // For debugging/testing to read all documents in the collection.
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
