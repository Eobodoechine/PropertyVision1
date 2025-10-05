import express from 'express';
import fetch from 'node-fetch';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const app = express();
app.use(express.json());

// Shared key authentication middleware
function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const provided = req.header('x-proxy-key');
  const expected = process.env.PROXY_SHARED_KEY;

  if (!provided) {
    console.log(JSON.stringify({ event: 'auth.failed', reason: 'missing_key', provided: null }));
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (provided !== expected) {
    console.log(JSON.stringify({
      event: 'auth.failed',
      reason: 'key_mismatch',
      provided_length: provided.length,
      expected_length: expected?.length,
      provided_prefix: provided.substring(0, 8),
      expected_prefix: expected?.substring(0, 8)
    }));
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

app.post('/geocode', auth, async (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'country:US');
  url.searchParams.set('region', 'us');
  url.searchParams.set('key', process.env.GMAPS_KEY!);

  const t0 = Date.now();
  try {
    const r = await fetch(url.toString(), { timeout: 8000 });
    const j = await r.json();

    // structured log
    console.log(JSON.stringify({
      event: 'proxy.response',
      component: 'geo-proxy',
      http: { status: r.status },
      timingMs: { total: Date.now() - t0 }
    }));

    return res.status(200).json(j); // raw Maps JSON (no modification)
  } catch (e:any) {
    console.log(JSON.stringify({
      event: 'proxy.error',
      component: 'geo-proxy',
      msg: e.message,
      timingMs: { total: Date.now() - t0 }
    }));
    return res.status(502).json({ error: 'upstream-failed', message: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => console.log('geo-proxy up'));
