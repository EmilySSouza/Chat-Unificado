const TWITCH_CONFIG = {
    channel: "funilzinha",
};

const APP_CONFIG = {
    maxMessages: process.env.MAX_MESSAGES || 200,
    updateInterval: process.env.UPDATE_INTERVAL || 60000,
    enableSimulation: process.env.ENABLE_SIMULATION || true
};


const YOUTUBE_CONFIG = {
    channelId: process.env.YOUTUBE_CHANNEL_ID || "",
    apiKey: process.env.YOUTUBE_API_KEY || ""
};