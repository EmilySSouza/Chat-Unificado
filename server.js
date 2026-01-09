const express = require('express');
const { LiveChat } = require('youtube-chat');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UC5ooSCrMhz10WUWrc6IlT3Q",
    youtubeVideoId: process.env.YOUTUBE_VIDEO_ID || "nZx2C80T284" // ADICIONE SEU VIDEO ID AQUI
};

// Middleware CORS para HTTPS
app.use((req, res, next) => {
    // SEMPRE usa HTTPS no Render
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const isSecure = protocol === 'https';

    if (isSecure) {
        res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Permite qualquer origem (Render + localhost)
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Cache-Control');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

app.use(express.static(__dirname));

let youtubeChat = null;
let isYouTubeLive = false;
const clients = [];

// FUNÇÃO SIMPLIFICADA DE CONEXÃO YOUTUBE
async function connectYouTube() {
    try {
        console.log('🔄 Iniciando conexão YouTube...');

        // Para conexão anterior
        if (youtubeChat) {
            try {
                youtubeChat.stop();
            } catch (e) { }
        }

        // USA VIDEO ID FIXO (mais confiável no Render)
        const videoId = CONFIG.youtubeVideoId;

        if (!videoId) {
            console.log('❌ Nenhum videoId configurado');
            return;
        }

        console.log(`🎯 Conectando ao videoId: ${videoId}`);

        youtubeChat = new LiveChat({
            videoId: videoId, // Video ID FIXO
            pollingInterval: 3000
        });

        youtubeChat.on('chat', (message) => {
            try {
                let messageText = '';

                if (typeof message.message === 'string') {
                    messageText = message.message;
                } else if (Array.isArray(message.message)) {
                    messageText = message.message
                        .map(item => item.text || '')
                        .filter(text => text)
                        .join(' ');
                }

                const userName = message.author?.name || 'Anônimo';

                console.log(`📩 YouTube: ${userName}: ${messageText.substring(0, 50)}...`);

                broadcast({
                    type: 'youtube',
                    data: {
                        user: userName,
                        message: messageText,
                        time: new Date().toLocaleTimeString('pt-BR'),
                        badges: {
                            isMember: message.isMembership || message.isMember,
                            isModerator: message.isModerator,
                            isOwner: message.isOwner
                        }
                    }
                });

            } catch (error) {
                console.error('❌ Erro mensagem:', error);
            }
        });

        youtubeChat.on('start', () => {
            console.log('✅ YouTube: Conectado!');
            isYouTubeLive = true;

            broadcast({
                type: 'system',
                data: '✅ YouTube: Conectado à transmissão!'
            });
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ YouTube Erro:', error.message);
            isYouTubeLive = false;

            // Reconecta em 30 segundos
            setTimeout(connectYouTube, 30000);
        });

        await youtubeChat.start();
        console.log('🎉 YouTube conectado com sucesso!');

    } catch (error) {
        console.error('💥 Erro conexão YouTube:', error.message);
        setTimeout(connectYouTube, 30000);
    }
}

// FUNÇÃO BROADCAST
function broadcast(data) {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;

    // Remove clientes desconectados
    const activeClients = [];

    clients.forEach(client => {
        try {
            client.write(sseMessage);
            activeClients.push(client);
        } catch (error) {
            // Cliente desconectado
        }
    });

    // Atualiza lista
    clients.length = 0;
    clients.push(...activeClients);
}

// ROTA SSE COM HTTPS FORÇADO
app.get('/events', (req, res) => {
    // Força HTTPS no Render
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    if (protocol !== 'https' && process.env.NODE_ENV === 'production') {
        console.log('⚠️ Request não seguro, redirecionando...');
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no'
    });

    clients.push(res);

    // Mantém conexão viva
    const keepAlive = setInterval(() => {
        try {
            res.write(': keepalive\n\n');
        } catch (error) {
            clearInterval(keepAlive);
        }
    }, 30000);

    // Mensagem inicial
    res.write(`data: ${JSON.stringify({
        type: 'welcome',
        data: {
            message: '💬 Chat Unificado conectado',
            youtubeStatus: isYouTubeLive ? 'Conectado' : 'Conectando...',
            timestamp: new Date().toLocaleTimeString('pt-BR'),
            server: 'Render'
        }
    })}\n\n`);

    // Limpa quando cliente desconectar
    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(res);
        if (index > -1) {
            clients.splice(index, 1);
        }
    });
});

// ROTA PRINCIPAL
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ROTA CONFIG.JS DINÂMICA COM HTTPS
app.get('/config.js', (req, res) => {
    // SEMPRE usa HTTPS no Render
    const isRender = req.hostname.includes('onrender.com');
    const protocol = isRender ? 'https' : req.protocol;
    const serverUrl = `${protocol}://${req.get('host')}`;

    const config = `
// Configuração automática
const CONFIG = {
    twitchChannel: "${CONFIG.twitchChannel}",
    serverUrl: "${serverUrl}",  // HTTPS no Render
    youtubeChannelId: "${CONFIG.youtubeChannelId}"
};

// Debug info
console.log('🌐 Server URL:', CONFIG.serverUrl);
console.log('🔗 Twitch Channel:', CONFIG.twitchChannel);
    `;

    res.header('Content-Type', 'application/javascript');
    res.header('Cache-Control', 'no-cache, no-store');
    res.send(config);
});

// ROTA HEALTH
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        youtube: !!youtubeChat,
        youtubeLive: isYouTubeLive,
        clients: clients.length,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// ROTA PARA FORÇAR HTTPS (importante!)
app.get('*', (req, res, next) => {
    if (process.env.NODE_ENV === 'production' &&
        req.headers['x-forwarded-proto'] !== 'https') {
        const httpsUrl = `https://${req.get('host')}${req.url}`;
        console.log(`🔒 Redirecionando para HTTPS: ${httpsUrl}`);
        return res.redirect(301, httpsUrl);
    }
    next();
});

// INICIA SERVIDOR
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube Video ID: ${CONFIG.youtubeVideoId}`);
    console.log('🔄 Iniciando conexões...');

    connectYouTube();
});