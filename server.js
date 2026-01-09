const express = require('express');
const { LiveChat } = require('youtube-chat');
const fetch = require('node-fetch'); // Adicione este pacote

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

// FUNÇÃO PARA ENCONTRAR LIVE ATIVA AUTOMATICAMENTE
async function findActiveLiveStream() {
    try {
        console.log(`🔍 Buscando live ativa para o canal: ${CONFIG.youtubeChannelId}`);

        // Método 1: Tenta acessar a página /live do canal
        const response = await fetch(`https://www.youtube.com/channel/${CONFIG.youtubeChannelId}/live`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Procura por padrões que contenham o videoId
        const patterns = [
            /"videoId":"([a-zA-Z0-9_-]{11})"/,
            /"liveStreamabilityRenderer":{"videoId":"([a-zA-Z0-9_-]{11})"/,
            /watch\?v=([a-zA-Z0-9_-]{11})/,
            /"embed":{"videoId":"([a-zA-Z0-9_-]{11})"/
        ];

        let videoId = null;

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                videoId = match[1];
                console.log(`✅ Video ID encontrado via padrão: ${videoId}`);
                break;
            }
        }

        // Se não encontrou, tenta método alternativo
        if (!videoId) {
            // Verifica se a página redirecionou para um vídeo específico
            const urlMatch = response.url.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
            if (urlMatch && urlMatch[1]) {
                videoId = urlMatch[1];
                console.log(`✅ Video ID encontrado via URL: ${videoId}`);
            }
        }

        // Verificação adicional: confirma se é uma live
        if (videoId) {
            const videoResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (videoResponse.ok) {
                const videoHtml = await videoResponse.text();

                // Verifica se é uma live (contém "isLive":true)
                if (videoHtml.includes('"isLive":true') ||
                    videoHtml.includes('"liveBroadcastDetails"') ||
                    videoHtml.includes('LIVE_STREAM_OFFLINE')) {
                    console.log(`🎥 Confirmado: ${videoId} é uma transmissão ao vivo`);
                    return videoId;
                } else {
                    console.log(`⚠️ ${videoId} não parece ser uma live ativa`);
                    return null;
                }
            }
        }

        return videoId;

    } catch (error) {
        console.error('❌ Erro ao buscar live:', error.message);
        return null;
    }
}

// FUNÇÃO PRINCIPAL DE CONEXÃO
async function connectYouTube() {
    try {
        console.log('🔄 Tentando conectar ao YouTube...');

        // 1. Busca live ativa automaticamente
        const videoId = await findActiveLiveStream();

        if (!videoId) {
            console.log('⏳ Nenhuma live ativa encontrada. Tentando novamente em 60 segundos...');
            broadcast({
                type: 'system',
                data: 'YouTube: Nenhuma transmissão ativa no momento. Verificando a cada 60s...'
            });

            // Agenda próxima tentativa
            setTimeout(connectYouTube, 60000);
            return;
        }

        // 2. Para conexão anterior se existir
        if (youtubeChat) {
            try {
                youtubeChat.stop();
                console.log('🔌 Conexão anterior encerrada');
            } catch (e) {
                // Ignora erros ao parar
            }
        }

        // 3. Cria nova conexão
        youtubeChat = new LiveChat({ videoId: videoId });

        // 4. Configura eventos
        youtubeChat.on('chat', (data) => {
            try {
                broadcast({
                    type: 'youtube',
                    data: {
                        user: data.author.name,
                        message: data.message[0]?.text || '',
                        time: new Date(data.timestamp).toLocaleTimeString('pt-BR'),
                        badges: {
                            isMember: data.isMembership,
                            isModerator: data.isModerator,
                            isOwner: data.isOwner
                        }
                    }
                });
            } catch (error) {
                console.error('Erro ao processar mensagem:', error);
            }
        });

        youtubeChat.on('start', () => {
            const msg = `YouTube: Conectado à live!`;
            console.log(`✅ ${msg}`);
            broadcast({ type: 'system', data: msg });
        });

        youtubeChat.on('end', () => {
            console.log('🔴 Live encerrada ou desconectada. Reconectando em 30s...');
            broadcast({ type: 'system', data: 'YouTube: Conexão perdida. Reconectando...' });
            setTimeout(connectYouTube, 30000);
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ Erro no chat YouTube:', error.message);

            // Reconecta em caso de erro específico
            if (error.message.includes('not found') ||
                error.message.includes('ended') ||
                error.message.includes('timeout')) {
                console.log('🔄 Reconectando em 30 segundos...');
                setTimeout(connectYouTube, 30000);
            }
        });

        // 5. Inicia conexão
        await youtubeChat.start();

    } catch (error) {
        console.error('💥 Erro crítico ao conectar:', error.message);

        // Reconecta após 60 segundos em caso de erro
        broadcast({
            type: 'system',
            data: `YouTube: Erro - ${error.message}. Reconectando...`
        });
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
            message: 'Conectado ao servidor',
            youtubeChannel: CONFIG.youtubeChannelId,
            status: 'Buscando transmissão ativa...'
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
        timestamp: new Date().toISOString(),
        message: 'Sistema de chat unificado'
    });
});

// ROTA PARA FORÇAR RECONEXÃO (útil para testes)
app.get('/reconnect-youtube', async (req, res) => {
    console.log('🔄 Reconexão manual solicitada');
    broadcast({ type: 'system', data: 'YouTube: Reconexão manual iniciada...' });

    if (youtubeChat) {
        try {
            youtubeChat.stop();
        } catch (e) {
            // Ignora erros
        }
    }

    setTimeout(connectYouTube, 1000);

    res.json({
        status: 'reconnecting',
        message: 'Reconexão ao YouTube iniciada'
    });
});

// ROTA PARA VERIFICAR STATUS DA LIVE
app.get('/check-live', async (req, res) => {
    try {
        const videoId = await findActiveLiveStream();
        res.json({
            hasLive: !!videoId,
            videoId: videoId,
            channelId: CONFIG.youtubeChannelId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            hasLive: false
        });
    }
});

// INICIA O SERVIDOR
app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📺 Canal Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 Canal YouTube: ${CONFIG.youtubeChannelId}`);
    console.log('🔄 Iniciando conexão automática com YouTube...');

    // Inicia a conexão com YouTube
    await connectYouTube();

    // Verifica periodicamente (a cada 5 minutos) se ainda está conectado
    setInterval(async () => {
        if (!youtubeChat) {
            console.log('🔄 Verificação periódica: YouTube desconectado. Reconectando...');
            await connectYouTube();
        }
    }, 300000); // 5 minutos
});