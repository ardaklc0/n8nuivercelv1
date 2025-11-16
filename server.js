const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
  'https://n8nuivercelv1.vercel.app', // Ana Vercel URL'si eklendi
  'https://n8nuivercelv1-git-main-ardaklc0s-projects.vercel.app', 
  'http://localhost:5500',
  'http://127.0.0.1:5500' // 127.0.0.1 eklendi
];

const corsOptions = {
  origin: function (origin, callback) {
    // Eğer istek yapan adres izin verilenler listesindeyse veya bir origin yoksa (örn: sunucu içi istekler) izin ver
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

// Frontend için JWT üreten yeni endpoint
app.get('/api/get-token', (req, res) => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        return res.status(500).json({ error: 'Server configuration error: Secret not set' });
    }
    // Kısa ömürlü bir token oluştur (örn: 15 dakika)
    const token = jwt.sign({ iss: 'n8n-converter-backend' }, jwtSecret, { expiresIn: '15m' });
    res.json({ token });
});

// JWT doğrulama middleware'i
const verifyJwt = (req, res, next) => {
    const jwtSecret = process.env.JWT_SECRET;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
        req.user = decoded;
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

app.get('/api/debug-env', (req, res) => {
    res.json({
        message: "Vercel sunucusunun gördüğü ortam değişkenleri:",
        NODE_ENV: process.env.NODE_ENV,
        HAS_JWT_SECRET: !!process.env.JWT_SECRET, // Değeri göstermeden, sadece var olup olmadığını kontrol eder (true/false)
        HAS_N8N_WEBHOOK_URL: !!process.env.N8N_WEBHOOK_URL,
        JWT_SECRET_LENGTH: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0 // Değerin uzunluğunu gösterir
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
