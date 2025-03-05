# Ethereum Event Indexer

This service indexes ERC-20 Transfer events from an Ethereum smart contract and provides a REST API to query the indexed data. It also includes a WebSocket endpoint for real-time event notifications.

## Features

- 📊 Indexes ERC-20 Transfer events from Ethereum's Sepolia testnet
- 🔍 REST API with filtering and pagination
- 📈 Statistics endpoint
- ⚡ WebSocket support for real-time events
- 🛡️ Rate limiting for API endpoints (100 requests per minute)
- 🔄 Resilient indexing with automatic recovery

## Tech Stack

- TypeScript
- Node.js
- Express.js
- ethers.js for Ethereum interaction
- SQLite with TypeORM for database
- WebSocket for real-time events

## Prerequisites

- Node.js 16+
- npm or yarn
- An Ethereum node provider API key (e.g., Infura)

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/ethereum-event-indexer.git
   cd ethereum-event-indexer
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```
   cp example.env .env
   ```

   Then edit the `.env` file to add your Infura API key and adjust any other settings:
   ```
   # Required
   RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
   
   # Optional (defaults shown)
   CONTRACT_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 # USDC on Sepolia
   START_BLOCK=0 # Start from contract creation if not specified or set to 0
   INITIAL_BATCH_SIZE=200 # Number of blocks to process in each batch
   PORT=3000
   ```

4. Build the application:
   ```
   npm run build
   ```

5. Start the server:
   ```
   npm start
   ```

   For development with hot-reload:
   ```
   npm run dev
   ```

## API Documentation

### Base URL
```
http://localhost:3000
```

### Endpoints

#### GET /events
Retrieve a paginated list of all indexed Transfer events.

**Query Parameters:**
- `from`: Filter by sender address
- `to`: Filter by recipient address
- `startBlock`: Filter by starting block number
- `endBlock`: Filter by ending block number
- `page`: Page number (default: 1)
- `pageSize`: Items per page (default: 10, max: 100)

**Example:**
```
GET /events?from=0x123...&page=2&pageSize=20
```

**Response:**
```json
{
  "data": [
    {
      "transactionHash": "0x123...",
      "blockNumber": 4000100,
      "timestamp": 1620000000,
      "from": "0x123...",
      "to": "0x456...",
      "value": "1000000"
    },
    ...
  ],
  "pagination": {
    "totalCount": 150,
    "page": 2,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

#### GET /stats
Retrieve aggregate statistics.

**Response:**
```json
{
  "totalEvents": 1250,
  "totalValueTransferred": "1250000000",
  "formattedTotalValueTransferred": "1,250.00 USDC"
}
```

#### GET /health
Health check endpoint to verify the API is running.

**Response:**
```json
{
  "status": "ok"
}
```

### Rate Limiting

The API is rate-limited to 100 requests per minute per IP address. When the limit is exceeded, the API returns a 429 status code with a "Too many requests" error message. Rate limit headers are included in every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2023-03-01T12:00:00.000Z
```

### WebSocket

Connect to the WebSocket endpoint to receive real-time Transfer events:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  // Handle different message types
  if (data.type === 'info') {
    console.log('Info message:', data.message);
  } else if (data.type === 'transferEvent') {
    console.log('New transfer event:', data.data);
  }
};
```

## Postman Collection

A Postman collection is included in the repository (`postman_collection.json`) for easy testing of the API endpoints.

## Development

### Project Structure

```
src/
├── config/             # Configuration files
├── controllers/        # API controllers
├── middleware/         # Express middleware
├── models/             # Database models
├── services/           # Business logic
│   ├── EthereumService.ts     # Main service facade
│   ├── IndexerService.ts      # Blockchain indexing logic
│   ├── EventQueryService.ts   # Database query logic
│   ├── RequestQueueService.ts # RPC request queueing
│   └── WebSocketService.ts    # Real-time events
└── index.ts            # Application entry point
```

### Testing

The application includes a comprehensive testing suite with unit, integration, and end-to-end tests.

#### Running Tests

Run all tests:
```
npm test
```

Run specific test types:
```
npm run test:unit       # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:e2e        # Run end-to-end tests only
```

Generate test coverage report:
```
npm run test:coverage
```

#### Test Structure

```
tests/
├── config/             # Test configuration
├── unit/               # Unit tests
│   ├── controllers/    # Controller tests
│   ├── middleware/     # Middleware tests
│   └── services/       # Service tests
├── integration/        # Integration tests
│   └── api/            # API endpoint tests
├── e2e/                # End-to-end tests
└── setup.ts            # Test setup file
```

#### Testing Stack

- Jest: Testing framework
- ts-jest: TypeScript support for Jest
- supertest: HTTP assertions for API testing
- nock: HTTP request mocking

#### Writing Tests

- **Unit Tests**: Test individual components in isolation with mocked dependencies
- **Integration Tests**: Test interactions between components
- **E2E Tests**: Test the entire application flow

Example unit test:
```typescript
describe('EventController', () => {
  it('should return events when valid parameters are provided', async () => {
    // Arrange
    const mockService = { getEvents: jest.fn().mockResolvedValue({ events: [], totalCount: 0 }) };
    const controller = new EventController(mockService);
    const req = { query: { page: '1', pageSize: '10' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    // Act
    await controller.getEvents(req as any, res as any);

    // Assert
    expect(mockService.getEvents).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
```

## License

This project is licensed under the MIT License. 