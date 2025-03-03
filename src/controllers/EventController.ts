import { Request, Response } from 'express';
import { EthereumService } from '../services/EthereumService';
import { isAddress } from 'ethers';

export class EventController {
  private ethereumService: EthereumService;

  constructor(ethereumService: EthereumService) {
    this.ethereumService = ethereumService;
  }

  public getEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        from,
        to,
        startBlock,
        endBlock,
        page = '1',
        pageSize = '10'
      } = req.query;

      // Validate input parameters
      const errors: string[] = [];

      // Validate Ethereum addresses
      if (from && typeof from === 'string' && !isAddress(from)) {
        errors.push('Invalid "from" address');
      }

      if (to && typeof to === 'string' && !isAddress(to)) {
        errors.push('Invalid "to" address');
      }

      // Validate numeric parameters
      const parsedStartBlock = startBlock ? parseInt(startBlock as string, 10) : undefined;
      const parsedEndBlock = endBlock ? parseInt(endBlock as string, 10) : undefined;
      const parsedPage = parseInt(page as string, 10);
      const parsedPageSize = parseInt(pageSize as string, 10);

      if (startBlock && isNaN(parsedStartBlock!)) {
        errors.push('startBlock must be a valid number');
      }

      if (endBlock && isNaN(parsedEndBlock!)) {
        errors.push('endBlock must be a valid number');
      }

      if (isNaN(parsedPage) || parsedPage < 1) {
        errors.push('page must be a positive number');
      }

      if (isNaN(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > 100) {
        errors.push('pageSize must be between 1 and 100');
      }

      if (errors.length > 0) {
        res.status(400).json({ errors });
        return;
      }

      // Query events with filters
      const result = await this.ethereumService.getEvents({
        from: from as string | undefined,
        to: to as string | undefined,
        startBlock: parsedStartBlock,
        endBlock: parsedEndBlock,
        page: parsedPage,
        pageSize: parsedPageSize
      });

      // Build response with pagination metadata
      const response = {
        data: result.events,
        pagination: {
          totalCount: result.totalCount,
          page: parsedPage,
          pageSize: parsedPageSize,
          totalPages: Math.ceil(result.totalCount / parsedPageSize)
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Error retrieving events:', error);
      res.status(500).json({ error: 'An error occurred while retrieving events' });
    }
  };
} 