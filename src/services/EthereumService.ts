import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { TransferEvent } from '../models/TransferEvent';
import { SyncState } from '../models/SyncState';
import { RPC_URL, CONTRACT_ADDRESS, START_BLOCK } from '../config/config';
import fs from 'fs';
import path from 'path';

// ERC-20 Transfer event interface
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Request queue for throttling
interface QueuedRequest {
  method: string;
  params: Array<any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  attempts: number;
}

export class EthereumService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private transferEventRepository: Repository<TransferEvent>;
  private syncStateRepository: Repository<SyncState>;
  private isIndexing: boolean = false;
  private contractCreationBlock: number | null = null;
  private cachedChainId: string | null = null;
  
  // Throttling and backoff settings
  private requestQueue: QueuedRequest[] = [];
  private processingQueue: boolean = false;
  private requestsInFlight: number = 0;
  private maxConcurrentRequests: number = 5; // Max concurrent requests to provider
  private maxRetries: number = 5; // Maximum number of retries per request
  private baseDelay: number = 1000; // Base delay in ms (1 second)
  private throttled: boolean = false;
  private throttleReleaseTime: number = 0;
  private throttleResetDelay: number = 30000; // 30 seconds

  // Original ethers provider send method before interception
  private _originalSend: (method: string, params: Array<any>) => Promise<any>;

  constructor() {
    // Create provider
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Intercept provider.send to implement throttling and retry with backoff
    const originalSend = this.provider.send.bind(this.provider);
    this.provider.send = async (method: string, params: Array<any>): Promise<any> => {
      // Return cached chainId if available
      if (method === 'eth_chainId' && this.cachedChainId) {
        return this.cachedChainId;
      }
      
      // Queue the request and return a promise
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          method,
          params,
          resolve,
          reject,
          attempts: 0
        });
        
        // Process the queue
        this.processQueue();
      });
    };
    
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, ERC20_ABI, this.provider);
    this.transferEventRepository = AppDataSource.getRepository(TransferEvent);
    this.syncStateRepository = AppDataSource.getRepository(SyncState);
    
    // Store originalSend as a class property so we can use it in executeRequest
    this._originalSend = originalSend;
  }
  
  // Process the request queue with throttling and backoff
  private async processQueue(): Promise<void> {
    // Avoid running multiple queue processors
    if (this.processingQueue) return;
    this.processingQueue = true;
    
    try {
      while (this.requestQueue.length > 0) {
        // If we're throttled, wait until the throttle is released
        if (this.throttled && Date.now() < this.throttleReleaseTime) {
          const waitTime = this.throttleReleaseTime - Date.now();
          console.log(`Rate limited. Waiting ${waitTime}ms before next request batch...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          this.throttled = false;
        }
        
        // Don't exceed max concurrent requests
        if (this.requestsInFlight >= this.maxConcurrentRequests) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit
          continue;
        }
        
        // Get the next request
        const request = this.requestQueue.shift();
        if (!request) continue;
        
        this.requestsInFlight++;
        
        // Execute the request
        this.executeRequest(request).finally(() => {
          this.requestsInFlight--;
        });
      }
    } finally {
      this.processingQueue = false;
      
      // If there are still items in the queue, process them
      if (this.requestQueue.length > 0) {
        this.processQueue();
      }
    }
  }
  
  // Execute a single request with retry and backoff
  private async executeRequest(request: QueuedRequest): Promise<void> {
    try {
      // Cache chain ID if this was a chain ID request
      if (request.method === 'eth_chainId' && !this.cachedChainId) {
        const result = await this._originalSend(request.method, request.params);
        this.cachedChainId = result;
        request.resolve(result);
        return;
      }
      
      const result = await this._originalSend(request.method, request.params);
      request.resolve(result);
    } catch (error: any) {
      // Check if it's a rate limit error (429)
      const isRateLimit = 
        error?.info?.responseStatus?.includes('429') ||
        error?.info?.responseBody?.includes('"code":429') ||
        error?.message?.includes('Too Many Requests');
      
      // If it's a rate limit error and we haven't exceeded retries
      if (isRateLimit && request.attempts < this.maxRetries) {
        request.attempts++;
        
        // Exponential backoff with jitter
        const delay = Math.min(
          this.baseDelay * Math.pow(2, request.attempts) + Math.random() * 1000,
          30000 // Max 30s delay
        );
        
        console.log(`Rate limited on ${request.method}. Retry ${request.attempts}/${this.maxRetries} after ${delay}ms`);
        
        // Set global throttle flag
        this.throttled = true;
        this.throttleReleaseTime = Date.now() + delay;
        
        // Push back to queue with incremented attempts
        setTimeout(() => {
          this.requestQueue.push(request);
          this.processQueue();
        }, delay);
      } else {
        // If we exceeded retries or it's another error, reject
        request.reject(error);
      }
    }
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

  public async getLastSyncedBlock(): Promise<number | null> {
    const syncState = await this.syncStateRepository.findOne({
      where: { id: 'batch-sync' }
    });

    return syncState ? syncState.lastSyncedBlock : null;
  }

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
        
        try {
          // Update real-time sync state with better error handling
          // First try to get existing record
          let realtimeSyncState = await this.syncStateRepository.findOne({
            where: { id: 'realtime-sync' }
          });
          
          if (!realtimeSyncState) {
            try {
              // Create if it doesn't exist
              const newSyncState = new SyncState();
              newSyncState.id = 'realtime-sync';
              newSyncState.lastSyncedBlock = transferEvent.blockNumber;
              newSyncState.lastSyncedAt = new Date();
              await this.syncStateRepository.save(newSyncState);
            } catch (dbError: any) {
              // If we get a unique constraint error, it means another concurrent process created the record
              // Just fetch it again and update it
              console.log('Error creating realtime-sync state, trying to fetch it again:', dbError.message);
              realtimeSyncState = await this.syncStateRepository.findOne({
                where: { id: 'realtime-sync' }
              });
            }
          }
          
          // If we have a record (either existing or fetched after creation error), update it
          if (realtimeSyncState && transferEvent.blockNumber > realtimeSyncState.lastSyncedBlock) {
            realtimeSyncState.lastSyncedBlock = transferEvent.blockNumber;
            realtimeSyncState.lastSyncedAt = new Date();
            await this.syncStateRepository.save(realtimeSyncState);
          }
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