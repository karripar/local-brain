import express from 'express';
import {body} from 'express-validator';
import {validationErrors} from '../../middlewares';
import {uploadPdf, ingestUploadedPdf} from '../controllers/UploadController';

const router = express.Router();

router.post(
  '/pdf',
  uploadPdf,
  [
    body('source')
      .optional()
      .isString()
      .withMessage('source must be a string when provided'),
    body('chunkSize')
      .optional()
      .isInt({min: 50, max: 5000})
      .withMessage('chunkSize must be an integer between 50 and 5000'),
    body('chunkOverlap')
      .optional()
      .isInt({min: 0, max: 1000})
      .withMessage('chunkOverlap must be an integer between 0 and 1000'),
  ],
  validationErrors,
  ingestUploadedPdf,
);

export default router;
