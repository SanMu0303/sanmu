window.DASHBOARD_CONFIG = {
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
