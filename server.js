// server.js - ATUALIZADO
const express = require('express');
const { LiveChat } = require('youtube-chat');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UCyDXAG7yWP9SJGpXUDfBuCg"
};

// Middleware CORS mais completo
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(__dirname));

let youtubeChat = null;
const clients = [];

async function connectYouTube() {
    try {
        console.log('🎯 Conectando ao YouTube...');

        if (youtubeChat) {
            youtubeChat.stop();
        }

        youtubeChat = new LiveChat({
            channelId: CONFIG.youtubeChannelId,
            // Adicione opções de debug
            debug: false
        });

        youtubeChat.on('chat', (data) => {
            console.log(`📨 YouTube: ${data.author.name}: ${data.message[0]?.text || ''}`);

            // Formatar mensagem corretamente
            const messageData = {
                type: 'youtube',
                data: {
                    user: data.author.name || 'Anônimo',
                    message: data.message[0]?.text || data.message[0] || '',
                    time: new Date(data.timestamp).toLocaleTimeString('pt-BR'),
                    badges: {
                        isMember: data.isMembership || false,
                        isModerator: data.isModerator || false,
                        isOwner: data.isOwner || false
                    }
                }
            };

            console.log('📤 Enviando para clientes:', messageData);
            broadcast(messageData);
        });

        youtubeChat.on('start', () => {
            console.log('✅ YouTube Chat conectado!');
            broadcast({
                type: 'system',
                data: 'YouTube: Conectado com sucesso!'
            });
        });

        youtubeChat.on('end', () => {
            console.log('⚠️ YouTube Chat desconectado!');
            broadcast({
                type: 'system',
                data: 'YouTube: Desconectado. Reconectando...'
            });
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ Erro YouTube:', error.message);
            broadcast({
                type: 'system',
                data: `Erro YouTube: ${error.message}`
            });
        });

        await youtubeChat.start();

    } catch (error) {
        console.error('💥 Erro conexão YouTube:', error.message);
        broadcast({
            type: 'system',
            data: `Erro conexão YouTube: ${error.message}`
        });
        setTimeout(connectYouTube, 10000);
    }
}

// Rota SSE com CORS explícito
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    });

    // Flush headers
    res.flushHeaders();

    const clientId = Date.now();
    clients.push({ id: clientId, res });

    console.log(`🔗 Cliente conectado: ${clientId}. Total: ${clients.length}`);

    // Enviar mensagem de boas-vindas
    const welcomeMsg = JSON.stringify({
        type: 'welcome',
        data: {
            message: 'Conectado ao servidor!',
            timestamp: new Date().toISOString(),
            clientId: clientId
        }
    });

    res.write(`data: ${welcomeMsg}\n\n`);

    // Heartbeat para manter conexão ativa
    const heartbeat = setInterval(() => {
        if (!res.finished) {
            res.write(': heartbeat\n\n');
        }
    }, 30000);

    req.on('close', () => {
        console.log(`🔴 Cliente desconectado: ${clientId}`);
        clearInterval(heartbeat);
        const index = clients.findIndex(c => c.id === clientId);
        if (index > -1) {
            clients.splice(index, 1);
        }
        console.log(`👥 Clientes restantes: ${clients.length}`);
    });
});

function broadcast(data) {
    if (clients.length === 0) {
        console.log('⚠️ Nenhum cliente conectado para broadcast');
        return;
    }

    const message = `data: ${JSON.stringify(data)}\n\n`;

    clients.forEach((client, index) => {
        try {
            if (!client.res.finished) {
                client.res.write(message);
            }
        } catch (error) {
            console.error(`❌ Erro enviando para cliente ${client.id}:`, error.message);
            // Remove cliente com erro
            clients.splice(index, 1);
        }
    });
}

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
console.log('⚙️ Config Render:', CONFIG);
    `;

    res.header('Content-Type', 'application/javascript');
    res.send(config);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        youtube: !!youtubeChat,
        clients: clients.length,
        timestamp: new Date().toISOString()
    });
});

app.get('/test', (req, res) => {
    broadcast({
        type: 'test',
        data: 'Mensagem de teste do servidor'
    });
    res.json({ success: true, message: 'Teste enviado' });
});

app.listen(PORT, '0.0.0.0', async () => {
    console.log('='.repeat(50));
    console.log(`🚀 Servidor Render rodando na porta ${PORT}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube: ${CONFIG.youtubeChannelId}`);
    console.log(`🌐 URL: https://chat-unificado.onrender.com`);
    console.log('='.repeat(50));

    await connectYouTube();
});