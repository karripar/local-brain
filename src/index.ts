import express from 'express';
import bodyParser from 'body-parser';
import apiRouter from './api';
import {notFound, errorHandler} from './middlewares';

const app = express();

app.use(bodyParser.json());

app.use('/api', apiRouter);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3006;

app.listen(PORT, () => {
  console.log(`Milvus vector-store API listening on port ${PORT}`);
});
