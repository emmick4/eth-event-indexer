// Set test environment variables
process.env.NODE_ENV = 'test';

// Increase timeout for tests
jest.setTimeout(30000);

// Global teardown
afterAll(async () => {
  // Clean up any resources if needed
}); 