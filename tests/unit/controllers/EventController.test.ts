import { Request, Response } from 'express';
import { EventController } from '../../../src/controllers/EventController';
import { EthereumService } from '../../../src/services/EthereumService';

// Mock EthereumService
jest.mock('../../../src/services/EthereumService');

describe('EventController', () => {
  let eventController: EventController;
  let mockEthereumService: jest.Mocked<EthereumService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock for EthereumService
    mockEthereumService = new EthereumService() as jest.Mocked<EthereumService>;
    
    // Create controller with mock service
    eventController = new EventController(mockEthereumService);
    
    // Setup mock response
    jsonSpy = jest.fn().mockReturnThis();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockResponse = {
      json: jsonSpy,
      status: statusSpy,
    };
  });

  describe('getEvents', () => {
    it('should return events when valid parameters are provided', async () => {
      // Arrange
      mockRequest = {
        query: {
          page: '1',
          pageSize: '10',
        },
      };
      
      const mockEvents = {
        events: [
          { id: 1, from: '0x123', to: '0x456', value: '100', blockNumber: 123 },
          { id: 2, from: '0x789', to: '0xabc', value: '200', blockNumber: 124 },
        ],
        totalCount: 2,
      };
      
      mockEthereumService.getEvents = jest.fn().mockResolvedValue(mockEvents);

      // Act
      await eventController.getEvents(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockEthereumService.getEvents).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        from: undefined,
        to: undefined,
        startBlock: undefined,
        endBlock: undefined,
      });
      
      expect(jsonSpy).toHaveBeenCalledWith({
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
      // Arrange
      mockRequest = {
        query: {
          from: 'invalid-address',
          page: '1',
          pageSize: '10',
        },
      };

      // Act
      await eventController.getEvents(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({ errors: ['Invalid "from" address'] });
    });

    it('should return 500 when service throws an error', async () => {
      // Arrange
      mockRequest = {
        query: {
          page: '1',
          pageSize: '10',
        },
      };
      
      mockEthereumService.getEvents = jest.fn().mockRejectedValue(new Error('Service error'));

      // Mock console.error to prevent error output during test
      const originalConsoleError = console.error;
      console.error = jest.fn();

      try {
        // Act
        await eventController.getEvents(mockRequest as Request, mockResponse as Response);

        // Assert
        expect(statusSpy).toHaveBeenCalledWith(500);
        expect(jsonSpy).toHaveBeenCalledWith({ error: 'An error occurred while retrieving events' });
      } finally {
        // Restore original console.error
        console.error = originalConsoleError;
      }
    });
  });
}); 