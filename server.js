const express = require('express');
const cors = require('cors');
const fetch = require('./fetch-wrapper.js').default;

const app = express();
const PORT = 8000;

app.use(cors());

// Serve static files from public directory
app.use(express.static('public'));

app.get('/api/kline', async (req, res) => {
  const symbol = req.query.symbol;
  const period = req.query.period;
  const limit = req.query.limit;
  if (!symbol || !period || !limit) {
    return res.status(400).json({ error: 'Missing required query parameters: symbol, period, limit' });
  }

  // Map period to Binance interval
  const interval = period;

  // Binance API expects symbol without underscore, e.g. BTCUSDT
  const binanceSymbol = symbol.replace('_', '');

  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json({ data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Binance API' });
  }
});

app.get('/api/ticker', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query parameter: symbol' });
  }

  const binanceSymbol = symbol.replace('_', '');

  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json({ data: [data] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch ticker data from Binance API' });
  }
});

// Fallback route to serve index.html for SPA
const path = require('path');
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Proxy server running on http://localhost:' + PORT);
});
