import { DataSource } from 'typeorm';
import { DB_NAME } from './config';
import { TransferEvent } from '../models/TransferEvent';
import { SyncState } from '../models/SyncState';

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: DB_NAME,
  entities: [TransferEvent, SyncState],
  synchronize: true, // Automatically create database schema in development
  logging: false
});

// Initialize database connection
export const initializeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error during database initialization:', error);
    throw error;
  }
}; 