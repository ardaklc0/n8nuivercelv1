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

    const getClientToken = () => {
        let token = localStorage.getItem('clientToken');
        if (!token) {
            token = prompt('Enter Access Token');
            if (token) localStorage.setItem('clientToken', token);
        }
        return token;
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
            // 1. Adım: Kullanıcıdan/LocalStorage'dan statik erişim anahtarını al
            const clientToken = getClientToken();
            if (!clientToken) {
                throw new Error('No client access token provided.');
            }

            // 2. Adım: Erişim anahtarı ile asıl isteği yap
            const webhookData = {
                acceptanceCriteria: acText,
                aiAgent: aiAgent,
                outputFormat: outputFormat
            };

            console.log('Sending data to /api/convert with client token...');
            const convertResponse = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-client-token': clientToken // Statik istemci anahtarı
                },
                body: JSON.stringify(webhookData),
            });

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
