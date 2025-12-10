import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBridgeTransactionSchema } from "@shared/schema";
import { z } from "zod";

const SLIPPAGE_BPS = 50;
const BRIDGE_FEE_PERCENT = 0.1;

function calculateQuote(amount: string) {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    return null;
  }
  
  const slippageAmount = amountNum * (SLIPPAGE_BPS / 10000);
  const feeAmount = amountNum * (BRIDGE_FEE_PERCENT / 100);
  const receivedAmount = amountNum - slippageAmount - feeAmount;
  
  return {
    inputAmount: amount,
    outputAmount: receivedAmount.toFixed(6),
    slippageBps: SLIPPAGE_BPS,
    feePercent: BRIDGE_FEE_PERCENT,
    feeAmount: feeAmount.toFixed(6),
    slippageAmount: slippageAmount.toFixed(6),
    estimatedTime: "~30 minutes",
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/quote", (req, res) => {
    const { amount } = req.query;
    
    if (!amount || typeof amount !== "string") {
      return res.status(400).json({ error: "Amount is required" });
    }
    
    const quote = calculateQuote(amount);
    if (!quote) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    res.json(quote);
  });

  app.post("/api/bridge", async (req, res) => {
    try {
      const { depositor, amount, txHash } = req.body;
      
      if (!depositor || !amount) {
        return res.status(400).json({ error: "Depositor and amount are required" });
      }
      
      const quote = calculateQuote(amount);
      if (!quote) {
        return res.status(400).json({ error: "Invalid amount" });
      }
      
      const transaction = await storage.createBridgeTransaction({
        depositor: depositor.toLowerCase(),
        amount,
        quotedMegaAmount: quote.outputAmount,
        slippageBps: SLIPPAGE_BPS,
        status: "pending",
        sourceChainId: 8453,
        destChainId: 4326,
        txHash: txHash || null,
      });
      
      res.json({
        ...transaction,
        estimatedTime: "~30 minutes",
        message: "Bridge initiated! Please wait approximately 30 minutes for completion.",
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
