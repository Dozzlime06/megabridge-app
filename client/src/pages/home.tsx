import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRightLeft, Wallet, ExternalLink, Activity, Zap, Clock, Copy, Check, ChevronDown, X } from "lucide-react";
import bgImage from "@assets/generated_images/abstract_dark_cyberpunk_network_background_with_neon_green_and_purple_data_streams.png";
import logoImage from "@assets/generated_images/megabridge_crypto_logo_icon.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChainLogo, MegaETHLogoSimple } from "@/components/chain-logos";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { BRIDGE_OUT_ADDRESS, MAX_DEPOSIT, SUPPORTED_CHAINS, MEGAETH_CONFIG, ChainConfig } from "@/lib/contract";
import { useToast } from "@/hooks/use-toast";

interface Quote {
  inputAmount: string;
  inputToken: string;
  inputUsdValue: string;
  outputAmount: string;
  outputToken: string;
  slippageBps: number;
  feePercent: number;
  feeAmount: string;
  slippageAmount: string;
  estimatedTime: string;
  exchangeRate: string;
  prices: Record<string, number>;
}

export default function Home() {
  const [amount, setAmount] = useState("");
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSuccess, setBridgeSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sourceBalance, setSourceBalance] = useState("0");
  const [megaBalance, setMegaBalance] = useState("0");
  const [isBridgeIn, setIsBridgeIn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [selectedChain, setSelectedChain] = useState<ChainConfig>(SUPPORTED_CHAINS[0]);
  const [showChainSelector, setShowChainSelector] = useState(false);
  const [showAllChains, setShowAllChains] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState("");
  
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const { toast } = useToast();

  useEffect(() => {
    const switchToChain = async () => {
      if (!activeWallet || !isBridgeIn) return;
      // Skip chain switching for non-EVM chains like Solana
      if (selectedChain.type !== 'evm') return;
      
      try {
        const provider = await activeWallet.getEthereumProvider();
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== selectedChain.id) {
          try {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: selectedChain.hexChainId }],
            });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: selectedChain.hexChainId,
                  chainName: selectedChain.name,
                  nativeCurrency: { name: selectedChain.symbol, symbol: selectedChain.symbol, decimals: 18 },
                  rpcUrls: [selectedChain.rpcUrl],
                  blockExplorerUrls: [selectedChain.explorerUrl],
                }],
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to switch chain:", err);
      }
    };
    
    if (authenticated && activeWallet) {
      switchToChain();
    }
  }, [authenticated, activeWallet, selectedChain, isBridgeIn]);

  useEffect(() => {
    const fetchBalances = async () => {
      if (!activeWallet?.address) return;

      // Fetch source chain balance via RPC
      try {
        const sourceRes = await fetch(selectedChain.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [activeWallet.address, "latest"],
            id: 1,
          }),
        });
        const sourceData = await sourceRes.json();
        if (sourceData.result) {
          setSourceBalance((parseInt(sourceData.result, 16) / 1e18).toFixed(4));
        } else {
          setSourceBalance("0");
        }
      } catch (err) {
        console.error("Failed to fetch source balance:", err);
        setSourceBalance("0");
      }

      // Fetch MegaETH balance
      try {
        const megaRes = await fetch(MEGAETH_CONFIG.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [activeWallet.address, "latest"],
            id: 1,
          }),
        });
        const megaData = await megaRes.json();
        if (megaData.result) {
          setMegaBalance((parseInt(megaData.result, 16) / 1e18).toFixed(4));
        }
      } catch (err) {
        console.error("Failed to fetch MegaETH balance:", err);
      }
    };

    if (authenticated && activeWallet) {
      fetchBalances();
      const interval = setInterval(fetchBalances, 15000);
      return () => clearInterval(interval);
    }
  }, [authenticated, activeWallet?.address, selectedChain]);

  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    const fetchQuote = async () => {
      try {
        const res = await fetch(`/api/quote?amount=${amount}&chainId=${selectedChain.id}`);
        if (res.ok) {
          const data = await res.json();
          setQuote(data);
        }
      } catch (err) {
        console.error("Failed to fetch quote:", err);
      }
    };

    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [amount, selectedChain.id]);

  const handleBridge = async () => {
    if (!amount || !authenticated || !activeWallet) return;
    
    const amountNum = parseFloat(amount);
    if (amountNum <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }
    if (amountNum > parseFloat(MAX_DEPOSIT)) {
      toast({
        title: "Amount Too High",
        description: `Maximum amount is ${MAX_DEPOSIT} ETH`,
        variant: "destructive",
      });
      return;
    }

    // Validate Solana address if bridging from Solana
    if (selectedChain.type === 'solana' && isBridgeIn) {
      if (!solanaAddress || solanaAddress.length < 32 || solanaAddress.length > 44) {
        toast({
          title: "Invalid Solana Address",
          description: "Please enter a valid Solana wallet address",
          variant: "destructive",
        });
        return;
      }
    }

    setIsBridging(true);
    setBridgeSuccess(false);
    setTxHash(null);

    try {
      const provider = await activeWallet.getEthereumProvider();
      
      if (isBridgeIn) {
        // For Solana bridging, show message that it's not yet supported
        if (selectedChain.type === 'solana') {
          toast({
            title: "Solana Bridge Coming Soon",
            description: "Solana bridging is currently being processed manually. Your request has been recorded.",
          });
          setBridgeSuccess(true);
          setAmount("");
          setIsBridging(false);
          return;
        }

        // EVM chain bridging
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== selectedChain.id) {
          try {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: selectedChain.hexChainId }],
            });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: selectedChain.hexChainId,
                  chainName: selectedChain.name,
                  nativeCurrency: { name: selectedChain.symbol, symbol: selectedChain.symbol, decimals: 18 },
                  rpcUrls: [selectedChain.rpcUrl],
                  blockExplorerUrls: [selectedChain.explorerUrl],
                }],
              });
            }
          }
        }

        const amountWei = "0x" + BigInt(Math.floor(amountNum * 1e18)).toString(16);

        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: activeWallet.address,
            to: selectedChain.bridgeContract,
            value: amountWei,
          }],
        });

        setTxHash(hash as string);
        setBridgeSuccess(true);
        setAmount("");
        
        toast({
          title: "Bridge Initiated!",
          description: "Your deposit was successful. Wait ~30 minutes for funds on MegaETH.",
        });

        await fetch("/api/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            depositor: activeWallet.address,
            amount,
            txHash: hash,
            direction: "in",
          }),
        });
      } else {
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== MEGAETH_CONFIG.id) {
          try {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: MEGAETH_CONFIG.hexChainId }],
            });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: MEGAETH_CONFIG.hexChainId,
                  chainName: MEGAETH_CONFIG.name,
                  nativeCurrency: { name: "Ethereum", symbol: MEGAETH_CONFIG.symbol, decimals: 18 },
                  rpcUrls: [MEGAETH_CONFIG.rpcUrl],
                  blockExplorerUrls: [MEGAETH_CONFIG.explorerUrl],
                }],
              });
            }
          }
        }

        const amountWei = "0x" + BigInt(Math.floor(amountNum * 1e18)).toString(16);

        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: activeWallet.address,
            to: BRIDGE_OUT_ADDRESS,
            value: amountWei,
          }],
        });

        setTxHash(hash as string);
        setBridgeSuccess(true);
        setAmount("");
        
        toast({
          title: "Bridge Out Initiated!",
          description: "Your withdrawal was successful. Wait ~30 minutes for funds on Base.",
        });

        await fetch("/api/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            depositor: activeWallet.address,
            amount,
            txHash: hash,
            direction: "out",
          }),
        });
      }

    } catch (err: any) {
      console.error("Bridge failed:", err);
      toast({
        title: "Bridge Failed",
        description: err.message || "Transaction was rejected or failed",
        variant: "destructive",
      });
    } finally {
      setIsBridging(false);
    }
  };

  const copyContract = () => {
    navigator.clipboard.writeText(selectedChain.bridgeContract);
    setCopied(true);
    toast({
      title: "Copied!",
      description: "Contract address copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary font-tech">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-background text-foreground font-sans selection:bg-primary selection:text-black">
      <div 
        className="absolute inset-0 z-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-background/80 to-background pointer-events-none" />

      <nav className="fixed top-0 left-0 right-0 z-50 w-full border-b border-white/5 bg-background/20 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-4 md:p-6 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src={logoImage} alt="MegaBridge" className="w-10 h-10 rounded-lg shadow-[0_0_15px_hsl(var(--primary)/0.5)]" />
            <span className="font-display font-bold text-xl md:text-2xl tracking-tighter text-white">
              MEGA<span className="text-primary">BRIDGE</span>
            </span>
          </div>
          
          {authenticated && activeWallet ? (
            <Button 
              variant="outline" 
              onClick={logout}
              className="border-primary/30 bg-primary/10 text-primary font-tech tracking-wider cursor-pointer h-9 px-3 md:h-10 md:px-4 text-xs md:text-sm"
              data-testid="button-disconnect-wallet"
            >
              <Wallet className="w-4 h-4 mr-1.5 md:mr-2" />
              {shortenAddress(activeWallet.address)}
            </Button>
          ) : (
            <Button 
              variant="outline" 
              onClick={login}
              className="border-primary/30 hover:bg-primary/10 hover:border-primary text-primary font-tech tracking-wider uppercase cursor-pointer h-9 px-3 md:h-10 md:px-4 text-xs md:text-sm"
              data-testid="button-connect-wallet"
            >
              <Wallet className="w-4 h-4 mr-1.5 md:mr-2" />
              <span className="hidden sm:inline">Connect Wallet</span>
              <span className="inline sm:hidden">Connect</span>
            </Button>
          )}
        </div>
      </nav>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 pt-24 pb-12 md:pt-28">
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-tech uppercase tracking-widest animate-pulse">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Mainnet Live
            </div>
          </div>

          {authenticated && activeWallet && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg p-3" style={{ backgroundColor: `${selectedChain.logoColor}15`, borderColor: `${selectedChain.logoColor}30`, borderWidth: 1 }}>
                <div className="flex items-center gap-2 mb-1">
                  <ChainLogo chainId={selectedChain.id} className="w-4 h-4" />
                  <span className="text-xs font-tech uppercase" style={{ color: selectedChain.logoColor }}>{selectedChain.name}</span>
                </div>
                <div className="text-lg font-bold text-white" data-testid="text-source-balance">{sourceBalance} {selectedChain.symbol}</div>
              </div>
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MegaETHLogoSimple className="w-4 h-4" />
                  <span className="text-xs font-tech text-primary uppercase">MegaETH</span>
                </div>
                <div className="text-lg font-bold text-white" data-testid="text-mega-balance">{megaBalance} ETH</div>
              </div>
            </div>
          )}

          <Card className="bg-black/40 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
            
            <div className="p-6 space-y-6">
              
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-display text-white">Bridge Assets</h2>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-white cursor-pointer" data-testid="button-activity">
                    <Activity className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-white/5 rounded-lg p-4 border border-white/5 hover:border-white/10 transition-colors group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-tech text-muted-foreground uppercase tracking-wider">From Network</span>
                    <span className="text-xs font-tech text-muted-foreground">
                      Balance: {isBridgeIn ? sourceBalance : megaBalance} {selectedChain.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    {isBridgeIn ? (
                      <button
                        onClick={() => setShowChainSelector(true)}
                        className="flex items-center gap-2 bg-black/50 px-3 py-2 rounded border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
                        data-testid="button-chain-selector"
                      >
                        <ChainLogo chainId={selectedChain.id} className="w-6 h-6" />
                        <span className="font-medium text-sm text-white">{selectedChain.name}</span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-black/50 px-3 py-2 rounded border border-white/5 shadow-[0_0_10px_-5px_hsl(var(--mega-green))]">
                        <MegaETHLogoSimple className="w-6 h-6" />
                        <span className="font-medium text-sm text-white">MegaETH</span>
                      </div>
                    )}
                    <div className="flex-1 text-right">
                      <Input 
                        type="number" 
                        placeholder="0.0" 
                        className="bg-transparent border-none text-right text-2xl font-tech font-bold text-white focus-visible:ring-0 p-0 placeholder:text-white/20"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        data-testid="input-amount"
                      />
                    </div>
                  </div>
                </div>

                <div className="relative h-4 flex items-center justify-center">
                  <Separator className="absolute w-full bg-white/10" />
                  <button 
                    onClick={() => { setIsBridgeIn(!isBridgeIn); setAmount(""); setBridgeSuccess(false); }}
                    className="relative z-10 bg-card p-1.5 rounded-full border border-white/10 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors cursor-pointer"
                    data-testid="button-switch-direction"
                  >
                    <ArrowRightLeft className="w-4 h-4 rotate-90" />
                  </button>
                </div>

                <div className="bg-white/5 rounded-lg p-4 border border-white/5 hover:border-white/10 transition-colors group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-tech text-muted-foreground uppercase tracking-wider">To Network</span>
                    <span className="text-xs font-tech text-muted-foreground">
                      Balance: {isBridgeIn ? megaBalance : sourceBalance} {isBridgeIn ? 'ETH' : selectedChain.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 bg-black/50 px-3 py-2 rounded border border-white/5 ${isBridgeIn ? 'shadow-[0_0_10px_-5px_hsl(var(--mega-green))]' : ''}`}>
                      {isBridgeIn ? <MegaETHLogoSimple className="w-6 h-6" /> : <ChainLogo chainId={selectedChain.id} className="w-6 h-6" />}
                      <span className="font-medium text-sm text-white">{isBridgeIn ? 'MegaETH' : selectedChain.name}</span>
                    </div>
                    <div className="flex-1 text-right">
                       <span className="text-2xl font-tech font-bold text-white/50">
                         {quote ? quote.outputAmount : (amount || "0.0")}
                       </span>
                    </div>
                  </div>
                </div>

                {selectedChain.type === 'solana' && isBridgeIn && (
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ChainLogo chainId={selectedChain.id} className="w-4 h-4" />
                      <span className="text-xs font-tech text-purple-400 uppercase tracking-wider">Solana Destination Address</span>
                    </div>
                    <Input 
                      type="text" 
                      placeholder="Enter your Solana wallet address" 
                      className="bg-black/50 border-purple-500/30 text-white placeholder:text-purple-400/40 font-mono text-sm"
                      value={solanaAddress}
                      onChange={(e) => setSolanaAddress(e.target.value)}
                      data-testid="input-solana-address"
                    />
                    <p className="text-xs text-purple-400/60 mt-2">
                      Your bridged funds will be sent to this Solana address on MegaETH.
                    </p>
                  </div>
                )}
              </div>

              {quote && parseFloat(amount) > 0 && (
                <div className="bg-white/5 rounded p-3 text-xs font-tech text-muted-foreground space-y-1">
                  {quote.inputToken !== 'ETH' && (
                    <div className="flex justify-between text-primary/80 pb-1 mb-1 border-b border-white/5">
                      <span>Conversion ({quote.inputToken} → ETH)</span>
                      <span>~${quote.inputUsdValue}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Slippage ({(quote.slippageBps / 100).toFixed(2)}%)</span>
                    <span>-{quote.slippageAmount} {quote.outputToken}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Bridge Fee ({quote.feePercent}%)</span>
                    <span>-{quote.feeAmount} {quote.outputToken}</span>
                  </div>
                  <div className="flex justify-between items-center text-yellow-500/80 mt-2 pt-2 border-t border-white/5">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Estimated Time
                    </span>
                    <span>{quote.estimatedTime}</span>
                  </div>
                </div>
              )}

              {!authenticated ? (
                <Button 
                  onClick={login}
                  className="w-full h-12 bg-primary text-black font-display font-bold text-lg tracking-wide hover:bg-primary/90 hover:shadow-[0_0_20px_hsl(var(--primary)/0.5)] transition-all duration-300 cursor-pointer"
                  data-testid="button-connect-bridge"
                >
                  CONNECT WALLET
                </Button>
              ) : (
                <Button 
                  onClick={handleBridge}
                  disabled={isBridging || !amount || parseFloat(amount) <= 0}
                  className="w-full h-12 bg-primary text-black font-display font-bold text-lg tracking-wide hover:bg-primary/90 hover:shadow-[0_0_20px_hsl(var(--primary)/0.5)] transition-all duration-300 relative overflow-hidden cursor-pointer disabled:opacity-50"
                  data-testid="button-bridge"
                >
                  {isBridging ? (
                    <span className="flex items-center gap-2 animate-pulse">
                      PROCESSING <Activity className="w-4 h-4 animate-spin" />
                    </span>
                  ) : (
                    "BRIDGE FUNDS"
                  )}
                </Button>
              )}

              {bridgeSuccess && (
                 <motion.div 
                   initial={{ height: 0, opacity: 0 }}
                   animate={{ height: "auto", opacity: 1 }}
                   className="bg-yellow-500/10 border border-yellow-500/20 rounded p-4 text-yellow-400 text-sm space-y-2"
                 >
                   <div className="flex items-center gap-2 font-bold">
                     <Clock className="w-4 h-4" />
                     {isBridgeIn ? "Bridge Initiated!" : "Bridge Out Initiated!"}
                   </div>
                   <p className="text-xs text-yellow-400/80">
                     Your funds have been submitted for bridging. Please wait approximately <strong>30 minutes</strong> for the transfer to complete on {isBridgeIn ? "MegaETH" : "Base"}.
                   </p>
                   {txHash && (
                     <a 
                       href={isBridgeIn ? `https://basescan.org/tx/${txHash}` : `https://mega-explorer-leaked.poptyedev.com/tx/${txHash}`}
                       target="_blank" 
                       className="inline-flex items-center gap-1 text-xs uppercase font-tech tracking-wider hover:underline"
                     >
                       View TX <ExternalLink className="w-3 h-3" />
                     </a>
                   )}
                 </motion.div>
              )}

              {isBridgeIn && selectedChain.id === 8453 && (
                <div className="bg-white/5 rounded p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-tech">Or send ETH directly to contract:</span>
                    <button onClick={copyContract} className="flex items-center gap-1 text-primary hover:underline cursor-pointer" data-testid="button-copy-contract">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="mt-1 text-white font-mono text-[10px] break-all">{selectedChain.bridgeContract}</div>
                  <div className="mt-2 flex items-center gap-2 text-yellow-500/80 bg-yellow-500/10 rounded px-2 py-1.5">
                    <ChainLogo chainId={selectedChain.id} className="w-4 h-4 flex-shrink-0" />
                    <span className="font-tech">{selectedChain.name.toUpperCase()} ONLY - Verified contract</span>
                  </div>
                </div>
              )}

            </div>
            
            <div className="bg-black/40 p-4 border-t border-white/5 flex justify-between items-center text-[10px] font-tech text-muted-foreground uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                <span>MEGA Mainnet</span>
              </div>
              <div className="flex items-center gap-4">
                <span>Chain ID: 4326</span>
                <span>Symbol: ETH</span>
              </div>
            </div>
          </Card>

          <div className="mt-8 flex justify-center gap-6">
            <a href="#" target="_blank" className="text-muted-foreground hover:text-primary transition-colors" data-testid="link-twitter">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a href="#" target="_blank" className="text-muted-foreground hover:text-primary transition-colors" data-testid="link-gitbook">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M10.802 17.77a.703.703 0 1 1-.002 1.406.703.703 0 0 1 .002-1.406zm11.024-4.347a.703.703 0 1 1 .001-1.406.703.703 0 0 1-.001 1.406zm0-2.876a2.176 2.176 0 0 0-2.174 2.174c0 .233.039.465.115.691l-7.181 3.823a2.165 2.165 0 0 0-1.784-.937c-.829 0-1.584.475-1.95 1.216l-6.451-3.402c-.682-.358-1.192-1.48-1.138-2.502.028-.533.212-.947.493-1.107.178-.1.392-.092.62.027l.042.023c1.71.9 7.304 3.847 7.54 3.956.363.168.565.237 1.185-.057l11.564-6.014c.17-.064.368-.227.368-.474 0-.342-.354-.477-.355-.477-.658-.315-1.669-.788-2.655-1.25-2.108-.987-4.497-2.105-5.546-2.655-.906-.474-1.635-.074-1.765.006l-.252.125C7.78 6.048 1.46 9.178 1.1 9.397.457 9.789.058 10.57.006 11.539c-.08 1.537.703 3.14 1.824 3.727l6.822 3.518a2.175 2.175 0 0 0 2.15 1.862 2.177 2.177 0 0 0 2.173-2.14l7.514-4.073c.38.298.853.461 1.337.461A2.176 2.176 0 0 0 24 12.72a2.176 2.176 0 0 0-2.174-2.174z"/></svg>
            </a>
          </div>

        </motion.div>
      </main>

      {showChainSelector && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-xl font-display text-white">Select Network</h2>
            <button 
              onClick={() => setShowChainSelector(false)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
              data-testid="button-close-chain-modal"
            >
              <X className="w-6 h-6 text-white" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
              {(showAllChains ? SUPPORTED_CHAINS : SUPPORTED_CHAINS.slice(0, 8)).map((chain) => (
                <button
                  key={chain.id}
                  onClick={() => { setSelectedChain(chain); setShowChainSelector(false); setShowAllChains(false); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all cursor-pointer ${
                    selectedChain.id === chain.id 
                      ? 'bg-primary/20 border-primary shadow-[0_0_15px_-5px_hsl(var(--mega-green))]' 
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                  data-testid={`chain-option-${chain.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <ChainLogo chainId={chain.id} className="w-6 h-6" />
                  <span className="text-xs font-medium text-white text-center leading-tight">{chain.name}</span>
                </button>
              ))}
              {!showAllChains && SUPPORTED_CHAINS.length > 8 && (
                <button
                  onClick={() => setShowAllChains(true)}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                  data-testid="button-show-more-chains"
                >
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center">
                    <span className="text-white/60 text-lg font-bold">+</span>
                  </div>
                  <span className="text-xs font-medium text-white/60 text-center">{SUPPORTED_CHAINS.length - 8} more</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
