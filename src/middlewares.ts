import {NextFunction} from 'express';
import CustomError from './classes/CustomError';
import {validationResult, body} from 'express-validator';
import {Request, Response} from 'express';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
dotenv.config();

// Middleware to handle 404 errors
const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new CustomError('Not Found', 404);
  next(error);
};

// Middleware to check for validation errors
const validationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages: string = errors
      .array()
      .map((error) => error.msg)
      .join(', ');
    next(new CustomError(messages, 400));
    return;
  }
  next();
};

// Middleware to handle validation errors
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array().map((e) => ({
        field: (e as any).param,
        message: e.msg,
        // value: e.value, // Removed as 'value' does not exist on ValidationError
      })),
    });
  }
  next();
};

// Middleware to handle errors
const errorHandler = (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.status(error.status || 500);
  res.json({
    message: error.message,
    status: error.status,
  });
};


// middleware to check that request was from the chat-service by verifying a shared secret.
const checkSignedSource = (
  req: Request & { rawBody?: string },
  res: Response,
  next: NextFunction,
) => {
  const secret = process.env.SOURCE_SECRET;
  const signature = req.header('x-signature');
  const timestamp = req.header('x-timestamp');

  if (!secret || !signature || !timestamp) {
    return res.status(403).json({ message: 'Missing auth headers' });
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return res.status(403).json({ message: 'Invalid timestamp' });
  }

  const maxAgeMs = 5 * 60 * 1000; // 5 minutes of clock skew allowed
  if (Math.abs(Date.now() - timestampMs) > maxAgeMs) {
    return res.status(403).json({ message: 'Stale request' });
  }

  const payload = [
    req.method.toUpperCase(),
    req.originalUrl,
    timestamp,
    req.rawBody || '',
  ].join('\n');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.log('--- SIGNATURE DEBUG ---');
    console.log('req.originalUrl:', req.originalUrl);
    console.log('rawBody:', JSON.stringify(req.rawBody || ''));
    console.log('timestamp:', timestamp);
    console.log('expected:', expected);
    console.log('received:', signature);

    return res.status(403).json({
      message: 'Invalid signature',
      validationResult: {
        reqOriginalUrl: req.originalUrl,
        rawBody: req.rawBody,
        secret: secret,
        timestamp,
        expected,
        received: signature,
      },
    });
  }

  next();
};

export {notFound, validationErrors, errorHandler, checkSignedSource};
