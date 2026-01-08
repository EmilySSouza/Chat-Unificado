require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const tmi = require('tmi.js');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ========== CONFIGURAÇÃO ==========
const config = {
    twitchChannel: process.env.TWITCH_CHANNEL || 'funilzinha',
    port: process.env.PORT || 3000,
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback'
    }
};

// ========== ARMAZENAMENTO ==========
const messages = [];
const clients = [];
const tokensFile = path.join(__dirname, 'youtube-tokens.json');

// ========== INICIALIZAÇÃO OAUTH ==========
const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
);

// YouTube API instance (será configurada após autenticação)
let youtube = null;

// ========== TWITCH ==========
const twitchClient = new tmi.Client({
    options: { debug: false },
    connection: {
        secure: true,
        reconnect: true
    },
    channels: [config.twitchChannel]
});

twitchClient.connect().catch(console.error);

twitchClient.on('message', (channel, tags, message, self) => {
    if (self) return;

    const chatMessage = {
        id: `twitch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        platform: 'twitch',
        username: tags['display-name'] || tags.username,
        message: message,
        color: tags.color || '#9146FF',
        timestamp: new Date().toLocaleTimeString('pt-BR'),
        badges: tags.badges || {}
    };

    broadcastMessage(chatMessage);
});

// ========== GERENCIAMENTO DE TOKENS YOUTUBE ==========
async function loadTokens() {
    try {
        const data = await fs.readFile(tokensFile, 'utf8');
        const tokens = JSON.parse(data);
        oauth2Client.setCredentials(tokens);
        console.log('✅ Tokens do YouTube carregados do arquivo');
        return tokens;
    } catch (error) {
        console.log('ℹ️  Nenhum token salvo encontrado. É necessário autorizar.');
        return null;
    }
}

async function saveTokens(tokens) {
    try {
        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
        console.log('💾 Tokens salvos em:', tokensFile);
    } catch (error) {
        console.error('❌ Erro ao salvar tokens:', error);
    }
}

// ========== ROTAS OAUTH ==========
// 1. ROTA PARA GERAR LINK DE AUTORIZAÇÃO
app.get('/auth/youtube', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // OBRIGATÓRIO para receber refresh_token
        scope: ['https://www.googleapis.com/auth/youtube.readonly'],
        prompt: 'consent' // Força a tela de consentimento mesmo se já autorizou antes
    });

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Autorizar YouTube</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                .container { max-width: 600px; margin: 0 auto; }
                .button { 
                    background: #FF0000; 
                    color: white; 
                    padding: 15px 30px; 
                    text-decoration: none; 
                    border-radius: 5px;
                    display: inline-block;
                    margin: 20px 0;
                    font-size: 18px;
                }
                .steps { text-align: left; background: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; }
                code { background: #333; color: #fff; padding: 2px 5px; border-radius: 3px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔗 Link de Autorização YouTube</h1>
                <p>Envie este link para sua amiga (dona do canal) clicar:</p>
                
                <div style="margin: 30px 0;">
                    <a href="${authUrl}" class="button" target="_blank">👉 CLIQUE AQUI PARA AUTORIZAR</a>
                </div>
                
                <p>Ou copie e cole o link abaixo:</p>
                <textarea style="width: 100%; height: 60px; padding: 10px; font-size: 14px;" readonly>${authUrl}</textarea>
                
                <div class="steps">
                    <h3>📋 Passo a passo para sua amiga:</h3>
                    <ol>
                        <li>Ela deve estar LOGADA na conta do YouTube do canal</li>
                        <li>Clicar no link acima (abrirá uma página do Google)</li>
                        <li>Clicar em "Continuar" na tela de aviso</li>
                        <li>Selecionar a conta certa se pedir</li>
                        <li>Na tela "Chat Unificado solicita acesso", clicar em <strong>"Continuar"</strong></li>
                        <li>Será redirecionada para uma página com <code>localhost:3000...</code> - <strong>ISSO É NORMAL</strong></li>
                        <li>Ela deve te avisar quando chegar nessa página final</li>
                    </ol>
                </div>
                
                <p><strong>Status atual:</strong> ${oauth2Client.credentials.refresh_token ? '✅ Autorizado' : '⏳ Aguardando autorização'}</p>
                <p><a href="/">Voltar ao chat</a> | <a href="/auth/status">Ver status detalhado</a></p>
            </div>
        </body>
        </html>
    `);
});

// 2. ROTA DE CALLBACK (O Google redireciona para aqui após autorização)
app.get('/auth/youtube/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send('❌ Código de autorização não recebido.');
    }

    try {
        // Troca o código por tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Salva os tokens (incluindo o refresh_token)
        await saveTokens(tokens);

        console.log('✅ Autorização concedida! Refresh Token salvo.');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Autorização Concluída!</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                    .success { color: green; font-size: 24px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="success">✅ Autorização concluída com sucesso!</div>
                <p>O chat do YouTube será sincronizado automaticamente.</p>
                <p>Esta janela pode ser fechada.</p>
                <script>
                    // Fecha após 3 segundos
                    setTimeout(() => window.close(), 3000);
                </script>
            </body>
            </html>
        `);

        // Inicia a conexão com o YouTube após autorização
        initializeYouTube();

    } catch (error) {
        console.error('❌ Erro no callback OAuth:', error);
        res.status(500).send(`Erro: ${error.message}`);
    }
});

// 3. ROTA PARA VER STATUS
app.get('/auth/status', (req, res) => {
    const hasRefreshToken = !!oauth2Client.credentials.refresh_token;
    const isExpired = oauth2Client.credentials.expiry_date < Date.now();

    res.json({
        authorized: hasRefreshToken,
        token_expired: isExpired,
        expiry_date: oauth2Client.credentials.expiry_date ? new Date(oauth2Client.credentials.expiry_date).toLocaleString() : null,
        has_refresh_token: hasRefreshToken,
        youtube_connected: !!youtube
    });
});

// ========== LÓGICA DO YOUTUBE ==========
async function initializeYouTube() {
    try {
        // Carrega tokens salvos
        const tokens = await loadTokens();

        if (!tokens || !tokens.refresh_token) {
            console.log('⏳ YouTube: Aguardando autorização via OAuth...');
            console.log('🔗 Acesse: http://localhost:3000/auth/youtube para gerar link');
            return;
        }

        // Configura o cliente OAuth com os tokens
        oauth2Client.setCredentials(tokens);

        // Cria instância da API do YouTube autenticada
        youtube = google.youtube({ version: 'v3', auth: oauth2Client });

        console.log('✅ YouTube API autenticada. Iniciando monitoramento...');

        // Inicia o monitoramento do chat
        startYouTubeMonitoring();

    } catch (error) {
        console.error('❌ Erro ao inicializar YouTube:', error);
    }
}

let youtubeLiveChatId = null;
let youtubeNextPageToken = null;
let youtubeMonitoringActive = false;

async function startYouTubeMonitoring() {
    if (youtubeMonitoringActive) return;
    youtubeMonitoringActive = true;

    console.log('🔄 Iniciando monitoramento do YouTube...');
    monitorYouTubeChat();
}

async function monitorYouTubeChat() {
    if (!youtube) {
        console.log('⏳ YouTube API não autenticada. Aguardando...');
        setTimeout(monitorYouTubeChat, 30000);
        return;
    }

    try {
        // Busca live ativa do canal autorizado
        if (!youtubeLiveChatId) {
            const response = await youtube.liveBroadcasts.list({
                part: ['snippet'],
                broadcastStatus: 'active',
                mine: true // ← AQUI ESTÁ A MAGIA: "mine: true" pega a live DO CANAL AUTORIZADO
            });

            if (response.data.items && response.data.items.length > 0) {
                youtubeLiveChatId = response.data.items[0].snippet.liveChatId;
                console.log(`✅ Live encontrada! Chat ID: ${youtubeLiveChatId}`);
            } else {
                console.log('⏳ Nenhuma live ativa no momento. Verificando novamente em 60s...');
                setTimeout(monitorYouTubeChat, 60000);
                return;
            }
        }

        // Busca mensagens do chat
        const params = {
            part: ['snippet', 'authorDetails'],
            liveChatId: youtubeLiveChatId,
            maxResults: 20
        };

        if (youtubeNextPageToken) {
            params.pageToken = youtubeNextPageToken;
        }

        const response = await youtube.liveChatMessages.list(params);

        // Processa novas mensagens
        if (response.data.items) {
            response.data.items.forEach(item => {
                const msgId = `youtube-${item.id}`;
                if (messages.find(m => m.id === msgId)) return; // Evita duplicatas

                const chatMessage = {
                    id: msgId,
                    platform: 'youtube',
                    username: item.authorDetails.displayName,
                    message: item.snippet.displayMessage,
                    color: '#FF0000',
                    timestamp: new Date(item.snippet.publishedAt).toLocaleTimeString('pt-BR'),
                    badges: {},
                    isMod: item.authorDetails.isChatModerator,
                    isOwner: item.authorDetails.isChatOwner,
                    isMember: item.authorDetails.isChatSponsor
                };

                broadcastMessage(chatMessage);
            });
        }

        // Agenda próxima verificação
        youtubeNextPageToken = response.data.nextPageToken;
        const pollInterval = response.data.pollingIntervalMillis || 10000;

        setTimeout(monitorYouTubeChat, pollInterval);

    } catch (error) {
        console.error('❌ Erro no monitoramento YouTube:', error.message);

        // Se for erro de token expirado, tenta renovar
        if (error.message.includes('token') || error.message.includes('expired')) {
            console.log('🔄 Token expirado, tentando renovar...');
            try {
                const { credentials } = await oauth2Client.refreshAccessToken();
                oauth2Client.setCredentials(credentials);
                await saveTokens(credentials);
                console.log('✅ Token renovado com sucesso!');
            } catch (refreshError) {
                console.error('❌ Não foi possível renovar o token:', refreshError);
            }
        }

        // Espera antes de tentar novamente
        setTimeout(monitorYouTubeChat, 30000);
    }
}

// ========== WEBSOCKET E BROADCAST ==========
wss.on('connection', (ws) => {
    clients.push(ws);

    ws.send(JSON.stringify({
        type: 'history',
        data: messages.slice(-100)
    }));

    ws.on('close', () => {
        const index = clients.indexOf(ws);
        if (index > -1) clients.splice(index, 1);
    });
});

function broadcastMessage(message) {
    messages.push(message);
    if (messages.length > 500) messages.shift();

    const data = JSON.stringify({
        type: 'message',
        data: message
    });

    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// ========== ROTAS ESTÁTICAS ==========
app.use(express.static('public'));

app.get('/test', (req, res) => {
    res.json({
        status: 'online',
        twitch: config.twitchChannel,
        youtube: youtubeLiveChatId ? 'conectado' : 'aguardando live',
        oauth: oauth2Client.credentials.refresh_token ? 'autorizado' : 'pendente'
    });
});

// ========== INICIAR SERVIDOR ==========
server.listen(config.port, async () => {
    console.log(`
🚀 ========== CHAT UNIFICADO ==========
✅ Servidor: http://localhost:${config.port}
📡 Twitch: @${config.twitchChannel}
🔗 Autorização YouTube: http://localhost:${config.port}/auth/youtube
🧪 Teste: http://localhost:${config.port}/test
=====================================
    `);

    // Inicializa YouTube (vai pedir autorização se necessário)
    initializeYouTube();
});