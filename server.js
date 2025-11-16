const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

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
        next();
    });
};

app.post('/api/outputGemini', async (req, res) => {
    try {
        const { acceptanceCriteria, aiAgent, outputFormat } = req.body;
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

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

        const response = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                acceptanceCriteria,
                aiAgent,
                outputFormat
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
