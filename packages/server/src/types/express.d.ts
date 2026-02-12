import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      promptApiKeyId?: string;
    }
  }
}

