import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  lastReset: number;
}

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private ipRecords: Map<string, RateLimitRecord> = new Map();

  constructor(windowMs: number = 60 * 1000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  public middleware = (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const record = this.ipRecords.get(ip) || { count: 0, lastReset: now };

    // Reset counter if window has passed
    if (now - record.lastReset > this.windowMs) {
      record.count = 0;
      record.lastReset = now;
    }

    // Increment request count
    record.count++;

    // Update record
    this.ipRecords.set(ip, record);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', this.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', new Date(record.lastReset + this.windowMs).toISOString());

    // Check if rate limit exceeded
    if (record.count > this.maxRequests) {
      return res.status(429).json({
        error: 'Too many requests, please try again later.',
        retryAfter: Math.ceil((record.lastReset + this.windowMs - now) / 1000)
      });
    }

    next();
  };

  // Helper to clean up old records (call periodically)
  public cleanUp(): void {
    const now = Date.now();
    this.ipRecords.forEach((record, ip) => {
      if (now - record.lastReset > this.windowMs) {
        this.ipRecords.delete(ip);
      }
    });
  }
} 