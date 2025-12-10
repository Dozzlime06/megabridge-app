import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";
import App from "./App";
import "./index.css";

const megaethChain = {
  id: 4326,
  name: "MEGA Mainnet",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-secret-mega.poptyedev.com/"] },
  },
  blockExplorers: {
    default: { name: "MEGA Explorer", url: "https://mega-explorer-leaked.poptyedev.com/" },
  },
};

createRoot(document.getElementById("root")!).render(
  <PrivyProvider
    appId="cmigfq0mr004ljf0c1j36gpk3"
    config={{
      appearance: {
        theme: "dark",
        accentColor: "#00FF6A",
        walletList: [
          "detected_ethereum_wallets",
          "metamask",
          "okx_wallet",
          "coinbase_wallet",
          "rainbow",
          "phantom",
          "zerion",
          "bybit_wallet",
          "bitget_wallet",
          "wallet_connect",
        ],
      },
      loginMethods: ["wallet"],
      embeddedWallets: {
        createOnLogin: "off",
      },
      externalWallets: {
        coinbaseWallet: {
          connectionOptions: "all",
        },
      },
      defaultChain: base,
      supportedChains: [base, megaethChain],
    }}
  >
    <App />
  </PrivyProvider>
);
