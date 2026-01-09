const express = require('express');
const axios = require('axios');
const tmi = require('tmi.js');  // Para Twitch
const { Server } = require('ws'); // WebSocket em vez de SSE
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

// ==================== CONFIGURAÇÃO ====================
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC5ooSCrMhz10WUWrc6IlT3Q';
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || 'funilzinha';

// Config simples
const config = {
    youtube: {
        enabled: !!YOUTUBE_API_KEY,
        checkInterval: 60000, // 1 minuto
        messageInterval: 10000 // 10 segundos
    },
    twitch: {
        enabled: true
    }
};

// ==================== YOUTUBE ====================
let youtubeLiveData = {
    isLive: false,
    liveChatId: null,
    videoId: null,
    lastMessageId: null
};

async function checkYouTubeLive() {
    if (!config.youtube.enabled) return;

    try {
        console.log('🔍 Verificando YouTube...');
        
        const search = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                channelId: YOUTUBE_CHANNEL_ID,
                eventType: 'live',
                type: 'video',
                maxResults: 1,
                key: YOUTUBE_API_KEY
            },
            timeout: 5000
        });

        if (!search.data.items?.length) {
            if (youtubeLiveData.isLive) {
                console.log('📭 Live do YouTube acabou');
                youtubeLiveData = { isLive: false, liveChatId: null, videoId: null, lastMessageId: null };
                broadcastSystemMessage('🎥 Transmissão do YouTube encerrada');
            }
            return;
        }

        const videoId = search.data.items[0].id.videoId;
        
        // Se já estamos nesta live, não precisa verificar novamente
        if (youtubeLiveData.videoId === videoId) return;

        // Obter detalhes da live
        const videoDetails = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'liveStreamingDetails,snippet',
                id: videoId,
                key: YOUTUBE_API_KEY
            },
            timeout: 5000
        });

        const liveChatId = videoDetails.data.items[0]?.liveStreamingDetails?.activeLiveChatId;
        
        if (liveChatId) {
            youtubeLiveData = {
                isLive: true,
                liveChatId,
                videoId,
                lastMessageId: null,
                title: videoDetails.data.items[0].snippet.title
            };
            
            console.log(`✅ YouTube LIVE: ${youtubeLiveData.title}`);
            broadcastSystemMessage(`🎥 Live do YouTube: ${youtubeLiveData.title}`);
            
            // Iniciar monitoramento do chat
            setTimeout(fetchYouTubeMessages, 2000);
        }
    } catch (error) {
        console.error('❌ Erro YouTube:', error.message);
    }
}

async function fetchYouTubeMessages() {
    if (!youtubeLiveData.isLive || !youtubeLiveData.liveChatId) return;

    try {
        const params = {
            part: 'snippet,authorDetails',
            liveChatId: youtubeLiveData.liveChatId,
            maxResults: 20,
            key: YOUTUBE_API_KEY
        };

        if (youtubeLiveData.lastMessageId) {
            params.pageToken = youtubeLiveData.lastMessageId;
        }

        const response = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
            params,
            timeout: 5000
        });

        if (response.data.items) {
            response.data.items.forEach(msg => {
                broadcast({
                    platform: 'youtube',
                    type: 'chat',
                    data: {
                        id: msg.id,
                        user: msg.authorDetails.displayName,
                        message: msg.snippet.displayMessage,
                        timestamp: msg.snippet.publishedAt,
                        badges: {
                            isModerator: msg.authorDetails.isChatModerator,
                            isOwner: msg.authorDetails.isChatOwner,
                            isVerified: msg.authorDetails.isVerified
                        }
                    }
                });
            });

            youtubeLiveData.lastMessageId = response.data.nextPageToken;
        }

        // Agendar próxima busca
        if (youtubeLiveData.isLive) {
            setTimeout(fetchYouTubeMessages, config.youtube.messageInterval);
        }
    } catch (error) {
        console.error('❌ Erro ao buscar mensagens YouTube:', error.message);
        setTimeout(fetchYouTubeMessages, 30000); // Esperar 30s em caso de erro
    }
}

// ==================== TWITCH ====================
let twitchClient = null;

function connectTwitch() {
    if (!config.twitch.enabled) return;

    console.log(`🎮 Conectando ao chat da Twitch: ${TWITCH_CHANNEL}`);

    twitchClient = new tmi.Client({
        channels: [TWITCH_CHANNEL],
        connection: {
            secure: true,
            reconnect: true
        },
        options: {
            debug: false
        }
    });

    twitchClient.connect().catch(console.error);

    twitchClient.on('message', (channel, tags, message, self) => {
        if (self) return;

        broadcast({
            platform: 'twitch',
            type: 'chat',
            data: {
                id: tags.id,
                user: tags['display-name'] || tags.username,
                message: message,
                timestamp: new Date().toISOString(),
                color: tags.color || '#FFFFFF',
                badges: {
                    isBroadcaster: tags.badges?.broadcaster === '1',
                    isModerator: tags.mod,
                    isVIP: tags.badges?.vip === '1',
                    isSubscriber: tags.subscriber,
                    isFounder: tags.badges?.founder === '1'
                }
            }
        });
    });

    twitchClient.on('connected', () => {
        console.log('✅ Conectado à Twitch');
        broadcastSystemMessage('🎮 Conectado ao chat da Twitch');
    });
}

// ==================== WEBSOCKET ====================
const clients = new Set();

function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

function broadcastSystemMessage(text) {
    broadcast({
        platform: 'system',
        type: 'system',
        data: {
            message: text,
            timestamp: new Date().toISOString()
        }
    });
}

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`👤 Novo cliente conectado. Total: ${clients.size}`);

    // Enviar mensagem de boas-vindas
    ws.send(JSON.stringify({
        platform: 'system',
        type: 'welcome',
        data: {
            message: '💬 Chat OBS Conectado!',
            timestamp: new Date().toISOString(),
            services: {
                youtube: youtubeLiveData.isLive,
                twitch: config.twitch.enabled
            }
        }
    }));

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`👤 Cliente desconectado. Restantes: ${clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('❌ Erro WebSocket:', error);
    });
});

// ==================== ROTAS HTTP ====================
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        youtube: {
            isLive: youtubeLiveData.isLive,
            enabled: config.youtube.enabled
        },
        twitch: {
            enabled: config.twitch.enabled,
            channel: TWITCH_CHANNEL
        },
        clients: clients.size,
        uptime: process.uptime()
    });
});

app.get('/config.js', (req, res) => {
    const isRender = req.hostname.includes('onrender.com');
    const protocol = isRender ? 'https' : req.protocol;
    const host = req.get('host');
    
    const configJs = `
// Configuração automática
const isLocal = window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1';

let CONFIG = {};

if (isLocal) {
    CONFIG = {
        twitchChannel: "${TWITCH_CHANNEL}",
        serverUrl: "ws://localhost:${process.env.PORT || 3000}",
        youtubeChannelId: "${YOUTUBE_CHANNEL_ID}"
    };
} else {
    CONFIG = {
        twitchChannel: "${TWITCH_CHANNEL}",
        serverUrl: "wss://${host}",
        youtubeChannelId: "${YOUTUBE_CHANNEL_ID}"
    };
}

console.log('⚙️ Configuração carregada:', CONFIG);
    `;
    
    res.header('Content-Type', 'application/javascript');
    res.send(configJs);
});

// ==================== INICIALIZAÇÃO ====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📺 YouTube: ${config.youtube.enabled ? 'HABILITADO' : 'DESABILITADO (sem API Key)'}`);
    console.log(`🎮 Twitch: ${TWITCH_CHANNEL}`);
    console.log(`🌐 WebSocket: wss://localhost:${PORT}`);
    
    // Iniciar serviços
    if (config.twitch.enabled) {
        connectTwitch();
    }
    
    if (config.youtube.enabled) {
        // Verificar YouTube a cada minuto
        setInterval(checkYouTubeLive, config.youtube.checkInterval);
        checkYouTubeLive(); // Verificação inicial
    }
});