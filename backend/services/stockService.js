/**
 * @file stockService.js
 * @description This module is responsible for fetching real-time stock price data from the Twelve Data external API.
 * It encapsulates the API logic, including handling API keys, making requests, and robustly processing responses.
 */

const axios = require('axios');

// --- Configuration ---
// Store the API key as a constant for easy management.
const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4'; 

/**
 * Fetches the current price for a given stock symbol from the Twelve Data API.
 * * @param {string} symbol The stock or crypto symbol to fetch (e.g., 'AAPL', 'BTC/USD').
 * @returns {Promise<number|null>} A promise that resolves to the numerical price if successful, or null if the price cannot be fetched or is invalid.
 * @throws {Error} Throws a specific error if the API rate limit is exceeded (HTTP 429), allowing the caller to implement retry or backoff logic.
 */
async function fetchStockPrice(symbol) {
  try {
    // Make an asynchronous GET request to the Twelve Data '/price' endpoint.
    const response = await axios.get('https://api.twelvedata.com/price', {
      params: {
        symbol,
        apikey: TWELVE_DATA_API_KEY,
      },
    });

    // Check for a successful HTTP status and that the expected 'price' field exists in the response data.
    if (response.status === 200 && response.data && response.data.price) {
      // The price from the API is a string; parse it into a floating-point number for calculations.
      const price = parseFloat(response.data.price);
      
      // Add a sanity check to ensure the parsed price is a valid number.
      if (isNaN(price)) {
        console.warn(`Invalid price data received for ${symbol}:`, response.data.price);
        return null;
      }
      return price;
    } else {
      // Log a warning if the API returns a successful status code but the data structure is not what we expect.
      console.warn(`Twelve Data API returned unexpected data for ${symbol}`, response.data);
      // Specifically check the response body for a rate limit error code, as some APIs send a 200 OK with an error object.
      if (response.data?.code === 429) {
          throw new Error(`API rate limit exceeded for symbol ${symbol}`);
      }
      return null;
    }
  } catch (err) {
      // --- Error Handling ---
      // This block catches exceptions, such as network failures or non-2xx HTTP status codes.
      // Check if the error is an API rate limit error (HTTP 429).
      if (err.response && err.response.status === 429) {
        throw new Error(`API rate limit exceeded for symbol ${symbol}`);
      }
      // For all other errors, log the issue and return null to prevent crashing the application.
      console.error(`Error fetching stock price for ${symbol}:`, err.message);
      return null;
  }
}

// Export the function to make it available for use in other modules.
module.exports = { fetchStockPrice };