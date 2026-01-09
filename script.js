// script.js - COMPLETO
let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
let autoScrollEnabled = true;
let isUserScrolling = false;
let scrollTimeout = null;
let messagesDiv = null;
let observer = null;

// Inicialização quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 DOM carregado, inicializando chat...');

    messagesDiv = document.getElementById('messages');

    if (messagesDiv) {
        console.log('✅ Elemento #messages encontrado');

        // Forçar scroll inicial após um breve delay
        setTimeout(() => {
            scrollToBottom(true);
            console.log('⬇️ Scroll inicial para o final');
        }, 300);

        // Configurar listener de scroll
        messagesDiv.addEventListener('scroll', handleScroll);

        // Configurar MutationObserver para detectar novas mensagens
        observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Verificar se é uma mensagem de chat (não sistema)
                    const isChatMessage = Array.from(mutation.addedNodes).some(node =>
                        node.classList &&
                        (node.classList.contains('twitch-message') ||
                            node.classList.contains('youtube-message'))
                    );

                    if (isChatMessage) {
                        console.log('📨 Nova mensagem detectada via MutationObserver');
                        scrollToBottom();
                    }
                }
            });
        });

        // Observar adição de filhos ao messagesDiv
        observer.observe(messagesDiv, {
            childList: true,
            subtree: false
        });

        // Adicionar evento de clique para resetar scroll manual
        messagesDiv.addEventListener('click', function () {
            // Se clicar perto do final, resetar flag de scroll manual
            if (isNearBottom(messagesDiv, 150)) {
                isUserScrolling = false;
                console.log('🔄 Clicou perto do final, resetando scroll manual');
            }
        });
    } else {
        console.error('❌ Elemento #messages NÃO encontrado!');
    }
});

// Função para verificar se está perto do final
function isNearBottom(element, threshold = 100) {
    if (!element || element.scrollHeight <= 0) return true;

    const { scrollTop, scrollHeight, clientHeight } = element;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= threshold;
}

// Função para gerenciar o evento de scroll
function handleScroll() {
    if (!messagesDiv) return;

    const nearBottom = isNearBottom(messagesDiv);

    if (!nearBottom) {
        // Usuário está rolando manualmente (longe do final)
        isUserScrolling = true;

        // Limpar timeout anterior
        if (scrollTimeout) clearTimeout(scrollTimeout);

        // Resetar flag após 1.5 segundos de inatividade
        scrollTimeout = setTimeout(() => {
            isUserScrolling = false;
            console.log('⏱️ Resetado flag de scroll manual após inatividade');

            // Se voltou ao final, fazer scroll suave
            if (isNearBottom(messagesDiv, 50)) {
                scrollToBottom();
            }
        }, 1500);
    } else {
        // Está perto do final, considerar que não está mais rolando manualmente
        isUserScrolling = false;

        // Limpar timeout se existir
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
            scrollTimeout = null;
        }
    }
}

// Função para forçar scroll para o final
function scrollToBottom(force = false) {
    if (!messagesDiv || messagesDiv.scrollHeight <= 0) return;

    const shouldScroll = force || (autoScrollEnabled && !isUserScrolling);

    if (shouldScroll) {
        // Usar setTimeout para garantir que o DOM foi atualizado
        setTimeout(() => {
            try {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
                console.log('⬇️ Scroll para:', messagesDiv.scrollTop, 'de', messagesDiv.scrollHeight);
            } catch (error) {
                console.error('❌ Erro ao fazer scroll:', error);
            }
        }, 50);
    } else {
        console.log('⏸️ Auto-scroll pausado (usuário está rolando manualmente)');
    }
}

// Funções de utilidade
function escapeHtml(text) {
    if (!text) return '';
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
            minute: '2-digit',
            hour12: false
        });
    } catch {
        return '';
    }
}

// Função principal para adicionar mensagens
function addMessage(data) {
    if (!messagesDiv) {
        messagesDiv = document.getElementById('messages');
        if (!messagesDiv) {
            console.error('❌ Elemento #messages não encontrado!');
            return;
        }
    }

    console.log('📨 Adicionando mensagem:', {
        platform: data.platform,
        user: data.data?.user,
        message: data.data?.message?.substring(0, 50) + '...'
    });

    // Criar elemento da mensagem
    const message = document.createElement('div');

    // Dados da mensagem
    const platform = data.platform || 'system';
    const user = escapeHtml(data.data?.user || 'Sistema');
    const messageText = escapeHtml(data.data?.message || '');
    const badges = data.data?.badges || {};
    const timestamp = data.data?.timestamp || new Date().toISOString();
    const userColor = data.data?.color || '#FFFFFF';
    const messageId = data.data?.id || Date.now();

    // Gerar badges HTML
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

    // Montar mensagem
    message.className = `message ${platform}-message`;
    message.dataset.id = messageId;
    message.dataset.timestamp = timestamp;
    message.innerHTML = `
        <div class="message-header">
            <span class="message-platform">
                ${platform === 'youtube' ? '🎥' :
            platform === 'twitch' ? '🎮' : '⚙️'}
            </span>
            <span class="message-user" style="color: ${userColor}">
                ${user}
            </span>
            ${badgesHtml}
            <span class="message-time" title="${new Date(timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })}">
                ${formatTime(timestamp)}
            </span>
        </div>
        <div class="message-content">${messageText}</div>
    `;

    // Adicionar mensagem
    messagesDiv.appendChild(message);

    // Forçar scroll para o final (com pequeno delay para garantir renderização)
    setTimeout(() => {
        scrollToBottom();
    }, 100);

    // Limitar mensagens (opcional - para performance)
    const maxMessages = 500;
    if (messagesDiv.children.length > maxMessages) {
        const toRemove = messagesDiv.children.length - maxMessages;
        console.log(`🧹 Removendo ${toRemove} mensagens antigas`);

        for (let i = 0; i < toRemove; i++) {
            if (messagesDiv.firstChild) {
                messagesDiv.removeChild(messagesDiv.firstChild);
            }
        }
    }
}

// Botão para alternar auto-scroll
window.toggleAutoScroll = function () {
    autoScrollEnabled = !autoScrollEnabled;
    const statusText = autoScrollEnabled ? 'ON ✅' : 'OFF ❌';

    console.log(`Auto-scroll: ${statusText}`);

    // Adicionar mensagem do sistema
    if (messagesDiv) {
        const systemMsg = document.createElement('div');
        systemMsg.className = 'message system-message';
        systemMsg.innerHTML = `
            <div class="message-header">
                <span class="message-platform">⚙️</span>
                <span class="message-user" style="color: #00ff00">Sistema</span>
                <span class="message-time">agora</span>
            </div>
            <div class="message-content">
                <strong>Auto-scroll: ${statusText}</strong>
                ${!autoScrollEnabled ? '<br><small>Clique no chat para voltar ao modo automático</small>' : ''}
            </div>
        `;
        messagesDiv.appendChild(systemMsg);

        // Se ativar auto-scroll, ir para o final
        if (autoScrollEnabled) {
            setTimeout(() => {
                scrollToBottom(true);
            }, 200);
        }
    }

    return autoScrollEnabled;
};

// Função para forçar scroll ao final manualmente
window.forceScrollToBottom = function () {
    if (!messagesDiv) return;

    isUserScrolling = false; // Resetar flag de scroll manual
    autoScrollEnabled = true; // Garantir que auto-scroll está ativo

    scrollToBottom(true);

    // Adicionar mensagem de sistema (opcional)
    const systemMsg = document.createElement('div');
    systemMsg.className = 'message system-message';
    systemMsg.innerHTML = `
        <div class="message-header">
            <span class="message-platform">⚙️</span>
            <span class="message-user" style="color: #00ff00">Sistema</span>
            <span class="message-time">agora</span>
        </div>
        <div class="message-content">Scroll manual para o final - Auto-scroll reativado</div>
    `;
    messagesDiv.appendChild(systemMsg);

    console.log('🎯 Scroll forçado para o final');
};

// Atualizar status dos serviços
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

    // Criar conexão WebSocket
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
                message: '✅ Conectado ao servidor WebSocket'
            }
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📩 Mensagem recebida:', data.platform);

            // Atualizar status dos serviços
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

            // Adicionar mensagem ao chat
            addMessage(data);
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ Erro WebSocket:', error);
        updateStatus('ws', 'error');
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket desconectado');
        updateStatus('ws', 'disconnected');
        document.getElementById('ws-text').textContent = 'Desconectado';

        // Tentar reconexão com backoff exponencial
        reconnectAttempts++;
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));

        console.log(`🔄 Tentativa ${reconnectAttempts} - Reconectando em ${delay / 1000}s...`);

        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: `🔌 Conexão perdida. Reconectando em ${delay / 1000} segundos...`
            }
        });

        reconnectTimeout = setTimeout(() => {
            connectWebSocket();
        }, delay);
    };
}

// Limpar todos os chats
window.clearChat = function () {
    if (messagesDiv && confirm('Tem certeza que deseja limpar todas as mensagens?')) {
        messagesDiv.innerHTML = '';

        addMessage({
            platform: 'system',
            data: {
                user: 'Sistema',
                message: '🧹 Chat limpo com sucesso'
            }
        });

        console.log('🧹 Chat limpo');
    }
};

// Função para recarregar a página
window.reloadPage = function () {
    if (confirm('Recarregar a página?')) {
        location.reload();
    }
};

// Função de debug
window.debugInfo = function () {
    console.log('=== DEBUG INFO ===');
    console.log('autoScrollEnabled:', autoScrollEnabled);
    console.log('isUserScrolling:', isUserScrolling);
    console.log('messagesDiv:', messagesDiv);

    if (messagesDiv) {
        console.log('ScrollTop:', messagesDiv.scrollTop);
        console.log('ScrollHeight:', messagesDiv.scrollHeight);
        console.log('ClientHeight:', messagesDiv.clientHeight);
        console.log('Total de mensagens:', messagesDiv.children.length);
        console.log('Está perto do final?', isNearBottom(messagesDiv));
    }

    console.log('WebSocket estado:', ws ? ws.readyState : 'null');
    console.log('=== FIM DEBUG ===');
};

// Inicialização quando a página carregar
window.onload = function () {
    console.log('🚀 Inicializando chat OBS...');
    console.log('⚙️ Config:', CONFIG);

    // Adicionar mensagem inicial
    addMessage({
        platform: 'system',
        data: {
            user: 'Sistema',
            message: '💬 Chat OBS inicializado. Aguardando conexões...'
        }
    });

    // Iniciar conexão WebSocket
    connectWebSocket();

    // Testar conexão periodicamente (keep-alive)
    setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ping',
                timestamp: Date.now(),
                data: 'keep-alive'
            }));
        }
    }, 30000); // A cada 30 segundos

    // Verificar periodicamente se precisa fazer scroll
    setInterval(() => {
        if (messagesDiv && autoScrollEnabled && !isUserScrolling) {
            // Se estiver muito longe do final e não estiver rolando manualmente
            if (!isNearBottom(messagesDiv, 500)) {
                console.log('🔄 Verificação periódica: ajustando scroll');
                scrollToBottom();
            }
        }
    }, 5000); // Verificar a cada 5 segundos

    // Log inicial
    console.log('✅ Chat inicializado com sucesso');
};