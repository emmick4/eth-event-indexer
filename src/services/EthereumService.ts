import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { TransferEvent } from '../models/TransferEvent';
import { SyncState } from '../models/SyncState';
import { RPC_URL, CONTRACT_ADDRESS, START_BLOCK } from '../config/config';

// ERC-20 Transfer event interface
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

export class EthereumService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private transferEventRepository: Repository<TransferEvent>;
  private syncStateRepository: Repository<SyncState>;
  private isIndexing: boolean = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, ERC20_ABI, this.provider);
    this.transferEventRepository = AppDataSource.getRepository(TransferEvent);
    this.syncStateRepository = AppDataSource.getRepository(SyncState);
  }

  public async getLastSyncedBlock(): Promise<number> {
    let syncState = await this.syncStateRepository.findOne({
      where: { id: 'main' }
    });

    if (!syncState) {
      syncState = new SyncState();
      syncState.lastSyncedBlock = START_BLOCK - 1;
      syncState.lastSyncedAt = new Date();
      await this.syncStateRepository.save(syncState);
    }

    return syncState.lastSyncedBlock;
  }

  public async startEventIndexing(batchSize: number = 1000): Promise<void> {
    if (this.isIndexing) {
      console.log('Indexer is already running');
      return;
    }

    this.isIndexing = true;

    try {
      const lastSyncedBlock = await this.getLastSyncedBlock();
      const currentBlock = await this.provider.getBlockNumber();

      console.log(`Starting indexer from block ${lastSyncedBlock + 1} to ${currentBlock}`);

      for (let fromBlock = lastSyncedBlock + 1; fromBlock <= currentBlock; fromBlock += batchSize) {
        const toBlock = Math.min(fromBlock + batchSize - 1, currentBlock);
        
        await this.indexTransferEvents(fromBlock, toBlock);
        
        // Update sync state
        const syncState = await this.syncStateRepository.findOne({
          where: { id: 'main' }
        });
        
        if (syncState) {
          syncState.lastSyncedBlock = toBlock;
          syncState.lastSyncedAt = new Date();
          await this.syncStateRepository.save(syncState);
        }
        
        console.log(`Indexed blocks ${fromBlock} to ${toBlock}`);
      }

      console.log('Indexing completed');
    } catch (error) {
      console.error('Error in indexing events:', error);
    } finally {
      this.isIndexing = false;
    }
  }

  private async indexTransferEvents(fromBlock: number, toBlock: number): Promise<void> {
    try {
      const filter = this.contract.filters.Transfer();
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

      const transferEvents: TransferEvent[] = [];

      for (const event of events) {
        const block = await event.getBlock();
        
        const transferEvent = new TransferEvent();
        transferEvent.transactionHash = event.transactionHash;
        transferEvent.blockNumber = event.blockNumber;
        transferEvent.timestamp = block.timestamp;
        transferEvent.from = event.args[0].toLowerCase();
        transferEvent.to = event.args[1].toLowerCase();
        transferEvent.value = event.args[2].toString();
        transferEvent.logIndex = event.index || 0;
        
        transferEvents.push(transferEvent);
      }

      if (transferEvents.length > 0) {
        await this.transferEventRepository.save(transferEvents);
        console.log(`Saved ${transferEvents.length} transfer events`);
      }
    } catch (error) {
      console.error(`Error indexing blocks ${fromBlock}-${toBlock}:`, error);
      throw error;
    }
  }

  // Subscribe to new Transfer events in real-time
  public subscribeToTransferEvents(callback: (event: TransferEvent) => void): void {
    this.contract.on('Transfer', async (from, to, value, event) => {
      try {
        const block = await this.provider.getBlock(event.blockNumber);
        
        if (!block) {
          console.error('Block not found for event:', event);
          return;
        }
        
        const transferEvent = new TransferEvent();
        transferEvent.transactionHash = event.transactionHash;
        transferEvent.blockNumber = event.blockNumber;
        transferEvent.timestamp = block.timestamp;
        transferEvent.from = from.toLowerCase();
        transferEvent.to = to.toLowerCase();
        transferEvent.value = value.toString();
        transferEvent.logIndex = event.index || 0;
        
        // Save to database
        await this.transferEventRepository.save(transferEvent);
        
        // Update sync state
        const syncState = await this.syncStateRepository.findOne({
          where: { id: 'main' }
        });
        
        if (syncState && transferEvent.blockNumber > syncState.lastSyncedBlock) {
          syncState.lastSyncedBlock = transferEvent.blockNumber;
          syncState.lastSyncedAt = new Date();
          await this.syncStateRepository.save(syncState);
        }
        
        // Call the callback
        callback(transferEvent);
      } catch (error) {
        console.error('Error processing live transfer event:', error);
      }
    });
    
    console.log('Subscribed to Transfer events');
  }
  
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