const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// YouTube API Configuration - ESSENCIAL!
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC5ooSCrMhz10WUWrc6IlT3Q';

// CONTADOR DE QUOTA - para monitorar uso
let quotaUsage = {
    today: new Date().toISOString().split('T')[0],
    unitsUsed: 0,
    lastReset: Date.now()
};

// Configurações OTIMIZADAS para quota gratuita
const CONFIG = {
    // YouTube API Quota Costs (aproximado)
    QUOTA_COSTS: {
        search: 100,     // search.list
        videos: 1,       // videos.list
        liveChat: 5,     // liveChatMessages.list (mínimo)
        channels: 1      // channels.list
    },

    // Limites DIÁRIOS (gratuito: 10,000 unidades)
    DAILY_QUOTA_LIMIT: 8000, // Deixamos 20% de margem

    // Polling OTIMIZADO
    CHECK_LIVE_INTERVAL: 300000, // 5 MINUTOS (em vez de 1)
    MIN_POLLING_INTERVAL: 10000, // 10 segundos mínimo
    MAX_POLLING_INTERVAL: 60000, // 60 segundos máximo

    // Otimizações
    MAX_MESSAGES_PER_POLL: 20,    // Reduzido de 50 para 20
    ENABLE_CACHE: true,
    CACHE_DURATION: 60000,        // 1 minuto

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

// Sistema de polling
let pollingInterval = null;
let currentPollingDelay = 15000; // Começa com 15 segundos
let isCheckingLive = false;
let lastLiveCheckTime = 0;

// ==================== SISTEMA DE QUOTA ====================
function updateQuotaUsage(cost) {
    const today = new Date().toISOString().split('T')[0];

    // Reset diário
    if (quotaUsage.today !== today) {
        quotaUsage = {
            today: today,
            unitsUsed: 0,
            lastReset: Date.now()
        };
    }

    quotaUsage.unitsUsed += cost;

    // Log de uso
    if (cost > 0) {
        console.log(`📊 Quota: +${cost} unidades = ${quotaUsage.unitsUsed}/${CONFIG.DAILY_QUOTA_LIMIT}`);

        // Aviso se estiver perto do limite
        const percentUsed = (quotaUsage.unitsUsed / CONFIG.DAILY_QUOTA_LIMIT) * 100;
        if (percentUsed > 80) {
            console.warn(`⚠️ ATENÇÃO: ${percentUsed.toFixed(1)}% da quota utilizada!`);
        }
    }

    return quotaUsage.unitsUsed;
}

function canMakeRequest(minimumQuota = 1) {
    const remainingQuota = CONFIG.DAILY_QUOTA_LIMIT - quotaUsage.unitsUsed;
    return remainingQuota >= minimumQuota;
}

function getOptimizedPollingDelay() {
    const percentUsed = (quotaUsage.unitsUsed / CONFIG.DAILY_QUOTA_LIMIT) * 100;

    if (percentUsed > 90) return 300000; // 5 minutos se >90%
    if (percentUsed > 70) return 120000; // 2 minutos se >70%
    if (percentUsed > 50) return 60000;  // 1 minuto se >50%
    if (percentUsed > 30) return 30000;  // 30 segundos se >30%

    return 10000; // 10 segundos padrão
}

// ==================== YOUTUBE API FUNCTIONS ====================
async function checkForActiveLiveStream() {
    if (isCheckingLive) return { success: false, message: 'Already checking' };
    if (!canMakeRequest(CONFIG.QUOTA_COSTS.search + CONFIG.QUOTA_COSTS.videos)) {
        console.log('⏸️ Pausando verificação de live - quota insuficiente');
        return { success: false, message: 'Insufficient quota' };
    }

    isCheckingLive = true;
    lastLiveCheckTime = Date.now();

    try {
        console.log('🔍 Verificando lives ativas...');

        // 1. Buscar live (100 unidades)
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
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

        updateQuotaUsage(CONFIG.QUOTA_COSTS.search);

        if (response.data.items && response.data.items.length > 0) {
            const liveVideo = response.data.items[0];
            const videoId = liveVideo.id.videoId;

            console.log(`✅ Live encontrada: ${liveVideo.snippet.title}`);

            // 2. Obter liveChatId (1 unidade)
            const videoResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'liveStreamingDetails',
                    id: videoId,
                    key: YOUTUBE_API_KEY
                },
                timeout: 5000
            });

            updateQuotaUsage(CONFIG.QUOTA_COSTS.videos);

            if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                const liveChatId = videoResponse.data.items[0].liveStreamingDetails?.activeLiveChatId;

                if (liveChatId) {
                    return {
                        success: true,
                        liveChatId,
                        videoInfo: {
                            videoId,
                            title: liveVideo.snippet.title,
                            publishedAt: liveVideo.snippet.publishedAt
                        }
                    };
                }
            }
        }

        console.log('📭 Nenhuma live ativa no momento');
        isCheckingLive = false;
        return { success: false, message: 'No active live stream' };

    } catch (error) {
        console.error('❌ Erro ao verificar live:', error.response?.data?.error?.message || error.message);

        // Se for erro 403 (quota), aumentar delay drasticamente
        if (error.response?.status === 403) {
            console.log('🚫 QUOTA EXCEDIDA! Aumentando intervalos...');
            currentPollingDelay = 300000; // 5 minutos
            updateQuotaUsage(1000); // Penalidade alta para forçar redução
        }

        isCheckingLive = false;
        return { success: false, error: error.message };
    }
}

async function fetchChatMessages(liveChatId) {
    if (!canMakeRequest(CONFIG.QUOTA_COSTS.liveChat)) {
        console.log('⏸️ Pausando fetch de mensagens - quota insuficiente');
        return { success: false, message: 'Insufficient quota' };
    }

    try {
        const params = {
            part: 'snippet,authorDetails',
            liveChatId: liveChatId,
            maxResults: CONFIG.MAX_MESSAGES_PER_POLL,
            key: YOUTUBE_API_KEY
        };

        const response = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
            params,
            timeout: 5000
        });

        // Atualizar quota (5 unidades por request)
        updateQuotaUsage(CONFIG.QUOTA_COSTS.liveChat);

        const messages = response.data.items || [];
        const nextPageToken = response.data.nextPageToken;

        // NÃO USAR pollingIntervalMillis da API - usar nosso sistema otimizado
        const optimizedDelay = getOptimizedPollingDelay();

        console.log(`📩 ${messages.length} mensagens | Delay: ${optimizedDelay / 1000}s | Quota: ${quotaUsage.unitsUsed}`);

        // Processar SOMENTE mensagens NOVAS
        const newMessages = [];
        for (const msg of messages) {
            const messageId = msg.id;

            // Verificar se é mensagem nova (não está no cache)
            if (!lastChatMessageIds.has(messageId)) {
                lastChatMessageIds.add(messageId);

                // Verificar se a mensagem é recente (últimos 30 segundos)
                const messageTime = new Date(msg.snippet.publishedAt).getTime();
                const currentTime = Date.now();
                const messageAge = currentTime - messageTime;

                // Só mostrar mensagens dos últimos 60 segundos para evitar atraso
                if (messageAge < 60000) {
                    newMessages.push({
                        id: msg.id,
                        user: msg.authorDetails.displayName,
                        message: msg.snippet.displayMessage,
                        timestamp: msg.snippet.publishedAt,
                        realTime: new Date().toISOString(), // Tempo real do servidor
                        badges: {
                            isModerator: msg.authorDetails.isChatModerator,
                            isOwner: msg.authorDetails.isChatOwner,
                            isVerified: msg.authorDetails.isVerified,
                            isMember: msg.authorDetails.isChatSponsor || false
                        }
                    });
                }
            }
        }

        // Limitar cache de IDs
        if (lastChatMessageIds.size > 500) {
            const idsArray = Array.from(lastChatMessageIds);
            lastChatMessageIds = new Set(idsArray.slice(-200));
        }

        return {
            success: true,
            messages: newMessages,
            nextPageToken,
            pollingIntervalMillis: optimizedDelay
        };

    } catch (error) {
        console.error('❌ Erro ao buscar mensagens:', error.response?.data?.error?.message || error.message);

        // Se for erro de quota, aumentar delay
        if (error.response?.status === 403) {
            console.log('🚫 Quota excedida no fetch. Aumentando delay...');
            updateQuotaUsage(100); // Penalidade
            return {
                success: false,
                error: 'quota_exceeded',
                pollingIntervalMillis: 300000 // 5 minutos
            };
        }

        return {
            success: false,
            error: error.message,
            pollingIntervalMillis: 60000 // 1 minuto em caso de erro
        };
    }
}

// ==================== POLLING SYSTEM ====================
async function startPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    console.log('🔄 Iniciando polling otimizado...');

    // Verificar se podemos fazer requests
    if (!canMakeRequest()) {
        console.log('⏸️ Polling pausado - quota diária atingida');
        broadcastSystemMessage('⏸️ Sistema em modo econômico - quota limitada');
        scheduleNextPoll(300000); // Tentar novamente em 5 minutos
        return;
    }

    // Verificar live a cada 5 minutos OU se não temos live atual
    const timeSinceLastCheck = Date.now() - lastLiveCheckTime;
    const shouldCheckLive = !currentLiveChatId || timeSinceLastCheck > 300000;

    if (shouldCheckLive) {
        const liveCheck = await checkForActiveLiveStream();

        if (liveCheck.success && liveCheck.liveChatId) {
            currentLiveVideoId = liveCheck.videoInfo.videoId;
            currentLiveChatId = liveCheck.liveChatId;

            // Limpar cache de mensagens antigas quando inicia nova live
            lastChatMessageIds.clear();

            broadcast({
                type: 'system',
                data: {
                    message: `✅ Conectado à live: ${liveCheck.videoInfo.title}`,
                    videoInfo: liveCheck.videoInfo,
                    quota: quotaUsage.unitsUsed
                }
            });

            // Iniciar polling do chat
            startChatPolling(liveCheck.liveChatId);

        } else {
            // Nenhuma live ativa
            handleNoLiveStream();
        }
    } else {
        // Continuar polling do chat existente
        startChatPolling(currentLiveChatId);
    }
}

function startChatPolling(liveChatId) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    // Delay otimizado baseado na quota
    currentPollingDelay = getOptimizedPollingDelay();

    console.log(`⚡ Polling do chat iniciado: ${currentPollingDelay / 1000}s`);

    // Primeira execução imediata
    fetchAndBroadcastMessages(liveChatId);

    // Configurar intervalo
    pollingInterval = setInterval(() => {
        fetchAndBroadcastMessages(liveChatId);
    }, currentPollingDelay);
}

async function fetchAndBroadcastMessages(liveChatId) {
    if (!canMakeRequest(CONFIG.QUOTA_COSTS.liveChat)) {
        console.log('⏸️ Skipping fetch - insufficient quota');
        return;
    }

    const chatData = await fetchChatMessages(liveChatId);

    if (chatData.success && chatData.messages.length > 0) {
        chatData.messages.forEach(msg => {
            // Adicionar timestamp do servidor para sincronização
            msg.serverTime = new Date().toISOString();
            broadcast({
                type: 'youtube',
                data: msg
            });
        });

        // Log da última mensagem
        const lastMsg = chatData.messages[chatData.messages.length - 1];
        console.log(`💬 Última mensagem: ${lastMsg.user}: ${lastMsg.message.substring(0, 30)}...`);
    }

    // Ajustar delay se necessário
    if (chatData.pollingIntervalMillis && Math.abs(chatData.pollingIntervalMillis - currentPollingDelay) > 5000) {
        currentPollingDelay = chatData.pollingIntervalMillis;
        console.log(`🔧 Ajustando delay para: ${currentPollingDelay / 1000}s`);
        restartPolling();
    }
}

function handleNoLiveStream() {
    currentLiveVideoId = null;
    currentLiveChatId = null;
    lastChatMessageIds.clear();

    broadcastSystemMessage('⏳ Aguardando transmissão ao vivo...');

    console.log('⏳ Sem live ativa. Próxima verificação em 5 minutos...');
    scheduleNextPoll(300000); // 5 minutos
}

function scheduleNextPoll(delay = null) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    const nextDelay = delay || currentPollingDelay;
    setTimeout(startPolling, nextDelay);
}

function restartPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    if (currentLiveChatId) {
        startChatPolling(currentLiveChatId);
    } else {
        startPolling();
    }
}

// ==================== BROADCAST & SYSTEM ====================
function broadcast(data) {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach((client, index) => {
        try {
            client.write(sseMessage);
        } catch (error) {
            // Remover cliente desconectado
            clients.splice(index, 1);
        }
    });
}

function broadcastSystemMessage(message) {
    broadcast({
        type: 'system',
        data: {
            message,
            timestamp: new Date().toISOString(),
            quota: quotaUsage.unitsUsed
        }
    });
}

// ==================== ROUTES ====================
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
            message: '💬 Chat OBS - Modo Otimizado',
            youtubeStatus: currentLiveVideoId ? 'LIVE' : 'OFFLINE',
            timestamp: new Date().toLocaleTimeString('pt-BR'),
            quota: quotaUsage.unitsUsed,
            settings: {
                pollingDelay: currentPollingDelay / 1000 + 's',
                dailyQuota: CONFIG.DAILY_QUOTA_LIMIT
            }
        }
    })}\n\n`);

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

// Rota de status com informações de quota
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        youtube: {
            isLive: !!currentLiveVideoId,
            videoId: currentLiveVideoId,
            liveChatId: currentLiveChatId,
            pollingDelay: currentPollingDelay,
            lastChecked: lastLiveCheckTime
        },
        quota: {
            unitsUsed: quotaUsage.unitsUsed,
            dailyLimit: CONFIG.DAILY_QUOTA_LIMIT,
            percentUsed: ((quotaUsage.unitsUsed / CONFIG.DAILY_QUOTA_LIMIT) * 100).toFixed(1) + '%',
            canMakeRequests: canMakeRequest(),
            today: quotaUsage.today
        },
        system: {
            clients: clients.length,
            uptime: process.uptime(),
            memory: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
        }
    });
});

// Rota para reset manual (apenas desenvolvimento)
app.get('/reset-quota', (req, res) => {
    if (process.env.NODE_ENV === 'development') {
        quotaUsage.unitsUsed = 0;
        quotaUsage.lastReset = Date.now();
        res.json({ message: 'Quota resetada', quotaUsage });
    } else {
        res.status(403).json({ error: 'Apenas em desenvolvimento' });
    }
});

// Rota para simular mensagem (para testes)
app.get('/test-message', (req, res) => {
    const testMsg = {
        type: 'youtube',
        data: {
            id: 'test-' + Date.now(),
            user: 'UsuarioTeste',
            message: 'Esta é uma mensagem de teste em tempo real! ' + new Date().toLocaleTimeString(),
            timestamp: new Date().toISOString(),
            serverTime: new Date().toISOString(),
            badges: {
                isModerator: false,
                isOwner: false,
                isVerified: false
            }
        }
    };

    broadcast(testMsg);
    res.json({ sent: true, message: testMsg.data.message });
});

// Rotas padrão
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
    youtubeChannelId: "${YOUTUBE_CHANNEL_ID}"
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
        quota: quotaUsage.unitsUsed,
        timestamp: new Date().toISOString()
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    console.log(`📺 YouTube: ${YOUTUBE_CHANNEL_ID}`);
    console.log(`🔑 API Key: ${YOUTUBE_API_KEY ? 'Configurada' : 'NÃO CONFIGURADA!'}`);
    console.log(`💰 Quota diária: ${CONFIG.DAILY_QUOTA_LIMIT} unidades`);
    console.log(`⚡ Polling otimizado: ${currentPollingDelay / 1000}s`);

    if (!YOUTUBE_API_KEY) {
        console.warn('⚠️ ⚠️ ⚠️ AVISO: YOUTUBE_API_KEY não configurada!');
        console.warn('   O chat do YouTube não funcionará sem uma API Key.');
        console.warn('   Obtenha uma em: https://console.cloud.google.com/');
    }

    // Iniciar polling após 2 segundos
    setTimeout(startPolling, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Encerrando servidor...');
    if (pollingInterval) clearInterval(pollingInterval);

    // Enviar mensagem de despedida
    broadcastSystemMessage('🔴 Servidor encerrando...');

    setTimeout(() => process.exit(0), 1000);
});