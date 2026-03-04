import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import {errorHandler, notFound} from './middlewares';
import api from './api';

dotenv.config();

const app = express();

app.use(express.json());
app.use(morgan('dev'));
app.use(helmet({contentSecurityPolicy: false}));
app.use(cors());

app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);

export default app;
