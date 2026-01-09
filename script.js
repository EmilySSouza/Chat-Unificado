// script.js
let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;

// Funções de utilidade
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    if (!timestamp) return 'agora';
    
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        
        if (diffMs < 60000) return 'agora';
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}min`;
        
        return date.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } catch {
        return '';
    }
}

function addMessage(data) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    const message = document.createElement('div');
    
    // Dados da mensagem
    const platform = data.platform || 'system';
    const user = escapeHtml(data.data?.user || 'Sistema');
    const messageText = escapeHtml(data.data?.message || '');
    const badges = data.data?.badges || {};
    const timestamp = data.data?.timestamp || new Date().toISOString();
    
    // Gerar badges HTML
    let badgesHtml = '';
    if (platform === 'twitch') {
        if (badges.isBroadcaster) badgesHtml += '<span class="badge" title="Broadcaster">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge" title="Mod">🛡️</span>';
        if (badges.isVIP) badgesHtml += '<span class="badge" title="VIP">⭐</span>';
        if (badges.isSubscriber || badges.isFounder) {
            badgesHtml += '<span class="badge" title="Subscriber">💜</span>';
        }
    } else if (platform === 'youtube') {
        if (badges.isOwner) badgesHtml += '<span class="badge" title="Dono">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge" title="Mod">🛡️</span>';
        if (badges.isVerified) badgesHtml += '<span class="badge" title="Verificado">✓</span>';
    }
    
    // Montar mensagem
    message.className = `message ${platform}-message`;
    message.innerHTML = `
        <div class="message-header">
            <span class="message-platform">
                ${platform === 'youtube' ? '🎥' : 
                  platform === 'twitch' ? '🎮' : '⚙️'}
            </span>
            <span class="message-user">${user}</span>
            ${badgesHtml}
            <span class="message-time" title="${new Date(timestamp).toLocaleTimeString('pt-BR')}">
                ${formatTime(timestamp)}
            </span>
        </div>
        <div class="message-content">${messageText}</div>
    `;
    
    // Adicionar ao chat
    messagesDiv.appendChild(message);
    
    // Scroll automático
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Limitar mensagens (máximo 200)
    while (messagesDiv.children.length > 200) {
        messagesDiv.removeChild(messagesDiv.firstChild);
    }
}

// Atualizar status
function updateStatus(service, status) {
    const element = document.getElementById(`${service}-status`);
    if (element) {
        element.className = `status-dot ${status}`;
    }
}

// Conectar WebSocket
function connectWebSocket() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    console.log('🔗 Conectando ao WebSocket...');
    updateStatus('ws', 'connecting');
    document.getElementById('ws-text').textContent = 'Conectando...';
    
    // Criar conexão
    ws = new WebSocket(CONFIG.serverUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket conectado');
        updateStatus('ws', 'connected');
        document.getElementById('ws-text').textContent = 'Conectado';
        reconnectAttempts = 0;
        
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: 'Conectado ao servidor'
            }
        });
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.platform) {
                case 'youtube':
                    updateStatus('youtube', 'connected');
                    break;
                case 'twitch':
                    updateStatus('twitch', 'connected');
                    break;
                case 'system':
                    if (data.type === 'welcome') {
                        console.log('👋 ', data.data.message);
                    }
                    break;
            }
            
            addMessage(data);
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ Erro WebSocket:', error);
    };
    
    ws.onclose = () => {
        console.log('🔌 WebSocket desconectado');
        updateStatus('ws', 'disconnected');
        document.getElementById('ws-text').textContent = 'Desconectado';
        
        // Reconexão com backoff exponencial
        reconnectAttempts++;
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        
        console.log(`🔄 Reconectando em ${delay/1000}s...`);
        
        reconnectTimeout = setTimeout(() => {
            connectWebSocket();
        }, delay);
    };
}

// Inicialização
window.onload = function() {
    console.log('🚀 Inicializando chat OBS...');
    console.log('⚙️ Config:', CONFIG);
    
    // Adicionar mensagem inicial
    addMessage({
        platform: 'system',
        data: {
            user: 'Sistema',
            message: '💬 Chat OBS inicializado'
        }
    });
    
    // Iniciar conexão
    connectWebSocket();
    
    // Testar conexão periodicamente
    setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
    }, 30000);
};