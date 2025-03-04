import { ethers } from 'ethers';
import logger from './logger';

/**
 * A custom provider that wraps ethers JsonRpcProvider to track API successes and failures
 */
export class TrackedProvider extends ethers.JsonRpcProvider {
  private _url: string;

  constructor(url: string, network?: ethers.Networkish) {
    super(url, network);
    this._url = url;
  }

  /**
   * Override send method to track API calls
   */
  async send(method: string, params: Array<any>): Promise<any> {
    const startTime = Date.now();
    try {
      // Call original method
      const result = await super.send(method, params);
      
      // Log success
      const responseTime = Date.now() - startTime;
      logger.logApiSuccess(method, params, responseTime);
      
      return result;
    } catch (error) {
      // Log failure
      const responseTime = Date.now() - startTime;
      logger.logApiFailure(method, params, error, responseTime);
      
      // Rethrow the error
      throw error;
    }
  }

  /**
   * Get provider statistics
   */
  public getStats() {
    return logger.getFailureStats();
  }
  
  /**
   * Get provider URL (useful for debugging)
   */
  public getUrl(): string {
    return this._url;
  }
} 