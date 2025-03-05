import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../../../src/middleware/RateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock response with setHeader method
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    
    // Create mock next function
    nextFunction = jest.fn();
  });

  describe('middleware', () => {
    it('should allow requests within the rate limit', () => {
      // Arrange
      rateLimiter = new RateLimiter(1000, 5); // 5 requests per second
      mockRequest = {
        ip: '127.0.0.1',
      };

      // Act & Assert - Make 5 requests (within limit)
      for (let i = 0; i < 5; i++) {
        rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);
        expect(nextFunction).toHaveBeenCalled();
        nextFunction.mockClear();
      }
    });

    it('should block requests exceeding the rate limit', () => {
      // Arrange
      rateLimiter = new RateLimiter(1000, 3); // 3 requests per second
      mockRequest = {
        ip: '127.0.0.1',
      };

      // Act - Make 3 requests (within limit)
      for (let i = 0; i < 3; i++) {
        rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      }

      // Act - Make 1 more request (exceeding limit)
      rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Too many requests')
      }));
      expect(nextFunction).toHaveBeenCalledTimes(3); // Only the first 3 calls should pass
    });

    it('should reset the rate limit after the window expires', (done) => {
      // Arrange
      const windowMs = 100; // Very short window for testing
      rateLimiter = new RateLimiter(windowMs, 1); // 1 request per 100ms
      mockRequest = {
        ip: '127.0.0.1',
      };

      // Act - Make 1 request (within limit)
      rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      nextFunction.mockClear();

      // Act - Make another request immediately (exceeding limit)
      rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(nextFunction).not.toHaveBeenCalled();

      // Wait for the window to expire
      setTimeout(() => {
        // Act - Make another request after window expires (should be allowed)
        rateLimiter.middleware(mockRequest as Request, mockResponse as Response, nextFunction);
        expect(nextFunction).toHaveBeenCalled();
        done();
      }, windowMs + 10);
    });

    it('should track requests from different IPs separately', () => {
      // Arrange
      rateLimiter = new RateLimiter(1000, 1); // 1 request per second
      const mockRequest1 = { ip: '127.0.0.1' };
      const mockRequest2 = { ip: '192.168.1.1' };

      // Act & Assert - First request from IP1 (allowed)
      rateLimiter.middleware(mockRequest1 as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
      nextFunction.mockClear();

      // Act & Assert - Second request from IP1 (blocked)
      rateLimiter.middleware(mockRequest1 as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(nextFunction).not.toHaveBeenCalled();
      jest.clearAllMocks();

      // Act & Assert - First request from IP2 (allowed)
      rateLimiter.middleware(mockRequest2 as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalled();
    });
  });
}); 