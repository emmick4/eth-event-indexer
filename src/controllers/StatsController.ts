import { Request, Response } from 'express';
import { EthereumService } from '../services/EthereumService';

export class StatsController {
  private ethereumService: EthereumService;

  constructor(ethereumService: EthereumService) {
    this.ethereumService = ethereumService;
  }

  public getStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.ethereumService.getStats();
      
      // Format the response
      const response = {
        totalEvents: stats.totalEvents,
        totalValueTransferred: stats.totalValueTransferred,
        // Add formatted value for UI display - optional but helpful
        // We divide by 10^6 because USDC has 6 decimals
        formattedTotalValueTransferred: (Number(stats.totalValueTransferred) / 1_000_000).toLocaleString('en-US', {
          maximumFractionDigits: 2
        }) + ' USDC'
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error retrieving stats:', error);
      res.status(500).json({ error: 'An error occurred while retrieving statistics' });
    }
  };

  public getApiStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const apiStats = this.ethereumService.getApiStats();
      
      // Format the response
      const response = {
        overallFailureRate: `${apiStats.overallRate.toFixed(2)}%`,
        methodStats: Object.entries(apiStats.methodStats).map(([method, stats]) => ({
          method,
          success: stats.success,
          failure: stats.failure,
          total: stats.success + stats.failure,
          failureRate: `${stats.rate.toFixed(2)}%`
        })),
        rpcUrl: this.ethereumService.provider.getUrl().replace(/\/[^/]*@/, '/****@') // Hide API key if present
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error retrieving API stats:', error);
      res.status(500).json({ error: 'An error occurred while retrieving API statistics' });
    }
  };
} 