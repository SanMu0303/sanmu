window.DASHBOARD_CONFIG = {
  // 如果网页部署在 GitHub Pages，必须填写 Vercel/Netlify 等可运行 /api 的后端域名。
  // 如果网页直接部署并访问 Vercel 域名，可以保持为空，默认使用同域 /api。
  apiOrigin: "https://sanmu-o962.vercel.app",
  discordClientId: "1514274852096180336",
  discordRedirectUri: "https://sanmu-o962.vercel.app/api/discord-callback",
  discordLocalRedirectUri: "http://127.0.0.1:8787/api/discord-callback",
  socialHeat: {
    enabled: false,
    endpoint: "",
    timeoutMs: 8000
  }
};

/*
socialHeat endpoint contract:

POST /your-heat-endpoint
{
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "baseAssets": ["BTC", "ETH"]
}

response:
{
  "items": [
    {
      "symbol": "BTCUSDT",
      "score": 82,
      "tags": ["#BTC", "#Bitcoin", "#ETF"],
      "twitterMentions": 18600,
      "binanceSquareMentions": 4200,
      "newsMentions": 950,
      "sources": [
        { "name": "X", "value": 18600 },
        { "name": "广场", "value": 4200 },
        { "name": "资讯", "value": 950 }
      ]
    }
  ]
}
*/
