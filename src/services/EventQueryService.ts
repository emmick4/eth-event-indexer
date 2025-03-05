import { Repository } from 'typeorm';
import { TransferEvent } from '../models/TransferEvent';

/**
 * Service for querying transfer events with filtering and pagination
 * Also provides aggregated statistics
 */
export class EventQueryService {
  private transferEventRepository: Repository<TransferEvent>;

  constructor(transferEventRepository: Repository<TransferEvent>) {
    this.transferEventRepository = transferEventRepository;
  }

  /**
   * Get events with filtering and pagination
   * 
   * @param params Query parameters including filters and pagination
   * @returns Object containing events and total count
   */
  public async getEvents(params: {
    from?: string;
    to?: string;
    startBlock?: number;
    endBlock?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ events: TransferEvent[]; totalCount: number }> {
    const { from, to, startBlock, endBlock, page = 1, pageSize = 10 } = params;
    
    const queryBuilder = this.transferEventRepository.createQueryBuilder('event');
    
    // Apply filters
    if (from) {
      queryBuilder.andWhere('event.from = :from', { from: from.toLowerCase() });
    }
    
    if (to) {
      queryBuilder.andWhere('event.to = :to', { to: to.toLowerCase() });
    }
    
    if (startBlock) {
      queryBuilder.andWhere('event.blockNumber >= :startBlock', { startBlock });
    }
    
    if (endBlock) {
      queryBuilder.andWhere('event.blockNumber <= :endBlock', { endBlock });
    }
    
    // Count total events matching the filters
    const totalCount = await queryBuilder.getCount();
    
    // Apply pagination
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);
    
    // Order by block number and log index
    queryBuilder.orderBy('event.blockNumber', 'DESC').addOrderBy('event.logIndex', 'ASC');
    
    const events = await queryBuilder.getMany();
    
    return { events, totalCount };
  }
  
  /**
   * Get aggregated statistics about transfer events
   * 
   * @returns Object with totalEvents and totalValueTransferred
   */
  public async getStats(): Promise<{ totalEvents: number; totalValueTransferred: string }> {
    // Count total events
    const totalEvents = await this.transferEventRepository.count();
    
    // Sum of all values (as strings)
    const sumResult = await this.transferEventRepository
      .createQueryBuilder('event')
      .select('SUM(CAST(event.value AS DECIMAL))', 'total')
      .getRawOne();
    
    const totalValueTransferred = sumResult?.total?.toString() || '0';
    
    return { totalEvents, totalValueTransferred };
  }
} 