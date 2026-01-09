// script.js - Chat OBS Twitch & YouTube
// Versão completa com reconexão automática e scroll fixo

// ==================== CONFIGURAÇÃO ====================
// A configuração é carregada pelo config.js gerado pelo servidor

// ==================== VARIÁVEIS GLOBAIS ====================
let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
let heartbeatInterval = null;
let autoScrollEnabled = true;
let isUserScrolling = false;
let scrollTimeout = null;
const MAX_RECONNECT_ATTEMPTS = 15;
const HEARTBEAT_INTERVAL = 25000; // 25 segundos
const CONNECTION_TIMEOUT = 10000; // 10 segundos

// ==================== FUNÇÕES UTILITÁRIAS ====================
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

        if (diffMs < 1000) return 'agora';
        if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s`;
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}min`;

        return date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '';
    }
}

// ==================== FUNÇÕES DE STATUS ====================
function updateStatus(service, status) {
    const element = document.getElementById(`${service}-status`);
    if (element) {
        // Remover todas as classes de status
        element.classList.remove('connected', 'disconnected', 'connecting', 'error');
        // Adicionar nova classe
        element.classList.add(status);
    }

    // Atualizar texto para WebSocket
    if (service === 'ws') {
        const wsText = document.getElementById('ws-text');
        if (wsText) {
            switch (status) {
                case 'connected': wsText.textContent = 'Conectado'; break;
                case 'connecting': wsText.textContent = 'Conectando...'; break;
                case 'disconnected': wsText.textContent = 'Desconectado'; break;
                case 'error': wsText.textContent = 'Erro'; break;
            }
        }
    }
}

// ==================== FUNÇÕES DE SCROLL ====================
function setupScrollDetection() {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;

    messagesDiv.addEventListener('scroll', () => {
        isUserScrolling = true;

        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            isUserScrolling = false;
        }, 2000);
    });
}

function isAtBottom(element, threshold = 50) {
    return Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) <= threshold;
}

function scrollToBottom(element) {
    if (!autoScrollEnabled || !element) return;

    requestAnimationFrame(() => {
        element.scrollTo({
            top: element.scrollHeight,
            behavior: 'smooth'
        });
    });
}

// ==================== FUNÇÃO PRINCIPAL - ADD MESSAGE ====================
function addMessage(data) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) {
        console.error('❌ Elemento #messages não encontrado!');
        return;
    }

    // Verificar se está no final ANTES de adicionar
    const wasAtBottom = isAtBottom(messagesDiv);

    // Criar elemento da mensagem
    const message = document.createElement('div');

    // Dados da mensagem
    const platform = data.platform || 'system';
    const user = escapeHtml(data.data?.user || 'Sistema');
    const messageText = escapeHtml(data.data?.message || '');
    const badges = data.data?.badges || {};
    const timestamp = data.data?.timestamp || new Date().toISOString();
    const userColor = data.data?.color || '#FFFFFF';
    const messageType = data.data?.type || 'chat';

    // Gerar badges HTML - ESTILO ANTERIOR
    let badgesHtml = '';
    if (platform === 'twitch') {
        if (badges.isBroadcaster) badgesHtml += '<span class="badge broadcaster" title="Broadcaster">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge mod" title="Moderator">🛡️</span>';
        if (badges.isVIP) badgesHtml += '<span class="badge vip" title="VIP">⭐</span>';
        if (badges.isSubscriber || badges.isFounder) {
            badgesHtml += '<span class="badge subscriber" title="Subscriber">💜</span>';
        }
    } else if (platform === 'youtube') {
        if (badges.isOwner) badgesHtml += '<span class="badge owner" title="Dono">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge mod" title="Moderador">🛡️</span>';
        if (badges.isVerified) badgesHtml += '<span class="badge verified" title="Verificado">✓</span>';
    }

    // Determinar classe CSS baseada no tipo
    let messageClass = `${platform}-message`;
    if (messageType === 'system' || platform === 'system') {
        messageClass = 'system-message';
    }

    // Montar mensagem
    message.className = `message ${messageClass}`;
    message.innerHTML = `
        <div class="message-header">
            <span class="message-platform">
                ${platform === 'youtube' ? '🎥' :
            platform === 'twitch' ? '🎮' : '⚙️'}
            </span>
            <span class="message-user" style="color: ${userColor}">${user}</span>
            ${badgesHtml}
            <span class="message-time" title="${new Date(timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })}">
                ${formatTime(timestamp)}
            </span>
        </div>
        <div class="message-content">${messageText}</div>
    `;

    // Adicionar ao FINAL do chat
    messagesDiv.appendChild(message);

    // Scroll automático inteligente
    if (autoScrollEnabled && (wasAtBottom || !isUserScrolling)) {
        scrollToBottom(messagesDiv);
    }

    // Limitar mensagens (máximo 300 para performance)
    const maxMessages = 300;
    if (messagesDiv.children.length > maxMessages) {
        const toRemove = messagesDiv.children.length - maxMessages;
        for (let i = 0; i < toRemove; i++) {
            if (messagesDiv.firstChild) {
                messagesDiv.removeChild(messagesDiv.firstChild);
            }
        }
    }
}

// ==================== WEBSOCKET - CONEXÃO E RECONEXÃO ====================
function connectWebSocket() {
    // Limpar timeout anterior
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    console.log('🔗 Conectando ao WebSocket...');
    updateStatus('ws', 'connecting');

    // Fechar conexão anterior se existir
    if (ws) {
        try {
            ws.close();
        } catch (error) {
            // Ignorar erros ao fechar
        }
        ws = null;
    }

    // Parar heartbeat anterior
    stopHeartbeat();

    // Criar nova conexão
    try {
        ws = new WebSocket(CONFIG.serverUrl);
    } catch (error) {
        console.error('❌ Erro ao criar WebSocket:', error);
        scheduleReconnection();
        return;
    }

    // Configurar timeout de conexão
    const connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            console.log('⏱️ Timeout de conexão');
            ws.close();
        }
    }, CONNECTION_TIMEOUT);

    // ==================== WEBSOCKET EVENT HANDLERS ====================

    ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('✅ WebSocket conectado');
        updateStatus('ws', 'connected');
        reconnectAttempts = 0;

        // Iniciar heartbeat
        startHeartbeat();

        // Mensagem de sistema
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '✅ Conectado ao servidor',
                timestamp: new Date().toISOString(),
                type: 'info'
            }
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            // Processar ping/pong
            if (data.type === 'ping') {
                handlePing(data);
                return;
            }

            // Atualizar status dos serviços
            updateServiceStatus(data);

            // Adicionar mensagem ao chat
            addMessage(data);

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error, 'Data:', event.data);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ Erro WebSocket:', error);
        updateStatus('ws', 'error');
    };

    ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log(`🔌 WebSocket desconectado. Código: ${event.code}, Razão: ${event.reason || 'Sem razão'}`);
        updateStatus('ws', 'disconnected');

        // Parar heartbeat
        stopHeartbeat();

        // Agendar reconexão
        scheduleReconnection();
    };
}

// ==================== FUNÇÕES AUXILIARES WEBSOCKET ====================
function handlePing(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
            original: data.timestamp
        }));
    }
}

function updateServiceStatus(data) {
    switch (data.platform) {
        case 'youtube':
            if (data.data?.message?.includes('Conectado') || data.data?.message?.includes('live')) {
                updateStatus('youtube', 'connected');
            } else if (data.data?.message?.includes('encerrada') || data.data?.message?.includes('offline')) {
                updateStatus('youtube', 'disconnected');
            }
            break;

        case 'twitch':
            if (data.data?.message?.includes('Conectado')) {
                updateStatus('twitch', 'connected');
            } else if (data.data?.message?.includes('Desconectado')) {
                updateStatus('twitch', 'disconnected');
            }
            break;

        case 'system':
            if (data.type === 'welcome') {
                console.log('👋 ', data.data.message);

                // Atualizar status baseado nos serviços reportados
                if (data.data.services) {
                    if (data.data.services.youtube) {
                        updateStatus('youtube', 'connected');
                    } else {
                        updateStatus('youtube', 'disconnected');
                    }

                    if (data.data.services.twitch) {
                        updateStatus('twitch', 'connected');
                    }
                }
            }
            break;
    }
}

function scheduleReconnection() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('⏸️ Máximo de tentativas de reconexão atingido');
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '❌ Falha na conexão. Por favor, recarregue a página.',
                timestamp: new Date().toISOString(),
                type: 'error'
            }
        });
        return;
    }

    reconnectAttempts++;
    const delay = calculateReconnectDelay(reconnectAttempts);

    console.log(`🔄 Reconectando em ${delay / 1000}s (tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Mostrar mensagem de reconexão na primeira tentativa
    if (reconnectAttempts === 1) {
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '🔌 Conexão perdida. Tentando reconectar...',
                timestamp: new Date().toISOString(),
                type: 'warning'
            }
        });
    }

    reconnectTimeout = setTimeout(() => {
        connectWebSocket();
    }, delay);
}

function calculateReconnectDelay(attempt) {
    // Backoff exponencial com jitter
    const baseDelay = Math.min(30000, Math.pow(2, attempt) * 1000);
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
}

// ==================== HEARTBEAT SYSTEM ====================
function startHeartbeat() {
    stopHeartbeat();

    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now(),
                    source: 'client'
                }));
            } catch (error) {
                console.error('❌ Erro ao enviar heartbeat:', error);
            }
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// ==================== FUNÇÕES DE CONTROLE ====================
window.toggleAutoScroll = function () {
    autoScrollEnabled = !autoScrollEnabled;

    const button = document.querySelector('button[onclick*="toggleAutoScroll"]');
    const statusText = autoScrollEnabled ? 'ON ✅' : 'OFF ❌';

    if (button) {
        button.textContent = `Auto-scroll: ${statusText}`;
        button.style.background = autoScrollEnabled ? '#00AD03' : '#FF3333';
    }

    // Mensagem de sistema
    addMessage({
        platform: 'system',
        data: {
            user: 'Sistema',
            message: `Auto-scroll: ${statusText}`,
            timestamp: new Date().toISOString(),
            type: 'info'
        }
    });

    // Se ativou auto-scroll, ir para o final
    if (autoScrollEnabled) {
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) {
            scrollToBottom(messagesDiv);
        }
    }

    console.log(`Auto-scroll: ${autoScrollEnabled ? 'ON' : 'OFF'}`);
    return autoScrollEnabled;
};

window.clearChat = function () {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) {
        messagesDiv.innerHTML = '';
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '🧹 Chat limpo',
                timestamp: new Date().toISOString(),
                type: 'info'
            }
        });
    }
};

window.reconnectNow = function () {
    console.log('🔄 Reconexão manual solicitada');
    reconnectAttempts = 0;
    connectWebSocket();
};

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Inicializando chat OBS...');
    console.log('⚙️ Config:', CONFIG);

    // Configurar detecção de scroll
    setupScrollDetection();

    // Iniciar conexão WebSocket
    connectWebSocket();

    // Configurar botão de auto-scroll se não existir
    setTimeout(() => {
        if (!document.querySelector('button[onclick*="toggleAutoScroll"]')) {
            const autoScrollBtn = document.createElement('button');
            autoScrollBtn.textContent = 'Auto-scroll: ON ✅';
            autoScrollBtn.onclick = toggleAutoScroll;
            autoScrollBtn.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: #00AD03;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 12px;
                z-index: 1001;
                opacity: 0.7;
            `;
            autoScrollBtn.onmouseover = () => autoScrollBtn.style.opacity = '1';
            autoScrollBtn.onmouseout = () => autoScrollBtn.style.opacity = '0.7';
            document.body.appendChild(autoScrollBtn);
        }
    }, 1000);

    // Monitorar visibilidade da página (útil para OBS)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
            console.log('👀 Página ficou visível, verificando conexão...');
            setTimeout(connectWebSocket, 1000);
        }
    });

    // Verificar conexão periodicamente
    setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Conexão está ok
            return;
        }

        // Se não estiver conectando ou já tentando reconectar
        if (!reconnectTimeout && ws && ws.readyState === WebSocket.CLOSED) {
            console.log('🔍 Verificação periódica: Conexão fechada, reconectando...');
            connectWebSocket();
        }
    }, 30000); // Verificar a cada 30 segundos

    // Adicionar mensagem inicial
    setTimeout(() => {
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '💬 Chat OBS inicializado. Aguardando mensagens...',
                timestamp: new Date().toISOString(),
                type: 'info'
            }
        });

        // Mostrar informações de conexão
        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: `📺 YouTube: ${CONFIG.youtubeChannelId ? 'Monitorando' : 'Não configurado'}`,
                timestamp: new Date().toISOString(),
                type: 'info'
            }
        });

        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: `🎮 Twitch: ${CONFIG.twitchChannel || 'Não configurado'}`,
                timestamp: new Date().toISOString(),
                type: 'info'
            }
        });
    }, 500);
});

// ==================== FUNÇÕES DE DEBUG (opcional) ====================
window.debugConnection = function () {
    console.log('=== DEBUG CONEXÃO ===');
    console.log('WebSocket state:', ws ? ws.readyState : 'null');
    console.log('Reconnect attempts:', reconnectAttempts);
    console.log('Auto-scroll:', autoScrollEnabled);
    console.log('Heartbeat interval:', heartbeatInterval ? 'Ativo' : 'Inativo');
    console.log('Reconnect timeout:', reconnectTimeout ? 'Agendado' : 'Não agendado');

    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) {
        console.log('=== DEBUG SCROLL ===');
        console.log('Scroll Top:', messagesDiv.scrollTop);
        console.log('Scroll Height:', messagesDiv.scrollHeight);
        console.log('Client Height:', messagesDiv.clientHeight);
        console.log('Está no final?', isAtBottom(messagesDiv));
        console.log('Mensagens:', messagesDiv.children.length);
    }

    console.log('Config:', CONFIG);
    console.log('====================');
};

// Exportar para uso global
window.CHAT_OBS = {
    connectWebSocket,
    toggleAutoScroll,
    clearChat,
    reconnectNow,
    debugConnection,
    addMessage,
    getStatus: () => ({
        ws: ws ? ws.readyState : -1,
        reconnectAttempts,
        autoScrollEnabled,
        config: CONFIG
    })
};

console.log('✅ script.js carregado com sucesso!');