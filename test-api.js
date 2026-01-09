// Arquivo para testar a API do YouTube
const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'SUA_CHAVE_AQUI';
const CHANNEL_ID = 'UC5ooSCrMhz10WUWrc6IlT3Q';

async function testYouTubeAPI() {
    console.log('🧪 Testando API do YouTube...');
    
    try {
        // Teste 1: Verificar canal
        console.log('\n1. Verificando canal...');
        const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
            params: {
                part: 'snippet,statistics',
                id: CHANNEL_ID,
                key: YOUTUBE_API_KEY
            }
        });
        
        const channel = channelRes.data.items[0];
        console.log(`✅ Canal: ${channel.snippet.title}`);
        console.log(`📊 Inscritos: ${channel.statistics.subscriberCount}`);
        
        // Teste 2: Verificar lives
        console.log('\n2. Buscando lives ativas...');
        const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                channelId: CHANNEL_ID,
                eventType: 'live',
                type: 'video',
                maxResults: 1,
                key: YOUTUBE_API_KEY
            }
        });
        
        if (searchRes.data.items.length > 0) {
            const live = searchRes.data.items[0];
            console.log(`✅ Live ativa encontrada: ${live.snippet.title}`);
            console.log(`📺 Video ID: ${live.id.videoId}`);
            
            // Teste 3: Detalhes do vídeo para pegar chatId
            console.log('\n3. Buscando detalhes da live...');
            const videoRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'liveStreamingDetails',
                    id: live.id.videoId,
                    key: YOUTUBE_API_KEY
                }
            });
            
            const liveChatId = videoRes.data.items[0]?.liveStreamingDetails?.activeLiveChatId;
            if (liveChatId) {
                console.log(`✅ LiveChat ID: ${liveChatId}`);
                
                // Teste 4: Buscar mensagens do chat
                console.log('\n4. Buscando mensagens do chat...');
                const chatRes = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
                    params: {
                        part: 'snippet,authorDetails',
                        liveChatId: liveChatId,
                        maxResults: 5,
                        key: YOUTUBE_API_KEY
                    }
                });
                
                console.log(`📩 ${chatRes.data.items.length} mensagens encontradas`);
                if (chatRes.data.items.length > 0) {
                    chatRes.data.items.forEach((msg, i) => {
                        console.log(`  ${i+1}. ${msg.authorDetails.displayName}: ${msg.snippet.displayMessage}`);
                    });
                }
                
                console.log(`⏱️ Polling interval: ${chatRes.data.pollingIntervalMillis}ms`);
            } else {
                console.log('❌ Não foi possível obter o LiveChat ID');
            }
            
        } else {
            console.log('📭 Nenhuma live ativa no momento');
        }
        
        console.log('\n🎉 Teste concluído com sucesso!');
        console.log('✅ API Key está funcionando corretamente');
        
    } catch (error) {
        console.error('\n❌ Erro no teste:', error.response?.data?.error || error.message);
        
        if (error.response?.data?.error?.code === 403) {
            console.log('\n⚠️ Possíveis problemas:');
            console.log('1. API não ativada no Google Cloud Console');
            console.log('2. Quota excedida');
            console.log('3. API Key inválida ou restrita');
            console.log('\n📋 Solução:');
            console.log('1. Ative a "YouTube Data API v3" no Google Cloud');
            console.log('2. Verifique as restrições da API Key');
            console.log('3. Aguarde a quota resetar (10,000 unidades/dia)');
        }
    }
}

// Executar teste
if (require.main === module) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'SUA_CHAVE_AQUI') {
        console.error('❌ Configure a YOUTUBE_API_KEY no arquivo .env ou como variável de ambiente');
        console.log('💡 Use: YOUTUBE_API_KEY=sua_chave node test-api.js');
        process.exit(1);
    }
    
    testYouTubeAPI();
}

module.exports = { testYouTubeAPI };