import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Ethereum configuration
export const RPC_URL = process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY';
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const START_BLOCK = parseInt(process.env.START_BLOCK || '0', 10);

// Server configuration
export const PORT = process.env.PORT || 3000;
export const NODE_ENV = process.env.NODE_ENV || 'development';

// Database configuration
export const DB_NAME = process.env.DB_NAME || 'ethereum_events.db';

// Validate that required environment variables are set
if (RPC_URL.includes('YOUR_INFURA_KEY')) {
  console.warn('Please set your Infura key in the .env file');
} 