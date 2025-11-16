const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory store for async Gemini outputs keyed by client token
// Note: On serverless platforms this is ephemeral; use a DB/kv for production.
const outputStore = new Map();
// SSE clients per client token (Map<string, Set<res>>)
const sseClients = new Map();

// Middleware
const allowedOrigins = [
  'https://n8nuivercelv1.vercel.app', 
  'https://n8nuivercelv1-git-main-ardaklc0s-projects.vercel.app', 
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://ardaklc0.github.io'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(__dirname));

console.log('Env check on boot:', {
    has_JWT_SECRET: !!process.env.JWT_SECRET,
    JWT_SECRET_LENGTH: process.env.JWT_SECRET ? String(process.env.JWT_SECRET).length : 0,
    VERCEL_ENV: process.env.VERCEL_ENV || 'unknown'
});

const verifyJwt = (req, res, next) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({ error: 'Server configuration error: JWT secret not set' });
    }

    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.headers['x-client-token']) {
        token = req.headers['x-client-token'];
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
        req.user = decoded;
        req.token = token;
        next();
    });
};

app.post('/api/convert', verifyJwt, async (req, res) => {
    try {
        const { acceptanceCriteria, aiAgent, outputFormat } = req.body;
        
        const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
        const jwtSecret = process.env.JWT_SECRET;

        if (!n8nWebhookUrl) {
            return res.status(500).json({ error: 'Server configuration error: N8N_WEBHOOK_URL not set' });
        }

        const headers = {
            'Content-Type': 'application/json'
        };

        if (jwtSecret) {
            const token = jwt.sign({}, jwtSecret);
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Provide callbackUrl and clientToken so n8n can report back when done
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'];
        const baseUrl = `${proto}://${host}`;

        const response = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                acceptanceCriteria,
                aiAgent,
                outputFormat,
                callbackUrl: `${baseUrl}/api/gemini-callback`,
                clientToken: req.token
            })
        });

        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            data = { message: text, success: response.ok };
        }
        
        res.json(data);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// Polling endpoint for client to fetch Gemini output when ready
app.get('/api/gemini-output', verifyJwt, (req, res) => {
    const token = req.token;
    const data = outputStore.get(token);
    if (!data) {
        return res.status(404).json({ status: 'pending' });
    }
    try {
        console.log('[gemini-output] responding for token:', token.slice(0, 12) + '...', 'payload keys:', Object.keys(data));
    } catch (_) {}
    return res.status(200).json(data);
});

// SSE endpoint: clients subscribe to receive output as soon as it's ready
app.get('/api/gemini-events', (req, res) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).end('JWT secret missing');
    const token = (req.query.token || '').toString();
    if (!token) return res.status(401).end('token required');
    try {
        jwt.verify(token, jwtSecret);
    } catch {
        return res.status(401).end('invalid token');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Allow CORS for allowed origins is handled by cors() middleware
    res.flushHeaders && res.flushHeaders();

    // Send a comment to keep connection alive periodically
    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 25000);

    // If we already have data, send immediately and close
    const existing = outputStore.get(token);
    if (existing) {
        res.write(`data: ${JSON.stringify(existing)}\n\n`);
        clearInterval(keepAlive);
        return res.end();
    }

    // Register client
    if (!sseClients.has(token)) sseClients.set(token, new Set());
    const set = sseClients.get(token);
    set.add(res);

    req.on('close', () => {
        clearInterval(keepAlive);
        set.delete(res);
        if (set.size === 0) sseClients.delete(token);
    });
});

// Callback endpoint for n8n to post final Gemini output
// Expected body: { text?: string, message?: string, output?: any, data?: any, clientToken: string }
app.post('/api/gemini-callback', express.json(), (req, res) => {
    try {
        const { clientToken, ...rest } = req.body || {};
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            return res.status(500).json({ error: 'Server configuration error: JWT secret not set' });
        }
        if (!clientToken || typeof clientToken !== 'string') {
            return res.status(400).json({ error: 'clientToken required' });
        }
        try {
            jwt.verify(clientToken, jwtSecret);
        } catch {
            return res.status(401).json({ error: 'Unauthorized: Invalid clientToken' });
        }
        const payload = rest && Object.keys(rest).length ? rest : { message: 'OK' };
        try {
            console.log('[gemini-callback] received payload keys:', Object.keys(payload), 'for token:', (clientToken || '').slice(0, 12) + '...');
        } catch (_) {}
        outputStore.set(clientToken, payload);
        // Push via SSE if clients are connected
        const clients = sseClients.get(clientToken);
        if (clients && clients.size) {
            const data = `data: ${JSON.stringify(payload)}\n\n`;
            for (const clientRes of clients) {
                try { clientRes.write(data); } catch {}
                try { clientRes.end(); } catch {}
            }
            sseClients.delete(clientToken);
        }
        return res.json({ ok: true });
    } catch (e) {
        console.error('Callback error:', e);
        return res.status(500).json({ error: 'Callback failed' });
    }
});

// GET /api/get-token removed to prevent public minting via browser

// Added POST variant that validates a server-side client secret
app.post('/api/get-token', (req, res) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({ error: 'Server configuration error: JWT secret not set' });
    }

    const serverClientSecret = process.env.CLIENT_SECRET;
    if (!serverClientSecret) {
        return res.status(500).json({ error: 'Server configuration error: CLIENT_SECRET not set' });
    }

    const headerSecret = typeof req.headers['x-client-secret'] === 'string' ? req.headers['x-client-secret'] : undefined;
    const bodySecret = req.body && typeof req.body.clientSecret === 'string' ? req.body.clientSecret : undefined;
    const providedSecret = (headerSecret || bodySecret || '').toString().trim();

    if (!providedSecret || providedSecret !== String(serverClientSecret).trim()) {
        return res.status(401).json({ error: 'Unauthorized: Invalid client secret' });
    }

    const token = jwt.sign({ iss: 'n8n-converter-backend' }, jwtSecret, { expiresIn: '15m' });
    return res.json({ token });
});

app.get('/api/debug-env', (req, res) => {
    res.json({
        has_JWT_SECRET: !!process.env.JWT_SECRET,
        JWT_SECRET_LENGTH: process.env.JWT_SECRET ? String(process.env.JWT_SECRET).length : 0,
        VERCEL_ENV: process.env.VERCEL_ENV || 'unknown'
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
