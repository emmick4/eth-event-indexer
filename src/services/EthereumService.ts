import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { TransferEvent } from '../models/TransferEvent';
import { SyncState } from '../models/SyncState';
import { RPC_URL, CONTRACT_ADDRESS } from '../config/config';
import { RequestQueueService } from './RequestQueueService';
import { IndexerService } from './IndexerService';
import { EventQueryService } from './EventQueryService';

// ERC-20 Transfer event interface
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

/**
 * Core Ethereum service that coordinates access to blockchain data
 * Acts as a facade for more specialized services
 */
export class EthereumService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private transferEventRepository: Repository<TransferEvent>;
  private syncStateRepository: Repository<SyncState>;
  
  // Specialized services
  private requestQueueService: RequestQueueService;
  private indexerService: IndexerService;
  private eventQueryService: EventQueryService;

  constructor() {
    // Create provider
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Set up request queue service
    this.requestQueueService = new RequestQueueService(this.provider);
    
    // Initialize contract
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, ERC20_ABI, this.provider);
    
    // Initialize repositories
    this.transferEventRepository = AppDataSource.getRepository(TransferEvent);
    this.syncStateRepository = AppDataSource.getRepository(SyncState);
    
    // Initialize specialized services
    this.indexerService = new IndexerService(
      this.provider,
      this.contract,
      this.transferEventRepository,
      this.syncStateRepository
    );
    
    this.eventQueryService = new EventQueryService(this.transferEventRepository);
  }
  
  /**
   * Get the last synced block from the indexer
   */
  public async getLastSyncedBlock(): Promise<number | null> {
    return this.indexerService.getLastSyncedBlock();
  }

  /**
   * Start indexing Transfer events from the blockchain
   */
  public async startEventIndexing(batchSize: number = 1000): Promise<void> {
    await this.indexerService.startEventIndexing(batchSize);
  }

  /**
   * Subscribe to real-time Transfer events
   */
  public subscribeToTransferEvents(callback: (event: TransferEvent) => void): void {
    this.indexerService.subscribeToTransferEvents(callback);
  }
  
  /**
   * Query transfer events with filtering and pagination
   */
  public async getEvents(params: {
    from?: string;
    to?: string;
    startBlock?: number;
    endBlock?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ events: TransferEvent[]; totalCount: number }> {
    return this.eventQueryService.getEvents(params);
  }
  
  /**
   * Get aggregated statistics about transfer events
   */
  public async getStats(): Promise<{ totalEvents: number; totalValueTransferred: string }> {
    return this.eventQueryService.getStats();
  }
} 