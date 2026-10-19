import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { apiRouter } from './routes/api.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/health', (_request, response) => response.json({ ok: true }));
  app.use('/api', apiRouter);
  app.use((error: Error & { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    let status = error.status;
    if (!status && (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError)) status = 400;
    if (!status && (error as Error & { code?: number }).code === 11000) status = 409;
    response.status(status ?? 500).json({ error: error.message });
  });
  return app;
}
