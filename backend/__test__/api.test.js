/**
 * @file This test suite provides unit tests for the Express REST API layer.
 *
 * @description
 * This file uses 'supertest' to simulate HTTP requests to the API endpoints defined
 * in `app.js`. The core testing strategy is to use `jest.mock` to completely
 * isolate the Express app from its external dependencies, including the database,
 * third-party APIs (via axios), and other internal services.
 *
 * Each `describe` block targets a specific API route, testing for both successful
 * execution ("happy path") and various error conditions (e.g., database failures).
 * This ensures that the route handling and controller logic are correct and resilient,
 * independent of the actual implementation of their dependencies.
 */


const request = require('supertest');
const axios = require('axios');
const app = require('../app'); // Not server.js
const db = require('../db/db_init');
const { calculateMarginStatus } = require('../services/marginService');
const WSServer = require('../services/wsServer');

jest.mock('axios');
jest.mock('../db/db_init');
jest.mock('../services/marginService');
jest.mock('../services/wsServer');

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();

  // Load the app fresh each time
  db.all = jest.fn();
  db.get = jest.fn();
});

describe('REST API endpoints', () => {
  describe('GET /api/clients', () => {
    
    it('should return list of clients', async () => {
      const fakeClients = [{ client_id: 'c1', name: 'Alice' }];
      db.all.mockImplementation((q, cb) => cb(null, fakeClients));

      const res = await request(app).get('/api/clients');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(fakeClients);
    });

    it('should handle db errors', async () => {
      db.all.mockImplementation((q, cb) => cb(new Error('fail'), null));

      const res = await request(app).get('/api/clients');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/positions/:clientId', () => {
    it('should return positions for valid client', async () => {
      const fakePositions = [{ symbol: 'AAPL', quantity: 10 }];
      db.all.mockImplementation((q, p, cb) => cb(null, fakePositions));

      const res = await request(app).get('/api/positions/c1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(fakePositions);
      expect(db.all).toHaveBeenCalledWith(expect.any(String), ['c1'], expect.any(Function));
    });

    it('should handle db errors for positions', async () => {
      db.all.mockImplementation((q, p, cb) => cb(new Error('error'), null));

      const res = await request(app).get('/api/positions/c2');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/margin-status/:clientId', () => {
    it('should return margin status JSON', async () => {
      calculateMarginStatus.mockResolvedValue({ marginCall: false });
      const res = await request(app).get('/api/margin-status/c1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ marginCall: false });
      expect(calculateMarginStatus).toHaveBeenCalledWith('c1');
    });

    it('should handle calculateMarginStatus error', async () => {
      calculateMarginStatus.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/margin-status/c1');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/market-data', () => {
    it('should return all market data', async () => {
      const fakeRows = [{ symbol: 'AAPL', current_price: 100 }];
      db.all.mockImplementation((q, p, cb) => cb(null, fakeRows));
      const res = await request(app).get('/api/market-data');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(fakeRows);
      expect(db.all).toHaveBeenCalledWith(expect.stringContaining('FROM market_data'), [], expect.any(Function));
    });

    it('should filter by symbols query', async () => {
      const fakeRows = [{ symbol: 'MSFT', current_price: 200 }];
      db.all.mockImplementation((q, p, cb) => cb(null, fakeRows));
      const res = await request(app).get('/api/market-data?symbols=MSFT,AAPL');
      expect(res.status).toBe(200);
      expect(db.all).toHaveBeenCalledWith(expect.stringContaining('WHERE symbol IN'), ['MSFT','AAPL'], expect.any(Function));
      expect(res.body).toEqual(fakeRows);
    });

    it('should handle db error', async () => {
      db.all.mockImplementation((q, p, cb) => cb(new Error('oops')));
      const res = await request(app).get('/api/market-data');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/chart-data', () => {
    const symbol = 'AAPL';
    const interval = '1day';
    
    it('should reject invalid interval', async () => {
      const res = await request(app).get(`/api/chart-data?symbol=${symbol}&interval=wrong`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    describe('with valid interval and DB fetch', () => {
      beforeEach(() => {
        // make chart_metadata be older
        const oldTs = new Date(Date.now() - 13 * 3600 * 1000);
        db.get.mockImplementation((q, p, cb) => cb(null, { last_updated: oldTs.toISOString() }));
        axios.get.mockResolvedValue({
          data: { values: [{
            datetime: new Date().toISOString(),
            open: '10', high: '20', low: '5', close: '15', volume: '1234'
          }]}
        });
        db.serialize = jest.fn(cb => cb());
        db.run = jest.fn((q,p,cb) => cb && cb());
        db.prepare = jest.fn(() => ({
          run: jest.fn(),
          finalize: jest.fn(),
        }));
      });

      it('should fetch fresh data from API', async () => {
        const res = await request(app).get(`/api/chart-data?symbol=${symbol}&interval=${interval}`);
        expect(res.status).toBe(200);
        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining('api.twelvedata.com/time_series'),
          expect.objectContaining({ params: expect.objectContaining({ symbol, interval: '1day' }) })
        );
        expect(res.body[0]).toHaveProperty('open');
      });
    });

    describe('using cached data', () => {
      beforeEach(() => {
        const now = new Date().toISOString();
        db.get.mockImplementation((q, p, cb) => cb(null, { last_updated: now }));
        const fakeChart = [{ timestamp: 1, open:2,high:3,low:4,close:5,volume:6 }];
        db.all.mockImplementation((q, p, cb) => cb(null, fakeChart));
      });

      it('should return cached data', async () => {
        const res = await request(app).get(`/api/chart-data?symbol=${symbol}&interval=${interval}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.any(Array));
        expect(db.all).toHaveBeenCalledWith(expect.any(String), [symbol, interval], expect.any(Function));
      });
    });
  });

  describe('POST /api/login', () => {
    it('should reject missing credentials', async () => {
      const res = await request(app).post('/api/login').send({ email: 'a@b.com' });
      expect(res.status).toBe(400);
    });

    it('should reject invalid login', async () => {
      db.get = jest.fn((q,p,cb) => cb(null, null)); // no row
      const res = await request(app).post('/api/login').send({ email:'a@b.com', password:'123' });
      expect(res.status).toBe(401);
    });

    it('should accept valid login', async () => {
      const clientRow = { client_id: 'c1', name:'Alice', email:'a@b.com' };
      db.get = jest.fn((q,p,cb) => cb(null, clientRow));
      const res = await request(app).post('/api/login').send({ email:'a@b.com', password:'pw' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message','Login successful');
      expect(res.body).toHaveProperty('client', clientRow);
    });
  });
});

describe('WebSocket Server startup', () => {
  it('should initialize a WebSocket server', () => {
    require('../server'); // This triggers the WSServer instantiation

    expect(WSServer).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8080 });
  });
});
