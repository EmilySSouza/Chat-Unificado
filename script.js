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
    if (!container) return;

    // Limita mensagens
    if (container.children.length >= 200) {
        container.removeChild(container.firstChild);
    }

    let badgesHtml = '';

    if (platform === 'twitch') {
        console.log(`🎯 Renderizando: ${user} com badges:`, badges.badgeList);

        // MÉTODO 1: Usar URLs diretas (mais confiável)
        if (badges.badgeList && badges.badgeList.length > 0) {
            badges.badgeList.forEach(badge => {
                const [setId, version] = badge.split('/');
                console.log(`   Badge: ${setId}/${version}`);

                // URLs diretas das badges da Twitch
                const badgeUrls = {
                    'broadcaster': `https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/${version}/1`,
                    'moderator': `https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/${version}/1`,
                    'vip': `https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/${version}/1`,
                    'subscriber': `https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/${version}/1`,
                    'founder': `https://static-cdn.jtvnw.net/badges/v1/511b78a9-ab37-472f-9569-457753bbe7d4/${version}/1`,
                    'premium': `https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/${version}/1`
                };

                if (badgeUrls[setId]) {
                    badgesHtml += `<img src="${badgeUrls[setId]}" 
                                      class="badge-icon" 
                                      title="${setId}"
                                      alt="${setId}">`;
                } else if (setId.startsWith('subscriber')) {
                    // Para subscribers com meses específicos
                    badgesHtml += `<img src="https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/${version}/1" 
                                      class="badge-icon" 
                                      title="Subscriber"
                                      alt="subscriber">`;
                } else {
                    console.log(`   ❌ Badge não mapeada: ${setId}`);
                }
            });
        }

        // MÉTODO 2: Fallback para status direto
        if (!badgesHtml) {
            if (badges.isBroadcaster) {
                badgesHtml += `<img src="https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1/1" 
                                  class="badge-icon" title="Broadcaster">`;
            }
            if (badges.isModerator) {
                badgesHtml += `<img src="https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1/1" 
                                  class="badge-icon" title="Moderator">`;
            }
        }

        console.log(`   ✅ HTML gerado: ${badgesHtml ? 'Sim' : 'Não'}`);

    } else if (platform === 'youtube') {
        // Código do YouTube...
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

        if (msg.includes('PING')) {
            twitchSocket.send('PONG :tmi.twitch.tv');
            return;
        }

        // Log para debug (remova depois de testar)
        console.log('📨 RAW:', msg);

        if (msg.includes('PRIVMSG')) {
            try {
                // CORREÇÃO: Parse correto das tags IRC
                let tags = {};
                let messageText = '';
                let displayName = '';

                // As tags começam com @ e terminam antes do primeiro espaço
                if (msg.startsWith('@')) {
                    const firstSpace = msg.indexOf(' ');
                    const tagsPart = msg.substring(1, firstSpace);

                    // Parse das tags
                    tagsPart.split(';').forEach(tag => {
                        const [key, ...valueParts] = tag.split('=');
                        if (key) {
                            tags[key] = valueParts.join('=');
                        }
                    });

                    // Extrai o resto da mensagem
                    const remaining = msg.substring(firstSpace + 1);

                    // Parse do formato: "username!username@username.tmi.twitch.tv PRIVMSG #canal :mensagem"
                    const privmsgMatch = remaining.match(/:(.*)!(.*)@(.*) PRIVMSG #(.*) :(.*)/);
                    if (privmsgMatch) {
                        displayName = tags['display-name'] || privmsgMatch[1];
                        messageText = privmsgMatch[5];
                    }
                }

                // DEBUG: Mostra todas as tags
                console.log('🔍 Tags encontradas:', tags);
                console.log('👤 Usuário:', displayName);
                console.log('📝 Mensagem:', messageText);
                console.log('🏷️ Badges string:', tags.badges);

                if (displayName && messageText) {
                    // Prepara dados para addMessage
                    const badgeList = tags.badges ? tags.badges.split(',') : [];
                    const messageData = {
                        badgeList: badgeList,
                        color: tags.color || '#FFFFFF',
                        isBroadcaster: badgeList.includes('broadcaster'),
                        isModerator: badgeList.includes('moderator') || tags.mod === '1',
                        isSubscriber: tags.subscriber === '1',
                        userId: tags['user-id'],
                        badges: tags.badges || ''
                    };

                    console.log(`✅ Processado: ${displayName} com ${badgeList.length} badges`);

                    // Adiciona mensagem ao chat
                    addMessage('twitch', displayName, messageText, messageData);
                }

            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
                console.log('Mensagem problemática:', msg);
            }
        }

        // Outros tipos de mensagem
        else if (msg.includes('USERNOTICE') || msg.includes('CLEARCHAT') || msg.includes('USERSTATE')) {
            console.log('ℹ️ Outro tipo de mensagem:', msg.substring(0, 100));
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

function testBadgeParsing() {
    // Simula uma mensagem real da Twitch
    const testMessage = '@badge-info=;badges=broadcaster/1;color=#FF0000;display-name=MilyMend;emotes=;flags=;id=123;mod=0;room-id=456;subscriber=0;tmi-sent-ts=123456789;turbo=0;user-id=789;user-type= :milymend!milymend@milymend.tmi.twitch.tv PRIVMSG #funilzinha :Testando badges';

    console.log('🧪 Testando parse...');

    // Simula o parsing
    let tags = {};
    if (testMessage.startsWith('@')) {
        const firstSpace = testMessage.indexOf(' ');
        const tagsPart = testMessage.substring(1, firstSpace);

        tagsPart.split(';').forEach(tag => {
            const [key, ...valueParts] = tag.split('=');
            if (key) tags[key] = valueParts.join('=');
        });
    }

    console.log('📊 Resultado do teste:');
    console.log('- Badges:', tags.badges);
    console.log('- Display Name:', tags['display-name']);
    console.log('- Badge List:', tags.badges ? tags.badges.split(',') : []);
}