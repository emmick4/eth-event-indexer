import { DataSource } from 'typeorm';
import { TransferEvent } from '../../src/models/TransferEvent';
import { SyncState } from '../../src/models/SyncState';

export const TestDataSource = new DataSource({
  type: 'sqlite',
  database: ':memory:', // Use in-memory database for tests
  entities: [TransferEvent, SyncState],
  synchronize: true,
  dropSchema: true, // Drop schema before each test run
  logging: false
});

// Initialize test database connection
export const initializeTestDatabase = async (): Promise<void> => {
  try {
    await TestDataSource.initialize();
    console.log('Test database connection established');
  } catch (error) {
    console.error('Error during test database initialization:', error);
    throw error;
  }
};

// Close test database connection
export const closeTestDatabase = async (): Promise<void> => {
  try {
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy();
      console.log('Test database connection closed');
    }
  } catch (error) {
    console.error('Error closing test database connection:', error);
    throw error;
  }
}; 