const WebSocket = require('ws');
const WSServer = require('../services/wsServer');
const db = require('../db/db_init');
const { calculateMarginStatus } = require('../services/marginService');

jest.mock('ws');
jest.mock('../services/marginService');

// Mock the db module with a synchronous init callback and no logs
jest.mock('../db/db_init', () => {
  return {
    init: jest.fn((callback) => {
      // Immediately call callback to simulate DB initialized without logging
      process.nextTick(() => callback(null));
    }),
    run: jest.fn(),
    // mock other DB methods if used
  };
});

describe('WSServer', () => {
  let wsServer;
  const mockOptions = { port: 8080 };
  const mockClientId = 'client-123';
  const mockSymbols = ['AAPL', 'MSFT'];
  const mockPrice = 150.50;

  const mockTwelveDataWS = {
    on: jest.fn(),
    send: jest.fn(),
    readyState: WebSocket.OPEN,
    close: jest.fn(),
    terminate: jest.fn(),
    ping: jest.fn(),
    removeAllListeners: jest.fn(),
  };
  const mockClientWS = {
    on: jest.fn(),
    send: jest.fn(),
    readyState: WebSocket.OPEN,
    close: jest.fn()
  };

  beforeAll(() => {
    // Suppress console.log during tests to avoid async log after test error
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    console.log.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    WebSocket.Server.mockImplementation(() => ({
      on: jest.fn()
    }));

    WebSocket.mockImplementationOnce(() => mockTwelveDataWS);

    wsServer = new WSServer(mockOptions);

    // Call the 'open' event handler for Twelve Data WS to simulate connection
    const openHandler = mockTwelveDataWS.on.mock.calls.find(call => call[0] === 'open')[1];
    openHandler();
  });

  afterEach(() => {
    wsServer.shutdown();
  });

  // ... rest of your tests unchanged ...

  describe('Client Connection Handling', () => {
    it('should handle new client connections', () => {
      const connectionHandler = wsServer.server.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockClientWS);

      expect(mockClientWS.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockClientWS.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(wsServer.clientSubscriptions.has(mockClientWS)).toBe(true);
    });

    it('should register clients with valid messages', () => {
      wsServer.server.on.mock.calls.find(call => call[0] === 'connection')[1](mockClientWS);
      const messageHandler = mockClientWS.on.mock.calls.find(call => call[0] === 'message')[1];

      const registerMessage = JSON.stringify({ type: 'register', clientId: mockClientId });
      messageHandler(registerMessage);

      expect(wsServer.clients.get(mockClientWS)).toBe(mockClientId);
    });

    it('should handle subscription requests', () => {
      wsServer.server.on.mock.calls.find(call => call[0] === 'connection')[1](mockClientWS);
      wsServer.clients.set(mockClientWS, mockClientId);
      const messageHandler = mockClientWS.on.mock.calls.find(call => call[0] === 'message')[1];

      const subscribeMessage = JSON.stringify({ type: 'subscribe', symbols: mockSymbols });
      messageHandler(subscribeMessage);

      const clientSubs = wsServer.clientSubscriptions.get(mockClientWS);
      mockSymbols.forEach(symbol => {
        expect(clientSubs.has(symbol)).toBe(true);
        expect(wsServer.masterSymbolList.has(symbol)).toBe(true);
      });
    });
  });

  describe('Twelve Data Integration', () => {
    it('should connect to Twelve Data on initialization', () => {
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://ws.twelvedata.com/v1/quotes/price'),
      );
      expect(mockTwelveDataWS.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockTwelveDataWS.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockTwelveDataWS.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockTwelveDataWS.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle price updates from Twelve Data', () => {
      const messageHandler = mockTwelveDataWS.on.mock.calls.find(call => call[0] === 'message')[1];
      wsServer.clientSubscriptions.set(mockClientWS, new Set(mockSymbols));
      wsServer.clients.set(mockClientWS, mockClientId);

      db.run.mockImplementation((query, params, callback) => callback(null));

      const priceUpdate = JSON.stringify({
        event: 'price',
        symbol: mockSymbols[0],
        price: mockPrice
      });

      messageHandler(priceUpdate);

      expect(db.run).toHaveBeenCalled();
      expect(mockClientWS.send).toHaveBeenCalledWith(
        expect.stringContaining('priceUpdate')
      );
    });

    it('should rotate subscriptions according to free tier limits', () => {
      const manySymbols = Array.from({ length: 10 }, (_, i) => `STOCK${i}`);
      wsServer.masterSymbolList = new Set(manySymbols);

      const rotate = wsServer.rotationInterval._onTimeout;
      rotate();

      expect(mockTwelveDataWS.send).toHaveBeenCalledWith(
        expect.stringContaining('subscribe')
      );
      expect(wsServer.activeSubscriptions.size).toBe(8); // MAX_SYMBOLS_FREE_TIER
    });
  });

  describe('Margin Status Updates', () => {
    it('should trigger margin updates on price changes', async () => {
      const messageHandler = mockTwelveDataWS.on.mock.calls.find(call => call[0] === 'message')[1];
      wsServer.clientSubscriptions.set(mockClientWS, new Set(mockSymbols));
      wsServer.clients.set(mockClientWS, mockClientId);

      calculateMarginStatus.mockResolvedValue({
        marginCall: false,
        netEquity: 10000
      });

      const priceUpdate = JSON.stringify({
        event: 'price',
        symbol: mockSymbols[0],
        price: mockPrice
      });

      messageHandler(priceUpdate);
      await new Promise(setImmediate);

      expect(calculateMarginStatus).toHaveBeenCalledWith(mockClientId);
      expect(mockClientWS.send).toHaveBeenCalledWith(
        expect.stringContaining('marginUpdate')
      );
    });
  });

  describe('Client Disconnection', () => {
    it('should clean up when client disconnects', () => {
      wsServer.server.on.mock.calls.find(call => call[0] === 'connection')[1](mockClientWS);
      wsServer.clients.set(mockClientWS, mockClientId);
      wsServer.clientSubscriptions.set(mockClientWS, new Set(mockSymbols));

      const mockClientWS2 = {
        on: jest.fn(),
        send: jest.fn(),
        readyState: WebSocket.OPEN,
        close: jest.fn()
      };
      wsServer.server.on.mock.calls.find(call => call[0] === 'connection')[1](mockClientWS2);
      wsServer.clients.set(mockClientWS2, 'client-456');
      wsServer.clientSubscriptions.set(mockClientWS2, new Set(mockSymbols));
      mockSymbols.forEach(symbol => {
        wsServer.masterSymbolList.add(symbol);
      });

      const disconnectHandler = mockClientWS.on.mock.calls.find(call => call[0] === 'close')[1];
      disconnectHandler();

      expect(wsServer.clients.has(mockClientWS)).toBe(false);
      expect(wsServer.clientSubscriptions.has(mockClientWS)).toBe(false);
      mockSymbols.forEach(symbol => {
        expect(wsServer.masterSymbolList.has(symbol)).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during price storage', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const messageHandler = mockTwelveDataWS.on.mock.calls.find(call => call[0] === 'message')[1];

      db.run.mockImplementation((query, params, callback) => callback(new Error('DB error')));

      messageHandler(JSON.stringify({
        event: 'price',
        symbol: mockSymbols[0],
        price: mockPrice
      }));

      expect(consoleError).toHaveBeenCalledWith(
        'Failed to upsert market data:',
        expect.any(String)
      );
      consoleError.mockRestore();
    });
  });
});
