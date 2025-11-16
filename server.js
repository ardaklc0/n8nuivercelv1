const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/convert', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
