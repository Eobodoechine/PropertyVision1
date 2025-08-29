// server/middleware/requireRapidKey.ts
import { Request, Response, NextFunction } from 'express';
import { getRapidApiKey } from '../utils/rapidKey';

// Attach req.rapidApiKey or return 400 if the key is missing
export function requireRapidKey(req: Request, res: Response, next: NextFunction) {
  const key = getRapidApiKey(req);
  if (!key) {
    return res.status(400).json({
      message: 'RapidAPI key not configured. Set RAPIDAPI_KEY env or send X-RapidAPI-Key header.'
    });
  }
  (req as any).rapidApiKey = key;
  next();
}
