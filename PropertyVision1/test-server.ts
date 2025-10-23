import 'dotenv/config';
import express from 'express';
import cors from 'cors';

console.log('🚀 Starting test server...');

const app = express();
app.use(cors());
app.use(express.json());

console.log('✅ Express app created');

app.get('/api/health', (req, res) => {
  console.log('📊 Health check requested');
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/test', (req, res) => {
  console.log('🧪 Test endpoint requested');
  res.json({ message: 'Test server is working!' });
});

const PORT = 3001;
const HOST = '0.0.0.0';

console.log(`🌟 Starting server on http://${HOST}:${PORT}`);

app.listen(PORT, HOST, () => {
  console.log(`✅ Test server running on http://${HOST}:${PORT}`);
  console.log(`📊 Health: http://${HOST}:${PORT}/api/health`);
  console.log(`🧪 Test: http://${HOST}:${PORT}/api/test`);
});
