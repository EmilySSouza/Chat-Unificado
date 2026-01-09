const express = require('express');
const { LiveChat } = require('youtube-chat');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UC5ooSCrMhz10WUWrc6IlT3Q"
};

// Middleware CORS
app.use((req, res, next) => {
    const allowedOrigins = [
        'https://chat-unificado.onrender.com',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
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
let isYouTubeLive = false; // NOVO: flag para controlar estado
const clients = [];

// FUNÇÃO PRINCIPAL DE CONEXÃO - CORRIGIDA
async function connectYouTube() {
    try {
        console.log('🔄 Conectando ao YouTube...');

        // Para conexão anterior se existir
        if (youtubeChat) {
            try {
                youtubeChat.stop();
                console.log('🔌 Conexão anterior encerrada');
            } catch (e) {
                // Ignora
            }
        }

        // Reseta flag
        isYouTubeLive = false;

        console.log(`📺 Usando channelId: ${CONFIG.youtubeChannelId}`);
        youtubeChat = new LiveChat({
            channelId: CONFIG.youtubeChannelId,
            pollingInterval: 5000 // Aumentei para 5 segundos
        });

        // Configura eventos
        youtubeChat.on('chat', (message) => {
            try {
                // Só processa mensagens se estiver em live
                if (!isYouTubeLive) {
                    console.log('⚠️ Mensagem recebida mas isYouTubeLive = false');
                    return;
                }

                let messageText = '';

                if (typeof message.message === 'string') {
                    messageText = message.message;
                } else if (Array.isArray(message.message)) {
                    messageText = message.message
                        .map(item => item.text || '')
                        .filter(text => text)
                        .join(' ');
                } else if (message.text) {
                    messageText = message.text;
                }

                const userName = message.author?.name ||
                    message.author?.displayName ||
                    'Anônimo';

                console.log(`📩 YouTube: ${userName}: ${messageText.substring(0, 50)}...`);

                broadcast({
                    type: 'youtube',
                    data: {
                        user: userName,
                        message: messageText,
                        time: message.timestamp ?
                            new Date(message.timestamp).toLocaleTimeString('pt-BR') :
                            new Date().toLocaleTimeString('pt-BR'),
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

        youtubeChat.on('start', (liveInfo) => {
            console.log('✅ YouTube: Conectado ao chat!');
            if (liveInfo) {
                console.log(`   Live Info: ${liveInfo}`);
            }

            // MARCA COMO LIVE ATIVA
            isYouTubeLive = true;

            broadcast({
                type: 'system',
                data: '✅ YouTube: Conectado à transmissão ao vivo!'
            });
        });

        youtubeChat.on('end', () => {
            console.log('🔴 YouTube: Chat encerrado');
            isYouTubeLive = false; // MARCA COMO NÃO LIVE

            broadcast({
                type: 'system',
                data: '🔴 YouTube: Transmissão encerrada'
            });

            // Se ainda estivermos no servidor, aguarda 30s e tenta novamente
            setTimeout(() => {
                if (!isYouTubeLive) {
                    console.log('🔄 Tentando reconectar após encerramento...');
                    connectYouTube();
                }
            }, 30000);
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ YouTube Erro:', error.message || error);

            // Verifica se é erro "no live stream"
            if (error.message.includes('No live stream') ||
                error.message.includes('not found') ||
                error.message.includes('No active live')) {

                console.log('⏳ YouTube: Nenhuma transmissão ativa no momento');
                isYouTubeLive = false;

                // NÃO ENVIA MENSAGEM PARA O CHAT - apenas log
                // broadcast({ 
                //     type: 'system', 
                //     data: '⏳ YouTube: Aguardando início da transmissão...' 
                // });

                // Tenta reconectar em 60 segundos
                setTimeout(connectYouTube, 60000);

            } else if (error.message.includes('ended')) {
                console.log('🔴 YouTube: Transmissão foi encerrada');
                isYouTubeLive = false;
                broadcast({
                    type: 'system',
                    data: '🔴 YouTube: Transmissão encerrada'
                });
                setTimeout(connectYouTube, 30000);

            } else {
                // Outros erros
                console.log('🔄 YouTube: Erro genérico, reconectando em 30s');
                setTimeout(connectYouTube, 30000);
            }
        });

        // NOVO EVENTO: Quando recebe dados da live
        youtubeChat.on('metadata', (metadata) => {
            console.log('📊 YouTube Metadata recebida');
            if (metadata && metadata.isLive) {
                isYouTubeLive = true;
                console.log('✅ YouTube: Metadata confirma LIVE ATIVA');
            }
        });

        // Inicia a conexão
        await youtubeChat.start();
        console.log('🎉 Conexão YouTube iniciada!');

    } catch (error) {
        console.error('💥 Erro crítico ao conectar:', error.message);

        // Tipos específicos de erro
        if (error.message.includes('No live stream') ||
            error.message.includes('not found')) {
            console.log('⏳ Nenhuma live ativa no momento');
            // NÃO envia mensagem para o chat
        } else {
            broadcast({
                type: 'system',
                data: '⚠️ YouTube: Erro de conexão'
            });
        }

        // Tenta novamente em 60 segundos
        setTimeout(connectYouTube, 60000);
    }
}

// FUNÇÃO PARA TRANSMITIR PARA CLIENTES SSE
function broadcast(data) {
    // FILTRO: Não envia certas mensagens repetitivas
    const skipMessages = [
        'Aguardando início da transmissão',
        'Aguardando transmissão',
        'Nenhuma transmissão ativa'
    ];

    const messageText = typeof data.data === 'string' ? data.data : '';

    if (skipMessages.some(msg => messageText.includes(msg))) {
        console.log(`🚫 Pulando mensagem: ${messageText}`);
        return;
    }

    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach(client => {
        try {
            client.write(sseMessage);
        } catch (error) {
            // Ignora clientes desconectados
        }
    });
}

// ROTA SSE (Server-Sent Events)
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    clients.push(res);

    // Mensagem de boas-vindas personalizada
    const welcomeMsg = {
        type: 'welcome',
        data: {
            message: '💬 Chat Unificado iniciado',
            youtubeChannel: CONFIG.youtubeChannelId,
            twitchChannel: CONFIG.twitchChannel,
            youtubeStatus: isYouTubeLive ? '🔴 EM LIVE' : '⏳ Aguardando',
            timestamp: new Date().toLocaleTimeString('pt-BR')
        }
    };

    res.write(`data: ${JSON.stringify(welcomeMsg)}\n\n`);

    // Envia status atual
    if (isYouTubeLive) {
        res.write(`data: ${JSON.stringify({
            type: 'system',
            data: '✅ YouTube: Conectado à transmissão ao vivo'
        })}\n\n`);
    }

    req.on('close', () => {
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
        console.log(`👤 Cliente desconectado. Restantes: ${clients.length}`);
    });
});

// ROTAS (mantenha as mesmas)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/config.js', (req, res) => {
    // Detecta se está no Render ou local
    const isRender = req.hostname.includes('onrender.com');
    const protocol = isRender ? 'https' : req.protocol;
    const serverUrl = `${protocol}://${req.get('host')}`;

    const config = `
const CONFIG = {
    twitchChannel: "${CONFIG.twitchChannel}",
    serverUrl: "${serverUrl}",  // ← DINÂMICO!
    youtubeChannelId: "${CONFIG.youtubeChannelId}"
};
// DEBUG INFO:
console.log('🌐 Ambiente:', '${isRender ? 'Render' : 'Local'}');
console.log('🔗 Server URL:', '${serverUrl}');
    `;

    res.header('Content-Type', 'application/javascript');
    res.send(config);
});

app.get('/debug', (req, res) => {
    res.json({
        environment: process.env.NODE_ENV || 'development',
        hostname: req.hostname,
        protocol: req.protocol,
        headers: {
            host: req.get('host'),
            origin: req.get('origin'),
            referer: req.get('referer')
        },
        serverUrl: `${req.protocol}://${req.get('host')}`,
        isRender: req.hostname.includes('onrender.com'),
        config: CONFIG
    });
});


// ROTA PARA STATUS DETALHADO
app.get('/status', (req, res) => {
    res.json({
        youtube: {
            connected: !!youtubeChat,
            isLive: isYouTubeLive,
            channelId: CONFIG.youtubeChannelId
        },
        twitch: {
            channel: CONFIG.twitchChannel
        },
        server: {
            clients: clients.length,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }
    });
});

// INICIA O SERVIDOR
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Ambiente: ${process.env.RENDER ? 'Render' : 'Local'}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube: ${CONFIG.youtubeChannelId}`);

    connectYouTube();
});