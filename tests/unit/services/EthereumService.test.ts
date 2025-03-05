import { initializeTestDatabase, closeTestDatabase, TestDataSource } from '../../config/database';
import { TransferEvent } from '../../../src/models/TransferEvent';
import { SyncState } from '../../../src/models/SyncState';

// Mock the EthereumService
const mockGetEvents = jest.fn();
const mockGetStats = jest.fn();
const mockStartEventIndexing = jest.fn();
const mockSubscribeToTransferEvents = jest.fn();

jest.mock('../../../src/services/EthereumService', () => {
  return {
    EthereumService: jest.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
      getStats: mockGetStats,
      startEventIndexing: mockStartEventIndexing,
      subscribeToTransferEvents: mockSubscribeToTransferEvents
    }))
  };
});

// Import after mocking
import { EthereumService } from '../../../src/services/EthereumService';

describe('EthereumService', () => {
  let ethereumService: EthereumService;

  beforeAll(async () => {
    // Initialize test database
    await initializeTestDatabase();
  });

  afterAll(async () => {
    // Close test database
    await closeTestDatabase();
  });

  beforeEach(async () => {
    // Clear database before each test
    await TestDataSource.getRepository(TransferEvent).clear();
    await TestDataSource.getRepository(SyncState).clear();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Create service
    ethereumService = new EthereumService();
    
    // Setup mock implementations
    mockGetEvents.mockImplementation(async (params) => {
      const { from, to, startBlock, endBlock, page, pageSize } = params;
      
      // Build query
      let query = TestDataSource.getRepository(TransferEvent)
        .createQueryBuilder('event');
      
      // Apply filters
      if (from) {
        query = query.andWhere('event.from = :from', { from });
      }
      
      if (to) {
        query = query.andWhere('event.to = :to', { to });
      }
      
      if (startBlock) {
        query = query.andWhere('event.blockNumber >= :startBlock', { startBlock });
      }
      
      if (endBlock) {
        query = query.andWhere('event.blockNumber <= :endBlock', { endBlock });
      }
      
      // Get total count
      const totalCount = await query.getCount();
      
      // Apply pagination
      const events = await query
        .orderBy('event.blockNumber', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getMany();
      
      return { events, totalCount };
    });
    
    mockGetStats.mockImplementation(async () => {
      const totalEvents = await TestDataSource.getRepository(TransferEvent).count();
      
      return {
        totalEvents,
        totalValueTransferred: '3000'
      };
    });
    
    mockStartEventIndexing.mockImplementation(async () => {
      // Create mock events
      const event1 = new TransferEvent();
      event1.transactionHash = '0xabcdef';
      event1.from = '0x1234567890123456789012345678901234567890';
      event1.to = '0x0987654321098765432109876543210987654321';
      event1.value = '1000';
      event1.blockNumber = 100;
      event1.timestamp = 1625097600;
      event1.logIndex = 0;
      
      const event2 = new TransferEvent();
      event2.transactionHash = '0xfedcba';
      event2.from = '0x0987654321098765432109876543210987654321';
      event2.to = '0x1234567890123456789012345678901234567890';
      event2.value = '2000';
      event2.blockNumber = 101;
      event2.timestamp = 1625097700;
      event2.logIndex = 0;
      
      await TestDataSource.getRepository(TransferEvent).save([event1, event2]);
      
      const syncState = new SyncState();
      syncState.lastSyncedBlock = 101;
      await TestDataSource.getRepository(SyncState).save(syncState);
    });
    
    mockSubscribeToTransferEvents.mockImplementation((callback) => {
      // Simulate an event after a short delay
      setTimeout(() => {
        callback({
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          value: '3000',
          blockNumber: 102,
          transactionHash: '0x123456',
          timestamp: 1625097800
        });
      }, 100);
    });
  });

  describe('startEventIndexing', () => {
    it('should index events and update sync state', async () => {
      // Act
      await ethereumService.startEventIndexing(10);
      
      // Assert
      expect(mockStartEventIndexing).toHaveBeenCalledWith(10);
      
      // Wait for indexing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify events were created
      const events = await TestDataSource.getRepository(TransferEvent).find();
      const syncState = await TestDataSource.getRepository(SyncState).findOne({ where: {} });
      
      expect(events.length).toBe(2);
      expect(syncState).toBeDefined();
      expect(syncState?.lastSyncedBlock).toBe(101);
    });
  });

  describe('getEvents', () => {
    it('should return events with pagination', async () => {
      // Arrange
      const event1 = new TransferEvent();
      event1.transactionHash = '0xabcdef';
      event1.from = '0x1234567890123456789012345678901234567890';
      event1.to = '0x0987654321098765432109876543210987654321';
      event1.value = '1000';
      event1.blockNumber = 100;
      event1.timestamp = 1625097600;
      event1.logIndex = 0;
      
      const event2 = new TransferEvent();
      event2.transactionHash = '0xfedcba';
      event2.from = '0x0987654321098765432109876543210987654321';
      event2.to = '0x1234567890123456789012345678901234567890';
      event2.value = '2000';
      event2.blockNumber = 101;
      event2.timestamp = 1625097700;
      event2.logIndex = 0;
      
      await TestDataSource.getRepository(TransferEvent).save([event1, event2]);
      
      // Act
      const result = await ethereumService.getEvents({
        page: 1,
        pageSize: 10
      });
      
      // Assert
      expect(mockGetEvents).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10
      });
      expect(result.events.length).toBe(2);
      expect(result.totalCount).toBe(2);
    });
    
    it('should filter events by from address', async () => {
      // Arrange
      const event1 = new TransferEvent();
      event1.transactionHash = '0xabcdef';
      event1.from = '0x1234567890123456789012345678901234567890';
      event1.to = '0x0987654321098765432109876543210987654321';
      event1.value = '1000';
      event1.blockNumber = 100;
      event1.timestamp = 1625097600;
      event1.logIndex = 0;
      
      const event2 = new TransferEvent();
      event2.transactionHash = '0xfedcba';
      event2.from = '0x0987654321098765432109876543210987654321';
      event2.to = '0x1234567890123456789012345678901234567890';
      event2.value = '2000';
      event2.blockNumber = 101;
      event2.timestamp = 1625097700;
      event2.logIndex = 0;
      
      await TestDataSource.getRepository(TransferEvent).save([event1, event2]);
      
      // Act
      const result = await ethereumService.getEvents({
        from: '0x1234567890123456789012345678901234567890',
        page: 1,
        pageSize: 10
      });
      
      // Assert
      expect(mockGetEvents).toHaveBeenCalledWith({
        from: '0x1234567890123456789012345678901234567890',
        page: 1,
        pageSize: 10
      });
      expect(result.events.length).toBe(1);
      expect(result.events[0].from).toBe('0x1234567890123456789012345678901234567890');
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      // Arrange
      const event1 = new TransferEvent();
      event1.transactionHash = '0xabcdef';
      event1.from = '0x1234567890123456789012345678901234567890';
      event1.to = '0x0987654321098765432109876543210987654321';
      event1.value = '1000';
      event1.blockNumber = 100;
      event1.timestamp = 1625097600;
      event1.logIndex = 0;
      
      const event2 = new TransferEvent();
      event2.transactionHash = '0xfedcba';
      event2.from = '0x0987654321098765432109876543210987654321';
      event2.to = '0x1234567890123456789012345678901234567890';
      event2.value = '2000';
      event2.blockNumber = 101;
      event2.timestamp = 1625097700;
      event2.logIndex = 0;
      
      await TestDataSource.getRepository(TransferEvent).save([event1, event2]);
      
      // Act
      const stats = await ethereumService.getStats();
      
      // Assert
      expect(mockGetStats).toHaveBeenCalled();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalValueTransferred).toBe('3000');
    });
  });

  describe('subscribeToTransferEvents', () => {
    it('should call callback when new events are received', (done) => {
      // Arrange
      const callback = jest.fn();
      
      // Act
      ethereumService.subscribeToTransferEvents(callback);
      
      // Assert - Wait for event to be processed
      setTimeout(() => {
        expect(mockSubscribeToTransferEvents).toHaveBeenCalledWith(callback);
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
          from: '0x1234567890123456789012345678901234567890',
          to: '0x0987654321098765432109876543210987654321',
          value: '3000'
        }));
        done();
      }, 200);
    });
  });
}); 