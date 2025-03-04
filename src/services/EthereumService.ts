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
  private contractCreationBlock: number | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, ERC20_ABI, this.provider);
    this.transferEventRepository = AppDataSource.getRepository(TransferEvent);
    this.syncStateRepository = AppDataSource.getRepository(SyncState);
  }

  // Get the contract creation block if START_BLOCK is 0
  private async getContractCreationBlock(): Promise<number> {
    if (this.contractCreationBlock !== null) {
      return this.contractCreationBlock;
    }

    try {
      console.log('Determining contract creation block...');
      // First check if there's any transaction history for the contract
      const code = await this.provider.getCode(CONTRACT_ADDRESS);
      if (code === '0x') {
        throw new Error('No contract found at the specified address');
      }

      // Search for the contract creation transaction
      let startSearchBlock = 0;
      // For Sepolia testnet, we can start from a more recent block to optimize search
      if (RPC_URL.includes('sepolia')) {
        startSearchBlock = 2000000; // Sepolia testnet started in mid-2022
      }

      // Get the current block
      const currentBlock = await this.provider.getBlockNumber();
      
      // Binary search approach to find the contract creation block
      // This is more efficient than scanning from block 0
      const getTransactionCount = async (blockNumber: number) => {
        try {
          return await this.provider.getTransactionCount(CONTRACT_ADDRESS, blockNumber);
        } catch (error) {
          console.error(`Error getting transaction count at block ${blockNumber}:`, error);
          return 0;
        }
      };

      let low = startSearchBlock;
      let high = currentBlock;
      
      console.log(`Starting binary search for contract creation block. Search range: ${low} to ${high}`);
      
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const txCountAtMid = await getTransactionCount(mid);
        const txCountAtMidMinus1 = mid > startSearchBlock ? await getTransactionCount(mid - 1) : -1;
        
        if (txCountAtMid > 0 && txCountAtMidMinus1 === 0) {
          this.contractCreationBlock = mid;
          console.log(`Contract creation block found: ${mid}`);
          return mid;
        } else if (txCountAtMid === 0) {
          console.log(`No transactions at block ${mid}, searching higher range (${mid+1} to ${high})`);
          low = mid + 1;
        } else {
          console.log(`Transactions found at block ${mid}, searching lower range (${low} to ${mid-1})`);
          high = mid - 1;
        }
      }

      // If binary search fails, use a default value
      console.warn('Binary search completed without finding exact contract creation block');
      console.warn(`Search range at end: ${low} to ${high}`);
      console.warn('Could not determine contract creation block, using default START_BLOCK');
      this.contractCreationBlock = START_BLOCK > 0 ? START_BLOCK : 1;
      return this.contractCreationBlock;
    } catch (error) {
      console.error('Error finding contract creation block:', error);
      // Fallback to START_BLOCK if greater than 0, otherwise use block 1
      this.contractCreationBlock = START_BLOCK > 0 ? START_BLOCK : 1;
      return this.contractCreationBlock;
    }
  }

  public async getLastSyncedBlock(): Promise<number> {
    let syncState = await this.syncStateRepository.findOne({
      where: { id: 'main' }
    });

    if (!syncState) {
      // If START_BLOCK is 0, determine the contract creation block
      const startBlock = START_BLOCK === 0 
        ? await this.getContractCreationBlock() 
        : START_BLOCK;
      
      syncState = new SyncState();
      syncState.lastSyncedBlock = startBlock - 1;
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

      // Check if we're starting from a contract creation block or specified START_BLOCK
      if (START_BLOCK === 0) {
        console.log(`Starting indexer from block ${lastSyncedBlock + 1} (contract creation block) to current block ${currentBlock}`);
      } else {
        console.log(`Starting indexer from block ${lastSyncedBlock + 1} (configured START_BLOCK=${START_BLOCK}) to current block ${currentBlock}`);
      }

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
        const block = await event.getBlock(); // need this to get the timestamp
        
        // Handle ethers.js v6 EventLog structure
        const eventLog = event as ethers.EventLog;
        
        const transferEvent = new TransferEvent();
        transferEvent.transactionHash = eventLog.transactionHash;
        transferEvent.blockNumber = eventLog.blockNumber;
        transferEvent.timestamp = block.timestamp;
        transferEvent.from = eventLog.args[0].toLowerCase();
        transferEvent.to = eventLog.args[1].toLowerCase();
        transferEvent.value = eventLog.args[2].toString();
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
    this.contract.on('Transfer', async (from, to, value, eventPayload) => {
      try {
        // In ethers v6, the event structure is a ContractEventPayload with the EventLog in the 'log' property
        const eventLog = eventPayload.log;

        if (!eventLog) {
          console.error('Missing event log in payload:', eventPayload);
          return;
        }

        const block = await this.provider.getBlock(eventLog.blockNumber);
        
        if (!block) {
          console.error('Block not found for event:', eventLog);
          return;
        }
        
        const transferEvent = new TransferEvent();
        transferEvent.transactionHash = eventLog.transactionHash;
        transferEvent.blockNumber = eventLog.blockNumber;
        transferEvent.timestamp = block.timestamp;
        transferEvent.from = from.toLowerCase();
        transferEvent.to = to.toLowerCase();
        transferEvent.value = value.toString();
        transferEvent.logIndex = eventLog.index || 0;
        
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