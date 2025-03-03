# Ethereum Event Indexer

This service indexes ERC-20 Transfer events from an Ethereum smart contract and provides a REST API to query the indexed data. It also includes a WebSocket endpoint for real-time event notifications.

## Features

- 📊 Indexes ERC-20 Transfer events from Ethereum's Sepolia testnet
- 🔍 REST API with filtering and pagination
- 📈 Statistics endpoint
- ⚡ WebSocket support for real-time events
- 🛡️ Rate limiting for API endpoints
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
   git clone <repository-url>
   cd ethereum-event-indexer
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```
   # Ethereum Node Configuration
   RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
   CONTRACT_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
   START_BLOCK=4000000

   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # Database Configuration
   DB_NAME=ethereum_events.db
   ```

   Replace `YOUR_INFURA_KEY` with your actual Infura API key.

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

### WebSocket

Connect to the WebSocket endpoint to receive real-time Transfer events:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New event:', data);
};
```

## Development

### Project Structure

```
src/
├── config/             # Configuration files
├── controllers/        # API controllers
├── middleware/         # Express middleware
├── models/             # Database models
├── services/           # Business logic
└── index.ts            # Application entry point
```

### Testing

```
npm test
```

## License

This project is licensed under the ISC License. 