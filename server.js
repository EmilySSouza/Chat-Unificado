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
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    next();
});
app.use(express.static(__dirname));

let youtubeChat = null;
const clients = [];

// FUNÇÃO PRINCIPAL DE CONEXÃO - VERSÃO SIMPLIFICADA
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

        // SEM videoId! Usa APENAS channelId - a biblioteca detecta automaticamente
        console.log(`📺 Usando channelId: ${CONFIG.youtubeChannelId}`);
        youtubeChat = new LiveChat({
            channelId: CONFIG.youtubeChannelId,
            pollingInterval: 3000, // Verifica a cada 3 segundos
            retryInterval: 10000   // Tenta reconectar após 10s em caso de erro
        });

        // Configura eventos
        youtubeChat.on('chat', (message) => {
            try {
                // Extrai o texto da mensagem (a biblioteca pode retornar formatos diferentes)
                let messageText = '';

                if (typeof message.message === 'string') {
                    messageText = message.message;
                } else if (Array.isArray(message.message)) {
                    // É um array de objetos com texto
                    messageText = message.message
                        .map(item => item.text || '')
                        .filter(text => text)
                        .join(' ');
                } else if (message.text) {
                    messageText = message.text;
                }

                // Extrai nome do usuário
                const userName = message.author?.name ||
                    message.author?.displayName ||
                    'Anônimo';

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
                console.log(`   Live Info:`, liveInfo);
            }

            broadcast({
                type: 'system',
                data: 'YouTube: Conectado ao chat da live!'
            });
        });

        youtubeChat.on('end', () => {
            console.log('🔴 YouTube: Chat encerrado');
            broadcast({
                type: 'system',
                data: 'YouTube: Chat encerrado. Reconectando...'
            });

            // Tenta reconectar em 30 segundos
            setTimeout(connectYouTube, 30000);
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ YouTube Erro:', error.message || error);

            // Mensagens específicas para diferentes erros
            let errorMsg = 'Erro no YouTube';

            if (error.message.includes('not found')) {
                errorMsg = 'Live não encontrada. Aguardando transmissão...';
            } else if (error.message.includes('ended')) {
                errorMsg = 'Live encerrada. Aguardando próxima...';
            } else if (error.message.includes('timeout')) {
                errorMsg = 'Timeout. Reconectando...';
            }

            broadcast({
                type: 'system',
                data: `YouTube: ${errorMsg}`
            });

            // Reconecta em 30 segundos
            setTimeout(connectYouTube, 30000);
        });

        // Evento opcional: quando recebe dados da live
        youtubeChat.on('metadata', (metadata) => {
            console.log('📊 YouTube Metadata:', metadata);
        });

        // Inicia a conexão
        await youtubeChat.start();
        console.log('🎉 Conexão YouTube iniciada com sucesso!');

    } catch (error) {
        console.error('💥 Erro crítico ao conectar ao YouTube:', error.message);

        // Informa o erro específico
        let userMessage = 'Erro ao conectar ao YouTube';

        if (error.message.includes('channelId')) {
            userMessage = 'ID do canal YouTube inválido';
        } else if (error.message.includes('No live stream')) {
            userMessage = 'Nenhuma transmissão ao vivo encontrada';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            userMessage = 'Problema de rede. Verificando novamente...';
        }

        broadcast({
            type: 'system',
            data: `YouTube: ${userMessage}`
        });

        // Tenta novamente em 60 segundos
        console.log('🔄 Tentando novamente em 60 segundos...');
        setTimeout(connectYouTube, 60000);
    }
}

// FUNÇÃO PARA TRANSMITIR PARA CLIENTES SSE
function broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach(client => {
        try {
            client.write(message);
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

    res.write(`data: ${JSON.stringify({
        type: 'welcome',
        data: {
            message: 'Conectado ao chat unificado',
            youtubeChannel: CONFIG.youtubeChannelId,
            twitchChannel: CONFIG.twitchChannel,
            status: 'Sistema pronto'
        }
    })}\n\n`);

    req.on('close', () => {
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

// ROTAS
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
        clients: clients.length,
        youtubeChannel: CONFIG.youtubeChannelId,
        timestamp: new Date().toISOString()
    });
});

// ROTA PARA TESTAR CONEXÃO YOUTUBE
app.get('/test-youtube', async (req, res) => {
    try {
        const testChat = new LiveChat({ channelId: CONFIG.youtubeChannelId });

        testChat.on('start', () => {
            res.json({
                success: true,
                message: 'YouTube conectado com sucesso!',
                channelId: CONFIG.youtubeChannelId
            });
            testChat.stop();
        });

        testChat.on('error', (error) => {
            res.json({
                success: false,
                message: error.message,
                channelId: CONFIG.youtubeChannelId
            });
        });

        await testChat.start();

        // Para após 5 segundos
        setTimeout(() => {
            try { testChat.stop(); } catch (e) { }
        }, 5000);

    } catch (error) {
        res.json({
            success: false,
            message: error.message,
            channelId: CONFIG.youtubeChannelId
        });
    }
});

// INICIA O SERVIDOR
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube: ${CONFIG.youtubeChannelId}`);
    console.log('🔄 Iniciando conexão com YouTube...');

    // Inicia a conexão com YouTube
    connectYouTube();

    // Verificação periódica
    setInterval(() => {
        console.log(`📊 Status: ${clients.length} cliente(s) conectado(s)`);

        // Se não há conexão ativa, tenta reconectar
        if (!youtubeChat) {
            console.log('🔄 YouTube desconectado. Tentando reconectar...');
            connectYouTube();
        }
    }, 60000); // 1 minuto
});