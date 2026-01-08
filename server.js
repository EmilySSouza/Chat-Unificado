const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Middleware para processar index.html e injetar variáveis
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    // Injetar configurações como script global
    const configScript = `
        <script>
            window.APP_CONFIG = ${JSON.stringify({
        maxMessages: process.env.MAX_MESSAGES || 200,
        updateInterval: process.env.UPDATE_INTERVAL || 60000,
        enableSimulation: process.env.ENABLE_SIMULATION !== 'false'
    })};
            
            window.TWITCH_CONFIG = ${JSON.stringify({
        channel: process.env.TWITCH_CHANNEL || "funilzinha"
    })};
            
            window.YOUTUBE_CONFIG = ${JSON.stringify({
        channelId: process.env.YOUTUBE_CHANNEL_ID || "",
        apiKey: process.env.YOUTUBE_API_KEY || ""
    })};
        </script>
    `;

    // Injetar antes do fechamento do </head>
    html = html.replace('</head>', configScript + '</head>');

    res.send(html);
});

// Rota para config.js (retorna configurações dinâmicas)
app.get('/config.js', (req, res) => {
    const config = `
        const TWITCH_CONFIG = ${JSON.stringify({
        channel: process.env.TWITCH_CHANNEL || "funilzinha"
    })};

        const YOUTUBE_CONFIG = ${JSON.stringify({
        channelId: process.env.YOUTUBE_CHANNEL_ID || "",
        apiKey: process.env.YOUTUBE_API_KEY || ""
    })};

        const APP_CONFIG = ${JSON.stringify({
        maxMessages: process.env.MAX_MESSAGES || 200,
        updateInterval: process.env.UPDATE_INTERVAL || 60000,
        enableSimulation: process.env.ENABLE_SIMULATION !== 'false'
    })};
    `;

    res.setHeader('Content-Type', 'application/javascript');
    res.send(config);
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
    console.log('Configurações carregadas:');
    console.log('- Twitch Channel:', process.env.TWITCH_CHANNEL || "funilzinha");
    console.log('- YouTube API Key:', process.env.YOUTUBE_API_KEY ? "Configurada" : "Não configurada");
});