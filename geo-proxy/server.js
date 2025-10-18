const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'healthy', service: 'geo-proxy' });
});

// Geocoding proxy endpoint
app.get('/geocode', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Address parameter required' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: 'Geocoding request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🌍 Geo-proxy listening on port ${PORT}`);
});
