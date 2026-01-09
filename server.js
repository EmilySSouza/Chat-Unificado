const express = require('express');
const { LiveChat } = require('youtube-chat');
const fetch = require('node-fetch'); // ADICIONE ESTA DEPENDÊNCIA

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UC5ooSCrMhz10WUWrc6IlT3Q",
    youtubeVideoId: process.env.YOUTUBE_VIDEO_ID || null // NOVO: videoId específico
};

// Middleware CORS
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Cache-Control');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

app.use(express.static(__dirname));

let youtubeChat = null;
let isYouTubeLive = false;
const clients = [];

// FUNÇÃO PARA BUSCAR VIDEO ID DA LIVE ATUAL
async function getCurrentLiveVideoId() {
    try {
        console.log('🔍 Buscando live ativa do canal...');

        // Método 1: Tenta usar videoId da variável de ambiente (se existir)
        if (CONFIG.youtubeVideoId) {
            console.log(`🎯 Usando videoId da variável: ${CONFIG.youtubeVideoId}`);
            return CONFIG.youtubeVideoId;
        }

        // Método 2: Tenta encontrar via página do YouTube
        const response = await fetch(`https://www.youtube.com/channel/${CONFIG.youtubeChannelId}/live`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 10000
        });

        const html = await response.text();

        // Procura o videoId na página
        const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) ||
            html.match(/watch\?v=([a-zA-Z0-9_-]{11})/) ||
            html.match(/"embed":{"videoId":"([a-zA-Z0-9_-]{11})"/);

        if (videoIdMatch && videoIdMatch[1]) {
            const videoId = videoIdMatch[1];
            console.log(`✅ VideoId encontrado: ${videoId}`);
            return videoId;
        }

        console.log('❌ Nenhum videoId encontrado na página');
        return null;

    } catch (error) {
        console.error('❌ Erro ao buscar videoId:', error.message);
        return null;
    }
}

// FUNÇÃO PRINCIPAL DE CONEXÃO - USANDO VIDEO ID
async function connectYouTube() {
    try {
        console.log('🔄 Conectando ao YouTube...');

        // Para conexão anterior
        if (youtubeChat) {
            try {
                youtubeChat.stop();
            } catch (e) { }
        }

        // Busca o videoId da live atual
        const videoId = await getCurrentLiveVideoId();

        if (!videoId) {
            console.log('⏳ Nenhuma live ativa encontrada');
            isYouTubeLive = false;

            // Tenta novamente em 2 minutos
            setTimeout(connectYouTube, 120000);
            return;
        }

        console.log(`🎬 Conectando usando videoId: ${videoId}`);

        // NOVA ABORDAGEM: Usa videoId em vez de channelId
        youtubeChat = new LiveChat({
            videoId: videoId, // ← USA VIDEO ID!
            pollingInterval: 3000
        });

        // Configura eventos (igual ao anterior)
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
                console.error('❌ Erro ao processar mensagem:', error);
            }
        });

        youtubeChat.on('start', () => {
            console.log('✅ YouTube: Conectado ao chat!');
            isYouTubeLive = true;

            broadcast({
                type: 'system',
                data: '✅ YouTube: Conectado à transmissão!'
            });
        });

        youtubeChat.on('end', () => {
            console.log('🔴 YouTube: Chat encerrado');
            isYouTubeLive = false;

            broadcast({
                type: 'system',
                data: '🔴 YouTube: Transmissão encerrada'
            });

            setTimeout(connectYouTube, 30000);
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ YouTube Erro:', error.message);

            // Se for "not found", tenta buscar novo videoId
            if (error.message.includes('not found') ||
                error.message.includes('Live Stream was not found')) {
                console.log('🔄 Live não encontrada, buscando nova...');
                isYouTubeLive = false;
                setTimeout(connectYouTube, 60000);
            }
        });

        await youtubeChat.start();
        console.log('🎉 Conexão YouTube iniciada com sucesso!');

    } catch (error) {
        console.error('💥 Erro ao conectar:', error.message);

        // Tenta novamente em 1 minuto
        setTimeout(connectYouTube, 60000);
    }
}

// Função broadcast (mantenha igual)
function broadcast(data) {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
        try {
            client.write(sseMessage);
        } catch (error) { }
    });
}

// ROTAS
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    clients.push(res);

    res.write(`data: ${JSON.stringify({
        type: 'welcome',
        data: {
            message: '💬 Chat Unificado',
            youtubeLive: isYouTubeLive,
            timestamp: new Date().toLocaleTimeString('pt-BR')
        }
    })}\n\n`);

    req.on('close', () => {
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/config.js', (req, res) => {
    const config = `
const CONFIG = {
    twitchChannel: "${CONFIG.twitchChannel}",
    serverUrl: "${req.protocol}://${req.get('host')}",
    youtubeChannelId: "${CONFIG.youtubeChannelId}"
};
    `;
    res.header('Content-Type', 'application/javascript');
    res.send(config);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        youtube: !!youtubeChat,
        youtubeLive: isYouTubeLive,
        clients: clients.length,
        timestamp: new Date().toISOString()
    });
});

// NOVA ROTA: Atualizar videoId manualmente
app.get('/update-video-id/:videoId', (req, res) => {
    const videoId = req.params.videoId;
    console.log(`🔄 VideoId atualizado manualmente: ${videoId}`);

    // Reconecta com novo videoId
    if (youtubeChat) {
        youtubeChat.stop();
    }

    // Usa o novo videoId
    CONFIG.youtubeVideoId = videoId;

    // Reconecta
    setTimeout(connectYouTube, 1000);

    res.json({
        success: true,
        message: `VideoId atualizado para: ${videoId}`,
        reconnecting: true
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube: ${CONFIG.youtubeChannelId}`);
    console.log('🔄 Iniciando conexão YouTube...');

    connectYouTube();
});