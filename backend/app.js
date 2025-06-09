const express = require('express');
const axios = require('axios');
const cors = require('cors');
const db = require('./db/db_init');
const { calculateMarginStatus } = require('./services/marginService');

const app = express();
const PORT = 5000;

// UPDATED: Removed Finnhub key, only Twelve Data is needed now
const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

// ... (The rest of the server.js file remains exactly the same as the last version) ...
app.use(cors({
  origin: [ "http://localhost:5173", 'http://192.168.1.83:5173'], 
  credentials: true
}));
app.use(express.json());

app.get('/api/clients', (req, res) => {
    db.all('SELECT * FROM clients', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

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

app.get('/api/margin-status/:clientId', async (req, res) => {
    try {
        const status = await calculateMarginStatus(req.params.clientId);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

app.get('/api/chart-data', async (req, res) => {
    const symbol = req.query.symbol;
    const interval = req.query.interval;

    console.log(`Fetching chart data for symbol: ${symbol}, interval: ${interval}`);
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
        const now = Date.now();
        const meta = await new Promise((resolve, reject) => {
            db.get(`SELECT last_updated FROM chart_metadata WHERE symbol = ? AND interval = ?`, [symbol, interval], (err, row) => err ? reject(err) : resolve(row));
        });
        const shouldFetch = !meta || (now - new Date(meta.last_updated).getTime() > TWELVE_HOURS_MS);
        if (shouldFetch) {
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
                const values = response.data.values.map(d => ({
                    timestamp: new Date(d.datetime).getTime(),
                    open: parseFloat(d.open),
                    high: parseFloat(d.high),
                    low: parseFloat(d.low),
                    close: parseFloat(d.close),
                    volume: parseFloat(d.volume)
                })).reverse();
                db.serialize(() => {
                    db.run(`DELETE FROM chart_data WHERE symbol = ? AND interval = ?`, [symbol, interval]);
                    const insert = db.prepare(`INSERT INTO chart_data (symbol, interval, timestamp, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                    values.forEach(row => {
                        insert.run(symbol, interval, row.timestamp, row.open, row.high, row.low, row.close, row.volume);
                    });
                    insert.finalize();
                    db.run(`INSERT INTO chart_metadata (symbol, interval, last_updated) VALUES (?, ?, ?) ON CONFLICT(symbol, interval) DO UPDATE SET last_updated = excluded.last_updated`, [symbol, interval, new Date().toISOString()]);
                });
                return res.json(values);
            } catch (apiErr) {
                console.error(`Twelve Data API error for ${symbol} (${interval}):`, apiErr.message);
                return res.status(500).json({ error: 'Failed to fetch chart data from API.' });
            }
        } else {
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

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`REST API server running on port ${PORT}`);
    });
}


module.exports = app;