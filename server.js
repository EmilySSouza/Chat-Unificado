const express = require('express');
const axios = require('axios');
const tmi = require('tmi.js');
const { Server } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server, clientTracking: true });

// ==================== CONFIGURAÇÃO OTIMIZADA ====================
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC5ooSCrMhz10WUWrc6IlT3Q';
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL || 'funilzinha';

// Config otimizada
const config = {
    youtube: {
        enabled: !!YOUTUBE_API_KEY,
        checkInterval: 30000, // 30 segundos para verificar live
        messageInterval: 3000, // 3 segundos para mensagens (REDUZIDO!)
        maxResults: 100
    },
    twitch: {
        enabled: true,
        reconnect: true,
        maxReconnectAttempts: 5
    }
};

// ==================== YOUTUBE - SISTEMA OTIMIZADO ====================
let youtubeLiveData = {
    isLive: false,
    liveChatId: null,
    videoId: null,
    lastMessageId: null,
    processedMessages: new Set(), // Evitar repetição
    lastFetchTime: 0,
    fetchInterval: null
};

// Cache para evitar mensagens repetidas
const messageCache = {
    youtube: new Set(),
    twitch: new Set(),
    clearOld: function () {
        // Limpar cache a cada 10 minutos
        setTimeout(() => {
            this.youtube.clear();
            this.twitch.clear();
            this.clearOld();
        }, 600000);
    }
};
messageCache.clearOld();

async function checkYouTubeLive() {
    if (!config.youtube.enabled) {
        console.log('⏸️ YouTube desabilitado (sem API Key)');
        return;
    }

    try {
        console.log('🔍 Verificando YouTube Live...');

        const search = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                channelId: YOUTUBE_CHANNEL_ID,
                eventType: 'live',
                type: 'video',
                maxResults: 1,
                key: YOUTUBE_API_KEY
            },
            timeout: 3000
        });

        if (!search.data.items?.length) {
            if (youtubeLiveData.isLive) {
                console.log('📭 Live do YouTube encerrada');
                stopYouTubePolling();
                youtubeLiveData = {
                    isLive: false,
                    liveChatId: null,
                    videoId: null,
                    lastMessageId: null,
                    processedMessages: new Set()
                };
                broadcastSystemMessage('🎥 Transmissão do YouTube encerrada');
            }
            return;
        }

        const videoId = search.data.items[0].id.videoId;

        // Se já estamos monitorando esta live, não fazer nada
        if (youtubeLiveData.videoId === videoId) {
            return;
        }

        // Obter liveChatId
        const videoDetails = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'liveStreamingDetails,snippet',
                id: videoId,
                key: YOUTUBE_API_KEY
            },
            timeout: 3000
        });

        const liveChatId = videoDetails.data.items[0]?.liveStreamingDetails?.activeLiveChatId;

        if (liveChatId) {
            // Parar polling anterior se existir
            stopYouTubePolling();

            youtubeLiveData = {
                isLive: true,
                liveChatId,
                videoId,
                lastMessageId: null,
                processedMessages: new Set(),
                lastFetchTime: Date.now(),
                title: videoDetails.data.items[0].snippet.title
            };

            console.log(`✅ YouTube LIVE: ${youtubeLiveData.title}`);
            broadcastSystemMessage(`🎥 Conectado à live: ${youtubeLiveData.title}`);

            // Iniciar polling OTIMIZADO
            startYouTubePolling();
        }
    } catch (error) {
        console.error('❌ Erro ao verificar YouTube:', error.message);
        setTimeout(checkYouTubeLive, 60000); // Tentar novamente em 1 minuto
    }
}

function startYouTubePolling() {
    if (youtubeLiveData.fetchInterval) {
        clearInterval(youtubeLiveData.fetchInterval);
    }

    console.log('⚡ Iniciando polling do YouTube (3s)');

    // Primeira execução imediata
    fetchYouTubeMessages();

    // Configurar intervalo
    youtubeLiveData.fetchInterval = setInterval(fetchYouTubeMessages, config.youtube.messageInterval);
}

function stopYouTubePolling() {
    if (youtubeLiveData.fetchInterval) {
        clearInterval(youtubeLiveData.fetchInterval);
        youtubeLiveData.fetchInterval = null;
        console.log('⏸️ Polling do YouTube parado');
    }
}

async function fetchYouTubeMessages() {
    if (!youtubeLiveData.isLive || !youtubeLiveData.liveChatId) return;

    // Rate limiting: mínimo 2 segundos entre requests
    const now = Date.now();
    if (now - youtubeLiveData.lastFetchTime < 2000) {
        return;
    }

    youtubeLiveData.lastFetchTime = now;

    try {
        const params = {
            part: 'snippet,authorDetails',
            liveChatId: youtubeLiveData.liveChatId,
            maxResults: config.youtube.maxResults,
            key: YOUTUBE_API_KEY
        };

        // Usar pageToken apenas se existir (para continuidade)
        if (youtubeLiveData.lastMessageId) {
            params.pageToken = youtubeLiveData.lastMessageId;
        }

        const response = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
            params,
            timeout: 2000 // Timeout curto
        });

        if (response.data.items && response.data.items.length > 0) {
            // Processar mensagens da MAIS ANTIGA para a MAIS NOVA
            const messages = response.data.items;
            let newMessagesCount = 0;

            for (const msg of messages) {
                const messageId = msg.id;

                // VERIFICAR SE MENSAGEM JÁ FOI PROCESSADA
                if (youtubeLiveData.processedMessages.has(messageId) || messageCache.youtube.has(messageId)) {
                    continue; // Pular mensagem repetida
                }

                // Adicionar ao cache
                youtubeLiveData.processedMessages.add(messageId);
                messageCache.youtube.add(messageId);

                // Calcular delay
                const messageTime = new Date(msg.snippet.publishedAt).getTime();
                const currentTime = Date.now();
                const delay = currentTime - messageTime;

                // Ignorar mensagens com mais de 60 segundos de delay
                if (delay > 60000) {
                    continue;
                }

                // Log de performance
                if (delay > 10000) {
                    console.log(`⚠️ YouTube Delay: ${delay}ms - ${msg.authorDetails.displayName}`);
                }

                broadcast({
                    platform: 'youtube',
                    type: 'chat',
                    data: {
                        id: messageId,
                        user: msg.authorDetails.displayName,
                        message: msg.snippet.displayMessage,
                        timestamp: msg.snippet.publishedAt,
                        serverTime: new Date().toISOString(), // Tempo do servidor
                        delay: delay,
                        badges: {
                            isModerator: msg.authorDetails.isChatModerator,
                            isOwner: msg.authorDetails.isChatOwner,
                            isVerified: msg.authorDetails.isVerified
                        }
                    }
                });

                newMessagesCount++;
            }

            if (newMessagesCount > 0) {
                console.log(`🎥 YouTube: ${newMessagesCount} novas mensagens | Delay médio: ${delay}ms`);
            }

            // Atualizar pageToken para próxima requisição
            youtubeLiveData.lastMessageId = response.data.nextPageToken;

            // Limitar cache de mensagens processadas
            if (youtubeLiveData.processedMessages.size > 1000) {
                const array = Array.from(youtubeLiveData.processedMessages);
                youtubeLiveData.processedMessages = new Set(array.slice(-500));
            }
        } else {
            // Chat vazio
            console.log('🎥 YouTube: Nenhuma nova mensagem');
        }

    } catch (error) {
        console.error('❌ Erro ao buscar mensagens YouTube:', error.message);

        // Se erro de quota, aumentar intervalo
        if (error.response?.status === 403) {
            console.log('🚫 Quota do YouTube pode estar baixa. Aumentando intervalo...');
            config.youtube.messageInterval = 10000; // 10 segundos
            stopYouTubePolling();
            startYouTubePolling();
        }
    }
}

// ==================== TWITCH - SISTEMA ROBUSTO ====================
let twitchClient = null;
let twitchReconnectAttempts = 0;

function connectTwitch() {
    if (!config.twitch.enabled) return;

    console.log(`🎮 Conectando à Twitch: ${TWITCH_CHANNEL}`);

    twitchClient = new tmi.Client({
        channels: [TWITCH_CHANNEL],
        connection: {
            secure: true,
            reconnect: true,
            timeout: 3000
        },
        options: {
            debug: false,
            messagesLogLevel: 'info'
        },
        logger: {
            info: () => { },
            warn: (message) => console.log(`⚠️ Twitch: ${message}`),
            error: (message) => console.error(`❌ Twitch: ${message}`)
        }
    });

    twitchClient.connect().catch(error => {
        console.error('❌ Falha ao conectar Twitch:', error.message);
        scheduleTwitchReconnect();
    });

    twitchClient.on('message', (channel, tags, message, self) => {
        if (self) return;

        const messageId = tags.id || `${tags['user-id']}-${Date.now()}`;

        // Evitar mensagens repetidas
        if (messageCache.twitch.has(messageId)) return;
        messageCache.twitch.add(messageId);

        broadcast({
            platform: 'twitch',
            type: 'chat',
            data: {
                id: messageId,
                user: tags['display-name'] || tags.username,
                message: message,
                timestamp: new Date().toISOString(),
                color: tags.color || '#9146FF',
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
        twitchReconnectAttempts = 0;
        broadcastSystemMessage('🎮 Conectado ao chat da Twitch');
    });

    twitchClient.on('disconnected', (reason) => {
        console.log(`🔌 Twitch desconectado: ${reason}`);
        broadcastSystemMessage('🔴 Desconectado da Twitch');
        scheduleTwitchReconnect();
    });
}

function scheduleTwitchReconnect() {
    if (twitchReconnectAttempts >= config.twitch.maxReconnectAttempts) {
        console.log('⏸️ Máximo de tentativas de reconexão Twitch atingido');
        return;
    }

    twitchReconnectAttempts++;
    const delay = Math.min(30000, twitchReconnectAttempts * 5000);

    console.log(`🔄 Reconectando Twitch em ${delay / 1000}s (tentativa ${twitchReconnectAttempts})`);

    setTimeout(() => {
        if (twitchClient) {
            twitchClient.disconnect();
        }
        connectTwitch();
    }, delay);
}

// ==================== WEBSOCKET - SISTEMA ESTÁVEL ====================
const clients = new Map(); // Usar Map para melhor controle

function broadcast(data) {
    const message = JSON.stringify(data);
    const deadClients = [];

    clients.forEach((clientInfo, ws) => {
        if (ws.readyState === 1) { // OPEN
            try {
                ws.send(message);
                clientInfo.lastActivity = Date.now();
            } catch (error) {
                deadClients.push(ws);
            }
        } else {
            deadClients.push(ws);
        }
    });

    // Remover clientes mortos
    deadClients.forEach(ws => {
        clients.delete(ws);
        console.log(`👤 Cliente removido. Restantes: ${clients.size}`);
    });
}

function broadcastSystemMessage(text, type = 'info') {
    broadcast({
        platform: 'system',
        type: 'system',
        data: {
            message: text,
            timestamp: new Date().toISOString(),
            type: type
        }
    });
}

// Heartbeat para manter conexões ativas
setInterval(() => {
    clients.forEach((clientInfo, ws) => {
        if (ws.readyState === 1) {
            try {
                ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (error) {
                clients.delete(ws);
            }
        }
    });
}, 30000); // A cada 30 segundos

wss.on('connection', (ws, req) => {
    const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
    const clientInfo = {
        id: clientId,
        ip: req.socket.remoteAddress,
        connectedAt: Date.now(),
        lastActivity: Date.now()
    };

    clients.set(ws, clientInfo);
    console.log(`👤 Novo cliente ${clientId}. Total: ${clients.size}`);

    // Configurar timeout de inatividade
    const inactivityTimeout = setTimeout(() => {
        if (clients.has(ws)) {
            ws.close();
            clients.delete(ws);
            console.log(`⏰ Cliente ${clientId} removido por inatividade`);
        }
    }, 300000); // 5 minutos de inatividade

    // Mensagem de boas-vindas
    ws.send(JSON.stringify({
        platform: 'system',
        type: 'welcome',
        data: {
            message: '💬 Chat OBS Conectado!',
            timestamp: new Date().toISOString(),
            clientId: clientId,
            services: {
                youtube: youtubeLiveData.isLive,
                twitch: config.twitch.enabled
            }
        }
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'pong') {
                clientInfo.lastActivity = Date.now();
                clearTimeout(inactivityTimeout);
            }
        } catch (error) {
            // Ignorar mensagens inválidas
        }
    });

    ws.on('close', () => {
        clearTimeout(inactivityTimeout);
        clients.delete(ws);
        console.log(`👤 Cliente ${clientId} desconectado. Restantes: ${clients.size}`);
    });

    ws.on('error', (error) => {
        console.error(`❌ Erro WebSocket cliente ${clientId}:`, error.message);
        clients.delete(ws);
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
        timestamp: new Date().toISOString(),
        youtube: {
            isLive: youtubeLiveData.isLive,
            enabled: config.youtube.enabled,
            videoId: youtubeLiveData.videoId,
            pollingInterval: config.youtube.messageInterval
        },
        twitch: {
            enabled: config.twitch.enabled,
            channel: TWITCH_CHANNEL,
            connected: twitchClient ? twitchClient.readyState() === 'OPEN' : false
        },
        websocket: {
            clients: clients.size,
            uptime: process.uptime()
        }
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
        youtubeChannelId: "${YOUTUBE_CHANNEL_ID}",
        reconnectDelay: 3000
    };
} else {
    CONFIG = {
        twitchChannel: "${TWITCH_CHANNEL}",
        serverUrl: "wss://${host}",
        youtubeChannelId: "${YOUTUBE_CHANNEL_ID}",
        reconnectDelay: 5000
    };
}

console.log('⚙️ Configuração carregada:', CONFIG);
    `;

    res.header('Content-Type', 'application/javascript');
    res.send(configJs);
});

// Rota para limpar cache (apenas desenvolvimento)
app.get('/clear-cache', (req, res) => {
    if (process.env.NODE_ENV !== 'production') {
        youtubeLiveData.processedMessages.clear();
        messageCache.youtube.clear();
        messageCache.twitch.clear();
        res.json({ message: 'Cache limpo', cacheSize: messageCache.youtube.size });
    } else {
        res.status(403).json({ error: 'Apenas em desenvolvimento' });
    }
});

// ==================== INICIALIZAÇÃO ====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📺 YouTube: ${config.youtube.enabled ? 'HABILITADO' : 'DESABILITADO (sem API Key)'}`);
    console.log(`🎮 Twitch: ${TWITCH_CHANNEL}`);
    console.log(`🌐 WebSocket: wss://localhost:${PORT}`);
    console.log(`⚡ Polling YouTube: ${config.youtube.messageInterval}ms`);

    // Iniciar serviços com delay para evitar sobrecarga
    setTimeout(() => {
        if (config.twitch.enabled) {
            connectTwitch();
        }

        if (config.youtube.enabled) {
            // Verificar YouTube a cada 30 segundos
            setInterval(checkYouTubeLive, config.youtube.checkInterval);
            checkYouTubeLive(); // Verificação inicial
        }
    }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Encerrando servidor graciosamente...');

    // Parar serviços
    stopYouTubePolling();
    if (twitchClient) {
        twitchClient.disconnect();
    }

    // Fechar WebSocket
    clients.forEach((_, ws) => {
        ws.close();
    });

    setTimeout(() => {
        console.log('👋 Servidor encerrado');
        process.exit(0);
    }, 1000);
});