let APP_CONFIG, TWITCH_CONFIG, YOUTUBE_CONFIG;

function loadConfig() {
    if (window.APP_CONFIG) {
        APP_CONFIG = window.APP_CONFIG;
    } else {
        APP_CONFIG = {
            maxMessages: 200,
            updateInterval: 60000,
            enableSimulation: true
        };
    }

    if (window.TWITCH_CONFIG) {
        TWITCH_CONFIG = window.TWITCH_CONFIG;
    } else {
        TWITCH_CONFIG = {
            channel: "funilzinha"
        };
    }

    if (window.YOUTUBE_CONFIG) {
        YOUTUBE_CONFIG = window.YOUTUBE_CONFIG;
    } else {
        YOUTUBE_CONFIG = {
            channelId: "",
            apiKey: ""
        };
    }

    console.log('Configurações carregadas:', {
        twitchChannel: TWITCH_CONFIG.channel,
        youtubeConfigured: !!YOUTUBE_CONFIG.apiKey,
        simulation: APP_CONFIG.enableSimulation
    });
}

let currentYouTubeLiveId = null;
let youtubeCheckInterval = null;
let twitchSocket = null;
let youtubeLiveChatId = null;
let youtubeNextPageToken = null;
let processedMessages = new Set();
let lastYouTubeCheck = 0;
let quotaErrorCount = 0;
const QUOTA_CHECK_INTERVAL = 60000;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateStatus(platform, status) {
    const statusElement = document.querySelector(`.${platform}-status .status-dot`);
    const textElement = document.querySelector(`.${platform}-status .status-text`);

    statusElement.className = 'status-dot';
    statusElement.classList.add(status);

    const statusTexts = {
        'online': `${platform === 'twitch' ? 'Twitch' : 'YouTube'}: Online`,
        'offline': `${platform === 'twitch' ? 'Twitch' : 'YouTube'}: Offline`,
        'connecting': `${platform === 'twitch' ? 'Twitch' : 'YouTube'}: Conectando...`,
        'error': `${platform === 'twitch' ? 'Twitch' : 'YouTube'}: Erro`
    };

    textElement.textContent = statusTexts[status] || statusTexts.offline;
}

function addMessageToChat(platform, data) {
    const messagesContainer = document.getElementById('combined-messages');

    const messages = messagesContainer.querySelectorAll('.message');
    if (messages.length >= APP_CONFIG.maxMessages) {
        messages[0].remove();
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${platform}-message`;

    const badge = data.user === 'Sistema' ? '<span class="user-badge">SISTEMA</span>' : '';

    messageElement.innerHTML = `
        <div class="message-header">
            <div class="message-user">${data.user} ${badge}</div>
            <div class="message-time">${data.time}</div>
        </div>
        <div class="message-content">${escapeHtml(data.message)}</div>
    `;

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function connectToTwitchChat() {
    console.log('🔌 Conectando ao chat da Twitch...');
    updateStatus('twitch', 'connecting');

    twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    twitchSocket.onopen = function () {
        console.log('✅ Conectado ao servidor Twitch');
        twitchSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        twitchSocket.send(`NICK justinfan${Math.floor(Math.random() * 10000)}`);
        twitchSocket.send(`JOIN #${TWITCH_CONFIG.channel.toLowerCase()}`);
    };

    twitchSocket.onmessage = function (event) {
        const message = event.data;

        if (message.includes('PING')) {
            twitchSocket.send('PONG :tmi.twitch.tv');
            return;
        }

        if (message.includes('PRIVMSG')) {
            processTwitchMessage(message);
        }

        if (message.includes('Welcome') || message.includes('JOIN')) {
            updateStatus('twitch', 'online');
        }
    };

    twitchSocket.onerror = function (error) {
        console.error('❌ Erro na conexão Twitch:', error);
        updateStatus('twitch', 'error');
    };

    twitchSocket.onclose = function () {
        console.log('📴 Conexão Twitch fechada');
        updateStatus('twitch', 'offline');

        setTimeout(() => {
            console.log('🔄 Reconectando à Twitch...');
            connectToTwitchChat();
        }, 5000);
    };
}

function processTwitchMessage(rawMessage) {
    try {
        const parts = rawMessage.split(';');
        const messageData = {};

        parts.forEach(part => {
            const [key, value] = part.split('=');
            if (key && value) messageData[key] = value;
        });

        const messageMatch = rawMessage.match(/:(.*)!(.*) PRIVMSG #(.*) :(.*)/);
        if (messageMatch) {
            const username = messageData['display-name'] || messageMatch[1];
            const message = messageMatch[4];

            addMessageToChat('twitch', {
                user: username,
                message: message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    } catch (error) {
        console.error('Erro ao processar mensagem Twitch:', error);
    }
}

async function checkYouTubeLive() {
    const now = Date.now();


    if (now - lastYouTubeCheck < QUOTA_CHECK_INTERVAL) {
        console.log('⏱️  Aguardando intervalo entre verificações...');
        return;
    }

    lastYouTubeCheck = now;
    console.log('🔍 Verificando status do YouTube...');

    if (!YOUTUBE_CONFIG.apiKey || YOUTUBE_CONFIG.apiKey.includes("SUA_API_KEY")) {
        console.error('❌ API Key do YouTube não configurada!');
        updateStatus('youtube', 'error');
        addMessageToChat('system', {
            user: 'Sistema',
            message: '⚠️ Configure a API Key do YouTube no config.js',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        return;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?` +
            `part=snippet&` +
            `channelId=${YOUTUBE_CONFIG.channelId}&` +
            `eventType=live&` +
            `type=video&` +
            `maxResults=1&` +
            `key=${YOUTUBE_CONFIG.apiKey}`,
            { signal: controller.signal }
        );

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro API YouTube:', errorText);

            if (response.status === 403) {
                quotaErrorCount++;
                console.warn(`⚠️ Erro de cota (${quotaErrorCount}/3)`);

                if (quotaErrorCount >= 3) {
                    console.error('🚫 Cota excedida - Parando verificações por 10 minutos');
                    updateStatus('youtube', 'error');

                    addMessageToChat('system', {
                        user: 'Sistema',
                        message: '⚠️ Cota da API YouTube excedida. Usando modo simulação.',
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    });

                    if (youtubeCheckInterval) {
                        clearInterval(youtubeCheckInterval);
                    }

                    if (APP_CONFIG.enableSimulation) {
                        startYouTubeSimulation();
                    }

                    setTimeout(() => {
                        quotaErrorCount = 0;
                        startYouTubeMonitoring();
                    }, 600000);

                    return;
                }
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const liveVideo = data.items[0];
            const liveVideoId = liveVideo.id.videoId;

            if (currentYouTubeLiveId !== liveVideoId) {
                currentYouTubeLiveId = liveVideoId;
                await startYouTubeChat(liveVideoId);
                updateStatus('youtube', 'online');
                quotaErrorCount = 0;
            }
        } else {
            console.log('📴 Nenhuma transmissão ao vivo encontrada');
            updateStatus('youtube', 'offline');

            if (APP_CONFIG.enableSimulation) {
                startYouTubeSimulation();
                updateStatus('youtube', 'online');
            }
        }

    } catch (error) {
        console.error('💥 Erro ao verificar live do YouTube:', error);

        if (!error.message.includes('403') && APP_CONFIG.enableSimulation) {
            console.log('🎭 Iniciando simulação devido a erro');
            startYouTubeSimulation();
            updateStatus('youtube', 'online');
        } else {
            updateStatus('youtube', 'error');
        }
    }
}

async function startYouTubeChat(liveId) {
    console.log(`🚀 Live do YouTube detectada: ${liveId}`);

    if (window.youtubeSimulationInterval) {
        clearInterval(window.youtubeSimulationInterval);
        window.youtubeSimulationInterval = null;
    }

    updateStatus('youtube', 'online');

    addMessageToChat('system', {
        user: 'Sistema',
        message: `✅ Live do YouTube detectada!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (APP_CONFIG.enableSimulation) {
        startYouTubeSimulation();
        return;
    }
}

function startYouTubeSimulation() {
    console.log('🎭 Iniciando simulação do chat do YouTube');

    if (window.youtubeSimulationInterval) {
        clearInterval(window.youtubeSimulationInterval);
    }

    const simulatedUsers = [
        { name: 'ViewerPro', messages: ['Ótima live!', 'Quando começa?'] },
        { name: 'Fã2024', messages: ['Boa noite a todos', 'Qual o jogo hoje?'] },
        { name: 'Subscriber', messages: ['Parabéns pelo conteúdo!'] },
        { name: 'NovoUser', messages: ['Primeira vez aqui!'] },
        { name: 'ChatMember', messages: ['Alguém do Brasil?'] }
    ];

    const genericMessages = [
        'Boa live!',
        'Excelente conteúdo!',
        'Alguém mais com problema no áudio?',
        'Poderia aumentar o volume?',
        'Quando é o próximo sorteio?',
        'Consegui resolver meu problema, obrigado!',
        'Alguém recomenda um jogo novo?',
        'Qual o seu rank?'
    ];

    window.youtubeSimulationInterval = setInterval(() => {
        const shouldSend = Math.random() > 0.3;

        if (shouldSend) {
            const userIndex = Math.floor(Math.random() * simulatedUsers.length);
            const user = simulatedUsers[userIndex];

            let message;
            if (Math.random() > 0.5 && user.messages.length > 0) {
                const msgIndex = Math.floor(Math.random() * user.messages.length);
                message = user.messages[msgIndex];
            } else {
                const msgIndex = Math.floor(Math.random() * genericMessages.length);
                message = genericMessages[msgIndex];
            }

            addMessageToChat('youtube', {
                user: user.name,
                message: message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    }, 4000);
}

function startYouTubeMonitoring() {
    console.log('👀 Iniciando monitoramento do YouTube');

    checkYouTubeLive();

    if (youtubeCheckInterval) {
        clearInterval(youtubeCheckInterval);
    }

    youtubeCheckInterval = setInterval(checkYouTubeLive, APP_CONFIG.updateInterval);
}

$(document).ready(function () {
    console.log('🚀 Sistema de chat iniciando...');

    addMessageToChat('system', {
        user: 'Sistema',
        message: '💬 Chat combinado iniciado. Conectando...',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (TWITCH_CONFIG.channel && TWITCH_CONFIG.channel !== "nomedocanal") {
        connectToTwitchChat();
    } else {
        updateStatus('twitch', 'error');
        addMessageToChat('system', {
            user: 'Sistema',
            message: '❌ Configure o canal Twitch no config.js',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    }

    startYouTubeMonitoring();

    setInterval(() => {
        if (twitchSocket && twitchSocket.readyState !== 1) {
            console.log('🔄 Reconectando Twitch...');
            connectToTwitchChat();
        }
    }, 30000);

    console.log('✅ Sistema inicializado!');
});