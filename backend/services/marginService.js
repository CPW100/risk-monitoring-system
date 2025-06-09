const db = require('../db/db_init');
const { fetchStockPrice } = require('./stockService');

async function calculateMarginStatus(clientId) {
    try {
        const positions = await new Promise((resolve, reject) => {
            db.all(`SELECT symbol, quantity FROM positions WHERE client_id = ?`, [clientId], (err, rows) => err ? reject(err) : resolve(rows));
        });

        const marginAccount = await new Promise((resolve, reject) => {
            db.get(`SELECT account_id, loan FROM margins WHERE client_id = ?`, [clientId], (err, row) => err ? reject(err) : resolve(row));
        });

        const loanAmount = marginAccount ? marginAccount.loan : 0;
        const accountId = marginAccount ? marginAccount.account_id : null;

        if (positions.length === 0) {
            const netEquity = -loanAmount;
            return { clientId, positions: [], portfolioValue: 0, loanAmount, netEquity, marginRequirement: 0, marginShortfall: netEquity < 0 ? Math.abs(netEquity) : 0, marginCall: netEquity < 0 && loanAmount > 0, timestamp: new Date().toISOString() };
        }

        const symbols = positions.map(p => p.symbol);
        const placeholders = symbols.map(() => '?').join(',');
        
        const prices = await new Promise((resolve, reject) => {
            db.all(`SELECT symbol, current_price FROM market_data WHERE symbol IN (${placeholders})`, symbols, (err, rows) => err ? reject(err) : resolve(rows));
        });

        const priceMap = Object.fromEntries(prices.map(row => [row.symbol, row.current_price]));

        // UPDATED: This entire block is new logic to handle API rate limiting

        // Step 1: Collect all symbols that need a price fetch
        const symbolsToFetch = [];
        for (const symbol of symbols) {
            if (priceMap[symbol] === undefined) {
                symbolsToFetch.push(symbol);
            }
        }

        // Step 2: Process the symbols in batches of 8, with a 61-second delay between batches
        if (symbolsToFetch.length > 0) {
            console.log(`Need to fetch prices for ${symbolsToFetch.length} symbols. Throttling requests...`);
            const batchSize = 8;
            for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
                const batch = symbolsToFetch.slice(i, i + batchSize);
                console.log(`Fetching batch ${i/batchSize + 1}: ${batch.join(', ')}`);

                // Fetch the current batch of prices in parallel
                await Promise.all(batch.map(async (symbol) => {
                    const fetchedPrice = await fetchStockPrice(symbol);
                    if (fetchedPrice !== null) {
                        priceMap[symbol] = fetchedPrice;
                        await new Promise((resolve, reject) => {
                            db.run(`INSERT OR REPLACE INTO market_data (symbol, current_price, timestamp) VALUES (?, ?, ?)`, [symbol, fetchedPrice, new Date().toISOString()], (err) => err ? reject(err) : resolve());
                        });
                    } else {
                        console.warn(`Failed to fetch price for symbol: ${symbol}`);
                    }
                }));

                // If there are more batches to process, wait for 61 seconds before the next one
                if (i + batchSize < symbolsToFetch.length) {
                    console.log('Rate limit reached for the minute. Waiting 61 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 61000));
                }
            }
        }
       
        let portfolioValue = 0;
        const positionsWithPrices = [];
        for (const pos of positions) {
            const price = priceMap[pos.symbol];
            if (price === undefined) {
                console.warn(`No price found for symbol: ${pos.symbol}, excluding from calculation.`);
                continue;
            }
            const positionValue = pos.quantity * price;
            portfolioValue += positionValue;
            positionsWithPrices.push({ symbol: pos.symbol, quantity: pos.quantity, currentPrice: price, positionValue });
        }

        const netEquity = portfolioValue - loanAmount;
        const marginRequirement = 0.25 * portfolioValue;
        const marginShortfall = marginRequirement - netEquity;
        const marginCall = marginShortfall > 0;
        
        if (accountId) {
             await new Promise((resolve, reject) => {
                db.run(`UPDATE margins SET margin_requirement = ? WHERE account_id = ?`, [marginRequirement, accountId], (err) => err ? reject(err) : resolve());
            });
        }

        return { clientId, positions: positionsWithPrices, portfolioValue, loanAmount, netEquity, marginRequirement, marginShortfall, marginCall, timestamp: new Date().toISOString() };
    } catch (error) {
        console.error('Error calculating margin status:', error);
        throw error;
    }
}

module.exports = { calculateMarginStatus };