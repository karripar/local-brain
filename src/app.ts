import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import {errorHandler, notFound, checkSignedSource} from './middlewares';
import api from './api';
import mlvsClient from './client';

dotenv.config();

const app = express();

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(morgan('dev'));
app.use(helmet({contentSecurityPolicy: false}));
app.use(cors());

app.use(errorHandler);
app.use(checkSignedSource);

app.use('/api/v1', api);

// Health check endpoint to verify Milvus connectivity
app.get("/milvus/health", async (req, res) => {
  try {
    const result = await mlvsClient.showCollections();
    res.json({ ok: true, collections: result.data?.map(c => c.name) ?? [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.use(notFound);

export default app;
