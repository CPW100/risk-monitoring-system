/**
 * @file This service module calculates the margin status for a given client.
 * It orchestrates fetching client portfolio data, retrieving market prices (from cache or a live API),
 * and computes key risk metrics like net equity, margin requirement, and potential margin calls.
 */

const db = require('../db/db_init');
const { fetchStockPrice } = require('./stockService');

/**
 * Asynchronously calculates the complete margin status for a specific client.
 * This function handles database lookups, external API calls with rate limiting,
 * and financial calculations.
 *
 * @param {string} clientId The UUID of the client whose margin status is to be calculated.
 * @returns {Promise<object>} A promise that resolves to an object containing detailed margin status.
 * @throws {Error} Throws an error if any critical database or API operation fails.
 */
async function calculateMarginStatus(clientId) {
    try {
        // --- Step 1: Fetch Client's Portfolio and Loan Data ---

        // Fetch all of the client's positions from the database.
        // Using `new Promise` to wrap the callback-based Node-sqlite3 API for use with async/await.
        const positions = await new Promise((resolve, reject) => {
            db.all(`SELECT symbol, quantity FROM positions WHERE client_id = ?`, [clientId], (err, rows) => err ? reject(err) : resolve(rows));
        });

        // Fetch the client's margin account details, specifically the outstanding loan amount.
        const marginAccount = await new Promise((resolve, reject) => {
            db.get(`SELECT account_id, loan FROM margins WHERE client_id = ?`, [clientId], (err, row) => err ? reject(err) : resolve(row));
        });

        // Safely extract loan amount and account ID, defaulting to 0 and null if no margin account exists.
        const loanAmount = marginAccount ? marginAccount.loan : 0;
        const accountId = marginAccount ? marginAccount.account_id : null;

        // Edge Case: If the client has no positions, calculate equity based only on the loan and return early.
        if (positions.length === 0) {
            const netEquity = -loanAmount;
            return { 
                clientId, positions: [], 
                portfolioValue: 0, 
                loanAmount, 
                netEquity, 
                marginRequirement: 0, 
                marginShortfall: netEquity < 0 ? Math.abs(netEquity) : 0, 
                marginCall: netEquity < 0 && loanAmount > 0, 
                timestamp: new Date().toISOString() 
            };
        }

        // --- Step 2: Fetch Market Prices (Cache-First Approach) ---
        const symbols = positions.map(p => p.symbol);
        const placeholders = symbols.map(() => '?').join(',');
        
        // First, attempt to fetch all required prices from our local market_data table (our cache).
        const prices = await new Promise((resolve, reject) => {
            db.all(`SELECT symbol, current_price FROM market_data WHERE symbol IN (${placeholders})`, symbols, (err, rows) => err ? reject(err) : resolve(rows));
        });

        const priceMap = Object.fromEntries(prices.map(row => [row.symbol, row.current_price]));

        // --- Step 3: Handle Missing Prices via External API with Rate Limiting ---
        // This block demonstrates a robust strategy for handling external API dependencies.

        // Identify which symbols we couldn't find in our local cache.
        const symbolsToFetch = [];
        for (const symbol of symbols) {
            if (priceMap[symbol] === undefined) {
                symbolsToFetch.push(symbol);
            }
        }

        // If there are symbols requiring a price fetch, process them in batches
        // of 8, with a 61-second delay between batches
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
                        // If fetched successfully, add the price to our map for the current calculation.
                        priceMap[symbol] = fetchedPrice;

                        // Update market data
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
       
        // --- Step 4: Perform Financial Calculations ---

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
            positionsWithPrices.push({ 
                symbol: pos.symbol, 
                quantity: pos.quantity, 
                currentPrice: price, positionValue 
            });
        }

        // Standard margin calculation formulas
        const netEquity = portfolioValue - loanAmount;
        const marginRequirement = 0.25 * portfolioValue;
        const marginShortfall = marginRequirement - netEquity;
        const marginCall = marginShortfall > 0;
        
        // --- Step 5: Persist Calculation Results ---

        // If a margin account exists, update it with the latest calculated margin requirement.
        if (accountId) {
             await new Promise((resolve, reject) => {
                db.run(`UPDATE margins SET margin_requirement = ? WHERE account_id = ?`, [marginRequirement, accountId], (err) => err ? reject(err) : resolve());
            });
        }

        // --- Step 6: Return the Final Report ---

        // Return a comprehensive object detailing the client's margin status.
        return { 
            clientId, 
            positions: positionsWithPrices, 
            portfolioValue, 
            loanAmount, 
            netEquity, 
            marginRequirement, 
            marginShortfall, 
            marginCall, 
            timestamp: new Date().toISOString() 
        };
    } catch (error) {
        console.error('Error calculating margin status:', error);
        throw error;
    }
}

// Export the function for use in other parts of the application.
module.exports = { calculateMarginStatus };