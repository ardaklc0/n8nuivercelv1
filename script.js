document.addEventListener('DOMContentLoaded', () => {
    const convertBtn = document.getElementById('convert-btn');
    const loader = document.getElementById('loader');
    const outputContainer = document.getElementById('output-container');
    const outputCode = document.getElementById('output-code');
    const outputHtml = document.getElementById('output-html');
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
        if (outputHtml) outputHtml.classList.remove('d-none');
        const preEl = outputCode && outputCode.closest ? outputCode.closest('pre') : null;
        if (preEl) preEl.classList.add('d-none');
    };
    const sanitizeHtml = (html) => {
        try {
            // Remove script tags
            let clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            // Remove on*="..." inline handlers
            clean = clean.replace(/ on[a-zA-Z]+\s*=\s*"[^"]*"/g, '')
                         .replace(/ on[a-zA-Z]+\s*=\s*'[^']*'/g, '')
                         .replace(/ on[a-zA-Z]+\s*=\s*[^\s>]+/g, '');
            // Neutralize javascript: URLs
            clean = clean.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
                         .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
            return clean;
        } catch (_) {
            return html;
        }
    };

    const escapeHtml = (text) => String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    // Ensure any <table> elements have Bootstrap classes and a responsive wrapper
    const enhanceTables = (html) => {
        try {
            const container = document.createElement('div');
            container.innerHTML = html;
            const tables = container.querySelectorAll('table');
            tables.forEach((tbl) => {
                const current = (tbl.getAttribute('class') || '').trim();
                const set = new Set(current.split(/\s+/).filter(Boolean));
                set.add('table');
                set.add('table-striped');
                set.add('table-bordered');
                tbl.setAttribute('class', Array.from(set).join(' '));
                const parent = tbl.parentElement;
                if (!parent || !parent.classList || !parent.classList.contains('table-responsive')) {
                    const wrap = document.createElement('div');
                    wrap.className = 'table-responsive mb-3';
                    tbl.parentNode.insertBefore(wrap, tbl);
                    wrap.appendChild(tbl);
                }
            });
            return container.innerHTML;
        } catch (_) {
            return html;
        }
    };

    const renderOutput = (text) => {
        const str = String(text ?? '').trim();
        ensureOutputVisible();
        if (!outputHtml) {
            // Fallback: if #output-html missing, keep legacy behavior
            outputCode.textContent = str;
            return;
        }
        // No interim status lines; only render final or error outputs
        const isStatus = false;
        const looksHtml = /<\s*(table|tr|td|th|thead|tbody|tfoot|ul|ol|li|p|div|span|h[1-6]|section|article|header|footer|br|hr)/i.test(str) || str.startsWith('<');
        if (looksHtml) {
            const safe = sanitizeHtml(str);
            // If only rows are provided, wrap into a Bootstrap table for valid markup
            const onlyRows = /<\s*tr[\s>]/i.test(safe) && !/</i.test(safe.replace(/<\s*tr[\s\S]*?<\s*\/tr\s*>/gi, '')) && !/\btable\b/i.test(safe);
            if (onlyRows) {
                const tableHtml = `<div class="table-responsive mb-3"><table class="table table-striped table-bordered"><tbody>${safe}</tbody></table></div>`;
                if (isStatus) outputHtml.innerHTML = tableHtml; else outputHtml.insertAdjacentHTML('beforeend', tableHtml);
            } else {
                const enhanced = enhanceTables(safe);
                if (isStatus) outputHtml.innerHTML = enhanced; else outputHtml.insertAdjacentHTML('beforeend', enhanced);
            }
        } else {
            const pre = `<pre class="mb-3">${escapeHtml(str)}</pre>`;
            if (isStatus) outputHtml.innerHTML = pre; else outputHtml.insertAdjacentHTML('beforeend', pre);
        }
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
                    renderOutput('No response received (timeout).');
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
                }
            } catch (_) {
            }
            window.__geminiPollTimer = setTimeout(tick, 1000);
        };
        window.__geminiPollTimer = setTimeout(tick, 1000);
    };

    const subscribeGeminiEvents = (token) => {
        try { if (window.__geminiEventSource) { window.__geminiEventSource.close(); } } catch (_) {}
        const url = `${geminiEventsUrl}?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url, { withCredentials: false });
        window.__geminiEventSource = es;
        es.onmessage = (evt) => {
            try {
                const data = evt.data ? JSON.parse(evt.data) : {};
                const display = (typeof data === 'string' && data) || data.text || data.message || data.output || data.data || JSON.stringify(data, null, 2);
                renderOutput(display || '');
            } catch {
                renderOutput(evt.data || '');
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
        // Reset any previous activity (polling/SSE/in-flight requests)
        // delete previous outputs
        outputHtml.innerHTML = '';
        outputCode.textContent = '';
        try { stopPolling(); } catch(_) {}
        try { if (window.__geminiEventSource) { window.__geminiEventSource.close(); window.__geminiEventSource = null; } } catch(_) {}
        try { if (window.__convertAbortController) { window.__convertAbortController.abort(); window.__convertAbortController = null; } } catch(_) {}

        const acText = acInput.value;
        const aiAgent = aiAgentSelect.value;
        const outputFormat = outputFormatSelect.value;
        if (!acText.trim()) {
            alert('Please enter Acceptance Criteria.');
            return;
        }
        // Show spinner-only loader, clear previous outputs
        loader.classList.remove('d-none');
        outputContainer.classList.add('d-none');
        try { if (outputHtml) outputHtml.innerHTML = ''; } catch(_) {}
        try { if (outputCode) outputCode.textContent = ''; } catch(_) {}
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
            // Prepare abort controller for this convert request
            const abortCtrl = new AbortController();
            window.__convertAbortController = abortCtrl;
            let convertResponse = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(webhookData),
                signal: abortCtrl.signal,
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
                    signal: abortCtrl.signal,
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
            if (error && error.name === 'AbortError') {
                // Silently ignore aborted previous requests when re-running
            } else {
                console.error('Error during conversion process:', error);
                alert('An error occurred: ' + error.message);
                renderOutput('Error: ' + error.message);
                outputContainer.classList.remove('d-none');
            }
        } finally {
            loader.classList.add('d-none');
            convertBtn.disabled = false;
            try { if (window.__convertAbortController) { window.__convertAbortController = null; } } catch(_) {}
        }
    });
});
