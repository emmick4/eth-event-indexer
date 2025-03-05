import request from 'supertest';
import express from 'express';
import { EventController } from '../../../src/controllers/EventController';
import { EthereumService } from '../../../src/services/EthereumService';
import { initializeTestDatabase, closeTestDatabase } from '../../config/database';

// Mock EthereumService
jest.mock('../../../src/services/EthereumService');

describe('Events API Integration Tests', () => {
  let app: express.Application;
  let mockEthereumService: jest.Mocked<EthereumService>;

  beforeAll(async () => {
    // Initialize test database
    await initializeTestDatabase();
  });

  afterAll(async () => {
    // Close test database
    await closeTestDatabase();
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock for EthereumService
    mockEthereumService = new EthereumService() as jest.Mocked<EthereumService>;
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Setup controller with mock service
    const eventController = new EventController(mockEthereumService);
    
    // Setup routes
    app.get('/events', eventController.getEvents);
  });

  describe('GET /events', () => {
    it('should return 200 and events when valid parameters are provided', async () => {
      // Arrange
      const mockEvents = {
        events: [
          { id: 1, from: '0x123', to: '0x456', value: '100', blockNumber: 123 },
          { id: 2, from: '0x789', to: '0xabc', value: '200', blockNumber: 124 },
        ],
        totalCount: 2,
      };
      
      mockEthereumService.getEvents = jest.fn().mockResolvedValue(mockEvents);

      // Act & Assert
      const response = await request(app)
        .get('/events')
        .query({ page: '1', pageSize: '10' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        data: mockEvents.events,
        pagination: {
          totalCount: 2,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        },
      });
    });

    it('should return 400 when invalid address is provided', async () => {
      // Act & Assert
      const response = await request(app)
        .get('/events')
        .query({ from: 'invalid-address', page: '1', pageSize: '10' })
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toContain('Invalid "from" address');
    });

    it('should return 500 when service throws an error', async () => {
      // Arrange
      mockEthereumService.getEvents = jest.fn().mockRejectedValue(new Error('Service error'));

      // Mock console.error to prevent error output during test
      const originalConsoleError = console.error;
      console.error = jest.fn();

      try {
        // Act & Assert
        const response = await request(app)
          .get('/events')
          .query({ page: '1', pageSize: '10' })
          .expect('Content-Type', /json/)
          .expect(500);

        expect(response.body).toEqual({ error: 'An error occurred while retrieving events' });
      } finally {
        // Restore original console.error
        console.error = originalConsoleError;
      }
    });
  });
}); 