import { ethers } from 'ethers';

/**
 * Interface representing a queued request to the Ethereum provider
 */
interface QueuedRequest {
  method: string;
  params: Array<any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  attempts: number;
}

/**
 * Service to handle request throttling, queuing, and retries for Ethereum JSON-RPC requests
 * Implements exponential backoff and rate limiting protection
 */
export class RequestQueueService {
  private provider: ethers.JsonRpcProvider;
  private requestQueue: QueuedRequest[] = [];
  private processingQueue: boolean = false;
  private requestsInFlight: number = 0;
  private maxConcurrentRequests: number = 5; // Max concurrent requests to provider
  private maxRetries: number = 5; // Maximum number of retries per request
  private baseDelay: number = 1000; // Base delay in ms (1 second)
  private throttled: boolean = false;
  private throttleReleaseTime: number = 0;
  private throttleResetDelay: number = 30000; // 30 seconds
  private cachedChainId: string | null = null;
  
  // Original ethers provider send method before interception
  private _originalSend: (method: string, params: Array<any>) => Promise<any>;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    
    // Store original send method
    const originalSend = this.provider.send.bind(this.provider);
    this._originalSend = originalSend;
    
    // Intercept provider.send to implement throttling and retry with backoff
    this.provider.send = async (method: string, params: Array<any>): Promise<any> => {
      // Return cached chainId if available
      if (method === 'eth_chainId' && this.cachedChainId) {
        return this.cachedChainId;
      }
      
      // Queue the request and return a promise
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          method,
          params,
          resolve,
          reject,
          attempts: 0
        });
        
        // Process the queue
        this.processQueue();
      });
    };
  }
  
  /**
   * Process the request queue with throttling and backoff
   * Manages concurrent requests and throttling
   */
  private async processQueue(): Promise<void> {
    // Avoid running multiple queue processors
    if (this.processingQueue) return;
    this.processingQueue = true;
    
    try {
      while (this.requestQueue.length > 0) {
        // If we're throttled, wait until the throttle is released
        if (this.throttled && Date.now() < this.throttleReleaseTime) {
          const waitTime = this.throttleReleaseTime - Date.now();
          console.log(`Rate limited. Waiting ${waitTime}ms before next request batch...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          this.throttled = false;
        }
        
        // Don't exceed max concurrent requests
        if (this.requestsInFlight >= this.maxConcurrentRequests) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit
          continue;
        }
        
        // Get the next request
        const request = this.requestQueue.shift();
        if (!request) continue;
        
        this.requestsInFlight++;
        
        // Execute the request
        this.executeRequest(request).finally(() => {
          this.requestsInFlight--;
        });
      }
    } finally {
      this.processingQueue = false;
      
      // If there are still items in the queue, process them
      if (this.requestQueue.length > 0) {
        this.processQueue();
      }
    }
  }
  
  /**
   * Execute a single request with retry and backoff
   * Handles rate limiting and implements exponential backoff
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    try {
      // Cache chain ID if this was a chain ID request
      if (request.method === 'eth_chainId' && !this.cachedChainId) {
        const result = await this._originalSend(request.method, request.params);
        this.cachedChainId = result;
        request.resolve(result);
        return;
      }
      
      const result = await this._originalSend(request.method, request.params);
      request.resolve(result);
    } catch (error: any) {
      // Check if it's a rate limit error (429)
      const isRateLimit = 
        error?.info?.responseStatus?.includes('429') ||
        error?.info?.responseBody?.includes('"code":429') ||
        error?.message?.includes('Too Many Requests');
      
      // If it's a rate limit error and we haven't exceeded retries
      if (isRateLimit && request.attempts < this.maxRetries) {
        request.attempts++;
        
        // Exponential backoff with jitter
        const delay = Math.min(
          this.baseDelay * Math.pow(2, request.attempts) + Math.random() * 1000,
          30000 // Max 30s delay
        );
        
        console.log(`Rate limited on ${request.method}. Retry ${request.attempts}/${this.maxRetries} after ${delay}ms`);
        
        // Set global throttle flag
        this.throttled = true;
        this.throttleReleaseTime = Date.now() + delay;
        
        // Push back to queue with incremented attempts
        setTimeout(() => {
          this.requestQueue.push(request);
          this.processQueue();
        }, delay);
      } else {
        // If we exceeded retries or it's another error, reject
        request.reject(error);
      }
    }
  }

  /**
   * Gets the cached chain ID if available
   */
  public getCachedChainId(): string | null {
    return this.cachedChainId;
  }
} 