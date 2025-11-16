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

    convertBtn.addEventListener('click', () => {
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

        const webhookData = {
            acceptanceCriteria: acText,
            aiAgent: aiAgent,
            outputFormat: outputFormat
        };

        console.log('Sending data to n8n:', webhookData);
        console.log('Webhook URL:', n8nWebhookUrl);

        fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(webhookData),
        })
        .then(response => {
            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);
            if (!response.ok) {
                console.error('Webhook call failed with status:', response.status);
            }
            return response.json().catch(() => ({}));
        })
        .then(data => {
            console.log('Webhook response data:', data);
        })
        .catch((error) => {
            console.error('Error calling webhook:', error);
            alert('Failed to connect to n8n webhook. Error: ' + error.message);
        });


        // Simulate AI processing time
        setTimeout(() => {
            // Generate dummy output based on selection
            let generatedOutput = '';
            if (outputFormat === 'Decision Table') {
                generatedOutput = `
| Condition                           | Rule 1 | Rule 2 | Rule 3 |
|-------------------------------------|--------|--------|--------|
| User is logged in                   | Yes    | Yes    | No     |
| User has valid subscription         | Yes    | No     | -      |
| Action: Grant access to feature X   | Allow  | Deny   | Deny   |
                `;
            } else if (outputFormat === 'Gherkin') {
                generatedOutput = `
Feature: User Authentication

  Scenario: Successful login with valid credentials
    Given the user is on the login page
    When the user enters valid username and password
    And clicks the "Login" button
    Then the user should be redirected to the dashboard
                `;
            } else {
                generatedOutput = `
Test Scenario 1: Verify login with valid credentials.
Test Scenario 2: Verify login with invalid credentials.
Test Scenario 3: Verify password recovery functionality.
                `;
            }

            // Hide loader and show output
            loader.classList.add('d-none');
            outputCode.textContent = generatedOutput.trim();
            outputContainer.classList.remove('d-none');
            convertBtn.disabled = false;

        }, 3000); // 3 seconds delay
    });
});
