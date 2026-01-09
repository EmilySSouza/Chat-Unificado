// script.js - VERSÃO CORRIGIDA

// ==================== VARIÁVEIS GLOBAIS ====================
let eventSource = null; // ← ADICIONE ESTA LINHA!
let twitchSocket = null;
let reconnectAttempts = 0;
let twitchBadgesCache = {
    global: {},
    channel: {}
};

// ==================== CONFIGURAÇÃO ====================
console.log('🎮 Iniciando chat...');

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

async function fetchGlobalBadges() {
    try {
        console.log('🌐 Buscando badges globais...');

        const response = await fetch('https://api.twitch.tv/helix/chat/badges/global', {
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Accept': 'application/vnd.twitchtv.v5+json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Organiza badges por set_id e versão
        data.data.forEach(badge => {
            twitchBadgesCache.global[badge.set_id] = {};
            badge.versions.forEach(version => {
                twitchBadgesCache.global[badge.set_id][version.id] = {
                    url_1x: version.image_url_1x,
                    url_2x: version.image_url_2x,
                    url_4x: version.image_url_4x,
                    title: version.title
                };
            });
        });

        console.log(`✅ ${Object.keys(twitchBadgesCache.global).length} badges globais carregadas`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar badges globais:', error.message);
        return false;
    }
}

// Busca badges específicas do canal
async function fetchChannelBadges(channelId) {
    try {
        console.log(`📡 Buscando badges do canal ID: ${channelId}...`);

        const response = await fetch(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${channelId}`, {
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Accept': 'application/vnd.twitchtv.v5+json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log('ℹ️ Canal não tem badges personalizadas');
                return false;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        data.data.forEach(badge => {
            twitchBadgesCache.channel[badge.set_id] = {};
            badge.versions.forEach(version => {
                twitchBadgesCache.channel[badge.set_id][version.id] = {
                    url_1x: version.image_url_1x,
                    url_2x: version.image_url_2x,
                    url_4x: version.image_url_4x,
                    title: version.title
                };
            });
        });

        console.log(`✅ ${Object.keys(twitchBadgesCache.channel).length} badges do canal carregadas`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar badges do canal:', error.message);
        return false;
    }
}

// Função auxiliar para obter ID do canal
async function getChannelId(channelName) {
    try {
        // Usa um Client-ID público (funciona para leitura)
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', // Client-ID público
                'Accept': 'application/vnd.twitchtv.v5+json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const channelId = data.data[0].id;
            console.log(`📊 ID do canal ${channelName}: ${channelId}`);
            return channelId;
        }

        return null;
    } catch (error) {
        console.error('⚠️ Não foi possível obter ID do canal (usando badges globais):', error.message);
        return null;
    }
}


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

    if (platform === 'twitch') {
        // Processa badges da Twitch com imagens
        if (badges.badgeList && badges.badgeList.length > 0) {
            badges.badgeList.forEach(badge => {
                const [setId, version] = badge.split('/');
                let badgeData = null;

                // Procura na ordem: canal → global
                if (twitchBadgesCache.channel[setId]?.[version]) {
                    badgeData = twitchBadgesCache.channel[setId][version];
                } else if (twitchBadgesCache.global[setId]?.[version]) {
                    badgeData = twitchBadgesCache.global[setId][version];
                }

                if (badgeData && badgeData.url_1x) {
                    badgesHtml += `<img src="${badgeData.url_1x}" 
                                   srcset="${badgeData.url_1x} 1x, ${badgeData.url_2x} 2x"
                                   class="badge-icon" 
                                   title="${badgeData.title || setId}"
                                   alt="${setId} badge">`;
                } else {
                    // Fallback para emojis
                    badgesHtml += getFallbackBadge(setId);
                }
            });
        } else {
            // Se não tem badges na lista, verifica status especial
            if (badges.isBroadcaster) {
                badgesHtml += `<img src="https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1" 
                               class="badge-icon" title="Broadcaster">`;
            } else if (badges.isModerator) {
                badgesHtml += `<img src="https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1" 
                               class="badge-icon" title="Moderator">`;
            }
        }

    } else if (platform === 'youtube') {
        // Seu código atual do YouTube
        if (badges.isOwner) badgesHtml += '<span class="badge owner">👑</span>';
        if (badges.isModerator) badgesHtml += '<span class="badge mod">🛡️</span>';
        if (badges.isMember) badgesHtml += '<span class="badge member">⭐</span>';
    }

    const msgEl = document.createElement('div');
    msgEl.className = `message ${platform}-message`;
    msgEl.innerHTML = `
        <div class="message-header">
            <span class="message-user" style="${badges.color ? `color: ${badges.color}` : ''}">
                ${badgesHtml}
                <span class="username">${user}</span>
            </span>
            <span class="message-time">${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="message-content">${escapeHtml(text)}</div>
    `;

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

// Fallback para badges não encontradas
function getFallbackBadge(setId) {
    const fallbacks = {
        'broadcaster': '<span class="badge broadcaster" title="Broadcaster">👑</span>',
        'moderator': '<span class="badge mod" title="Moderator">🛡️</span>',
        'vip': '<span class="badge vip" title="VIP">⭐</span>',
        'subscriber': '<span class="badge subscriber" title="Subscriber">💜</span>',
        'founder': '<span class="badge founder" title="Founder">🚀</span>',
        'premium': '<span class="badge premium" title="Prime Gaming">🎮</span>'
    };

    return fallbacks[setId] || '';
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

async function connectTwitch() {
    console.log('🎮 Conectando Twitch...');

    // 1. CARREGA BADGES ANTES DE CONECTAR
    console.log('🔄 Carregando badges da Twitch...');

    // Carrega badges globais (sempre disponíveis)
    await fetchGlobalBadges();

    // Tenta carregar badges específicas do canal
    try {
        const channelId = await getChannelId(CONFIG.twitchChannel);
        if (channelId) {
            await fetchChannelBadges(channelId);
            console.log(`✅ Badges carregadas para o canal: ${CONFIG.twitchChannel}`);
        }
    } catch (error) {
        console.log('⚠️ Usando apenas badges globais:', error.message);
    }

    // 2. CONEXÃO WEBSOCKET
    // Fecha conexão anterior
    if (twitchSocket && twitchSocket.readyState === WebSocket.OPEN) {
        twitchSocket.close();
    }

    // Cria nova conexão
    twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    twitchSocket.onopen = () => {
        console.log('✅ Twitch WebSocket conectado!');

        // Solicita tags e comandos
        twitchSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');

        // Conecta como usuário anônimo (para visualização)
        twitchSocket.send(`NICK justinfan${Math.floor(Math.random() * 10000)}`);

        // Entra no canal
        twitchSocket.send(`JOIN #${CONFIG.twitchChannel.toLowerCase()}`);

        addMessage('system', 'Sistema', 'Twitch conectado com badges');
    };

    twitchSocket.onmessage = (event) => {
        const msg = event.data;
        console.log('📨 Raw Twitch:', msg); // DEBUG

        // Responde a PING
        if (msg.includes('PING')) {
            twitchSocket.send('PONG :tmi.twitch.tv');
            console.log('🔄 PING/PONG Twitch');
            return;
        }

        // Processa mensagens do chat
        if (msg.includes('PRIVMSG')) {
            try {
                // Parse das tags IRC
                const parts = msg.split(';');
                const tags = {};

                parts.forEach(part => {
                    const [key, ...value] = part.split('=');
                    if (key && key.trim()) {
                        tags[key.trim()] = value.join('=');
                    }
                });

                // Extrai username e mensagem
                const match = msg.match(/:(.*)!(.*) PRIVMSG #(.*) :(.*)/);
                if (match) {
                    const username = tags['display-name'] || match[1];
                    const message = match[4];

                    // DEBUG: Mostra todas as tags
                    console.log('🏷️ Tags:', tags);

                    // Prepara dados da mensagem
                    const messageData = {
                        badgeList: tags.badges ? tags.badges.split(',') : [],
                        isBroadcaster: tags['user-id'] === tags['room-id'],
                        isModerator: tags.mod === '1',
                        isSubscriber: tags.subscriber === '1',
                        color: tags.color || '#FFFFFF',
                        userId: tags['user-id'],
                        roomId: tags['room-id']
                    };

                    console.log(`💬 Twitch: ${username} (badges: ${messageData.badgeList.length})`);

                    // Adiciona mensagem ao chat
                    addMessage('twitch', username, message, messageData);
                }
            } catch (error) {
                console.error('❌ Erro ao processar mensagem Twitch:', error, 'Mensagem:', msg);
            }
        }

        // Mensagens de sistema
        if (msg.includes('JOIN')) {
            console.log('➡️ Usuário entrou no chat');
        }

        if (msg.includes('PART')) {
            console.log('⬅️ Usuário saiu do chat');
        }

        // Confirmação de conexão
        if (msg.includes('Welcome, GLHF!')) {
            console.log('🎉 Conectado ao chat da Twitch!');
            addMessage('system', 'Sistema', `Conectado ao chat de ${CONFIG.twitchChannel}`);
        }
    };

    twitchSocket.onclose = (event) => {
        console.log(`🔌 Twitch desconectado. Código: ${event.code}, Razão: ${event.reason}`);

        if (event.code !== 1000) {
            const delay = Math.min(30000, reconnectAttempts * 5000);
            console.log(`🔄 Reconectando Twitch em ${delay / 1000}s...`);

            setTimeout(() => {
                reconnectAttempts++;
                connectTwitch();
            }, delay);
        }
    };

    twitchSocket.onerror = (error) => {
        console.error('❌ Erro WebSocket Twitch:', error);

        // Reconexão rápida em caso de erro
        if (twitchSocket.readyState === WebSocket.CLOSED) {
            console.log('🔄 Reconexão imediata...');
            setTimeout(connectTwitch, 2000);
        }
    };

    // 3. VERIFICAÇÃO PERIÓDICA
    const checkConnection = setInterval(() => {
        if (twitchSocket && twitchSocket.readyState === WebSocket.OPEN) {
            // Mantém conexão ativa
            twitchSocket.send('PING :keepalive');
        }
    }, 30000);

    // Limpa intervalo quando desconectar
    twitchSocket.addEventListener('close', () => {
        clearInterval(checkConnection);
    });
}

// ==================== FUNÇÕES GLOBAIS ====================

window.testServer = async function () {
    try {
        const response = await fetch('https://chat-unificado.onrender.com/test');
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

window.onload = function () {
    console.log('🚀 Chat OBS - Iniciando...');
    console.log('⚙️ Config:', CONFIG);

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