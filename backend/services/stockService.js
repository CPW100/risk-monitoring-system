const axios = require('axios');

// Twelve Data API Key
const TWELVE_DATA_API_KEY = '55144c72562c4bb398c7e99c455a21e4'; 

async function fetchStockPrice(symbol) {
  try {
    // UPDATED: Switched to Twelve Data's /price endpoint
    const response = await axios.get('https://api.twelvedata.com/price', {
      params: {
        symbol,
        apikey: TWELVE_DATA_API_KEY,
      },
    });

    if (response.status === 200 && response.data && response.data.price) {
      const price = parseFloat(response.data.price);
      if (isNaN(price)) {
        console.warn(`Invalid price data for ${symbol}:`, response.data.price);
        return null;
      }
      return price;
    } else {
      console.warn(`Twelve Data API returned unexpected data for ${symbol}`, response.data);
      if (response.data?.code === 429) {
          throw new Error(`API rate limit exceeded for symbol ${symbol}`);
      }
      return null;
    }
  } catch (err) {
    if (err.response && err.response.status === 429) {
      throw new Error(`API rate limit exceeded for symbol ${symbol}`);
    }
    console.error(`Error fetching stock price for ${symbol}:`, err.message);
    return null;
  }
}

module.exports = { fetchStockPrice };