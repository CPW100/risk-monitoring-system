const { calculateMarginStatus } = require('../services/marginService');
const db = require('../db/db_init');
const { fetchStockPrice } = require('../services/stockService');
const util = require('util');
const closeDb = util.promisify(db.close.bind(db));

jest.mock('../services/stockService');

describe('calculateMarginStatus', () => {

    const testClientId = 'test-client-123';

    beforeAll(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});

        // Await DB initialization if async
        await new Promise((resolve, reject) => {
            db.serialize(() => {
            // If you need to run some setup queries here
            resolve();
            });
        });
    });

    afterAll(async () => {
        if (console.log.mockRestore) {
            console.log.mockRestore();
        }

        try {
            await closeDb();
        } catch (err) {
            console.error('Error closing DB:', err);
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns default values when client has no positions', async () => {
        // Mock db.all for positions to return empty array
        jest.spyOn(db, 'all').mockImplementation((query, params, cb) => {
            if (query.includes('positions')) return cb(null, []);
            if (query.includes('market_data')) return cb(null, []);
            return cb(null, []);
        });

        // Mock db.get for margins to return loan info
        jest.spyOn(db, 'get').mockImplementation((query, params, cb) => {
            const callback = typeof params === 'function' ? params : cb;
            callback(null, { account_id: 'acct-001', loan: 500 });
        });

        const result = await calculateMarginStatus(testClientId);

        expect(result.positions).toEqual([]);
        expect(result.loanAmount).toBe(500);
        expect(result.netEquity).toBe(-500);
        expect(result.marginShortfall).toBe(500);
        expect(result.marginCall).toBe(true);
    });

    it('fetches missing prices and updates market_data', async () => {
        // Setup positions with two symbols
        jest.spyOn(db, 'all').mockImplementation((query, params, cb) => {
            if (query.includes('positions')) {
                return cb(null, [
                    { symbol: 'AAPL', quantity: 10 },
                    { symbol: 'MSFT', quantity: 5 }
                ]);
            }
            if (query.includes('market_data')) {
                // only AAPL price present in DB, MSFT missing
                return cb(null, [{ symbol: 'AAPL', current_price: 100 }]);
            }
            cb(null, []);
        });

        jest.spyOn(db, 'get').mockImplementation((query, params, cb) => {
            const callback = typeof params === 'function' ? params : cb;
            callback(null, { account_id: 'acct-001', loan: 200 });
        });

        // Mock fetchStockPrice for MSFT returns 200
        fetchStockPrice.mockResolvedValue(200);

        // Mock db.run for INSERT OR REPLACE to succeed immediately
        jest.spyOn(db, 'run').mockImplementation((query, params, cb) => cb(null));

        const result = await calculateMarginStatus(testClientId);

        // Check positions include prices and positionValue
        expect(result.positions.find(p => p.symbol === 'AAPL').currentPrice).toBe(100);
        expect(result.positions.find(p => p.symbol === 'MSFT').currentPrice).toBe(200);

        // Portfolio value = (10*100) + (5*200) = 1000 + 1000 = 2000
        expect(result.portfolioValue).toBe(2000);
        expect(result.loanAmount).toBe(200);
        expect(result.netEquity).toBe(1800);
    });

    it('calculates margin shortfall and margin call correctly', async () => {
        // Setup positions and prices so that netEquity < marginRequirement
        jest.spyOn(db, 'all').mockImplementation((query, params, cb) => {
            if (query.includes('positions')) {
            return cb(null, [{ symbol: 'AAPL', quantity: 10 }]);
            }
            if (query.includes('market_data')) {
            return cb(null, [{ symbol: 'AAPL', current_price: 100 }]);
            }
            cb(null, []);
        });

        jest.spyOn(db, 'get').mockImplementation((query, params, cb) => {
            const callback = typeof params === 'function' ? params : cb;
            callback(null, { account_id: 'acct-001', loan: 1000 });
        });

        jest.spyOn(db, 'run').mockImplementation((query, params, cb) => cb(null));

        const result = await calculateMarginStatus(testClientId);

        // portfolioValue = 10*100 = 1000
        // netEquity = 1000 - 1000 = 0
        // marginRequirement = 0.25 * 1000 = 250
        // marginShortfall = 250 - 0 = 250 (positive)
        // marginCall = true (shortfall > 0)
        expect(result.marginShortfall).toBeCloseTo(250);
        expect(result.marginCall).toBe(true);
    });

    it('throws error if DB calls fail', async () => {
        expect.assertions(2);
        const errorMock = jest.spyOn(console, 'error').mockImplementation(() => {});

        jest.spyOn(db, 'all').mockImplementation((query, params, cb) => {
            cb(new Error('DB failure'), null);
        });

        await expect(calculateMarginStatus(testClientId)).rejects.toThrow('DB failure');

        expect(errorMock).toHaveBeenCalled();

        errorMock.mockRestore();
    });
});
