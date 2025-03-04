import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { initializeDatabase } from './config/database';
import { PORT } from './config/config';
import { EthereumService } from './services/EthereumService';
import { WebSocketService } from './services/WebSocketService';
import { EventController } from './controllers/EventController';
import { StatsController } from './controllers/StatsController';
import { RateLimiter } from './middleware/RateLimiter';

async function bootstrap() {
  try {
    // Initialize database
    await initializeDatabase();

    // Create Express application
    const app = express();
    const server = http.createServer(app);

    // Middleware
    app.use(cors());
    app.use(express.json());

    // Rate limiter - 100 requests per minute
    const rateLimiter = new RateLimiter(60 * 1000, 100);
    app.use(rateLimiter.middleware);

    // Services
    const ethereumService = new EthereumService();
    const webSocketService = new WebSocketService(server);

    // Controllers
    const eventController = new EventController(ethereumService);
    const statsController = new StatsController(ethereumService);

    // Routes
    app.get('/events', eventController.getEvents);
    app.get('/stats', statsController.getStats);
    
    // Basic health check
    app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });
    
    // API documentation
    app.get('/', (_, res) => {
      res.json({
        name: 'Ethereum Event Indexer API',
        description: 'API for querying indexed ERC-20 Transfer events',
        endpoints: [
          {
            path: '/events',
            description: 'Get paginated Transfer events with optional filters',
            method: 'GET',
            params: {
              from: 'Filter by sender address',
              to: 'Filter by recipient address',
              startBlock: 'Filter by starting block number',
              endBlock: 'Filter by ending block number',
              page: 'Page number (default: 1)',
              pageSize: 'Items per page (default: 10, max: 100)'
            }
          },
          {
            path: '/stats',
            description: 'Get statistics about indexed events',
            method: 'GET'
          },
          {
            path: '/health',
            description: 'Health check endpoint',
            method: 'GET'
          }
        ],
        websocket: {
          path: '/',
          description: 'WebSocket endpoint for real-time Transfer events'
        }
      });
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      
      // Start indexing service
      ethereumService.startEventIndexing();
      
      // Subscribe to live events and broadcast via WebSocket
      ethereumService.subscribeToTransferEvents((event) => {
        webSocketService.broadcastEvent(event);
        
        // Log new events
        console.log(`New Transfer: ${event.from} -> ${event.to} [${event.value}]`);
      });
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down server...');
      server.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start application
bootstrap(); 