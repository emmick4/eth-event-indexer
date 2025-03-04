import fs from 'fs';
import path from 'path';

// Define log levels
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// Interface for API request logs
interface ApiLogEntry {
  timestamp: string;
  level: LogLevel;
  method: string;
  params?: any;
  errorMessage?: string;
  errorCode?: string | number;
  stackTrace?: string;
  responseTime?: number;
}

class Logger {
  private logDir: string;
  private apiLogFile: string;
  private consoleOutput: boolean;
  private failureCounter: Map<string, { count: number, lastTime: number }> = new Map();
  private successCounter: Map<string, { count: number, lastTime: number }> = new Map();

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.apiLogFile = path.join(this.logDir, 'api-failures.log');
    this.consoleOutput = true;
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatLogEntry(entry: ApiLogEntry): string {
    return JSON.stringify(entry);
  }

  public logApiFailure(method: string, params?: any, error?: any, responseTime?: number): void {
    const now = new Date();
    const timestamp = now.toISOString();
    
    // Increment failure counter for this method
    const methodKey = this.getMethodKey(method, params);
    const currentStats = this.failureCounter.get(methodKey) || { count: 0, lastTime: 0 };
    this.failureCounter.set(methodKey, { 
      count: currentStats.count + 1, 
      lastTime: now.getTime() 
    });
    
    // Create log entry
    const logEntry: ApiLogEntry = {
      timestamp,
      level: 'error',
      method,
      params,
      responseTime,
      errorMessage: error?.message || 'Unknown error',
      errorCode: error?.code || 'UNKNOWN_ERROR',
    };

    if (error?.stack) {
      logEntry.stackTrace = error.stack;
    }

    // Write to log file
    fs.appendFileSync(this.apiLogFile, this.formatLogEntry(logEntry) + '\n');
    
    // Console output if enabled
    if (this.consoleOutput) {
      console.error(`API FAILURE [${method}]: ${logEntry.errorMessage} (${logEntry.errorCode})`);
    }
  }

  public logApiSuccess(method: string, params?: any, responseTime?: number): void {
    const now = new Date();
    
    // Increment success counter for this method
    const methodKey = this.getMethodKey(method, params);
    const currentStats = this.successCounter.get(methodKey) || { count: 0, lastTime: 0 };
    this.successCounter.set(methodKey, { 
      count: currentStats.count + 1, 
      lastTime: now.getTime() 
    });
  }

  private getMethodKey(method: string, params?: any): string {
    if (!params) return method;
    // For more specific tracking, create a key based on method and relevant param values
    // This is a simplified version - you might want to customize based on your needs
    return `${method}:${JSON.stringify(params)}`;
  }

  public getFailureRate(method?: string): { total: number, success: number, failure: number, rate: number } {
    let totalSuccess = 0;
    let totalFailure = 0;

    if (method) {
      // Get stats for specific method
      for (const [key, stats] of this.successCounter.entries()) {
        if (key.startsWith(method)) {
          totalSuccess += stats.count;
        }
      }
      for (const [key, stats] of this.failureCounter.entries()) {
        if (key.startsWith(method)) {
          totalFailure += stats.count;
        }
      }
    } else {
      // Get overall stats
      for (const stats of this.successCounter.values()) {
        totalSuccess += stats.count;
      }
      for (const stats of this.failureCounter.values()) {
        totalFailure += stats.count;
      }
    }

    const total = totalSuccess + totalFailure;
    const rate = total > 0 ? (totalFailure / total) * 100 : 0;

    return {
      total,
      success: totalSuccess,
      failure: totalFailure,
      rate
    };
  }

  public getFailureStats(): { 
    overallRate: number,
    methodStats: { 
      [method: string]: { 
        success: number, 
        failure: number, 
        rate: number 
      } 
    } 
  } {
    const methodStats: { [method: string]: { success: number, failure: number, rate: number } } = {};
    const allMethods = new Set<string>();

    // Collect all unique method names
    for (const key of [...this.successCounter.keys(), ...this.failureCounter.keys()]) {
      const method = key.split(':')[0];
      allMethods.add(method);
    }

    // Calculate stats for each method
    for (const method of allMethods) {
      const stats = this.getFailureRate(method);
      methodStats[method] = {
        success: stats.success,
        failure: stats.failure,
        rate: stats.rate
      };
    }

    // Calculate overall failure rate
    const overallStats = this.getFailureRate();

    return {
      overallRate: overallStats.rate,
      methodStats
    };
  }
}

// Create a singleton instance
const logger = new Logger();
export default logger; 