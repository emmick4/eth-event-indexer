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
} 