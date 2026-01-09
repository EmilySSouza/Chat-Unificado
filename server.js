const express = require('express');
const { LiveChat } = require('youtube-chat');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UC5ooSCrMhz10WUWrc6IlT3Q" // Channel ID CORRETO
};

// CORS simplificado
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

let youtubeChat = null;
let isYouTubeLive = false;
const clients = [];

// CONEXÃO SIMPLIFICADA - SEGUINDO A DOCUMENTAÇÃO
async function connectYouTube() {
    try {
        console.log('🔄 Iniciando YouTube...');
        
        // Para conexão anterior
        if (youtubeChat) {
            try {
                youtubeChat.stop();
                console.log('🔌 Conexão anterior encerrada');
            } catch (e) {}
        }
        
        // SEGUINDO A DOCUMENTAÇÃO: Usa apenas channelId
        console.log(`📺 Usando channelId: ${CONFIG.youtubeChannelId}`);
        
        youtubeChat = new LiveChat({
            channelId: CONFIG.youtubeChannelId  // APENAS channelId, SEM videoId!
        });
        
        // Eventos conforme documentação
        youtubeChat.on('start', (liveId) => {
            console.log(`✅ YouTube: Conectado! Live ID: ${liveId}`);
            isYouTubeLive = true;
            
            broadcast({
                type: 'system',
                data: `✅ YouTube: Conectado à live! (ID: ${liveId})`
            });
        });
        
        youtubeChat.on('chat', (chatItem) => {
            try {
                // Processa mensagem conforme documentação
                let messageText = '';
                
                if (Array.isArray(chatItem.message)) {
                    messageText = chatItem.message
                        .map(item => 'text' in item ? item.text : '')
                        .filter(text => text)
                        .join(' ');
                }
                
                const userName = chatItem.author?.name || 'Anônimo';
                
                console.log(`📩 YouTube: ${userName}: ${messageText.substring(0, 50)}...`);
                
                broadcast({
                    type: 'youtube',
                    data: {
                        user: userName,
                        message: messageText,
                        time: chatItem.timestamp ? 
                            chatItem.timestamp.toLocaleTimeString('pt-BR') : 
                            new Date().toLocaleTimeString('pt-BR'),
                        badges: {
                            isMember: chatItem.isMembership,
                            isModerator: chatItem.isModerator,
                            isOwner: chatItem.isOwner,
                            isVerified: chatItem.isVerified
                        }
                    }
                });
                
            } catch (error) {
                console.error('❌ Erro mensagem:', error);
            }
        });
        
        youtubeChat.on('end', (reason) => {
            console.log(`🔴 YouTube: Chat encerrado. Razão: ${reason || 'Desconhecida'}`);
            isYouTubeLive = false;
            
            broadcast({
                type: 'system',
                data: '🔴 YouTube: Chat encerrado'
            });
            
            // Reconecta em 30 segundos
            setTimeout(connectYouTube, 30000);
        });
        
        youtubeChat.on('error', (err) => {
            console.error('❌ YouTube Erro:', err.message || err);
            
            // Tipos específicos de erro
            if (err.message?.includes('Live Stream was not found')) {
                console.log('⏳ Canal não está em live no momento');
                isYouTubeLive = false;
                
                // Não envia mensagem para o chat
                // Apenas log no servidor
                
            } else if (err.message?.includes('No live stream')) {
                console.log('📴 Nenhuma transmissão ativa');
                isYouTubeLive = false;
            }
            
            // Reconecta em 2 minutos
            setTimeout(connectYouTube, 120000);
        });
        
        // Inicia conforme documentação
        const ok = await youtubeChat.start();
        
        if (ok) {
            console.log('🎉 YouTube: Chat iniciado com sucesso!');
        } else {
            console.log('⚠️ YouTube: Não conseguiu iniciar');
            setTimeout(connectYouTube, 30000);
        }
        
    } catch (error) {
        console.error('💥 Erro crítico YouTube:', error.message);
        
        // Reconecta em 3 minutos
        setTimeout(connectYouTube, 180000);
    }
}

// BROADCAST (mantenha igual)
function broadcast(data) {
    const sseMessage = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
        try {
            client.write(sseMessage);
        } catch (error) {}
    });
}

// ROTAS (mantenha iguais)
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

    res.write(`data: ${JSON.stringify({
        type: 'welcome',
        data: {
            message: '💬 Chat OBS iniciado',
            youtubeStatus: isYouTubeLive ? 'Conectado' : 'Verificando...',
            timestamp: new Date().toLocaleTimeString('pt-BR')
        }
    })}\n\n`);

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/config.js', (req, res) => {
    const protocol = req.hostname.includes('onrender.com') ? 'https' : req.protocol;
    const serverUrl = `${protocol}://${req.get('host')}`;
    
    const config = `
const CONFIG = {
    twitchChannel: "${CONFIG.twitchChannel}",
    serverUrl: "${serverUrl}",
    youtubeChannelId: "${CONFIG.youtubeChannelId}"
};
    `;
    
    res.header('Content-Type', 'application/javascript');
    res.send(config);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        youtube: !!youtubeChat,
        youtubeLive: isYouTubeLive,
        clients: clients.length,
        timestamp: new Date().toISOString()
    });
});

// INICIA
app.listen(PORT, () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    console.log(`📺 Twitch: ${CONFIG.twitchChannel}`);
    console.log(`🎥 YouTube Channel ID: ${CONFIG.youtubeChannelId}`);
    console.log('🔄 Iniciando YouTube...');
    
    connectYouTube();
});