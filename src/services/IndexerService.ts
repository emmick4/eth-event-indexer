import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { TransferEvent } from '../models/TransferEvent';
import { SyncState } from '../models/SyncState';
import { RPC_URL, CONTRACT_ADDRESS, START_BLOCK } from '../config/config';

/**
 * Service responsible for indexing ERC-20 Transfer events
 * Handles historical backfilling and state tracking
 */
export class IndexerService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private transferEventRepository: Repository<TransferEvent>;
  private syncStateRepository: Repository<SyncState>;
  private isIndexing: boolean = false;
  private contractCreationBlock: number | null = null;

  constructor(
    provider: ethers.JsonRpcProvider,
    contract: ethers.Contract,
    transferEventRepository: Repository<TransferEvent>,
    syncStateRepository: Repository<SyncState>
  ) {
    this.provider = provider;
    this.contract = contract;
    this.transferEventRepository = transferEventRepository;
    this.syncStateRepository = syncStateRepository;
  }

  /**
   * Get the last synced block from the database
   */
  public async getLastSyncedBlock(): Promise<number | null> {
    const syncState = await this.syncStateRepository.findOne({
      where: { id: 'batch-sync' }
    });

    return syncState ? syncState.lastSyncedBlock : null;
  }

  /**
   * Determines the contract creation block using binary search
   * 
   * This method employs a binary search algorithm to efficiently locate the block
   * where the contract was created. Instead of scanning from block 0 (which could take
   * a very long time), it uses a divide-and-conquer approach:
   * 
   * 1. Start with a search range from startSearchBlock (0 or chain-specific value) to currentBlock
   * 2. Check the transaction count in the middle block
   * 3. If a block has transactions but the previous block doesn't, we've found the creation block
   * 4. Otherwise, search either the lower or upper half of the range
   * 
   * This reduces the search time from O(n) to O(log n), making it much more efficient
   * for determining the contract creation block.
   */
  public async getContractCreationBlock(): Promise<number> {
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

  /**
   * Start indexing Transfer events from historical blocks
   * Supports resuming from last indexed block and dynamic batch sizing
   */
  public async startEventIndexing(batchSize: number = 1000): Promise<void> {
    if (this.isIndexing) {
      console.log('Indexer is already running');
      return;
    }

    this.isIndexing = true;
    let currentBatchSize = batchSize;
    let consecutiveSuccesses = 0;
    let consecutiveFailures = 0;

    try {
      let startBlock: number;
      const lastSyncedBlock = await this.getLastSyncedBlock();
      const currentBlock = await this.provider.getBlockNumber();
      let isResuming = false;

      if (lastSyncedBlock !== null) {
        // We have a previous sync state
        startBlock = lastSyncedBlock + 1;
        isResuming = true;
      } else {
        // No sync record exists yet, determine the starting block
        if (START_BLOCK === 0) {
          startBlock = await this.getContractCreationBlock();
        } else {
          startBlock = START_BLOCK;
        }
        
        // Create initial sync state
        const syncState = new SyncState();
        syncState.id = 'batch-sync';
        syncState.lastSyncedBlock = startBlock - 1;
        syncState.lastSyncedAt = new Date();
        await this.syncStateRepository.save(syncState);
      }

      // Log the appropriate message
      if (isResuming) {
        console.log(`Resuming indexer from last synced block ${startBlock} to current block ${currentBlock}`);
      } else if (START_BLOCK === 0) {
        console.log(`Starting indexer from block ${startBlock} (contract creation block) to current block ${currentBlock}`);
      } else {
        console.log(`Starting indexer from block ${startBlock} (configured START_BLOCK=${START_BLOCK}) to current block ${currentBlock}`);
      }

      for (let fromBlock = startBlock; fromBlock <= currentBlock;) {
        // Dynamically adjust batch size based on success/failure rates
        const toBlock = Math.min(fromBlock + currentBatchSize - 1, currentBlock);
        
        try {
          await this.indexTransferEvents(fromBlock, toBlock);
          
          // Update sync state
          const syncState = await this.syncStateRepository.findOne({
            where: { id: 'batch-sync' }
          });
          
          if (syncState) {
            syncState.lastSyncedBlock = toBlock;
            syncState.lastSyncedAt = new Date();
            await this.syncStateRepository.save(syncState);
          }
          
          console.log(`Indexed blocks ${fromBlock} to ${toBlock} (batch size: ${currentBatchSize})`);
          
          // Increase batch size after consecutive successes, up to the original batch size
          consecutiveSuccesses++;
          consecutiveFailures = 0;
          
          if (consecutiveSuccesses >= 5 && currentBatchSize < batchSize) {
            const newBatchSize = Math.min(currentBatchSize * 2, batchSize);
            console.log(`Increasing batch size from ${currentBatchSize} to ${newBatchSize} after consecutive successes`);
            currentBatchSize = newBatchSize;
            consecutiveSuccesses = 0;
          }
          
          // Move to the next batch
          fromBlock = toBlock + 1;
        } catch (error) {
          console.error(`Error indexing blocks ${fromBlock}-${toBlock}:`, error);
          
          // Check if it's a rate limiting error
          const errorMessage = String(error);
          if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
            consecutiveFailures++;
            consecutiveSuccesses = 0;
            
            // Reduce batch size on rate limit errors
            if (currentBatchSize > 10) {
              const newBatchSize = Math.max(Math.floor(currentBatchSize / 2), 10);
              console.log(`Reducing batch size from ${currentBatchSize} to ${newBatchSize} due to rate limiting`);
              currentBatchSize = newBatchSize;
              
              // Add a delay before retrying
              const backoffMs = Math.min(1000 * Math.pow(2, consecutiveFailures), 60000);
              console.log(`Backing off for ${backoffMs}ms before retrying...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              
              // Don't advance the block pointer so we retry the same range with smaller batch
            } else {
              // If batch size is already minimum, just wait longer before retrying
              const backoffMs = Math.min(5000 * Math.pow(2, consecutiveFailures), 300000);
              console.log(`Minimum batch size reached. Backing off for ${backoffMs}ms before retrying...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          } else {
            // For non-rate-limiting errors, just move forward and log the error
            console.error(`Skipping blocks ${fromBlock}-${toBlock} due to non-rate-limiting error`);
            fromBlock = toBlock + 1;
          }
        }
      }

      console.log('Indexing completed');
    } catch (error) {
      console.error('Error in indexing events:', error);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Index transfer events for a specific block range
   */
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
      // Log the error but allow it to propagate up for handling in startEventIndexing
      console.error(`Error indexing blocks ${fromBlock}-${toBlock}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to new Transfer events in real-time
   */
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
        
        try {
          // Simple approach: Use a raw upsert query to update the sync state
          // This is much more reliable for SQLite and handles the race condition properly
          await this.syncStateRepository.manager.query(
            `INSERT INTO sync_state (id, lastSyncedBlock, lastSyncedAt, isIndexing) 
             VALUES (?, ?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET 
               lastSyncedBlock = CASE WHEN lastSyncedBlock < ? THEN ? ELSE lastSyncedBlock END,
               lastSyncedAt = CASE WHEN lastSyncedBlock < ? THEN ? ELSE lastSyncedAt END`,
            [
              'realtime-sync', 
              transferEvent.blockNumber, 
              new Date(), 
              false,
              transferEvent.blockNumber,
              transferEvent.blockNumber,
              transferEvent.blockNumber,
              new Date()
            ]
          );
        } catch (syncError) {
          // Log but don't stop processing - the event was already saved
          console.error('Error updating realtime-sync state:', syncError);
        }
        
        // Call the callback
        callback(transferEvent);
      } catch (error) {
        console.error('Error processing live transfer event:', error);
      }
    });
    
    console.log('Subscribed to Transfer events');
  }
} 