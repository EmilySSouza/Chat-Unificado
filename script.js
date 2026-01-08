// script.js - VERSÃO CORRIGIDA

// ==================== VARIÁVEIS GLOBAIS ====================
let eventSource = null;
let twitchSocket = null;
let reconnectAttempts = 0;
let CONFIG = {};

// ==================== CONFIGURAÇÃO ====================
console.log('🎮 Iniciando chat...');

async function loadConfig() {
    try {
        // Tenta carregar do servidor
        const response = await fetch('/config.js');
        const configScript = await response.text();

        // Executa o script para definir CONFIG
        eval(configScript);

        console.log('✅ Configuração carregada do servidor:', CONFIG);
    } catch (error) {
        console.warn('⚠️ Usando configuração padrão...');
        // Configuração de fallback
        CONFIG = {
            twitchChannel: "funilzinha",
            serverUrl: window.location.origin,
            youtubeChannelId: "UCyDXAG7yWP9SJGpXUDfBuCg"
        };
    }
}

// Verifica se CONFIG existe (vem do config.js)
if (typeof CONFIG === 'undefined') {
    console.error('❌ CONFIG não encontrada!');
    window.CONFIG = {
        twitchChannel: "funilzinha",
        serverUrl: "http://localhost:3000",
        youtubeChannelId: "UCyDXAG7yWP9SJGpXUDfBuCg"
    };
}

console.log('✅ Configuração:', CONFIG);

// ==================== FUNÇÕES ====================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addMessage(platform, user, text, badges = {}) {
    const container = document.getElementById('combined-messages');
    if (!container) {
        console.error('❌ Container não encontrado!');
        return;
    }

    // Limita mensagens
    if (container.children.length >= 200) {
        container.removeChild(container.firstChild);
    }

    // Cria badges HTML
    let badgesHtml = '';
    if (badges.isOwner) badgesHtml += '<span class="badge owner">👑</span>';
    if (badges.isModerator) badgesHtml += '<span class="badge mod">🛡️</span>';
    if (badges.isMember) badgesHtml += '<span class="badge member">⭐</span>';

    const msgEl = document.createElement('div');
    msgEl.className = `message ${platform}-message`;
    msgEl.innerHTML = `
        <div class="message-header">
            <span class="message-user">${user} ${badgesHtml}</span>
            <span class="message-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="message-content">${escapeHtml(text)}</div>
    `;

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;

    console.log(`💬 ${platform.toUpperCase()}: ${user}: ${text}`);
}

// ==================== CONEXÃO SERVIDOR ====================

function connectToServer() {
    console.log('🔗 Conectando ao servidor...');

    // Fecha conexão anterior se existir
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    // Cria nova conexão
    eventSource = new EventSource(`${CONFIG.serverUrl}/events`);

    eventSource.onopen = () => {
        console.log('✅ Conectado ao servidor!');
        reconnectAttempts = 0;
        addMessage('system', 'Sistema', 'Servidor conectado');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📩 Evento recebido:', data.type);

            switch (data.type) {
                case 'youtube':
                    addMessage(
                        'youtube',
                        data.data.user,
                        data.data.message,
                        data.data.badges
                    );
                    break;

                case 'system':
                    addMessage('system', 'Sistema', data.data);
                    break;

                case 'welcome':
                    console.log('Mensagem de boas-vindas:', data.data);
                    break;
            }
        } catch (error) {
            console.error('❌ Erro ao processar evento:', error);
        }
    };

    eventSource.onerror = (error) => {
        console.error('❌ Erro na conexão:', error);
        if (eventSource) {
            eventSource.close();
        }

        reconnectAttempts++;
        const delay = Math.min(5000, reconnectAttempts * 1000);

        console.log(`🔄 Reconectando em ${delay / 1000}s...`);
        setTimeout(connectToServer, delay);
    };
}

// ==================== TWITCH ====================

function connectTwitch() {
    console.log('🎮 Conectando Twitch...');

    // Fecha conexão anterior
    if (twitchSocket && twitchSocket.readyState === WebSocket.OPEN) {
        twitchSocket.close();
    }

    twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    twitchSocket.onopen = () => {
        console.log('✅ Twitch conectado!');
        twitchSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        twitchSocket.send(`NICK justinfan${Math.floor(Math.random() * 10000)}`);
        twitchSocket.send(`JOIN #${CONFIG.twitchChannel.toLowerCase()}`);
        addMessage('system', 'Sistema', 'Twitch conectado');
    };

    twitchSocket.onmessage = (event) => {
        const msg = event.data;

        if (msg.includes('PING')) {
            twitchSocket.send('PONG :tmi.twitch.tv');
            return;
        }

        if (msg.includes('PRIVMSG')) {
            try {
                const parts = msg.split(';');
                const tags = {};
                parts.forEach(part => {
                    const [key, ...value] = part.split('=');
                    if (key) tags[key] = value.join('=');
                });

                const match = msg.match(/:(.*)!(.*) PRIVMSG #(.*) :(.*)/);
                if (match) {
                    const username = tags['display-name'] || match[1];
                    const message = match[4];

                    addMessage('twitch', username, message);
                }
            } catch (error) {
                console.log('Erro Twitch:', error);
            }
        }
    };

    twitchSocket.onclose = () => {
        console.log('🔄 Reconectando Twitch...');
        setTimeout(connectTwitch, 5000);
    };

    twitchSocket.onerror = (error) => {
        console.error('❌ Erro Twitch:', error);
    };
}

// ==================== FUNÇÕES GLOBAIS ====================

window.testServer = async function () {
    try {
        const response = await fetch('http://localhost:3000/test');
        const data = await response.json();
        console.log('✅ Teste enviado:', data);
        addMessage('system', 'Sistema', 'Teste enviado ao servidor');
    } catch (error) {
        console.error('❌ Erro no teste:', error);
        addMessage('system', 'Sistema', 'Erro ao testar servidor');
    }
};

window.clearChat = function () {
    const container = document.getElementById('combined-messages');
    if (container) {
        container.innerHTML = '';
        addMessage('system', 'Sistema', 'Chat limpo');
    }
};

// ==================== INICIALIZAÇÃO ====================

window.onload = async function () {
    console.log('🚀 Chat OBS - Iniciando...');

    // Carrega a configuração primeiro
    await loadConfig();

    console.log('⚙️ Config final:', CONFIG);

    // Mensagem inicial
    addMessage('system', 'Sistema', '💬 Chat OBS iniciado');
    addMessage('system', 'Sistema', `📺 Twitch: ${CONFIG.twitchChannel}`);
    addMessage('system', 'Sistema', '🎥 YouTube: Conectando...');

    // Conecta aos serviços
    connectToServer();
    connectTwitch();

    console.log('✅ Sistema pronto!');
};

// ==================== VERIFICAÇÃO DE CONEXÃO ====================

// Verifica conexão periodicamente
setInterval(() => {
    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        console.log('🔄 Reconectando EventSource...');
        connectToServer();
    }

    if (twitchSocket && twitchSocket.readyState === WebSocket.CLOSED) {
        console.log('🔄 Reconectando Twitch...');
        connectTwitch();
    }
}, 10000);