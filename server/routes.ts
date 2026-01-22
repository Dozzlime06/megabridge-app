import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBridgeTransactionSchema } from "@shared/schema";
import { z } from "zod";

const SLIPPAGE_BPS = 50;
const BRIDGE_FEE_PERCENT = 0.1;

const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  SOL: 9,
  MATIC: 18,
  BNB: 18,
  AVAX: 18,
  FTM: 18,
  CRO: 18,
  MNT: 18,
  xDAI: 18,
  HYPE: 18,
  FLUFFEY: 18,
  MEKA: 18,
  KUMA: 18,
  SIGMA: 18,
};

// MegaETH token addresses (for Codex API)
const MEGAETH_TOKENS: Record<string, string> = {
  FLUFFEY: '0xc5808cf8be4e4ce012aa65bf6f60e24a3cc82071',
  MEKA: '0x238214f6026601d5136ed88b5905e909ba06997b',
  KUMA: '0xd34f85ba2a331514666f3040f43d83306c7a85df',
  SIGMA: '0x023bb18826845645b121c5dfb65d23e834158491',
};

// Codex API for MegaETH token prices
const CODEX_API_URL = 'https://graph.codex.io/graphql';
const MEGAETH_NETWORK_ID = 4326;

const CHAIN_TOKEN: Record<string, string> = {
  '8453': 'ETH',
  '8453_FLUFFEY': 'FLUFFEY',
  '1': 'ETH',
  '1_FLUFFEY': 'FLUFFEY',
  '42161': 'ETH',
  '42161_FLUFFEY': 'FLUFFEY',
  '10': 'ETH',
  '10_FLUFFEY': 'FLUFFEY',
  '137': 'MATIC',
  '56': 'BNB',
  '43114': 'AVAX',
  '250': 'FTM',
  '25': 'CRO',
  '324': 'ETH',
  '59144': 'ETH',
  '534352': 'ETH',
  '81457': 'ETH',
  '5000': 'MNT',
  '100': 'xDAI',
  '1101': 'ETH',
  '7777777': 'ETH',
  '34443': 'ETH',
  '169': 'ETH',
  '999': 'HYPE',
  'solana': 'SOL',
};

let priceCache: { prices: Record<string, number>; timestamp: number } | null = null;
const CACHE_DURATION = 10000;

async function fetchPrices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
    return priceCache.prices;
  }

  const coinGeckoIds: Record<string, string> = {
    ETH: 'ethereum',
    SOL: 'solana',
    MATIC: 'matic-network',
    BNB: 'binancecoin',
    AVAX: 'avalanche-2',
    FTM: 'fantom',
  };

  const prices: Record<string, number> = { xDAI: 1 };

  // Fetch major token prices from CoinGecko (real-time)
  try {
    const ids = Object.values(coinGeckoIds).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { 
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'MegaBridge/1.0'
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      for (const [symbol, geckoId] of Object.entries(coinGeckoIds)) {
        if (data[geckoId]?.usd) {
          prices[symbol] = data[geckoId].usd;
          console.log(`[Prices] ${symbol}: $${data[geckoId].usd} (real-time from CoinGecko)`);
        }
      }
    }
  } catch (e) {
    console.log('Failed to fetch prices from CoinGecko:', e);
  }

  // Fetch MegaETH token prices from Codex API (real-time)
  try {
    const codexApiKey = process.env.CODEX_API_KEY;
    if (codexApiKey) {
      const tokenInputs = Object.entries(MEGAETH_TOKENS).map(([_, address]) => 
        `{address: "${address}", networkId: ${MEGAETH_NETWORK_ID}}`
      ).join(', ');
      
      const query = `{ getTokenPrices(inputs: [${tokenInputs}]) { address priceUsd } }`;
      
      const res = await fetch(CODEX_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': codexApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(5000)
      });
      
      if (res.ok) {
        const data = await res.json();
        const tokenPrices = data.data?.getTokenPrices || [];
        
        for (const [symbol, address] of Object.entries(MEGAETH_TOKENS)) {
          const tokenPrice = tokenPrices.find((t: any) => t?.address?.toLowerCase() === address.toLowerCase());
          if (tokenPrice?.priceUsd) {
            prices[symbol] = tokenPrice.priceUsd;
            const ethPrice = prices.ETH || 3000;
            const tokensPerEth = (ethPrice / tokenPrice.priceUsd).toFixed(0);
            console.log(`[Prices] ${symbol}: $${tokenPrice.priceUsd.toFixed(8)} (Codex: 1 ETH = ${tokensPerEth} ${symbol})`);
          }
        }
      }
    } else {
      console.log('[Prices] CODEX_API_KEY not set, skipping Codex API');
    }
  } catch (e) {
    console.log('[Prices] Failed to fetch from Codex API:', e);
  }
  
  // Fetch HYPE price from CoinGecko (real-time)
  try {
    const hypeRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(3000) }
    );
    if (hypeRes.ok) {
      const hypeData = await hypeRes.json();
      if (hypeData.hyperliquid?.usd) {
        prices.HYPE = hypeData.hyperliquid.usd;
        console.log(`[Prices] HYPE: $${prices.HYPE} (real-time from CoinGecko)`);
      }
    }
  } catch (e) {
    console.log('[Prices] Failed to fetch HYPE price separately');
  }
  
  // Safety fallbacks only if API completely fails (should rarely happen)
  if (!prices.ETH) {
    console.log('[Prices] WARNING: Using fallback ETH price');
    prices.ETH = 3000;
  }
  if (!prices.SOL) prices.SOL = 150;
  if (!prices.MATIC) prices.MATIC = 0.5;
  if (!prices.BNB) prices.BNB = 600;
  if (!prices.AVAX) prices.AVAX = 35;
  if (!prices.FTM) prices.FTM = 0.5;
  if (!prices.CRO) prices.CRO = 0.1;
  if (!prices.MNT) prices.MNT = 0.8;
  if (!prices.HYPE) prices.HYPE = 25;
  
  // Mania.fun token fallbacks (should use real API prices, these are safety fallbacks)
  if (!prices.FLUFFEY || prices.FLUFFEY <= 0) {
    console.log('[Prices] WARNING: Using fallback FLUFFEY price');
    prices.FLUFFEY = 0.0001; // ~$100k market cap / 1B supply
  }
  if (!prices.MEKA || prices.MEKA <= 0) {
    prices.MEKA = 0.00002;
  }
  if (!prices.KUMA || prices.KUMA <= 0) {
    prices.KUMA = 0.000015;
  }
  if (!prices.SIGMA || prices.SIGMA <= 0) {
    prices.SIGMA = 0.00001; // Fallback - no mania.fun API available
  }
  
  priceCache = { prices, timestamp: Date.now() };
  console.log(`[Prices] Final prices at ${new Date().toISOString()}:`, prices);
  return prices;
}

async function calculateQuote(amount: string, key: string = '8453_ETH', targetToken: string = 'ETH', inputTokenParam?: string) {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return null;
  }
  
  const prices = await fetchPrices();
  
  // Normalize token symbols
  const sourceToken = (inputTokenParam || 'ETH').toUpperCase();
  const targetTokenFinal = (targetToken || 'ETH').toUpperCase();
  
  // Get prices for source and target tokens
  const sourcePrice = prices[sourceToken] || prices.ETH;
  const targetPrice = prices[targetTokenFinal] || prices.ETH;
  
  console.log(`[Quote Debug] inputTokenParam: ${inputTokenParam}, targetToken: ${targetToken}`);
  console.log(`[Quote Debug] sourceToken: ${sourceToken}, targetTokenFinal: ${targetTokenFinal}`);
  console.log(`[Quote Debug] sourcePrice: $${sourcePrice}, targetPrice: $${targetPrice}`);

  // Calculate target amount based on USD value equivalence
  const finalTargetEquivalent = amountNum * (sourcePrice / targetPrice);
  
  // Log the exchange rate
  if (sourceToken !== targetTokenFinal) {
    console.log(`[Quote] 1 ${sourceToken} = ${(sourcePrice / targetPrice).toFixed(2)} ${targetTokenFinal}`);
  }
  
  const usdValue = amountNum * sourcePrice;
  const targetEquivalent = finalTargetEquivalent;
  
  const slippageAmount = targetEquivalent * (SLIPPAGE_BPS / 10000);
  const feeAmount = targetEquivalent * (BRIDGE_FEE_PERCENT / 100);
  const receivedAmount = targetEquivalent - slippageAmount - feeAmount;
  
  return {
    inputAmount: amount,
    inputToken: sourceToken,
    inputUsdValue: usdValue.toFixed(2),
    outputAmount: receivedAmount.toFixed(receivedAmount > 100 ? 2 : 9),
    outputToken: targetTokenFinal,
    slippageBps: SLIPPAGE_BPS,
    feePercent: BRIDGE_FEE_PERCENT,
    feeAmount: feeAmount.toFixed(receivedAmount > 100 ? 2 : 9),
    slippageAmount: slippageAmount.toFixed(receivedAmount > 100 ? 2 : 9),
    estimatedTime: "~5 minutes",
    exchangeRate: (sourcePrice / targetPrice).toFixed(6),
    prices: {
      [sourceToken]: sourcePrice,
      [targetTokenFinal]: targetPrice,
      ETH: prices.ETH,
    },
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/quote", async (req, res) => {
    const { amount, chainId, inputToken, outputToken } = req.query;
    
    if (!amount || typeof amount !== "string") {
      return res.status(400).json({ error: "Amount is required" });
    }
    
    const key = chainId ? `${chainId}_${inputToken || 'ETH'}` : '8453_ETH';
    console.log(`[API] Quote Request: amount=${amount}, chainId=${chainId}, input=${inputToken}, output=${outputToken}`);
    const quote = await calculateQuote(amount, key, outputToken as string || 'ETH', inputToken as string);
    console.log(`[API] Final Quote Output:`, JSON.stringify(quote));
    if (!quote) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    res.json(quote);
  });

  app.get("/api/prices", async (req, res) => {
    try {
      const prices = await fetchPrices();
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  app.post("/api/bridge", async (req, res) => {
    try {
      const { depositor, amount, txHash, sourceChainId } = req.body;
      
      if (!depositor || !amount) {
        return res.status(400).json({ error: "Depositor and amount are required" });
      }
      
      const chainId = sourceChainId || 8453;
      const quote = await calculateQuote(amount, chainId);
      if (!quote) {
        return res.status(400).json({ error: "Invalid amount" });
      }
      
      const transaction = await storage.createBridgeTransaction({
        depositor: depositor.toLowerCase(),
        amount,
        quotedMegaAmount: quote.outputAmount,
        slippageBps: SLIPPAGE_BPS,
        status: "pending",
        sourceChainId: chainId,
        destChainId: 4326,
        txHash: txHash || null,
      });
      
      res.json({
        ...transaction,
        estimatedTime: "~5 minutes",
        message: "Bridge initiated! Please wait approximately 5 minutes for completion.",
      });
    } catch (error: any) {
      console.error("Bridge error:", error);
      res.status(500).json({ error: error.message || "Failed to create bridge transaction" });
    }
  });

  app.get("/api/transactions/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const transactions = await storage.getBridgeTransactionsByDepositor(address.toLowerCase());
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getAllPendingTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch transactions" });
    }
  });

  app.post("/api/admin/fulfill/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { megaTxHash } = req.body;
      
      const transaction = await storage.updateBridgeTransactionStatus(
        parseInt(id),
        "completed",
        megaTxHash
      );
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      
      res.json(transaction);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fulfill transaction" });
    }
  });

  app.post("/api/admin/reject/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      const transaction = await storage.updateBridgeTransactionStatus(
        parseInt(id),
        "rejected"
      );
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      
      res.json(transaction);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to reject transaction" });
    }
  });

  return httpServer;
}
