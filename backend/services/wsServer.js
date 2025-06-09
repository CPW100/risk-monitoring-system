/**
 * @file This module defines the WebSocket server (WSServer) class.
 * @description The WSServer is responsible for managing WebSocket connections from end-user clients.
 * It also establishes and maintains its own WebSocket connection to the Twelve Data real-time price feed.
 * Its core purpose is to multiplex data: it subscribes to symbols based on client demand, receives price updates,
 * broadcasts them to relevant clients, and triggers real-time margin calculations.
 */

const WebSocket = require('ws');
const db = require('../db/db_init');
const { calculateMarginStatus } = require('./marginService');

// --- Configuration for Twelve Data API ---
// Store the API key in a constant for clarity and ease of maintenance.
const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4';
const MAX_SYMBOLS_FREE_TIER = 8; // Twelve Data's free tier limit is 8 credits/symbols
const ROTATION_INTERVAL_MS = 0.5 * 60 * 1000; // Rotate symbols every 2 minutes

class WSServer {
/**
 * Initializes a new instance of the WSServer class.
 * 
 * @param {Object} options - Configuration options for the WebSocket server.
 * 
 * This constructor sets up a WebSocket server to handle connections from clients.
 * It establishes mappings to track connected clients and their subscribed symbols.
 * Additionally, it initializes the connection to the Twelve Data WebSocket for receiving
 * real-time price data. The constructor also sets up event listeners for new client connections,
 * message handling, and client disconnections.
 */

    constructor(options) {
        // Initialize the client-facing WebSocket server.
        this.server = new WebSocket.Server(options);
        
        // --- State Management ---
        // Map to store connected client WebSockets and their associated client IDs. <WebSocket, string>
        this.clients = new Map();
        // Map to track which symbols each client WebSocket is subscribed to. <WebSocket, Set<string>>
        this.clientSubscriptions = new Map();

        // --- Symbol Rotation and Upstream Connection State ---
        // A master set of ALL symbols requested by ALL connected clients.
        this.masterSymbolList = new Set();
        // The set of symbols we are CURRENTLY subscribed to on the Twelve Data feed. Limited by MAX_SYMBOLS_FREE_TIER.
        this.activeSubscriptions = new Set();
        // Holds the setInterval instance for the symbol rotation logic.
        this.rotationInterval = null;
        // An index to keep track of our position in the masterSymbolList for rotation.
        this.rotationIndex = 0;
        // Interval for sending keep-alive pings to the Twelve Data server.
        this.twelveKeepaliveInterval = null;
        
        // The WebSocket instance for the connection to the Twelve Data service.
        this.twelve_ws = null;
        // Immediately attempt to connect to the upstream data provider upon instantiation.
        this.connectToTwelveData();

        // Set up event listeners for the client-facing server.
        this.server.on('connection', (ws) => {
            console.log('New client WebSocket connection');
            this.clientSubscriptions.set(ws, new Set());
            ws.on('message', (message) => this.handleMessage(ws, message));
            ws.on('close', () => this.handleDisconnect(ws));
        });
    }

    /**
     * Establishes and manages the WebSocket connection to the Twelve Data service.
     * Includes logic for message handling, keep-alive, and automatic reconnection.
     */
    connectToTwelveData() {
        this.twelve_ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TWELVE_DATA_API_KEY}`);

        // --- Event Handlers for Twelve Data WebSocket ---
        this.twelve_ws.on('open', () => {
            console.log('Connected to Twelve Data WebSocket.');
            // Once connected, start the symbol rotation process.
            this.startSymbolRotation();
        });

        this.twelve_ws.on('message', (message) => {
            const data = JSON.parse(message);
            // Handle real-time price updates.
            if (data.event === 'price') {
                const { symbol, price } = data;
                console.log(`Received price update for ${symbol}: ${price}`);

                // Persist the new price, broadcast it, and trigger margin updates.
                this.storeMarketPrice(symbol, price);
                this.broadcastPriceUpdate(symbol, price);
                this.updateMarginStatusForSubscribers(symbol);
            }
            // Handle the server's keep-alive mechanism by responding to pings.
            if (data.event === 'ping') {
                this.twelve_ws.send(JSON.stringify({ event: 'pong' }));
                console.log('Responded to Twelve Data ping'); // Optional logging
                return;
            }
        });

        // Implement a client-side keep-alive to ensure the connection remains active.
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
            // Implement a simple exponential retry mechanism.
            this.reconnectTimeout = setTimeout(() => this.connectToTwelveData(), 5000);
        });

        this.twelve_ws.on('error', (err) => {
            console.error('Twelve Data WebSocket error:', err.message);
        });
    }
    
    /**
     * Implements the core symbol rotation logic.
     * This function periodically changes the active subscriptions to work around the API's free-tier limit,
     * allowing the server to monitor a larger set of symbols over time than it can subscribe to at once.
     */
    startSymbolRotation() {
        if (this.rotationInterval) clearInterval(this.rotationInterval);

        /**
         * Implements the core symbol rotation logic.
         * This function is called periodically to change the active subscriptions to work around the API's free-tier limit,
         * allowing the server to monitor a larger set of symbols over time than it can subscribe to at once.
         *
         * The logic is as follows:
         * 1. If there are no symbols in the master list, unsubscribe from all active symbols and clear the active subscriptions set.
         * 2. Otherwise, take the next `MAX_SYMBOLS_FREE_TIER` symbols from the master list, wrapping around to the start if necessary.
         * 3. Find the symbols that are currently subscribed but not in the next batch, and unsubscribe from them.
         * 4. Find the symbols that are in the next batch but not currently subscribed, and subscribe to them.
         * 5. Update the active subscriptions set with the new batch of symbols.
         */
        const rotate = () => {
            
            if (!this.twelve_ws || this.twelve_ws.readyState !== WebSocket.OPEN) return;

            // If no symbols are needed, ensure we unsubscribe from any lingering active subscriptions.
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
            
            // Determine the next batch of symbols to subscribe to.
            const nextBatch = new Set();
            for (let i = 0; i < Math.min(symbolArray.length, MAX_SYMBOLS_FREE_TIER); i++) {
                const symbol = symbolArray[this.rotationIndex];
                nextBatch.add(symbol);
                this.rotationIndex = (this.rotationIndex + 1) % symbolArray.length;
            }
            
            const symbolsToUnsubscribe = [...this.activeSubscriptions].filter(s => !nextBatch.has(s));
            const symbolsToSubscribe = [...nextBatch].filter(s => !this.activeSubscriptions.has(s));

            // Send unsubscribe and subscribe messages only if there are changes.
            if (symbolsToUnsubscribe.length > 0) {
                console.log(JSON.stringify({ action: 'unsubscribe', params: {symbols: symbolsToUnsubscribe.join(',')} }));
                this.twelve_ws.send(JSON.stringify({ action: 'unsubscribe', params: {symbols: symbolsToUnsubscribe.join(',')} }));
            }
            if (symbolsToSubscribe.length > 0) {
                console.log(JSON.stringify({ action: 'subscribe', params: {symbols: symbolsToSubscribe.join(',')} }));
                this.twelve_ws.send(JSON.stringify({ action: 'subscribe', params: {symbols: symbolsToSubscribe.join(',')} }));
            }

            // Update the state of our active subscriptions.
            this.activeSubscriptions = nextBatch;
            console.log(`Rotated subscriptions. Active symbols: ${Array.from(this.activeSubscriptions).join(', ')}`);
        };

        rotate();
        this.rotationInterval = setInterval(rotate, ROTATION_INTERVAL_MS);
    }
    
    /**
     * Stops the symbol rotation process by clearing the interval timer.
     * This effectively pauses the rotation of active subscriptions, ensuring
     * that no further subscription updates occur until rotation is restarted.
     */
    stopSymbolRotation() {
        if (this.rotationInterval) clearInterval(this.rotationInterval);
        this.rotationInterval = null;
    }
    
    /**
     * Handles incoming WebSocket messages, parsing the message type and executing
     * the appropriate logic for each type. Supports registration and subscription
     * requests from clients.
     *
     * @param {WebSocket} ws - The WebSocket connection from which the message was received.
     * @param {string} message - The raw message data received over the WebSocket.
     */
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

    /**
     * Handles a subscription request from a client, adding the requested symbols to both
     * the client's subscription list and the master list of all symbols needed by connected clients.
     * If a symbol is already present in the master list, it is not duplicated.
     * @param {WebSocket} ws - The WebSocket connection from which the subscription request was received.
     * @param {string[]} symbols - The symbols the client wishes to subscribe to.
     */
    handleSubscribe(ws, symbols) {
        const clientSubs = this.clientSubscriptions.get(ws);
        if (!clientSubs) return;
        
        symbols.forEach(symbol => {
            clientSubs.add(symbol);
            this.masterSymbolList.add(symbol);
        });
        
        console.log(`Client ${this.clients.get(ws)} requested subscriptions for: ${symbols.join(', ')}. Master list size: ${this.masterSymbolList.size}`);
    }

    /**
     * Handles the disconnection of a client WebSocket.
     * 
     * This function performs cleanup operations when a client disconnects from the server.
     * It removes the client from the clients map and clientSubscriptions map.
     * For each symbol the client was subscribed to, it checks if any other clients are still subscribed.
     * If no other clients need the symbol, it removes the symbol from the masterSymbolList.
     * 
     * The function also ensures the rotation index is reset if it exceeds the size of the masterSymbolList.
     *
     * @param {WebSocket} ws - The WebSocket connection that has been closed.
     */
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
    
    /**
     * Broadcasts a price update to all connected clients that are subscribed to the specified symbol.
     * @param {string} symbol - The symbol for which the price update is being broadcast.
     * @param {number} price - The new price for the symbol.
     */
    broadcastPriceUpdate(symbol, price) {
        const timestamp = new Date().toISOString();
        for (const [ws, subs] of this.clientSubscriptions.entries()) {
            if (subs.has(symbol) && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'priceUpdate', symbol, price, timestamp }));
            }
        }
    }

    /**
     * Updates the margin status for all connected clients subscribed to a given symbol.
     * For each client with an active subscription to the specified symbol:
     * - Calculates the client's margin status.
     * - Sends the margin status update to the client.
     * 
     * @param {string} symbol - The symbol for which the margin status updates are triggered.
     */
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
    
    /**
     * Persists a given symbol's current price to the database.
     * If the symbol already exists in the database, updates its current price and timestamp.
     * If the symbol does not exist, inserts a new row with the given price and timestamp.
     * 
     * @param {string} symbol - The symbol for which the price is stored.
     * @param {number} price - The price for the symbol.
     * @returns {Promise<void>} A promise that resolves once the price has been stored.
     */
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

    /**
     * Cleans up all resources used by the WebSocket server.
     * 
     * Called when the server is shutting down.
     * 
     * @returns {void}
     */
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