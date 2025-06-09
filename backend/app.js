/**
 * @file This file sets up the primary REST API server using Express.
 * It defines endpoints for fetching client data, positions, calculating margin status,
 * retrieving market data, and providing historical chart data with a caching layer.
 */
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const db = require('./db/db_init');
const { calculateMarginStatus } = require('./services/marginService');
require('dotenv').config();

const app = express();
const PORT = 5000;

const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4';
// Define a cache invalidation period (12 hours) for historical chart data.
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

app.use(cors({
  origin: allowedOrigins, 
  credentials: true
}));
app.use(express.json());


/**
 * @route GET /api/clients
 * @description Fetches a list of all clients.
 */
app.get('/api/clients', (req, res) => {
    db.all('SELECT * FROM clients', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


/**
 * @route GET /api/positions/:clientId
 * @description Fetches all trading positions for a specific client.
 * @param {string} clientId - The UUID of the client.
 */
app.get('/api/positions/:clientId', (req, res) => {
    db.all(
        `SELECT * FROM positions WHERE client_id = ?`,
        [req.params.clientId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});


/**
 * @route GET /api/margin-status/:clientId
 * @description Calculates and returns the real-time margin status for a client.
 * @param {string} clientId - The UUID of the client.
 */
app.get('/api/margin-status/:clientId', async (req, res) => {
    try {
        const status = await calculateMarginStatus(req.params.clientId);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/**
 * @route GET /api/market-data
 * @description Fetches cached real-time market data for one or more symbols.
 * @query {string} symbols - A comma-separated list of symbols to fetch.
 */
app.get('/api/market-data', (req, res) => {
    const { symbols } = req.query;
    let query = 'SELECT symbol, current_price, timestamp FROM market_data';
    if (symbols) {
        const placeholders = symbols.split(',').map(() => '?').join(',');
        query += ` WHERE symbol IN (${placeholders})`;
    }
    const params = symbols ? symbols.split(',') : [];
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Error fetching market data:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json(rows);
    });
}); 


/**
 * @route GET /api/chart-data
 * @description Provides historical time-series data for a given symbol and interval.
 * Implements a cache-aside strategy to reduce API calls to the data provider.
 * @query {string} symbol - The financial symbol (e.g., AAPL).
 * @query {string} interval - The time interval ('1day', '1week', etc.).
 */
app.get('/api/chart-data', async (req, res) => {
    const symbol = req.query.symbol;
    const interval = req.query.interval;

    console.log(`Fetching chart data for symbol: ${symbol}, interval: ${interval}`);
    // Map user-friendly intervals to the specific parameters required by the Twelve Data API.
    const intervalMap = {
        '1day': { apiInterval: '1day', outputsize: 365 },
        '1week': { apiInterval: '1week', outputsize: 52 },
        '1month': { apiInterval: '1month', outputsize: 12 },
        '1year': { apiInterval: '1month', outputsize: 12 }
    };
    const mapping = intervalMap[interval];
    if (!mapping) {
        return res.status(400).json({ error: 'Invalid interval. Use 1day, 1week, 1month, or 1year.' });
    }
    try {
        // --- Cache Checking Logic ---
        // Check when this data was last updated in our local cache.
        const now = Date.now();
        const meta = await new Promise((resolve, reject) => {
            db.get(`SELECT last_updated FROM chart_metadata WHERE symbol = ? AND interval = ?`, [symbol, interval], (err, row) => err ? reject(err) : resolve(row));
        });
        // Determine if we need to fetch fresh data.
        const shouldFetch = !meta || (now - new Date(meta.last_updated).getTime() > TWELVE_HOURS_MS);

        if (shouldFetch) {
            // --- API Fetch and Cache Update ---
            try {
                console.log(`Fetching chart data using TWELVE API for symbol: ${symbol}, interval: ${interval}`);
                const response = await axios.get('https://api.twelvedata.com/time_series', {
                    params: {
                        symbol,
                        interval: mapping.apiInterval,
                        outputsize: mapping.outputsize,
                        apikey: TWELVE_DATA_API_KEY
                    }
                });
                if (response.data.status === "error") {
                    console.error(`Error fetching chart data for symbol: ${symbol}, interval: ${interval}`, response.data.message);
                    return res.status(400).json({ error: response.data.message });
                }

                // Transform the API response into the desired format and sort chronologically.
                const values = response.data.values.map(d => ({
                    timestamp: new Date(d.datetime).getTime(),
                    open: parseFloat(d.open),
                    high: parseFloat(d.high),
                    low: parseFloat(d.low),
                    close: parseFloat(d.close),
                    volume: parseFloat(d.volume)
                })).reverse();

                // --- Database Transaction to Update Cache ---
                db.serialize(() => {
                    db.run(`DELETE FROM chart_data WHERE symbol = ? AND interval = ?`, [symbol, interval]);
                    const insert = db.prepare(`INSERT INTO chart_data (symbol, interval, timestamp, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                    values.forEach(row => {
                        insert.run(symbol, interval, row.timestamp, row.open, row.high, row.low, row.close, row.volume);
                    });
                    insert.finalize();
                    // Update the metadata to reflect the new cache time.
                    db.run(`INSERT INTO chart_metadata (symbol, interval, last_updated) VALUES (?, ?, ?) ON CONFLICT(symbol, interval) DO UPDATE SET last_updated = excluded.last_updated`, [symbol, interval, new Date().toISOString()]);
                });
                return res.json(values);
            } catch (apiErr) {
                console.error(`Twelve Data API error for ${symbol} (${interval}):`, apiErr.message);
                return res.status(500).json({ error: 'Failed to fetch chart data from API.' });
            }
        } else {
            // --- Serve From Cache ---
            console.log(`Retrieving cached chart data for symbol: ${symbol}, interval: ${interval}`);
            db.all(`SELECT timestamp, open, high, low, close, volume FROM chart_data WHERE symbol = ? AND interval = ? ORDER BY timestamp ASC`, [symbol, interval], (err, rows) => {
                if (err) return res.status(500).json({ error: 'Failed to retrieve cached chart data.' });
                return res.json(rows);
            });
        }
    } catch (err) {
        console.error('Unexpected server error:', err);
        res.status(500).json({ error: 'Unexpected error.' });
    }
});

/**
 * @route POST /api/login
 * @description A basic endpoint for user authentication.
 * @note This is a simplistic implementation for demonstration; production apps should use hashed passwords.
 */
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    const query = `SELECT client_id, name, email FROM clients WHERE email = ? AND password = ?`;
    db.get(query, [email, password], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        if (!row) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        res.json({
            message: 'Login successful',
            client: row
        });
    });
});

// --- Server Startup ---
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`REST API server running on port ${PORT}`);
    });
}

module.exports = app;