const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Rota principal - serve o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota ESPECIAL para config.js dinâmico
app.get('/config.js', (req, res) => {
    console.log('📋 Servindo config.js com variáveis de ambiente:');
    console.log('- YOUTUBE_API_KEY:', process.env.YOUTUBE_API_KEY ? '✔️ Configurada' : '❌ Não configurada');
    console.log('- TWITCH_CHANNEL:', process.env.TWITCH_CHANNEL || 'funilzinha');

    const configContent = `
// Configurações dinâmicas do servidor
const TWITCH_CONFIG = {
    channel: "${process.env.TWITCH_CHANNEL || 'funilzinha'}"
};

const YOUTUBE_CONFIG = {
    channelId: "${process.env.YOUTUBE_CHANNEL_ID || ''}",
    apiKey: "${process.env.YOUTUBE_API_KEY || ''}"
};

const APP_CONFIG = {
    maxMessages: ${process.env.MAX_MESSAGES || 200},
    updateInterval: ${process.env.UPDATE_INTERVAL || 60000},
    enableSimulation: ${process.env.ENABLE_SIMULATION !== 'false'}
};

console.log('✅ Configurações carregadas:');
console.log('- Canal Twitch:', TWITCH_CONFIG.channel);
console.log('- YouTube API Key:', YOUTUBE_CONFIG.apiKey ? '✔️ Configurada' : '❌ Não configurada');
    `;

    res.setHeader('Content-Type', 'application/javascript');
    res.send(configContent);
});

// Rota para verificar variáveis de ambiente (apenas para debug)
app.get('/debug-env', (req, res) => {
    res.json({
        youtube_api_key: process.env.YOUTUBE_API_KEY ? 'Configurada' : 'Não configurada',
        youtube_channel_id: process.env.YOUTUBE_CHANNEL_ID || 'Não configurada',
        twitch_channel: process.env.TWITCH_CHANNEL || 'funilzinha',
        max_messages: process.env.MAX_MESSAGES || 200,
        update_interval: process.env.UPDATE_INTERVAL || 60000,
        enable_simulation: process.env.ENABLE_SIMULATION || true
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log('📊 Variáveis de ambiente detectadas:');
    console.log('- PORT:', PORT);
    console.log('- YOUTUBE_API_KEY:', process.env.YOUTUBE_API_KEY ? '✅ Configurada' : '❌ Não configurada');
    console.log('- YOUTUBE_CHANNEL_ID:', process.env.YOUTUBE_CHANNEL_ID || 'Não configurada');
    console.log('- TWITCH_CHANNEL:', process.env.TWITCH_CHANNEL || 'funilzinha (padrão)');
});