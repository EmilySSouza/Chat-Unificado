const express = require('express');
const { LiveChat } = require('youtube-chat');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    twitchChannel: process.env.TWITCH_CHANNEL || "funilzinha",
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || "UC5ooSCrMhz10WUWrc6IlT3Q"
};

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    next();
});
app.use(express.static(__dirname));

let youtubeChat = null;
const clients = [];

async function connectYouTube() {
    try {
        if (youtubeChat) {
            youtubeChat.stop();
        }

        youtubeChat = new LiveChat({
            channelId: CONFIG.youtubeChannelId
        });

        youtubeChat.on('chat', (data) => {
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
        });

        youtubeChat.on('start', () => {
            broadcast({ type: 'system', data: 'YouTube: Conectado!' });
        });

        youtubeChat.on('error', (error) => {
            console.error('❌ Erro YouTube:', error.message);
        });

        await youtubeChat.start();

    } catch (error) {
        console.error('💥 Erro conexão:', error.message);
        setTimeout(connectYouTube, 10000);
    }
}

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
        data: { message: 'Conectado ao servidor Render' }
    })}\n\n`);

    req.on('close', () => {
        const index = clients.indexOf(res);
        if (index > -1) clients.splice(index, 1);
    });
});

function broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
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

app.listen(PORT, async () => {
    await connectYouTube();
});