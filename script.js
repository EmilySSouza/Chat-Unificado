let eventSource = null;
let twitchSocket = null;
let reconnectAttempts = 0;
let twitchBadgesCache = {
    global: {},
    channel: {}
};

if (typeof CONFIG === 'undefined') {
    console.error('❌ CONFIG não encontrada!');
    window.CONFIG = {
        twitchChannel: "funilzinha",
        serverUrl: "http://localhost:3000",
        youtubeChannelId: "UC5ooSCrMhz10WUWrc6IlT3Q"
    };
}

async function fetchGlobalBadges() {
    try {
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
        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar badges globais:', error.message);
        return false;
    }
}

async function fetchChannelBadges(channelId) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${channelId}`, {
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Accept': 'application/vnd.twitchtv.v5+json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
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

        return true;
    } catch (error) {
        console.error('❌ Erro ao carregar badges do canal:', error.message);
        return false;
    }
}

async function getChannelId(channelName) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
            headers: {
                'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                'Accept': 'application/vnd.twitchtv.v5+json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const channelId = data.data[0].id;
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

    if (container.children.length >= 200) {
        container.removeChild(container.firstChild);
    }

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
    }

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
}

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

function connectToServer() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    eventSource = new EventSource(`${CONFIG.serverUrl}/events`);

    eventSource.onopen = () => {
        reconnectAttempts = 0;
        addMessage('system', 'Sistema', '🔗 Conectado ao servidor...');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            // IGNORA mensagens de "aguardando" se já viu antes
            const ignoreMessages = [
                'Aguardando início da transmissão',
                'Aguardando transmissão',
                'Nenhuma transmissão ativa'
            ];

            const messageText = typeof data.data === 'string' ? data.data : '';
            if (ignoreMessages.some(msg => messageText.includes(msg))) {
                return; // Não mostra no chat
            }

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
                    // Mostra apenas informações importantes
                    if (data.data.message) {
                        addMessage('system', 'Sistema', data.data.message);
                    }
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

        setTimeout(connectToServer, delay);
    };
}

async function connectTwitch() {

    await fetchGlobalBadges();

    try {
        const channelId = await getChannelId(CONFIG.twitchChannel);
        if (channelId) {
            await fetchChannelBadges(channelId);
        }
    } catch (error) {
        console.log('⚠️ Usando apenas badges globais:', error.message);
    }

    if (twitchSocket && twitchSocket.readyState === WebSocket.OPEN) {
        twitchSocket.close();
    }

    twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    twitchSocket.onopen = () => {

        twitchSocket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');

        twitchSocket.send(`NICK justinfan${Math.floor(Math.random() * 10000)}`);

        twitchSocket.send(`JOIN #${CONFIG.twitchChannel.toLowerCase()}`);

        addMessage('system', 'Sistema', 'Twitch conectado com badges');
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

                    const twitchBadges = {};
                    if (tags.badges) {
                        const badgesList = tags.badges.split(',');
                        badgesList.forEach(badge => {
                            const [name, version] = badge.split('/');
                            twitchBadges[name] = version;
                        });
                    }

                    const userBadges = {
                        isBroadcaster: tags['badges']?.includes('broadcaster') || tags['user-id'] === tags['room-id'],
                        isModerator: tags.mod === '1' || tags['badges']?.includes('moderator'),
                        isVIP: tags['badges']?.includes('vip'),
                        isSubscriber: tags.subscriber === '1',
                        isFounder: tags['badges']?.includes('founder'),
                        badgeInfo: tags['badge-info']
                    };

                    addMessage('twitch', username, message, userBadges);
                }
            } catch (error) {
                console.log('Erro Twitch:', error);
            }
        }
    };

    twitchSocket.onclose = (event) => {
        if (event.code !== 1000) {
            const delay = Math.min(30000, reconnectAttempts * 5000);

            setTimeout(() => {
                reconnectAttempts++;
                connectTwitch();
            }, delay);
        }
    };

    twitchSocket.onerror = (error) => {
        console.error('❌ Erro WebSocket Twitch:', error);

        if (twitchSocket.readyState === WebSocket.CLOSED) {
            setTimeout(connectTwitch, 2000);
        }
    };

    const checkConnection = setInterval(() => {
        if (twitchSocket && twitchSocket.readyState === WebSocket.OPEN) {
            twitchSocket.send('PING :keepalive');
        }
    }, 30000);

    twitchSocket.addEventListener('close', () => {
        clearInterval(checkConnection);
    });
};

window.testServer = async function () {
    try {
        const response = await fetch('https://chat-unificado.onrender.com/test');
        const data = await response.json();
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

window.onload = function () {
    addMessage('system', 'Sistema', '💬 Chat OBS iniciado');
    addMessage('system', 'Sistema', `📺 Twitch: ${CONFIG.twitchChannel}`);
    addMessage('system', 'Sistema', '🎥 YouTube: Conectando...');

    connectToServer();
    connectTwitch();
};

setInterval(() => {
    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        connectToServer();
    }

    if (twitchSocket && twitchSocket.readyState === WebSocket.CLOSED) {
        connectTwitch();
    }
}, 10000);

function testBadgeParsing() {
    const testMessage = '@badge-info=;badges=broadcaster/1;color=#FF0000;display-name=MilyMend;emotes=;flags=;id=123;mod=0;room-id=456;subscriber=0;tmi-sent-ts=123456789;turbo=0;user-id=789;user-type= :milymend!milymend@milymend.tmi.twitch.tv PRIVMSG #funilzinha :Testando badges';

    let tags = {};
    if (testMessage.startsWith('@')) {
        const firstSpace = testMessage.indexOf(' ');
        const tagsPart = testMessage.substring(1, firstSpace);

        tagsPart.split(';').forEach(tag => {
            const [key, ...valueParts] = tag.split('=');
            if (key) tags[key] = valueParts.join('=');
        });
    }
}