document.addEventListener('DOMContentLoaded', () => {
    const convertBtn = document.getElementById('convert-btn');
    const loader = document.getElementById('loader');
    const outputContainer = document.getElementById('output-container');
    const outputCode = document.getElementById('output-code');
    const outputFrame = document.getElementById('output-frame');
    const renderedPanel = document.getElementById('rendered-panel');
    const acInput = document.getElementById('ac-input');
    const aiAgentSelect = document.getElementById('ai-agent-select');
    const outputFormatSelect = document.getElementById('output-format-select');
    const darkModeSwitch = document.getElementById('darkModeSwitch');
    const themeIcon = document.getElementById('theme-icon');

    const n8nWebhookUrl = 'https://n8nuivercelv1.vercel.app/api/convert';
    const geminiOutputUrl = 'https://n8nuivercelv1.vercel.app/api/gemini-output';
    const geminiEventsUrl = 'https://n8nuivercelv1.vercel.app/api/gemini-events';

    const TOKEN_KEY = 'n8nui_token_cache';
    const TEN_MIN_MS = 10 * 60 * 1000;
    let memoryTokenCache = null;

    const getStorage = () => {
        try {
            const testKey = '__test__';
            sessionStorage.setItem(testKey, '1');
            sessionStorage.removeItem(testKey);
            return sessionStorage;
        } catch (_) {
            return null;
        }
    };
    const loadCachedToken = () => {
        const now = Date.now();
        try {
            const store = getStorage();
            if (store) {
                const raw = store.getItem(TOKEN_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.token && typeof parsed.expiresAt === 'number' && parsed.expiresAt > now) {
                        return parsed;
                    }
                }
            } else if (memoryTokenCache && memoryTokenCache.expiresAt > now) {
                return memoryTokenCache;
            }
        } catch (_) {
            // ignore parse/storage errors
        }
        return null;
    };
    const saveCachedToken = (token) => {
        const data = { token, expiresAt: Date.now() + TEN_MIN_MS - 5000 };
        const store = getStorage();
        try {
            if (store) {
                store.setItem(TOKEN_KEY, JSON.stringify(data));
            } else {
                memoryTokenCache = data;
            }
        } catch (_) {
            memoryTokenCache = data;
        }
        return data;
    };
    const clearCachedToken = () => {
        const store = getStorage();
        try { if (store) store.removeItem(TOKEN_KEY); } catch (_) {}
        memoryTokenCache = null;
    };
    const stopPolling = () => {
        if (window.__geminiPollTimer) {
            clearTimeout(window.__geminiPollTimer);
            window.__geminiPollTimer = null;
        }
    };
    const ensureOutputVisible = () => {
        outputContainer.classList.remove('d-none');
    };
    const isLikelyHTML = (s) => {
        if (typeof s !== 'string') return false;
        if (/^\s*<!doctype html/i.test(s)) return true;
        // Basic heuristic: has both opening and closing tags
        return /<([a-z][\s\S]*?)>/i.test(s) && /<\/[a-z][\s\S]*?>/i.test(s);
    };

    const renderOutput = (content) => {
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        outputCode.textContent = text;
        if (renderedPanel && outputFrame && isLikelyHTML(text)) {
            const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${text}</body></html>`;
            outputFrame.srcdoc = doc;
            renderedPanel.classList.remove('d-none');
        } else if (renderedPanel) {
            renderedPanel.classList.add('d-none');
        }
        ensureOutputVisible();
    };
    const getValidToken = async () => {
        const cached = loadCachedToken();
        if (cached && cached.token) return cached.token;
        const clientSecret = getClientSecret();
        if (!clientSecret) throw new Error('No client access secret provided.');
        const tokenResp = await fetch('https://n8nuivercelv1.vercel.app/api/get-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-client-secret': clientSecret },
            body: JSON.stringify({ clientSecret })
        });
        if (!tokenResp.ok) {
            const err = await tokenResp.json().catch(() => ({}));
            throw new Error(err.error || 'Could not fetch authentication token');
        }
        const payload = await tokenResp.json();
        saveCachedToken(payload.token);
        return payload.token;
    };
    const startPollingGeminiOutput = async (timeoutMs = 10 * 60 * 1000) => {
        stopPolling();
        const start = Date.now();
        const tick = async () => {
            try {
                if (Date.now() - start > timeoutMs) {
                    setOutputText('Still converting... (timeout)');
                    stopPolling();
                    return;
                }
                const token = await getValidToken();
                const resp = await fetch(geminiOutputUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.status === 401) {
                    clearCachedToken();
                    setOutputText('Converting...');
                } else if (resp.ok) {
                    const contentType = resp.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const data = await resp.json();
                        const display =
                            (typeof data === 'string' && data) ||
                            data.text || data.message || data.output || data.data || JSON.stringify(data, null, 2);
                        renderOutput(display);
                    } else {
                        const text = await resp.text();
                        renderOutput(text || '');
                    }
                    stopPolling();
                    return;
                } else {
                    setOutputText('Converting...');
                }
            } catch (_) {
                setOutputText('Converting...');
            }
            window.__geminiPollTimer = setTimeout(tick, 1000);
        };
        renderOutput('Converting...');
        window.__geminiPollTimer = setTimeout(tick, 1000);
    };

    const subscribeGeminiEvents = (token) => {
        try { if (window.__geminiEventSource) { window.__geminiEventSource.close(); } } catch (_) {}
        const url = `${geminiEventsUrl}?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url, { withCredentials: false });
        window.__geminiEventSource = es;
        setOutputText('Converting...');
        es.onmessage = (evt) => {
            try {
                const data = evt.data ? JSON.parse(evt.data) : {};
                const display = (typeof data === 'string' && data) || data.text || data.message || data.output || data.data || JSON.stringify(data, null, 2);
                renderOutput(display || '');
            } catch {
                setOutputText(evt.data || '');
            }
            try { es.close(); } catch (_) {}
        };
        es.onerror = () => {
            try { es.close(); } catch (_) {}
            // Fallback to polling if SSE fails (e.g., network/CDN proxy)
            startPollingGeminiOutput();
        };
        return () => { try { es.close(); } catch (_) {} };
    };
    darkModeSwitch.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        themeIcon.textContent = isDarkMode ? '🌙' : '☀️';
        localStorage.setItem('darkMode', isDarkMode);
    });
    const darkModePreference = localStorage.getItem('darkMode') === 'true';
    if (darkModePreference) {
        document.body.classList.add('dark-mode');
        darkModeSwitch.checked = true;
        themeIcon.textContent = '🌙';
    }
    const getClientSecret = () => {
        // Prompt for the access secret (no persistent storage to avoid tracking prevention).
        const entered = prompt('Enter Access Secret');
        return entered ? entered.trim() : '';
    };
    convertBtn.addEventListener('click', async () => {
        const acText = acInput.value;
        const aiAgent = aiAgentSelect.value;
        const outputFormat = outputFormatSelect.value;
        if (!acText.trim()) {
            alert('Please enter Acceptance Criteria.');
            return;
        }
        loader.classList.remove('d-none');
        outputContainer.classList.add('d-none');
        convertBtn.disabled = true;
        try {
            let cached = loadCachedToken();
            let token = cached ? cached.token : null;
            if (!token) {
                const clientSecret = getClientSecret();
                if (!clientSecret) throw new Error('No client access secret provided.');

                const tokenResp = await fetch('https://n8nuivercelv1.vercel.app/api/get-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-secret': clientSecret
                    },
                    body: JSON.stringify({ clientSecret })
                });
                if (!tokenResp.ok) {
                    const err = await tokenResp.json().catch(() => ({}));
                    throw new Error(err.error || 'Could not fetch authentication token');
                }
                const payload = await tokenResp.json();
                token = payload.token;
                saveCachedToken(token);
            }
            const webhookData = {
                acceptanceCriteria: acText,
                aiAgent: aiAgent,
                outputFormat: outputFormat
            };
            // Prefer SSE for instant updates; fallback to polling if SSE fails
            subscribeGeminiEvents(token);
            let convertResponse = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(webhookData),
            });
            if (convertResponse.status === 401) {
                clearCachedToken();
                const clientSecret = getClientSecret();
                if (!clientSecret) throw new Error('No client access secret provided.');
                const tokenResp = await fetch('https://n8nuivercelv1.vercel.app/api/get-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-secret': clientSecret
                    },
                    body: JSON.stringify({ clientSecret })
                });
                if (!tokenResp.ok) {
                    const err = await tokenResp.json().catch(() => ({}));
                    throw new Error(err.error || 'Could not fetch authentication token');
                }
                const payload = await tokenResp.json();
                token = payload.token;
                saveCachedToken(token);
                convertResponse = await fetch(n8nWebhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(webhookData),
                });
            }
            const resultData = await convertResponse.json();
            if (!convertResponse.ok) {
                throw new Error(resultData.error || `Webhook call failed with status: ${convertResponse.status}`);
            }
                const display =
                    (typeof resultData === 'string' && resultData) ||
                    resultData.text ||
                    resultData.message ||
                    resultData.output ||
                    resultData.data ||
                    JSON.stringify(resultData, null, 2);
                renderOutput(display);
            outputContainer.classList.remove('d-none');
            stopPolling();
        } catch (error) {
            console.error('Error during conversion process:', error);
            alert('An error occurred: ' + error.message);
            outputCode.textContent = 'Error: ' + error.message;
            outputContainer.classList.remove('d-none');
        } finally {
            loader.classList.add('d-none');
            convertBtn.disabled = false;
        }
    });
});
