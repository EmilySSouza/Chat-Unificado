// script.js - Cliente atualizado
(function () {
    // Configuração automática
    const isRender = window.location.hostname.includes('onrender.com');
    const isLocal = window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

    if (typeof CONFIG === 'undefined') {
        console.log('⚙️ Configurando automaticamente...');

        if (isRender) {
            window.CONFIG = {
                twitchChannel: "funilzinha",
                serverUrl: "https://chat-unificado.onrender.com",
                youtubeChannelId: "UC5ooSCrMhz10WUWrc6IlT3Q"
            };
        } else if (isLocal) {
            window.CONFIG = {
                twitchChannel: "funilzinha",
                serverUrl: "http://localhost:3000",
                youtubeChannelId: "UC5ooSCrMhz10WUWrc6IlT3Q"
            };
        } else {
            window.CONFIG = {
                twitchChannel: "funilzinha",
                serverUrl: window.location.origin,
                youtubeChannelId: "UC5ooSCrMhz10WUWrc6IlT3Q"
            };
        }

        console.log('✅ CONFIG:', window.CONFIG);
    }
})();

let eventSource = null;
let twitchSocket = null;
let reconnectAttempts = 0;
let lastMessageTime = 0;
const MESSAGE_COOLDOWN = 1000; // 1 segundo entre mensagens

// Função para escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Função para formatar tempo relativo
function formatTimeAgo(timestamp) {
    if (!timestamp) return 'agora';

    const messageTime = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - messageTime;

    if (diff < 1000) return 'agora';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s atrás`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min atrás`;

    return new Date(timestamp).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Adicionar mensagem com sincronização de tempo
function addMessage(platform, user, text, badges = {}, timestamp = null) {
    const container = document.getElementById('combined-messages');
    if (!container) return;

    // Limitar número de mensagens
    if (container.children.length >= 200) {
        container.removeChild(container.firstChild);
    }

    // Preparar badges
    let badgesHtml = '';
    if (platform === 'twitch') {
        if (badges.isBroadcaster) badgesHtml += '<span class="badge broadcaster" title="Broadcaster">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge mod" title="Moderator">🛡️</span>';
        if (badges.isVIP) badgesHtml += '<span class="badge vip" title="VIP">⭐</span>';
        if (badges.isSubscriber || badges.isFounder) {
            badgesHtml += '<span class="badge subscriber" title="Subscriber">💜</span>';
        }
    } else if (platform === 'youtube') {
        if (badges.isOwner) badgesHtml += '<span class="badge owner">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge mod">🛡️</span>';
        if (badges.isMember) badgesHtml += '<span class="badge member">⭐</span>';
        if (badges.isVerified) badgesHtml += '<span class="badge verified">✓</span>';
    }

    // Tempo da mensagem
    const messageTime = timestamp ? new Date(timestamp) : new Date();
    const timeDisplay = formatTimeAgo(timestamp);
    const fullTime = messageTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Criar elemento da mensagem
    const msgEl = document.createElement('div');
    msgEl.className = `message ${platform}-message`;
    msgEl.setAttribute('data-time', messageTime.getTime());
    msgEl.setAttribute('data-platform', platform);

    msgEl.innerHTML = `
        <div class="message-header">
            <span class="message-platform">${platform === 'youtube' ? '🎥' : '🎮'}</span>
            <span class="message-user">${escapeHtml(user)} ${badgesHtml}</span>
            <span class="message-time" title="${fullTime}">${timeDisplay}</span>
        </div>
        <div class="message-content">${escapeHtml(text)}</div>
    `;

    // Inserir em ordem cronológica
    const messages = Array.from(container.children);
    const msgTime = messageTime.getTime();

    let inserted = false;
    for (let i = messages.length - 1; i >= 0; i--) {
        const existingTime = parseInt(messages[i].getAttribute('data-time') || '0');
        if (msgTime >= existingTime) {
            if (i === messages.length - 1) {
                container.appendChild(msgEl);
            } else {
                container.insertBefore(msgEl, messages[i + 1]);
            }
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        container.insertBefore(msgEl, container.firstChild);
    }

    // Scroll para a última mensagem
    container.scrollTop = container.scrollHeight;

    // Atualizar tempo da última mensagem
    lastMessageTime = Date.now();
}

// Conectar ao servidor SSE
function connectToServer() {
    console.log('🔗 Conectando ao servidor SSE...');

    if (eventSource) {
        eventSource.close();
    }

    const sseUrl = `${CONFIG.serverUrl}/events`;
    console.log('🎯 SSE URL:', sseUrl);

    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
        console.log('✅ Conexão SSE aberta');
        reconnectAttempts = 0;
        addMessage('system', 'Sistema', '🔗 Conectado ao servidor...');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'youtube':
                    console.log(`🎥 YouTube: ${data.data.user}`);
                    addMessage(
                        'youtube',
                        data.data.user,
                        data.data.message,
                        data.data.badges,
                        data.data.timestamp || data.data.serverTime
                    );
                    break;

                case 'system':
                    console.log(`📢 Sistema: ${data.data.message}`);
                    addMessage('system', 'Sistema', data.data.message, {}, data.data.timestamp);

                    // Mostrar informações de quota se disponível
                    if (data.data.quota !== undefined) {
                        console.log(`💰 Quota: ${data.data.quota} unidades`);
                    }
                    break;

                case 'welcome':
                    console.log('👋 Bem-vindo:', data.data.message);
                    addMessage('system', 'Sistema', data.data.message);

                    // Mostrar informações do sistema
                    if (data.data.settings) {
                        console.log('⚙️ Configurações:', data.data.settings);
                    }
                    break;
            }
        } catch (error) {
            console.error('❌ Erro ao processar evento:', error);
        }
    };

    eventSource.onerror = (error) => {
        console.error('❌ Erro SSE:', error);

        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        reconnectAttempts++;
        const delay = Math.min(10000, reconnectAttempts * 2000);
        console.log(`🔄 Reconectando em ${delay}ms...`);

        setTimeout(connectToServer, delay);
    };
}

// Função para testar mensagem (desenvolvimento)
window.sendTestMessage = function () {
    fetch(`${CONFIG.serverUrl}/test-message`)
        .then(res => res.json())
        .then(data => {
            console.log('✅ Mensagem de teste enviada:', data);
        })
        .catch(err => {
            console.error('❌ Erro ao enviar teste:', err);
        });
};

// Funções globais
window.clearChat = function () {
    const container = document.getElementById('combined-messages');
    if (container) {
        container.innerHTML = '';
        addMessage('system', 'Sistema', 'Chat limpo');
    }
};

window.showStatus = function () {
    fetch(`${CONFIG.serverUrl}/status`)
        .then(res => res.json())
        .then(data => {
            console.log('📊 Status do sistema:', data);
            alert(`Status:\nYouTube: ${data.youtube.isLive ? 'LIVE' : 'OFFLINE'}\nQuota: ${data.quota.percentUsed}\nClientes: ${data.system.clients}`);
        })
        .catch(err => {
            console.error('❌ Erro ao buscar status:', err);
        });
};

// Inicialização
window.onload = function () {
    console.log('🚀 Página carregada');
    console.log('⚙️ CONFIG:', CONFIG);

    // Adicionar controles de teste se for localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const controls = document.createElement('div');
        controls.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            z-index: 1000;
        `;
        controls.innerHTML = `
            <button onclick="sendTestMessage()" style="margin: 2px;">Testar Mensagem</button>
            <button onclick="clearChat()" style="margin: 2px;">Limpar Chat</button>
            <button onclick="showStatus()" style="margin: 2px;">Status</button>
        `;
        document.body.appendChild(controls);
    }

    addMessage('system', 'Sistema', '💬 Chat OBS iniciado');
    addMessage('system', 'Sistema', `📺 Twitch: ${CONFIG.twitchChannel}`);
    addMessage('system', 'Sistema', '🎥 YouTube: Conectando...');

    connectToServer();
    // connectTwitch(); // Comente se não quiser Twitch por enquanto
};

// Reconexão automática
setInterval(() => {
    if (eventSource && (eventSource.readyState === EventSource.CLOSED || eventSource.readyState === 2)) {
        console.log('🔁 Reconectando SSE...');
        connectToServer();
    }
}, 15000);