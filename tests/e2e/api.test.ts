import request from 'supertest';
import http from 'http';
import express, { Request, Response } from 'express';
import { initializeTestDatabase, closeTestDatabase, TestDataSource } from '../config/database';
import { EthereumService } from '../../src/services/EthereumService';
import { EventController } from '../../src/controllers/EventController';
import { StatsController } from '../../src/controllers/StatsController';
import { TransferEvent } from '../../src/models/TransferEvent';
import { SyncState } from '../../src/models/SyncState';

// Mock EthereumService methods but use real database
jest.mock('../../src/services/EthereumService', () => {
  return {
    __esModule: true,
    EthereumService: jest.fn().mockImplementation(() => ({
      startEventIndexing: jest.fn(),
      subscribeToTransferEvents: jest.fn(),
      getEvents: jest.fn().mockImplementation(async (params) => {
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
      }),
      getStats: jest.fn().mockImplementation(async () => {
        const totalEvents = await TestDataSource.getRepository(TransferEvent).count();
        const syncState = await TestDataSource.getRepository(SyncState).findOne({ where: {} });
        
        return {
          totalEvents,
          totalValueTransferred: '3000',
          lastSyncedBlock: syncState?.lastSyncedBlock || 0,
          isIndexing: false
        };
      })
    }))
  };
});

describe('API E2E Tests', () => {
  let app: express.Application;
  let server: http.Server;
  
  beforeAll(async () => {
    // Initialize test database
    await initializeTestDatabase();
    
    // Create test data
    const event1 = new TransferEvent();
    event1.transactionHash = '0x123';
    event1.from = '0x1234567890123456789012345678901234567890';
    event1.to = '0x0987654321098765432109876543210987654321';
    event1.value = '100';
    event1.blockNumber = 100;
    event1.timestamp = Math.floor(Date.now() / 1000);
    event1.logIndex = 0;
    
    const event2 = new TransferEvent();
    event2.transactionHash = '0x456';
    event2.from = '0x0987654321098765432109876543210987654321';
    event2.to = '0x1234567890123456789012345678901234567890';
    event2.value = '200';
    event2.blockNumber = 200;
    event2.timestamp = Math.floor(Date.now() / 1000);
    event2.logIndex = 0;
    
    await TestDataSource.getRepository(TransferEvent).save([event1, event2]);
    
    const syncState = new SyncState();
    syncState.lastSyncedBlock = 200;
    syncState.isIndexing = false;
    await TestDataSource.getRepository(SyncState).save(syncState);
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Create services
    const ethereumService = new EthereumService();
    
    // Create controllers
    const eventController = new EventController(ethereumService);
    const statsController = new StatsController(ethereumService);
    
    // Setup routes
    app.get('/events', eventController.getEvents);
    app.get('/stats', statsController.getStats);
    
    // Health check endpoint
    app.get('/health', function(req: Request, res: Response) {
      res.json({ status: 'ok' });
    });
    
    // Start server
    server = http.createServer(app);
    server.listen(0); // Use any available port
  });
  
  afterAll(async () => {
    // Close server
    server.close();
    
    // Close test database
    await closeTestDatabase();
  });
  
  describe('GET /events', () => {
    it('should return events with pagination', async () => {
      const response = await request(app)
        .get('/events')
        .query({ page: '1', pageSize: '10' })
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('totalCount', 2);
      expect(response.body.data.length).toBe(2);
    });
    
    it('should filter events by from address', async () => {
      const response = await request(app)
        .get('/events')
        .query({ from: '0x0987654321098765432109876543210987654321', page: '1', pageSize: '10' })
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].from).toBe('0x0987654321098765432109876543210987654321');
    });
  });
  
  describe('GET /stats', () => {
    it('should return statistics', async () => {
      const response = await request(app)
        .get('/stats')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('totalEvents', 2);
      expect(response.body).toHaveProperty('totalValueTransferred');
    });
  });
  
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toEqual({ status: 'ok' });
    });
  });
}); 