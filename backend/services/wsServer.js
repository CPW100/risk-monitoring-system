const WebSocket = require('ws');
const db = require('../db/db_init');
const { calculateMarginStatus } = require('./marginService');

// UPDATED: Using Twelve Data API Key and limits
const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4';
const MAX_SYMBOLS_FREE_TIER = 8; // Twelve Data's free tier limit is 8 credits/symbols
const ROTATION_INTERVAL_MS = 2 * 60 * 1000; // Rotate symbols every 2 minutes

class WSServer {
    constructor(options) {
        this.server = new WebSocket.Server(options);
        this.clients = new Map(); // Map<ws, clientId>
        this.clientSubscriptions = new Map(); // Map<ws, Set<symbol>>

        this.masterSymbolList = new Set();
        this.activeSubscriptions = new Set();
        this.rotationInterval = null;
        this.rotationIndex = 0;
        this.twelveKeepaliveInterval = null;

        this.twelve_ws = null;
        this.connectToTwelveData();

        this.server.on('connection', (ws) => {
            console.log('New client WebSocket connection');
            this.clientSubscriptions.set(ws, new Set());
            ws.on('message', (message) => this.handleMessage(ws, message));
            ws.on('close', () => this.handleDisconnect(ws));
        });
    }

    connectToTwelveData() {
        this.twelve_ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TWELVE_DATA_API_KEY}`);

        this.twelve_ws.on('open', () => {
            console.log('Connected to Twelve Data WebSocket.');
            this.startSymbolRotation();
        });

        this.twelve_ws.on('message', (message) => {
            const data = JSON.parse(message);
            // Twelve Data uses an 'event' property
            if (data.event === 'price') {
                const { symbol, price } = data;
                console.log(`Received price update for ${symbol}: ${price}`);
                this.storeMarketPrice(symbol, price);
                this.broadcastPriceUpdate(symbol, price);
                this.updateMarginStatusForSubscribers(symbol);
            }
            if (data.event === 'ping') {
                this.twelve_ws.send(JSON.stringify({ event: 'pong' }));
                console.log('Responded to Twelve Data ping'); // Optional logging
                return;
            }
        });

        // Send a custom ping every 30 seconds if no data flows
        this.twelveKeepaliveInterval = setInterval(() => {
            if (this.twelve_ws.readyState === WebSocket.OPEN) {
                this.twelve_ws.ping(); // Send a WebSocket-level ping (no payload needed)
                console.log('Sent client-side ping to Twelve Data');
            }
        }, 30000);

        this.twelve_ws.on('close', () => {
            console.log('Disconnected from Twelve Data WebSocket. Reconnecting in 5 seconds...');
            clearInterval(this.twelveKeepaliveInterval);
            this.stopSymbolRotation();
            this.reconnectTimeout = setTimeout(() => this.connectToTwelveData(), 5000);
        });

        this.twelve_ws.on('error', (err) => {
            console.error('Twelve Data WebSocket error:', err.message);
        });
    }
    
    startSymbolRotation() {
        if (this.rotationInterval) clearInterval(this.rotationInterval);

        const rotate = () => {
            
            if (!this.twelve_ws || this.twelve_ws.readyState !== WebSocket.OPEN) return;

            const symbolArray = Array.from(this.masterSymbolList);
            if (symbolArray.length === 0) {
                if (this.activeSubscriptions.size > 0) {
                    const symbolsToUnsubscribe = Array.from(this.activeSubscriptions);
                    this.twelve_ws.send(JSON.stringify({ action: 'unsubscribe', params: {symbols: symbolsToUnsubscribe.join(',')} }));
                    this.activeSubscriptions.clear();
                    console.log('Master list empty, unsubscribed from all active symbols.');
                }
                return;
            }
            
            const nextBatch = new Set();
            for (let i = 0; i < Math.min(symbolArray.length, MAX_SYMBOLS_FREE_TIER); i++) {
                const symbol = symbolArray[this.rotationIndex];
                nextBatch.add(symbol);
                this.rotationIndex = (this.rotationIndex + 1) % symbolArray.length;
            }
            
            const symbolsToUnsubscribe = [...this.activeSubscriptions].filter(s => !nextBatch.has(s));
            const symbolsToSubscribe = [...nextBatch].filter(s => !this.activeSubscriptions.has(s));

            if (symbolsToUnsubscribe.length > 0) {
                console.log(JSON.stringify({ action: 'unsubscribe', params: {symbols: symbolsToUnsubscribe.join(',')} }));
                this.twelve_ws.send(JSON.stringify({ action: 'unsubscribe', params: {symbols: symbolsToUnsubscribe.join(',')} }));
            }
            if (symbolsToSubscribe.length > 0) {
                console.log(JSON.stringify({ action: 'subscribe', params: {symbols: symbolsToSubscribe.join(',')} }));
                this.twelve_ws.send(JSON.stringify({ action: 'subscribe', params: {symbols: symbolsToSubscribe.join(',')} }));
            }

            this.activeSubscriptions = nextBatch;
            console.log(`Rotated subscriptions. Active symbols: ${Array.from(this.activeSubscriptions).join(', ')}`);
        };

        rotate();
        this.rotationInterval = setInterval(rotate, ROTATION_INTERVAL_MS);
    }
    
    stopSymbolRotation() {
        if (this.rotationInterval) clearInterval(this.rotationInterval);
        this.rotationInterval = null;
    }
    
    // handleMessage, handleSubscribe, handleDisconnect, broadcastPriceUpdate, etc. remain the same as the improved Finnhub version
    // ... (No changes needed for the rest of the WSServer class methods from the last Finnhub update) ...
    handleMessage(ws, message) {
        try {
            const { type, clientId, symbols } = JSON.parse(message);
            switch (type) {
                case 'register':
                    this.clients.set(ws, clientId);
                    console.log(`Client ${clientId} registered`);
                    break;
                case 'subscribe':
                    this.handleSubscribe(ws, symbols);
                    break;
                default:
                    console.warn('Unknown message type:', type);
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    }

    handleSubscribe(ws, symbols) {
        const clientSubs = this.clientSubscriptions.get(ws);
        if (!clientSubs) return;
        
        symbols.forEach(symbol => {
            clientSubs.add(symbol);
            this.masterSymbolList.add(symbol);
        });
        
        console.log(`Client ${this.clients.get(ws)} requested subscriptions for: ${symbols.join(', ')}. Master list size: ${this.masterSymbolList.size}`);
    }

    handleDisconnect(ws) {
        const clientId = this.clients.get(ws);
        const clientSubs = this.clientSubscriptions.get(ws);

        if (clientSubs) {
            clientSubs.forEach(symbol => {
                let isStillNeeded = false;
                for (const [clientWs, subs] of this.clientSubscriptions.entries()) {
                    if (clientWs !== ws && subs.has(symbol)) {
                        isStillNeeded = true;
                        break;
                    }
                }
                if (!isStillNeeded) {
                    this.masterSymbolList.delete(symbol);
                }
            });
        }
        
        this.clients.delete(ws);
        this.clientSubscriptions.delete(ws);

        if (this.rotationIndex >= this.masterSymbolList.size) {
            this.rotationIndex = 0;
        }

        console.log(`Client ${clientId} disconnected. Master list size: ${this.masterSymbolList.size}`);
    }
    
    broadcastPriceUpdate(symbol, price) {
        const timestamp = new Date().toISOString();
        for (const [ws, subs] of this.clientSubscriptions.entries()) {
            if (subs.has(symbol) && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'priceUpdate', symbol, price, timestamp }));
            }
        }
    }

    async updateMarginStatusForSubscribers(symbol) {
        const processedClients = new Set();
        for (const [ws, subs] of this.clientSubscriptions.entries()) {
            if (subs.has(symbol) && ws.readyState === WebSocket.OPEN) {
                const clientId = this.clients.get(ws);
                if (clientId && !processedClients.has(clientId)) {
                    processedClients.add(clientId);
                    try {
                        const marginStatus = await calculateMarginStatus(clientId);
                        if (marginStatus) {
                            ws.send(JSON.stringify({ type: 'marginUpdate', ...marginStatus }));
                        }
                    } catch (error) {
                        console.error(`Failed to calculate margin for client ${clientId}:`, error.message);
                    }
                }
            }
        }
    }
    
    async storeMarketPrice(symbol, price) {
        const timestamp = new Date().toISOString();
        const stmt = `
            INSERT INTO market_data (symbol, current_price, timestamp)
            VALUES (?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                current_price = excluded.current_price,
                timestamp = excluded.timestamp
        `;
        return new Promise((resolve) => {
            db.run(stmt, [symbol, price, timestamp], (err) => {
                if (err) console.error('Failed to upsert market data:', err.message);
                resolve();
            });
        });
    }

    shutdown() {
        console.log('[WS Server] Shutting down');
        if (this.twelve_ws) {
            this.twelve_ws.removeAllListeners();
            try {
            this.twelve_ws.terminate(); // force close if available
            } catch (e) {
            this.twelve_ws.close();
            }
        }

        clearInterval(this.twelveKeepaliveInterval);
        clearInterval(this.rotationInterval);
        clearTimeout(this.reconnectTimeout); // track timeout
        }
}

module.exports = WSServer;