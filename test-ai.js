(async () => {
    try {
        const apiBaseUrl = (process.env.API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');
        if (!apiBaseUrl) {
            throw new Error('Defina API_URL ou VITE_API_URL para testar a API.');
        }

        const res = await fetch(`${apiBaseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: 'Você é um assistente de produtividade. Responda APENAS com um objeto JSON puro, sem explicações. O formato deve ser: {"tags": ["Tag1", "Tag2"], "priority": "low" | "medium" | "high"}. Baseie-se no título da tarefa.' },
                    { role: 'user', content: 'Tarefa: Reunião importante com o cliente amanhã' }
                ],
                temperature: 0.2,
                max_tokens: 800
            })
        });
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error connecting to server:", e.message);
    }
})();
