import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown, Wallet, ExternalLink, Activity, Clock, Copy, Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      if (selectedChain.type !== 'evm') return;
      try {
        const provider = await activeWallet.getEthereumProvider();
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== selectedChain.id) {
          try {
            await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: selectedChain.hexChainId }] });
          } catch (switchError: any) {
            if (switchError.code === 4902) {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [{ chainId: selectedChain.hexChainId, chainName: selectedChain.name, nativeCurrency: { name: selectedChain.symbol, symbol: selectedChain.symbol, decimals: 18 }, rpcUrls: [selectedChain.rpcUrl], blockExplorerUrls: [selectedChain.explorerUrl] }],
              });
            }
          }
        }
      } catch (err) { console.error("Failed to switch chain:", err); }
    };
    if (authenticated && activeWallet) switchToChain();
  }, [authenticated, activeWallet, selectedChain, isBridgeIn]);

  useEffect(() => {
    const fetchBalances = async () => {
      if (!activeWallet?.address) return;
      try {
        const sourceRes = await fetch(selectedChain.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [activeWallet.address, "latest"], id: 1 }) });
        const sourceData = await sourceRes.json();
        setSourceBalance(sourceData.result ? (parseInt(sourceData.result, 16) / 1e18).toFixed(4) : "0");
      } catch { setSourceBalance("0"); }
      try {
        const megaRes = await fetch(MEGAETH_CONFIG.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [activeWallet.address, "latest"], id: 1 }) });
        const megaData = await megaRes.json();
        if (megaData.result) setMegaBalance((parseInt(megaData.result, 16) / 1e18).toFixed(4));
      } catch {}
    };
    if (authenticated && activeWallet) { fetchBalances(); const interval = setInterval(fetchBalances, 15000); return () => clearInterval(interval); }
  }, [authenticated, activeWallet?.address, selectedChain]);

  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) { setQuote(null); return; }
    const fetchQuote = async () => {
      try {
        const res = await fetch(`/api/quote?amount=${amount}&chainId=${selectedChain.id}`);
        if (res.ok) setQuote(await res.json());
      } catch {}
    };
    const debounce = setTimeout(fetchQuote, 300);
    return () => clearTimeout(debounce);
  }, [amount, selectedChain.id]);

  const handleBridge = async () => {
    if (!amount || !authenticated || !activeWallet) return;
    const amountNum = parseFloat(amount);
    if (amountNum <= 0) { toast({ title: "Invalid Amount", variant: "destructive" }); return; }
    if (amountNum > parseFloat(MAX_DEPOSIT)) { toast({ title: "Amount Too High", description: `Max: ${MAX_DEPOSIT} ETH`, variant: "destructive" }); return; }
    if (selectedChain.type === 'solana' && isBridgeIn && (!solanaAddress || solanaAddress.length < 32)) { toast({ title: "Invalid Solana Address", variant: "destructive" }); return; }

    setIsBridging(true); setBridgeSuccess(false); setTxHash(null);
    try {
      const provider = await activeWallet.getEthereumProvider();
      if (isBridgeIn) {
        if (selectedChain.type === 'solana') { toast({ title: "Solana Coming Soon" }); setBridgeSuccess(true); setAmount(""); setIsBridging(false); return; }
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== selectedChain.id) {
          try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: selectedChain.hexChainId }] }); }
          catch (e: any) { if (e.code === 4902) await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: selectedChain.hexChainId, chainName: selectedChain.name, nativeCurrency: { name: selectedChain.symbol, symbol: selectedChain.symbol, decimals: 18 }, rpcUrls: [selectedChain.rpcUrl], blockExplorerUrls: [selectedChain.explorerUrl] }] }); }
        }
        const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: activeWallet.address, to: selectedChain.bridgeContract, value: "0x" + BigInt(Math.floor(amountNum * 1e18)).toString(16) }] });
        setTxHash(hash as string); setBridgeSuccess(true); setAmount(""); toast({ title: "Bridge Initiated!" });
        await fetch("/api/bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositor: activeWallet.address, amount, txHash: hash, direction: "in" }) });
      } else {
        const chainId = await provider.request({ method: "eth_chainId" });
        if (parseInt(chainId as string, 16) !== MEGAETH_CONFIG.id) {
          try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MEGAETH_CONFIG.hexChainId }] }); }
          catch (e: any) { if (e.code === 4902) await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: MEGAETH_CONFIG.hexChainId, chainName: MEGAETH_CONFIG.name, nativeCurrency: { name: "Ethereum", symbol: MEGAETH_CONFIG.symbol, decimals: 18 }, rpcUrls: [MEGAETH_CONFIG.rpcUrl], blockExplorerUrls: [MEGAETH_CONFIG.explorerUrl] }] }); }
        }
        const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: activeWallet.address, to: BRIDGE_OUT_ADDRESS, value: "0x" + BigInt(Math.floor(amountNum * 1e18)).toString(16) }] });
        setTxHash(hash as string); setBridgeSuccess(true); setAmount(""); toast({ title: "Bridge Out Initiated!" });
        await fetch("/api/bridge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depositor: activeWallet.address, amount, txHash: hash, direction: "out" }) });
      }
    } catch (err: any) { toast({ title: "Bridge Failed", description: err.message, variant: "destructive" }); }
    finally { setIsBridging(false); }
  };

  const copyContract = () => { navigator.clipboard.writeText(selectedChain.bridgeContract); setCopied(true); toast({ title: "Copied!" }); setTimeout(() => setCopied(false), 2000); };
  const shortenAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-neutral-950"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/90 backdrop-blur border-b border-neutral-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center font-bold text-black">M</div>
            <span className="font-bold text-xl">MegaBridge</span>
          </div>
          {authenticated && activeWallet ? (
            <Button onClick={logout} variant="outline" className="border-neutral-700 bg-neutral-900 hover:bg-neutral-800 cursor-pointer" data-testid="button-disconnect-wallet">
              <Wallet className="w-4 h-4 mr-2" />{shortenAddress(activeWallet.address)}
            </Button>
          ) : (
            <Button onClick={login} className="bg-green-500 hover:bg-green-600 text-black font-semibold cursor-pointer" data-testid="button-connect-wallet">
              <Wallet className="w-4 h-4 mr-2" />Connect
            </Button>
          )}
        </div>
      </nav>

      <main className="min-h-screen flex items-center justify-center px-4 pt-20 pb-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Bridge to MegaETH</h1>
            <p className="text-neutral-400">Transfer assets across 20+ chains</p>
          </div>

          {authenticated && activeWallet && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                <div className="flex items-center gap-2 mb-1 text-sm text-neutral-400">
                  <ChainLogo chainId={selectedChain.id} className="w-4 h-4" />{selectedChain.name}
                </div>
                <div className="text-xl font-bold" data-testid="text-source-balance">{sourceBalance} {selectedChain.symbol}</div>
              </div>
              <div className="bg-neutral-900 rounded-xl p-4 border border-green-500/30">
                <div className="flex items-center gap-2 mb-1 text-sm text-green-400">
                  <MegaETHLogoSimple className="w-4 h-4" />MegaETH
                </div>
                <div className="text-xl font-bold" data-testid="text-mega-balance">{megaBalance} ETH</div>
              </div>
            </div>
          )}

          <div className="bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden">
            <div className="p-5 space-y-4">
              <div className="bg-neutral-950 rounded-xl p-4">
                <div className="flex justify-between text-sm text-neutral-500 mb-2">
                  <span>From</span>
                  <span>Balance: {isBridgeIn ? sourceBalance : megaBalance}</span>
                </div>
                <div className="flex items-center gap-3">
                  {isBridgeIn ? (
                    <button onClick={() => setShowChainSelector(true)} className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg cursor-pointer" data-testid="button-chain-selector">
                      <ChainLogo chainId={selectedChain.id} className="w-6 h-6" />
                      <span className="font-medium">{selectedChain.name}</span>
                      <ChevronDown className="w-4 h-4 text-neutral-400" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-neutral-800 px-3 py-2 rounded-lg">
                      <MegaETHLogoSimple className="w-6 h-6" /><span className="font-medium">MegaETH</span>
                    </div>
                  )}
                  <Input type="number" placeholder="0.00" className="flex-1 bg-transparent border-none text-right text-2xl font-bold focus-visible:ring-0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-amount" />
                </div>
              </div>

              <div className="flex justify-center -my-1">
                <button onClick={() => { setIsBridgeIn(!isBridgeIn); setAmount(""); setBridgeSuccess(false); }} className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center cursor-pointer" data-testid="button-switch-direction">
                  <ArrowDown className="w-5 h-5 text-black" />
                </button>
              </div>

              <div className="bg-neutral-950 rounded-xl p-4">
                <div className="flex justify-between text-sm text-neutral-500 mb-2">
                  <span>To</span>
                  <span>Balance: {isBridgeIn ? megaBalance : sourceBalance}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isBridgeIn ? 'bg-green-500/10 border border-green-500/30' : 'bg-neutral-800'}`}>
                    {isBridgeIn ? <MegaETHLogoSimple className="w-6 h-6" /> : <ChainLogo chainId={selectedChain.id} className="w-6 h-6" />}
                    <span className="font-medium">{isBridgeIn ? 'MegaETH' : selectedChain.name}</span>
                  </div>
                  <div className="flex-1 text-right text-2xl font-bold text-neutral-400">{quote ? quote.outputAmount : (amount || "0.00")}</div>
                </div>
              </div>

              {quote && parseFloat(amount) > 0 && (
                <div className="bg-neutral-950 rounded-xl p-4 text-sm space-y-2">
                  <div className="flex justify-between text-neutral-400"><span>Slippage</span><span>-{quote.slippageAmount} ETH</span></div>
                  <div className="flex justify-between text-neutral-400"><span>Fee ({quote.feePercent}%)</span><span>-{quote.feeAmount} ETH</span></div>
                  <div className="flex justify-between text-yellow-500 pt-2 border-t border-neutral-800"><span className="flex items-center gap-1"><Clock className="w-4 h-4" />Time</span><span>{quote.estimatedTime}</span></div>
                </div>
              )}

              {!authenticated ? (
                <Button onClick={login} className="w-full h-12 bg-green-500 hover:bg-green-400 text-black font-bold text-lg cursor-pointer" data-testid="button-connect-bridge">Connect Wallet</Button>
              ) : (
                <Button onClick={handleBridge} disabled={isBridging || !amount || parseFloat(amount) <= 0} className="w-full h-12 bg-green-500 hover:bg-green-400 text-black font-bold text-lg cursor-pointer disabled:opacity-50" data-testid="button-bridge">
                  {isBridging ? <><Activity className="w-5 h-5 animate-spin mr-2" />Processing...</> : "Bridge"}
                </Button>
              )}

              {bridgeSuccess && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-green-400 font-semibold mb-1"><Check className="w-5 h-5" />Success!</div>
                  <p className="text-sm text-neutral-400">Wait ~30 minutes for transfer.</p>
                  {txHash && <a href={isBridgeIn ? `https://basescan.org/tx/${txHash}` : `https://mega-explorer-leaked.poptyedev.com/tx/${txHash}`} target="_blank" className="text-green-400 text-sm hover:underline flex items-center gap-1 mt-2">View TX <ExternalLink className="w-3 h-3" /></a>}
                </div>
              )}

              {isBridgeIn && selectedChain.id === 8453 && (
                <div className="bg-neutral-950 rounded-xl p-4 text-sm">
                  <div className="flex justify-between mb-2"><span className="text-neutral-400">Direct deposit:</span><button onClick={copyContract} className="text-green-400 hover:underline cursor-pointer flex items-center gap-1" data-testid="button-copy-contract">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? "Copied" : "Copy"}</button></div>
                  <code className="text-xs text-neutral-500 break-all">{selectedChain.bridgeContract}</code>
                </div>
              )}
            </div>

            <div className="bg-neutral-950 px-5 py-3 border-t border-neutral-800 flex justify-between text-xs text-neutral-500">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500" />MegaETH Mainnet</div>
              <span>Chain: 4326</span>
            </div>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {showChainSelector && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-neutral-950/95 backdrop-blur flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <h2 className="text-xl font-bold">Select Network</h2>
              <button onClick={() => setShowChainSelector(false)} className="p-2 hover:bg-neutral-800 rounded-full cursor-pointer" data-testid="button-close-chain-modal"><X className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto">
                {(showAllChains ? SUPPORTED_CHAINS : SUPPORTED_CHAINS.slice(0, 9)).map((chain) => (
                  <button key={chain.id} onClick={() => { setSelectedChain(chain); setShowChainSelector(false); setShowAllChains(false); }} className={`flex flex-col items-center gap-2 p-4 rounded-xl border cursor-pointer ${selectedChain.id === chain.id ? 'bg-green-500/10 border-green-500' : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'}`} data-testid={`chain-option-${chain.name.toLowerCase().replace(/\s+/g, '-')}`}>
                    <ChainLogo chainId={chain.id} className="w-8 h-8" />
                    <span className="text-sm font-medium">{chain.name}</span>
                  </button>
                ))}
                {!showAllChains && SUPPORTED_CHAINS.length > 9 && (
                  <button onClick={() => setShowAllChains(true)} className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-neutral-700 hover:border-neutral-600 cursor-pointer" data-testid="button-show-more-chains">
                    <span className="text-neutral-400">+{SUPPORTED_CHAINS.length - 9}</span>
                    <span className="text-sm text-neutral-500">more</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
