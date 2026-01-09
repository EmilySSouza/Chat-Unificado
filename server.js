const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// YouTube API Configuration
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC5ooSCrMhz10WUWrc6IlT3Q';

// Configurações de otimização
const CONFIG = {
    // Otimizações para economizar quota
    CHECK_LIVE_INTERVAL: 60000, // 1 minuto (em vez de 30s)
    MIN_POLLING_INTERVAL: 5000, // 5 segundos mínimo
    MAX_POLLING_INTERVAL: 30000, // 30 segundos máximo
    MAX_MESSAGES_PER_POLL: 50, // Limitar mensagens por poll
    CACHE_DURATION: 30000, // 30 segundos de cache
    
    // Twitch
    TWITCH_CHANNEL: process.env.TWITCH_CHANNEL || 'funilzinha'
};

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(express.static(__dirname));

// Estado do sistema
let currentLiveVideoId = null;
let currentLiveChatId = null;
let lastChatMessageIds = new Set();
const clients = [];

// Cache para reduzir chamadas à API
const cache = {
    videoInfo: null,
    lastChecked: 0,
    messages: [],
    liveChatId: null,
    lastLiveCheck: 0
};

// Sistema de polling
let pollingInterval = null;
let currentPollingDelay = 10000; // Começa com 10 segundos
let isCheckingLive = false;

// Verificar horário para otimização
function shouldCheckForLive() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Se já temos uma live, verificar menos frequentemente
    if (currentLiveVideoId) {
        // Se já temos uma live, só verificar a cada 5 minutos
        const timeSinceLastCheck = Date.now() - cache.lastLiveCheck;
        return timeSinceLastCheck > 300000; // 5 minutos
    }
    
    // Sem live ativa - verificar baseado no horário
    if (hour >= 0 && hour < 6) { // Madrugada (0-6h)
        return Math.random() < 0.2; // 20% chance (verifica menos)
    }
    
    if (hour >= 6 && hour < 12) { // Manhã (6-12h)
        return Math.random() < 0.5; // 50% chance
    }
    
    if (hour >= 12 && hour < 18) { // Tarde (12-18h)
        return Math.random() < 0.7; // 70% chance
    }
    
    // Noite (18-24h) - horário de pico
    return Math.random() < 0.9; // 90% chance
}

// Função para verificar se há uma live ativa (otimizada)
async function checkForActiveLiveStream() {
    if (isCheckingLive) return { success: false, message: 'Already checking' };
    
    isCheckingLive = true;
    cache.lastLiveCheck = Date.now();
    
    try {
        console.log('🔍 Verificando lives ativas...');
        
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                channelId: YOUTUBE_CHANNEL_ID,
                eventType: 'live',
                type: 'video',
                maxResults: 1,
                key: YOUTUBE_API_KEY
            },
            timeout: 10000
        });

        if (response.data.items && response.data.items.length > 0) {
            const liveVideo = response.data.items[0];
            const videoId = liveVideo.id.videoId;
            
            console.log(`✅ Live encontrada: ${liveVideo.snippet.title}`);
            console.log(`📺 Video ID: ${videoId}`);
            
            // Obter liveChatId do vídeo
            const videoResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'liveStreamingDetails',
                    id: videoId,
                    key: YOUTUBE_API_KEY
                },
                timeout: 10000
            });

            if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                const liveChatId = videoResponse.data.items[0].liveStreamingDetails?.activeLiveChatId;
                
                if (liveChatId) {
                    cache.liveChatId = liveChatId;
                    cache.videoInfo = {
                        videoId,
                        title: liveVideo.snippet.title,
                        thumbnail: liveVideo.snippet.thumbnails.default.url,
                        publishedAt: liveVideo.snippet.publishedAt
                    };
                    cache.lastChecked = Date.now();
                    
                    isCheckingLive = false;
                    return { 
                        success: true, 
                        liveChatId,
                        videoInfo: cache.videoInfo
                    };
                }
            }
        }
        
        console.log('📭 Nenhuma live ativa no momento');
        isCheckingLive = false;
        return { success: false, message: 'No active live stream' };
        
    } catch (error) {
        console.error('❌ Erro ao verificar live:', error.response?.data?.error?.message || error.message);
        
        // Se for erro de quota, esperar mais tempo
        if (error.response?.data?.error?.code === 403) {
            console.log('⚠️ Quota excedida ou acesso negado. Aguardando 5 minutos...');
            currentPollingDelay = 300000; // 5 minutos
        }
        
        isCheckingLive = false;
        return { success: false, error: error.message };
    }
}

// Função para buscar mensagens do chat (otimizada)
async function fetchChatMessages(liveChatId, pageToken = null) {
    try {
        const params = {
            part: 'snippet,authorDetails',
            liveChatId: liveChatId,
            maxResults: CONFIG.MAX_MESSAGES_PER_POLL, // Limitar para economizar quota
            key: YOUTUBE_API_KEY
        };

        if (pageToken) {
            params.pageToken = pageToken;
        }

        const response = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
            params,
            timeout: 10000
        });

        const messages = response.data.items || [];
        const nextPageToken = response.data.nextPageToken;
        
        // Calcular polling delay baseado na API e nossas configurações
        const apiPollingInterval = response.data.pollingIntervalMillis || 5000;
        let newPollingDelay = Math.max(
            CONFIG.MIN_POLLING_INTERVAL,
            Math.min(apiPollingInterval, CONFIG.MAX_POLLING_INTERVAL)
        );
        
        console.log(`📩 ${messages.length} mensagens | Delay: ${newPollingDelay}ms`);

        // Processar novas mensagens
        const newMessages = messages.filter(msg => {
            const messageId = msg.id;
            if (!lastChatMessageIds.has(messageId)) {
                lastChatMessageIds.add(messageId);
                return true;
            }
            return false;
        }).slice(0, 20) // Limitar para não sobrecarregar o cliente
        .map(msg => ({
            id: msg.id,
            user: msg.authorDetails.displayName,
            message: msg.snippet.displayMessage,
            timestamp: msg.snippet.publishedAt,
            badges: {
                isModerator: msg.authorDetails.isChatModerator,
                isOwner: msg.authorDetails.isChatOwner,
                isVerified: msg.authorDetails.isVerified,
                isMember: msg.authorDetails.isChatSponsor || false
            },
            profileImage: msg.authorDetails.profileImageUrl
        }));

        // Limitar cache de IDs (evitar memory leak)
        if (lastChatMessageIds.size > 1000) {
            const idsArray = Array.from(lastChatMessageIds);
            lastChatMessageIds = new Set(idsArray.slice(-500));
        }

        return {
            success: true,
            messages: newMessages,
            nextPageToken,
            pollingIntervalMillis: newPollingDelay
        };

    } catch (error) {
        console.error('❌ Erro ao buscar mensagens:', error.response?.data?.error?.message || error.message);
        
        // Se for erro de quota, aumentar o delay
        if (error.response?.data?.error?.code === 403) {
            console.log('⚠️ Quota excedida. Aumentando intervalo de polling...');
            return {
                success: false,
                error: 'quota_exceeded',
                pollingIntervalMillis: 60000 // 1 minuto
            };
        }
        
        return { 
            success: false, 
            error: error.message,
            pollingIntervalMillis: 30000 // 30 segundos em caso de erro
        };
    }
}

// Sistema de polling otimizado
async function startPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    console.log('🔄 Iniciando/Reiniciando polling do chat...');

    // Verificar se devemos procurar por live
    if (!currentLiveChatId || shouldCheckForLive()) {
        const liveCheck = await checkForActiveLiveStream();
        
        if (liveCheck.success && liveCheck.liveChatId) {
            currentLiveVideoId = liveCheck.videoInfo.videoId;
            currentLiveChatId = liveCheck.liveChatId;
            
            // Primeira busca (pega histórico)
            const chatData = await fetchChatMessages(liveCheck.liveChatId);
            
            if (chatData.success) {
                // Enviar mensagem de sistema
                broadcast({
                    type: 'system',
                    data: {
                        message: `✅ Conectado à live: ${liveCheck.videoInfo.title}`,
                        videoInfo: liveCheck.videoInfo
                    }
                });

                // Enviar histórico se houver
                if (chatData.messages.length > 0) {
                    chatData.messages.forEach(msg => {
                        broadcast({
                            type: 'youtube',
                            data: msg
                        });
                    });
                }

                // Configurar intervalo baseado na resposta
                currentPollingDelay = chatData.pollingIntervalMillis || CONFIG.MIN_POLLING_INTERVAL;
                
                // Iniciar polling regular
                startRegularPolling(liveCheck.liveChatId);
                
            } else if (chatData.error === 'quota_exceeded') {
                // Se quota excedida, esperar mais tempo
                currentPollingDelay = 120000; // 2 minutos
                scheduleNextPoll();
            }
        } else {
            // Nenhuma live ativa
            handleNoLiveStream();
        }
    } else {
        // Já temos liveChatId, continuar polling normal
        startRegularPolling(currentLiveChatId);
    }
}

function startRegularPolling(liveChatId) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    pollingInterval = setInterval(async () => {
        const chatData = await fetchChatMessages(liveChatId);
        
        if (chatData.success && chatData.messages.length > 0) {
            chatData.messages.forEach(msg => {
                broadcast({
                    type: 'youtube',
                    data: msg
                });
            });
        }
        
        // Ajustar delay se necessário
        if (chatData.pollingIntervalMillis && chatData.pollingIntervalMillis !== currentPollingDelay) {
            currentPollingDelay = chatData.pollingIntervalMillis;
            console.log(`⚡ Ajustando polling delay para: ${currentPollingDelay}ms`);
            clearInterval(pollingInterval);
            startRegularPolling(liveChatId);
        }
        
        // Verificar se ainda estamos em live a cada 10 ciclos
        if (Math.random() < 0.1) { // 10% chance a cada polling
            setTimeout(() => {
                if (shouldCheckForLive()) {
                    checkForActiveLiveStream().then(result => {
                        if (!result.success) {
                            handleNoLiveStream();
                        }
                    });
                }
            }, 1000);
        }
        
    }, currentPollingDelay);

    console.log(`✅ Polling iniciado (${currentPollingDelay}ms)`);
}

function handleNoLiveStream() {
    currentLiveVideoId = null;
    currentLiveChatId = null;
    
    // Limpar IDs antigos quando não há live
    lastChatMessageIds.clear();
    
    broadcast({
        type: 'system',
        data: {
            message: '⏳ Aguardando transmissão ao vivo...',
            isLive: false
        }
    });

    console.log('⏳ Nenhuma live ativa, verificando novamente em 1 minuto...');
    
    // Agendar próxima verificação
    scheduleNextPoll();
}

function scheduleNextPoll() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    
    setTimeout(startPolling, CONFIG.CHECK_LIVE_INTERVAL);
}

// Broadcast function
function broadcast(data) {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
    const now = Date.now();
    
    clients.forEach((client, index) => {
        try {
            client.write(sseMessage);
        } catch (error) {
            // Remover cliente se der erro
            clients.splice(index, 1);
        }
    });
}

// Rotas
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    clients.push(res);

    // Keep alive
    const keepAlive = setInterval(() => {
        try {
            res.write(': keepalive\n\n');
        } catch (error) {
            clearInterval(keepAlive);
        }
    }, 30000);

    // Mensagem de boas-vindas
    res.write(`data: ${JSON.stringify({
        type: 'welcome',
        data: {
            message: '💬 Chat OBS iniciado',
            youtubeStatus: currentLiveVideoId ? 'Conectado' : 'Verificando...',
            timestamp: new Date().toLocaleTimeString('pt-BR'),
            config: {
                twitchChannel: CONFIG.TWITCH_CHANNEL,
                youtubeChannelId: YOUTUBE_CHANNEL_ID
            }
        }
    })}\n\n`);

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

// Rota de status
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        youtube: {
            isLive: !!currentLiveVideoId,
            videoId: currentLiveVideoId,
            liveChatId: currentLiveChatId,
            pollingDelay: currentPollingDelay,
            quotaOptimized: true,
            lastChecked: cache.lastChecked
        },
        system: {
            clients: clients.length,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        }
    });
});

// Rota de teste
app.get('/test', (req, res) => {
    res.json({
        message: 'Servidor funcionando',
        timestamp: new Date().toISOString(),
        youtubeApiKey: YOUTUBE_API_KEY ? 'Configurada' : 'Não configurada',
        channelId: YOUTUBE_CHANNEL_ID
    });
});

// Outras rotas
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/config.js', (req, res) => {
    const protocol = req.hostname.includes('onrender.com') ? 'https' : req.protocol;
    const serverUrl = `${protocol}://${req.get('host')}`;
    
    const config = `
const CONFIG = {
    twitchChannel: "${CONFIG.TWITCH_CHANNEL}",
    serverUrl: "${serverUrl}",
    youtubeChannelId: "${YOUTUBE_CHANNEL_ID}",
    apiConfigured: ${!!YOUTUBE_API_KEY}
};
    `;
    
    res.header('Content-Type', 'application/javascript');
    res.send(config);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        youtubeLive: !!currentLiveVideoId,
        clients: clients.length,
        pollingDelay: currentPollingDelay,
        timestamp: new Date().toISOString()
    });
});

// Rota para forçar verificação de live
app.get('/check-live', async (req, res) => {
    const result = await checkForActiveLiveStream();
    res.json(result);
});

// Middleware de erro
app.use((err, req, res, next) => {
    console.error('❌ Erro no servidor:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    console.log(`📺 YouTube Channel ID: ${YOUTUBE_CHANNEL_ID}`);
    console.log(`🔑 YouTube API Key: ${YOUTUBE_API_KEY ? 'Configurada ✓' : 'NÃO configurada ✗'}`);
    console.log(`⚡ Otimizações de quota: ATIVADAS`);
    console.log(`📊 Configurações:`, CONFIG);
    
    // Iniciar polling após 3 segundos
    setTimeout(startPolling, 3000);
});

// Limpeza ao sair
process.on('SIGTERM', () => {
    console.log('🛑 Servidor encerrando...');
    if (pollingInterval) clearInterval(pollingInterval);
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Servidor interrompido');
    if (pollingInterval) clearInterval(pollingInterval);
    process.exit(0);
});