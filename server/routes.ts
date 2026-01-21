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
};

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

  const prices: Record<string, number> = { xDAI: 1, FLUFFEY: 0.000000114 };

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
        }
      }
      // Ensure FLUFFEY is explicitly set even after CG fetch
      prices.FLUFFEY = 0.000000114;
    }
  } catch (e) {
    console.log('Failed to fetch prices from CoinGecko:', e);
  }

  // Fetch FLUFFEY price from DexScreener (MegaETH chain)
  try {
    const fluffeyRes = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/0xd774dd586cd0bb1c242e75b06a02eacc951629fa',
      { headers: { 'Accept': 'application/json' } }
    );
    if (fluffeyRes.ok) {
      const fluffeyData = await fluffeyRes.json();
      const pairs = fluffeyData.pairs || [];
      // Prioritize MegaETH/Mega pairs or Noxa DEX
      const pair = pairs.find((p: any) => 
        p.chainId === 'megaeth' || p.chainId === 'mega' || p.dexId === 'noxa'
      ) || pairs[0];
      
      const price = pair?.priceUsd;
      
      if (price) {
        prices.FLUFFEY = parseFloat(price);
        console.log(`[Prices] Set FLUFFEY price to actual: $${prices.FLUFFEY} from DexScreener (${pair?.chainId}/${pair?.dexId})`);
      } else {
        // Fallback to a hardcoded price if API returns nothing to avoid 1:1
        prices.FLUFFEY = 0.000000114; 
        console.log('[Prices] No priceUsd found, using safety fallback for FLUFFEY');
      }
    } else {
      console.log(`[Prices] DexScreener response not ok: ${fluffeyRes.status}`);
      prices.FLUFFEY = 0.000000114;
    }
  } catch (e) {
    console.log('[Prices] Failed to fetch FLUFFEY price:', e);
    prices.FLUFFEY = 0.000000114;
  }
  
  // FINAL SAFETY CHECK: If FLUFFEY price is still same as ETH or invalid, force it
  if (!prices.FLUFFEY || prices.FLUFFEY > 1) {
     prices.FLUFFEY = 0.000000114;
  }
  
  try {
    const hypeRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(3000) }
    );
    if (hypeRes.ok) {
      const hypeData = await hypeRes.json();
      if (hypeData.hyperliquid?.usd) {
        prices.HYPE = hypeData.hyperliquid.usd;
      }
    }
  } catch (e) {
    console.log('[Prices] Failed to fetch HYPE price separately');
  }
  
  if (!prices.ETH) prices.ETH = 3500;
  if (!prices.SOL) prices.SOL = 180;
  if (!prices.MATIC) prices.MATIC = 0.5;
  if (!prices.BNB) prices.BNB = 600;
  if (!prices.AVAX) prices.AVAX = 35;
  if (!prices.FTM) prices.FTM = 0.5;
  if (!prices.CRO) prices.CRO = 0.1;
  if (!prices.MNT) prices.MNT = 0.8;
  if (!prices.HYPE) prices.HYPE = 25;
  
  priceCache = { prices, timestamp: Date.now() };
  console.log(`[Prices] Updated at ${new Date().toISOString()}:`, prices);
  return prices;
}

async function calculateQuote(amount: string, key: string = '8453_ETH', targetToken: string = 'ETH', inputTokenParam?: string) {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return null;
  }
  
  const prices = await fetchPrices();
  
  // FORCE OVERRIDE: If the input token is ETH, we use the ETH price.
  // If the output token is FLUFFEY, we use the FLUFFEY price.
  const sourceToken = (inputTokenParam || '').toUpperCase() === 'FLUFFEY' ? 'FLUFFEY' : 'ETH';
  const targetTokenFinal = (targetToken || '').toUpperCase() === 'FLUFFEY' ? 'FLUFFEY' : 'ETH';
  
  const sourcePrice = prices[sourceToken] || prices.ETH;
  const targetPrice = prices[targetTokenFinal] || prices.ETH;
  
  console.log(`[Quote Debug] inputTokenParam: ${inputTokenParam}, targetToken: ${targetToken}`);
  console.log(`[Quote Debug] sourceToken: ${sourceToken}, targetTokenFinal: ${targetTokenFinal}`);
  console.log(`[Quote Debug] sourcePrice: ${sourcePrice}, targetPrice: ${targetPrice}`);

  // HARD OVERRIDE FOR FLUFFEY/ETH PAIR TO ENSURE NO 1:1
  let finalTargetEquivalent = amountNum * (sourcePrice / targetPrice);
  
  if (sourceToken === 'ETH' && targetTokenFinal === 'FLUFFEY') {
    const fluffeyPrice = prices.FLUFFEY || 0.000000114;
    finalTargetEquivalent = amountNum * (prices.ETH / fluffeyPrice);
    console.log(`[Quote] Hard Override Applied: 1 ETH = ${prices.ETH / fluffeyPrice} FLUFFEY`);
  } else if (sourceToken === 'FLUFFEY' && targetTokenFinal === 'ETH') {
    const fluffeyPrice = prices.FLUFFEY || 0.000000114;
    finalTargetEquivalent = amountNum * (fluffeyPrice / prices.ETH);
    console.log(`[Quote] Hard Override Applied: 1 FLUFFEY = ${fluffeyPrice / prices.ETH} ETH`);
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
    outputAmount: receivedAmount.toFixed(6),
    outputToken: targetToken,
    slippageBps: SLIPPAGE_BPS,
    feePercent: BRIDGE_FEE_PERCENT,
    feeAmount: feeAmount.toFixed(6),
    slippageAmount: slippageAmount.toFixed(6),
    estimatedTime: "~5 minutes",
    exchangeRate: (sourcePrice / targetPrice).toFixed(6),
    prices: {
      [sourceToken]: sourcePrice,
      [targetToken]: targetPrice,
      ETH: ethPrice,
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
