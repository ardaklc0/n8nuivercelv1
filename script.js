document.addEventListener('DOMContentLoaded', () => {
    const convertBtn = document.getElementById('convert-btn');
    const loader = document.getElementById('loader');
    const outputContainer = document.getElementById('output-container');
    const outputCode = document.getElementById('output-code');
    const acInput = document.getElementById('ac-input');
    const aiAgentSelect = document.getElementById('ai-agent-select');
    const outputFormatSelect = document.getElementById('output-format-select');
    const darkModeSwitch = document.getElementById('darkModeSwitch');
    const themeIcon = document.getElementById('theme-icon');

    const n8nWebhookUrl = 'https://n8nuivercelv1.vercel.app/api/convert';

    // Simple token cache: sessionStorage if available, else in-memory. TTL = 10 minutes.
    const TOKEN_KEY = 'n8nui_token_cache';
    const TEN_MIN_MS = 10 * 60 * 1000;
    let memoryTokenCache = null;

    const getStorage = () => {
        try {
            // Test sessionStorage availability (Edge Tracking Prevention may block)
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
            // Step 1: Use cached JWT if available and valid (<=10 minutes old)
            let cached = loadCachedToken();
            let token = cached ? cached.token : null;

            // Step 2: If no valid token, prompt for secret and request a new token
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

            // 3. Adım: Alınan token ile asıl isteği yap
            const webhookData = {
                acceptanceCriteria: acText,
                aiAgent: aiAgent,
                outputFormat: outputFormat
            };

            console.log('Sending data to /api/convert with client token...');
            let convertResponse = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(webhookData),
            });

            // If token was invalid/expired, clear cache, re-prompt once, and retry
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
                // Sunucudan gelen hata mesajını kullan
                throw new Error(resultData.error || `Webhook call failed with status: ${convertResponse.status}`);
            }
            
            console.log('Webhook response data:', resultData);

            // Sunucudan gelen gerçek yanıtı göster
            // Not: Gelen verinin formatına göre bu kısmı düzenlemeniz gerekebilir.
            // Örnek olarak, resultData.text varsayılmıştır.
            outputCode.textContent = resultData.text || JSON.stringify(resultData, null, 2);
            outputContainer.classList.remove('d-none');

        } catch (error) {
            console.error('Error during conversion process:', error);
            alert('An error occurred: ' + error.message);
            outputCode.textContent = 'Error: ' + error.message;
            outputContainer.classList.remove('d-none');
        } finally {
            // İşlem bitince loader'ı kaldır ve butonu aktif et
            loader.classList.add('d-none');
            convertBtn.disabled = false;
        }
    });
});
