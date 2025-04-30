import { z } from "zod";
import { initializeMcpApiHandler } from "../lib/mcp-api-handler";
import { createPublicClient, formatUnits, http, createWalletClient, Chain } from "viem";
import * as dotenv from "dotenv";
dotenv.config();
import fetch from "node-fetch";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { JsonRpcProvider, Wallet, parseEther, Contract } from "ethers";
import { privateKeyToAccount } from "viem/accounts";


// Monorail API Base URLs
const MONORAIL_DATA_API = "https://testnet-api.monorail.xyz/v1";
const MONORAIL_PATHFINDER_API = "https://testnet-pathfinder-v2.monorail.xyz/v1";
const MONORAIL_ROUTER = "0xC995498c22a012353FAE7eCC701810D673E25794" as const;

// Monorail Data API Types
interface TokenDetails {
  address: string;
  categories: string[];
  decimals: number;
  name: string;
  symbol: string;
}

interface TokenBalance {
  address: string;
  balance: string;
  categories: string[];
  decimals: number;
  id: string;
  name: string;
  symbol: string;
}

interface TokenResult {
  address: string;
  balance: string;
  categories: string[];
  decimals: string;
  id: string;
  name: string;
  symbol: string;
}

// Monorail Pathfinder API Types
interface MonorailSplit {
  fee: string;
  input: string;
  input_formatted: string;
  min_output: string;
  min_output_formatted: string;
  output: string;
  output_formatted: string;
  percentage: string;
  price_impact: string;
  protocol: string;
}

interface MonorailRoute {
  from: `0x${string}`;
  from_symbol: string;
  input: string;
  input_formatted: string;
  output: string;
  output_formatted: string;
  splits: MonorailSplit[];
  to: `0x${string}`;
  to_symbol: string;
  vs: string;
  weighted_price_impact: string;
}

interface MonorailQuoteResponse {
  block: number;
  compound_impact: string;
  from: `0x${string}`;
  hops: number;
  input: string;
  input_formatted: string;
  min_output: string;
  min_output_formatted: string;
  output: string;
  output_formatted: string;
  routes: MonorailRoute[][];
  to: `0x${string}`;
  transaction: {
    data: `0x${string}`;
    to: `0x${string}`;
    value?: `0x${string}`;
  };
}

// Contract ABIs
const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Helper functions for Monorail APIs
async function getTokenDetails(address: string): Promise<TokenDetails> {
  const response = await fetch(`${MONORAIL_DATA_API}/token/${address}`);
  if (!response.ok) {
    throw new Error(`Failed to get token details: ${response.statusText}`);
  }
  return await response.json() as TokenDetails;
}

// Remove hardcoded TOKENS object and replace with dynamic token fetching
interface TokenInfo {
  address: `0x${string}`;
  decimals: number;
  symbol: string;
  name: string;
}

let tokenCache: Record<string, TokenInfo> = {};

// Hardcoded verified tokens list from Monorail API
const VERIFIED_TOKENS: TokenInfo[] = [
  { address: "0x268e4e24e0051ec27b3d27a95977e71ce6875a05", name: "Bean Exchange", symbol: "BEAN", decimals: 18 },
  { address: "0x3552f8254263ea8880c7f7e25cb8dbbd79c0c4b1", name: "buja Monad", symbol: "BMONAD", decimals: 18 },
  { address: "0xe0590015a873bf326bd645c3e1266d4db41c4e6b", name: "Chog", symbol: "CHOG", decimals: 18 },
  { address: "0x0f0bdebf0f83cd1ee3974779bcb7315f9808c714", name: "Molandak", symbol: "DAK", decimals: 18 },
  { address: "0x6ce1890eeadae7db01026f4b294cb8ec5ecc6563", name: "Halliday", symbol: "HALLI", decimals: 18 },
  { address: "0x04a9d9d4aea93f512a4c7b71993915004325ed38", name: "Hedgemony", symbol: "HEDGE", decimals: 18 },
  { address: "0xcc5b42f9d6144dfdfb6fb3987a2a916af902f5f8", name: "AI Jarvis", symbol: "JAI", decimals: 6 },
  { address: "0x8a056df4d7f23121a90aca1ca1364063d43ff3b8", name: "MONKeys", symbol: "KEYS", decimals: 18 },
  { address: "0xc8527e96c3cb9522f6e35e95c0a28feab8144f15", name: "Madness Finance", symbol: "MAD", decimals: 18 },
  { address: "0x786f4aa162457ecdf8fa4657759fa3e86c9394ff", name: "Madness LPs", symbol: "MAD-LP", decimals: 18 },
  { address: "0xb38bb873cca844b20a9ee448a87af3626a6e1ef5", name: "MistToken", symbol: "MIST", decimals: 18 },
  { address: "0x0000000000000000000000000000000000000000", name: "Monad", symbol: "MON", decimals: 18 },
  { address: "0x0c0c92fcf37ae2cbcc512e59714cd3a1a1cbc411", name: "Monda", symbol: "MONDA", decimals: 18 },
  { address: "0x4aa50e8208095d9594d18e8e3008abb811125dce", name: "Moon", symbol: "MOON", decimals: 18 },
  { address: "0x43e52cbc0073caa7c0cf6e64b576ce2d6fb14eb8", name: "DANOM", symbol: "NOM", decimals: 18 },
  { address: "0xc85548e0191cd34be8092b0d42eb4e45eba0d581", name: "Nostra", symbol: "NSTR", decimals: 18 },
  { address: "0x44369aafdd04cd9609a57ec0237884f45dd80818", name: "Perena", symbol: "P1", decimals: 18 },
  { address: "0x8a86d48c867b76ff74a36d3af4d2f1e707b143ed", name: "RBS Dollar", symbol: "RBSD", decimals: 18 },
  { address: "0x92eac40c98b383ea0f0efda747bdac7ac891d300", name: "Reddio", symbol: "RED", decimals: 18 },
  { address: "0x24d2fd6c5b29eebd5169cc7d6e8014cd65decd73", name: "PlatoTestFat", symbol: "TFAT", decimals: 18 },
  { address: "0x5d876d73f4441d5f2438b1a3e2a51771b337f27a", name: "Curvance USD Coin", symbol: "USDC", decimals: 6 },
  { address: "0xf817257fed379853cde0fa4f97ab987181b1e5ea", name: "USD Coin", symbol: "USDC", decimals: 6 },
  { address: "0x88b8e2161dedc77ef4ab7585569d2415a1c1055d", name: "Tether USD", symbol: "USDT", decimals: 6 },
  { address: "0xd875ba8e2cad3c0f7e2973277c360c8d2f92b510", name: "Stable USD", symbol: "USDX", decimals: 6 },
  { address: "0xbdd352f339e27e07089039ba80029f9135f6146f", name: "USD Moon", symbol: "USDm", decimals: 6 },
  { address: "0xcf5a6076cfa32686c0df13abada2b40dec133f1d", name: "Wrapped BTC", symbol: "WBTC", decimals: 8 },
  { address: "0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37", name: "Wrapped ETH", symbol: "WETH", decimals: 18 },
  { address: "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701", name: "Wrapped Monad", symbol: "WMON", decimals: 18 },
  { address: "0x5387c85a4965769f6b0df430638a1388493486f1", name: "Wrapped SOL", symbol: "WSOL", decimals: 9 },
  { address: "0xfe140e1dce99be9f4f15d657cd9b7bf622270c50", name: "Moyaki", symbol: "YAKI", decimals: 18 },
  { address: "0xb2f82d0f38dc453d596ad40a37799446cc89274a", name: "aPriori Monad LST", symbol: "aprMON", decimals: 18 },
  { address: "0xaeef2f6b429cb59c9b2d7bb2141ada993e8571c3", name: "Magma gMON", symbol: "gMON", decimals: 18 },
  { address: "0xceb564775415b524640d9f688278490a7f3ef9cd", name: "Talentum Wrapped MON", symbol: "iceMON", decimals: 18 },
  { address: "0x3b428df09c3508d884c30266ac1577f099313cf6", name: "Mama BTC", symbol: "mamaBTC", decimals: 8 },
  { address: "0x0efed4d9fb7863ccc7bb392847c08dcd00fe9be2", name: "muBOND", symbol: "muBOND", decimals: 18 },
  { address: "0xe1d2439b75fb9746e7bc6cb777ae10aa7f7ef9c5", name: "Kintsu Staked Monad", symbol: "sMON", decimals: 18 },
  { address: "0x3a98250f98dd388c211206983453837c8365bdc1", name: "ShMonad", symbol: "shMON", decimals: 18 },
  { address: "0x199c0da6f291a897302300aaae4f20d139162916", name: "Staked Monad", symbol: "stMON", decimals: 18 }
];

async function getTokenInfo(symbol: string): Promise<TokenInfo | null> {
  // Check cache first
  if (tokenCache[symbol.toUpperCase()]) {
    return tokenCache[symbol.toUpperCase()];
  }

  // Use hardcoded list instead of API
  const token = VERIFIED_TOKENS.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (token) {
    tokenCache[token.symbol.toUpperCase()] = token;
    return token;
  }

  return null;
}

async function getWalletBalances(address: string): Promise<TokenBalance[]> {
  const response = await fetch(`${MONORAIL_DATA_API}/wallet/${address}/balances`);
  if (!response.ok) {
    throw new Error(`Failed to get wallet balances: ${response.statusText}`);
  }
  return await response.json() as TokenBalance[];
}

// Define Monad Testnet chain
const monadTestnet: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
    },
    public: {
      http: ['https://testnet-rpc.monad.xyz'],
    },
  },
};

// Initialize environment and clients
const USER_PRIVATE_KEY = process.env.USER_PRIVATE_KEY;

const account = privateKeyToAccount(USER_PRIVATE_KEY as `0x${string}`);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

const walletClient = createWalletClient({
  chain: monadTestnet,
  transport: http(),
  account,
});

// Initialize ethers provider and wallet
const MONAD_TESTNET_RPC = "https://testnet-rpc.monad.xyz";
const ethersProvider = new JsonRpcProvider(MONAD_TESTNET_RPC);
const ethersWallet = new Wallet(USER_PRIVATE_KEY as string, ethersProvider);

// Contract addresses
const STAKING_CONTRACT_ADDRESS = "0xb2f82D0f38dc453D596Ad40A37799446Cc89274A" as const;
const MAGMA_CONTRACT = "0x2c9c959516e9aaedb2c748224a41249202ca8be7";

// Constants
const GAS_LIMIT_STAKE = 500000;
const GAS_LIMIT_UNSTAKE = 800000;

const STAKING_ABI = [
  {
    constant: true,
    inputs: [{ name: "", type: "address" }],
    name: "getPendingUnstakeRequests",
    outputs: [{ name: "", type: "uint256[]" }],
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "stake",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "requestUnstake",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// NNS API configuration
const NNS_API_BASE = "https://api.nad.domains";
const MONAD_CHAIN_ID = "10143"; // Updated chain ID for NNS API

// Constants for blockchain explorer and formatting
const MONAD_EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const MONAD_ADDRESS_EXPLORER = "https://testnet.monadexplorer.com/address/";

// Helper function for uploading to Pinata
async function uploadImageToPinata(memeUrl: string): Promise<string> {
  const response = await axios.get(memeUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(response.data);
  const filePath = "temp_meme.png";
  fs.writeFileSync(filePath, buffer);

  const url = "https://api.pinata.cloud/pinning/pinFileToIPFS";
  const data = new FormData();
  data.append("file", fs.createReadStream(filePath));
  
  const res = await axios.post(url, data, {
    headers: {
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET,
      ...data.getHeaders(),
    },
  });
  
  fs.unlinkSync(filePath);
  return `ipfs://${res.data.IpfsHash}`;
}

// Helper functions for NNS domain resolution
async function resolveAddressToName(address: string): Promise<string | null> {
  try {
    const response = await axios.get(`${NNS_API_BASE}/v1/protocol/primary-name/${address}?chainId=${MONAD_CHAIN_ID}`);
    if (response.data && response.data.name) {
      return response.data.name;
    }
    return null;
  } catch (error) {
    console.error("Error resolving NNS name:", error);
    return null;
  }
}

async function resolveNameToAddress(name: string): Promise<string | null> {
  try {
    // Remove .nad extension if present
    const cleanName = name.endsWith('.nad') ? name : `${name}.nad`;
    console.log(`Resolving domain: ${cleanName}`);
    const response = await axios.get(`${NNS_API_BASE}/v1/protocol/resolved-address/${cleanName}?chainId=${MONAD_CHAIN_ID}`);
    console.log('API Response:', response.data);
    if (response.data && response.data.success && response.data.resolvedAddress) {
      console.log(`Resolved address: ${response.data.resolvedAddress}`);
      return response.data.resolvedAddress;
    }
    return null;
  } catch (error) {
    console.error("Error resolving NNS address:", error);
    return null;
  }
}

async function resolveDomainToAddress(domain: string): Promise<string | null> {
  // Check if input is already an address
  if (domain.startsWith("0x") && domain.length === 42) {
    return domain;
  }
  // Try NNS resolution
  const resolved = await resolveNameToAddress(domain);
  console.log(`Resolved domain ${domain} to address: ${resolved}`);
  return resolved;
}

// Token transfer helper function
async function transferTokens(
  tokenSymbol: string,
  recipientAddressOrDomain: string,
  amount: number
): Promise<string> {
  const token = await getTokenInfo(tokenSymbol);
  if (!token) {
    throw new Error(`Token ${tokenSymbol} not found`);
  }

  const recipientAddress = await resolveDomainToAddress(recipientAddressOrDomain);
  if (!recipientAddress) {
    throw new Error(`Could not resolve address for ${recipientAddressOrDomain}`);
  }

  // Convert amount to the correct number of decimals
  const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, token.decimals)));

  if (token.symbol === "MON") {
    // Native MON transfer
    const hash = await walletClient.sendTransaction({
      to: recipientAddress as `0x${string}`,
      value: amountInSmallestUnit,
      account: account,
    });
    return hash;
  } else {
    // Send ERC20 token (viem way)
    const { request } = await publicClient.simulateContract({
      address: token.address as `0x${string}`,
      abi: [
        {
          inputs: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      functionName: "transfer",
      args: [recipientAddress as `0x${string}`, amountInSmallestUnit],
      account: account,
    });
    const hash = await walletClient.writeContract(request);
    return hash;
  }
}

// Imgflip API configuration
// Helper to get required env vars
function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const IMGFLIP_USERNAME = getEnvVar('IMGFLIP_USERNAME');
const IMGFLIP_PASSWORD = getEnvVar('IMGFLIP_PASSWORD');
const IMGFLIP_API_URL = 'https://api.imgflip.com/caption_image';

// Imgflip API types
interface ImgflipResponse {
  success: boolean;
  error_message?: string;
  data: {
    url: string;
  };
}

// Helper function to create a meme
async function createMeme(templateId: string, topText: string, bottomText: string): Promise<string> {
  const params = new URLSearchParams({
    template_id: templateId,
    username: IMGFLIP_USERNAME,
    password: IMGFLIP_PASSWORD,
    text0: topText,
    text1: bottomText,
  });
  const response = await fetch(IMGFLIP_API_URL, {
    method: 'POST',
    body: params,
  });
  const data = await response.json() as ImgflipResponse;
  if (!data.success) {
    throw new Error(`Failed to create meme: ${data.error_message}`);
  }
  return data.data.url;
}

// Helper function to format transaction response
function formatTransactionResponse(hash: string, details?: string): string {
  const txLink = `[View Transaction](${MONAD_EXPLORER_URL}${hash})`;
  return `🎉 Transaction successful!\n${txLink}\n${details ? `\nDetails:\n${details}` : ''}`;
}

// Helper function to format meme response
function formatMemeResponse(memeUrl: string, template: string): string {
  return `🎨 Meme created successfully!\n\n📌 Template: ${template}\n🔗 [View Meme](${memeUrl})\n\nEnjoy your meme! 🎉`;
}

// Nad.fun API configuration
const NAD_FUN_API_BASE = "https://testnet-bot-api-server.nad.fun";

// Nad.fun Contract Addresses
const NAD_FUN_CONTRACTS = {
  CORE: "0x822EB1ADD41cf87C3F178100596cf24c9a6442f6",
  BONDING_CURVE_FACTORY: "0x60216FB3285595F4643f9f7cddAB842E799BD642",
  INTERNAL_UNISWAP_V2_ROUTER: "0x619d07287e87C9c643C60882cA80d23C8ed44652",
  INTERNAL_UNISWAP_V2_FACTORY: "0x13eD0D5e1567684D964469cCbA8A977CDA580827",
  WRAPPED_MON: "0x3bb9AFB94c82752E47706A10779EA525Cf95dc27"
};

// Nad.fun Contract ABIs
const NAD_FUN_ABIS = {
  CORE: [
    {
      inputs: [
        { name: "amountIn", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "tokenAddress", type: "address" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" }
      ],
      name: "buy",
      outputs: [],
      stateMutability: "payable",
      type: "function"
    },
    {
      inputs: [
        { name: "tokensOut", type: "uint256" },
        { name: "tokenAddress", type: "address" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" }
      ],
      name: "exactOutBuy",
      outputs: [],
      stateMutability: "payable",
      type: "function"
    }
  ],
  ROUTER: [
    {
      inputs: [
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMin", type: "uint256" },
        { name: "path", type: "address[]" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" }
      ],
      name: "swapExactTokensForNative",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    }
  ]
};

// Rename the Nad.fun getTokenInfo function to avoid conflict
async function getNadFunTokenInfo(tokenAddress: string) {
  const response = await fetch(`${NAD_FUN_API_BASE}/token/${tokenAddress}`);
  if (!response.ok) {
    throw new Error(`Failed to get token info: ${response.statusText}`);
  }
  return await response.json();
}

// Nad.fun Trading Functions
async function buyFromBondingCurve(
  tokenAddress: string,
  amount: string
): Promise<string> {
  const amountIn = BigInt(amount);
  const fee = (amountIn * BigInt(10)) / BigInt(1000); // 1% fee
  const totalValue = amountIn + fee;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  const hash = await walletClient.writeContract({
    address: NAD_FUN_CONTRACTS.CORE as `0x${string}`,
    abi: NAD_FUN_ABIS.CORE,
    functionName: "buy",
    args: [
      amountIn,
      fee,
      tokenAddress,
      account.address,
      deadline
    ],
    value: totalValue,
    account: account,
  });

  return hash;
}

async function buyExactTokens(
  tokenAddress: string,
  tokensOut: string
): Promise<string> {
  const tokenAmount = BigInt(tokensOut);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  const hash = await walletClient.writeContract({
    address: NAD_FUN_CONTRACTS.CORE as `0x${string}`,
    abi: NAD_FUN_ABIS.CORE,
    functionName: "exactOutBuy",
    args: [
      tokenAmount,
      tokenAddress,
      account.address,
      deadline
    ],
    account: account,
  });

  return hash;
}

async function sellToDex(
  tokenAddress: string,
  amount: string,
  slippage: number = 0.5
): Promise<string> {
  // First approve tokens to Router
  const tokenAmount = BigInt(amount);
  const approveTxHash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [
      NAD_FUN_CONTRACTS.INTERNAL_UNISWAP_V2_ROUTER as `0x${string}`,
      tokenAmount
    ],
    account: account,
  });

  // Wait for approval confirmation
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  // Calculate deadline
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  // Get expected output amount
  const path = [
    tokenAddress as `0x${string}`,
    NAD_FUN_CONTRACTS.WRAPPED_MON as `0x${string}`
  ];

  const amounts = await publicClient.readContract({
    address: NAD_FUN_CONTRACTS.INTERNAL_UNISWAP_V2_ROUTER as `0x${string}`,
    abi: NAD_FUN_ABIS.ROUTER,
    functionName: "getAmountsOut",
    args: [tokenAmount, path]
  });

  // Calculate minimum amount with slippage
  const expectedAmount = (amounts as bigint[])[1];
  const slippageFactor = BigInt(1000) - BigInt(Math.floor(slippage * 10));
  const minAmount = (expectedAmount * slippageFactor) / BigInt(1000);

  // Submit transaction
  const hash = await walletClient.writeContract({
    address: NAD_FUN_CONTRACTS.INTERNAL_UNISWAP_V2_ROUTER as `0x${string}`,
    abi: NAD_FUN_ABIS.ROUTER,
    functionName: "swapExactTokensForNative",
    args: [
      tokenAmount,
      minAmount,
      path,
      account.address,
      deadline
    ],
    account: account,
  });

  return hash;
}

// Updated MemeOdysseyHub contract address and ABI
const MEME_ODYSSEY_CONTRACT = "0x615E3a55Eeb3A31B3ea895242309cb721B696C3d";
const MEME_ODYSSEY_ABI = [
  "function mintMeme(address recipient, string memory _tokenURI) public returns (uint256)",
  "function tokenURI(uint256 tokenId) public view returns (string memory)",
  "event MemeMinted(uint256 indexed tokenId, address indexed recipient, string tokenURI)"
] as const;

// Define template type with enhanced categories
type MemeTemplate = {
  name: string;
  type: string;
  description: string;
  category: string;
  textFields: {
    top: string;
    bottom: string;
  };
};

type TemplateId = string;

type MemeTemplates = {
  [key: TemplateId]: MemeTemplate;
};

// Load meme templates from templates.json
const templatesJson = JSON.parse(fs.readFileSync('templates.json', 'utf-8'));

// Enhanced meme templates with more details
const MEME_TEMPLATES: MemeTemplates = Object.entries(templatesJson).reduce((acc, [name, details]: [string, any]) => {
  acc[details.id] = {
    name: name,
    type: "custom",
    description: `Template with ${details.box_count} text boxes`,
    category: "general",
    textFields: {
      top: "Top text",
      bottom: "Bottom text"
    }
  };
  return acc;
}, {} as MemeTemplates);

// Token counter management
const TOKEN_COUNTER_FILE = "tokenCounter.json";

function readTokenCounter(): number {
  try {
    if (fs.existsSync(TOKEN_COUNTER_FILE)) {
      const data = fs.readFileSync(TOKEN_COUNTER_FILE);
      return JSON.parse(data.toString()).counter || 0;
    }
    return 0;
  } catch (error) {
    console.error("Error reading token counter:", error);
    return 0;
  }
}

function writeTokenCounter(counter: number): void {
  try {
    fs.writeFileSync(TOKEN_COUNTER_FILE, JSON.stringify({ counter }));
  } catch (error) {
    console.error("Error writing token counter:", error);
  }
}

// Helper function to get template name with type safety
function getTemplateName(template: string): string {
  if (isValidTemplateId(template)) {
    return MEME_TEMPLATES[template].name;
  }
  return "Unknown Template";
}

// Type guard for template IDs
function isValidTemplateId(template: string): template is TemplateId {
  return template in MEME_TEMPLATES;
}

// Update metadata generation with enhanced details
async function createMetadata(
  imageIpfsUrl: string,
  tokenId: number,
  prompt: string,
  template: string
): Promise<string> {
  const templateInfo = MEME_TEMPLATES[template];
  const metadata = {
    name: `Meme Odyssey #${tokenId}`,
    description: `A unique meme NFT inspired by the prompt: "${prompt}". Created using the ${templateInfo?.name || "Custom"} template.`,
    image: imageIpfsUrl,
    attributes: [
      { trait_type: "Template", value: templateInfo?.name || "Custom Template" },
      { trait_type: "Category", value: templateInfo?.category || "custom" },
      { trait_type: "Type", value: templateInfo?.type || "custom" }
    ],
    collection: {
      name: "Meme Odyssey Hub",
      family: "Meme Odyssey",
      description: "A vibrant collection of meme NFTs on Monad Testnet, each telling its own story through internet culture and creativity."
    },
    properties: {
      prompt,
      template: {
        id: template,
        name: templateInfo?.name || "Custom Template",
        category: templateInfo?.category || "custom",
        type: templateInfo?.type || "custom"
      }
    }
  };
  
  const filePath = "metadata.json";
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));

  const url = "https://api.pinata.cloud/pinning/pinFileToIPFS";
  const data = new FormData();
  data.append("file", fs.createReadStream(filePath));
  
  const res = await axios.post(url, data, {
    headers: {
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET,
      ...data.getHeaders(),
    },
  });
  
  fs.unlinkSync(filePath);
  return `ipfs://${res.data.IpfsHash}`;
}

// Simplified mintNFT function
async function mintNFT(memeUrl: string, prompt: string, template: string): Promise<{ tokenId: string; metadataIpfsUrl: string; transactionHash: string }> {
  try {
    if (!account.address) {
      throw new Error("Wallet account not found");
    }

    if (!USER_PRIVATE_KEY) {
      throw new Error("Private key not found in environment variables");
    }

    // Increment token counter
    const currentCounter = readTokenCounter() + 1;
    writeTokenCounter(currentCounter);

    console.log("Starting minting process with parameters:", { memeUrl, prompt, template });
    
    // Upload meme to IPFS
    console.log("Uploading meme to IPFS...");
    const imageIpfsUrl = await uploadImageToPinata(memeUrl);
    console.log("Image uploaded:", imageIpfsUrl);
    
    // Generate and upload metadata
    console.log("Creating metadata...");
    const metadataIpfsUrl = await createMetadata(imageIpfsUrl, currentCounter, prompt, template);
    console.log("Metadata uploaded:", metadataIpfsUrl);
    
    // Initialize contract with ethers for better event handling
    const provider = new JsonRpcProvider(MONAD_TESTNET_RPC);
    const wallet = new Wallet(USER_PRIVATE_KEY as string, ethersProvider);
    const contract = new Contract(MEME_ODYSSEY_CONTRACT, MEME_ODYSSEY_ABI, wallet);
    
    // Mint NFT
    console.log("Minting NFT...");
    const tx = await contract.mintMeme(account.address, metadataIpfsUrl);
    console.log("Transaction sent:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt);
    
    // Find the MemeMinted event
    const memeMintedEvent = receipt.logs.find(
      (log: any) => {
        try {
          return log.fragment?.name === "MemeMinted";
        } catch {
          return false;
        }
      }
    );
    
    if (!memeMintedEvent) {
      throw new Error("MemeMinted event not found in transaction receipt");
    }
    
    const tokenId = memeMintedEvent.args.tokenId.toString();
    console.log("NFT minted successfully with token ID:", tokenId);
    
    return { 
      tokenId, 
      metadataIpfsUrl,
      transactionHash: tx.hash
    };
  } catch (error) {
    console.error("Error in mintNFT:", error);
    throw error;
  }
}

// Update Nad.fun API endpoints and types
interface NadFunTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  marketCap: string;
  price: string;
  volume24h: string;
  priceChange24h: string;
}

interface NadFunPosition {
  tokenAddress: string;
  amount: string;
  entryPrice: string;
  currentPrice: string;
  pnl: string;
  type: string;
}

interface NadFunMarketInfo {
  price: string;
  marketCap: string;
  volume24h: string;
  priceChange24h: string;
  holders: number;
  transactions: number;
}

interface NadFunSwapHistory {
  timestamp: number;
  type: string;
  amount: string;
  price: string;
  value: string;
  txHash: string;
}

// Update NAD_FUN_API object with all endpoints
const NAD_FUN_API = {
  // Token Market Operations
  async buyFromBondingCurve(tokenAddress: string, amountIn: string) {
    const response = await fetch(`${NAD_FUN_API_BASE}/market/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, amountIn })
    });
    return await response.json();
  },

  async buyExactTokens(tokenAddress: string, tokensOut: string) {
    const response = await fetch(`${NAD_FUN_API_BASE}/market/buyExact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, tokensOut })
    });
    return await response.json();
  },

  async sellToDex(tokenAddress: string, amount: string, slippage: number = 0.5) {
    const response = await fetch(`${NAD_FUN_API_BASE}/market/sell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, amount, slippage })
    });
    return await response.json();
  },

  // Account Operations
  async getAccountPositions(address: string, positionType: string = "open") {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/account/position/${address}?position_type=${positionType}&page=1&limit=10`
    );
    return await response.json() as NadFunPosition[];
  },

  async getAccountCreatedTokens(address: string) {
    const response = await fetch(`${NAD_FUN_API_BASE}/account/tokens/${address}`);
    return await response.json() as NadFunTokenInfo[];
  },

  // Token Information
  async getTokensByCreationTime(page: number = 1, limit: number = 10) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/tokens/creation_time?page=${page}&limit=${limit}`
    );
    return await response.json() as NadFunTokenInfo[];
  },

  async getTokensByMarketCap(page: number = 1, limit: number = 10) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/tokens/market_cap?page=${page}&limit=${limit}`
    );
    return await response.json() as NadFunTokenInfo[];
  },

  async getTokensByLatestTrade(page: number = 1, limit: number = 10) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/tokens/latest_trade?page=${page}&limit=${limit}`
    );
    return await response.json() as NadFunTokenInfo[];
  },

  async getTokenMetadata(tokenAddress: string) {
    const response = await fetch(`${NAD_FUN_API_BASE}/token/${tokenAddress}`);
    return await response.json() as NadFunTokenInfo;
  },

  async getTokenChartData(tokenAddress: string, timeframe: string = "24h") {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/token/chart/${tokenAddress}?timeframe=${timeframe}`
    );
    return await response.json();
  },

  async getTokenSwapHistory(tokenAddress: string, page: number = 1, limit: number = 10) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/token/swap/${tokenAddress}?page=${page}&limit=${limit}`
    );
    return await response.json() as NadFunSwapHistory[];
  },

  async getTokenMarketInfo(tokenAddress: string) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/token/market/${tokenAddress}`
    );
    return await response.json() as NadFunMarketInfo;
  },

  async getTokenHolders(tokenAddress: string, page: number = 1, limit: number = 10) {
    const response = await fetch(
      `${NAD_FUN_API_BASE}/token/holder/${tokenAddress}?page=${page}&limit=${limit}`
    );
    return await response.json();
  }
};

// BlockVision API Key and Base URL
const BLOCKVISION_API_KEY = getEnvVar('BLOCKVISION_API_KEY');
const BLOCKVISION_API_BASE = getEnvVar('BLOCKVISION_API_BASE');

// BlockVision: Retrieve Account Tokens
async function getBlockvisionAccountTokens(address: string): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/account/tokens?address=${address}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Account Tokens error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Account NFTs
async function getBlockvisionAccountNFTs(address: string, pageIndex: number = 1): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/account/nfts?address=${address}&pageIndex=${pageIndex}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Account NFTs error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Account Activities
async function getBlockvisionAccountActivities(address: string, limit: number = 20, ascendingOrder: boolean = false, cursor?: string): Promise<any> {
  let url = `${BLOCKVISION_API_BASE}/account/activities?address=${address}&limit=${limit}&ascendingOrder=${ascendingOrder}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Account Activities error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// Restore getBlockInfo
async function getBlockInfo(blockNumber: number): Promise<any> {
  try {
    const block = await publicClient.getBlock({
      blockNumber: BigInt(blockNumber),
    });
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      transactions: block.transactions,
    };
  } catch (error) {
    throw new Error(`Failed to get block info: ${error}`);
  }
}

// Restore getTransactionInfo
async function getTransactionInfo(txHash: string): Promise<any> {
  try {
    const tx = await publicClient.getTransaction({
      hash: txHash as `0x${string}`,
    });
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      nonce: tx.nonce,
      data: tx.input,
    };
  } catch (error) {
    throw new Error(`Failed to get transaction info: ${error}`);
  }
}

// Restore getLatestBlock
async function getLatestBlock(): Promise<any> {
  try {
    const block = await publicClient.getBlock();
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
    };
  } catch (error) {
    throw new Error(`Failed to get latest block: ${error}`);
  }
}

// Update swapTokens to use the Monorail swap approach from tool.ts
async function swapTokens(tokenIn: string, tokenOut: string, amount: number): Promise<string> {
  const tokenInInfo = await getTokenInfo(tokenIn);
  const tokenOutInfo = await getTokenInfo(tokenOut);

  if (!tokenInInfo || !tokenOutInfo) {
    throw new Error(`Token not found: ${!tokenInInfo ? tokenIn : tokenOut}`);
  }

  // Get quote from Monorail API
  const fromAddress = tokenIn === "MON" ? "0x0000000000000000000000000000000000000000" : tokenInInfo.address;
  const toAddress = tokenOut === "MON" ? "0x0000000000000000000000000000000000000000" : tokenOutInfo.address;

  const quoteUrl = `${MONORAIL_PATHFINDER_API}/quote?amount=${amount}&from=${fromAddress}&to=${toAddress}&sender=${walletClient.account.address}&slippage=100&deadline=60&max_hops=3`;

  const response = await fetch(quoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to get quote: ${response.statusText}`);
  }

  const quoteData = await response.json() as MonorailQuoteResponse;
  if (!quoteData.transaction) {
    throw new Error("Failed to get quote from Monorail");
  }

  // Handle approvals if needed
  if (tokenIn !== "MON") {
    const approveTx = await walletClient.writeContract({
      address: tokenInInfo.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [MONORAIL_ROUTER, BigInt(quoteData.input)],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  // Execute the swap using the transaction data from Monorail
  const tx = await walletClient.sendTransaction({
    to: quoteData.transaction.to as `0x${string}`,
    data: quoteData.transaction.data as `0x${string}`,
    value: tokenIn === "MON" ? BigInt(quoteData.transaction.value || "0") : BigInt(0),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status === "success") {
    return `Swap transaction successful: ${tx}\nExpected output: ${quoteData.output_formatted} ${tokenOut}\nPrice Impact: ${quoteData.compound_impact}%`;
  } else {
    throw new Error(`Swap transaction failed: ${tx}`);
  }
}

// Restore stakeMon
async function stakeMon(amount: number): Promise<string> {
  try {
    const tx = await walletClient.writeContract({
      address: STAKING_CONTRACT_ADDRESS as `0x${string}`,
      abi: STAKING_ABI,
      functionName: "stake",
      args: [parseEther(amount.toString())],
      value: parseEther(amount.toString()),
      gas: BigInt(GAS_LIMIT_STAKE)
    });
    return tx;
  } catch (error) {
    throw new Error(`Failed to stake MON: ${error}`);
  }
}

// Restore requestUnstake
async function requestUnstake(amount: number): Promise<string> {
  try {
    const tx = await walletClient.writeContract({
      address: STAKING_CONTRACT_ADDRESS as `0x${string}`,
      abi: STAKING_ABI,
      functionName: "requestUnstake",
      args: [parseEther(amount.toString())],
      gas: BigInt(GAS_LIMIT_UNSTAKE)
    });
    return tx;
  } catch (error) {
    throw new Error(`Failed to request unstake: ${error}`);
  }
}

// Restore claimUnstaked
async function claimUnstaked(): Promise<string> {
  try {
    const tx = await walletClient.writeContract({
      address: STAKING_CONTRACT_ADDRESS as `0x${string}`,
      abi: STAKING_ABI,
      functionName: "claim",
      gas: BigInt(GAS_LIMIT_UNSTAKE)
    });
    return tx;
  } catch (error) {
    throw new Error(`Failed to claim unstaked MON: ${error}`);
  }
}

// Restore checkPendingUnstakes
async function checkPendingUnstakes(address: string): Promise<bigint[]> {
  try {
    const pendingUnstakes = await publicClient.readContract({
      address: STAKING_CONTRACT_ADDRESS as `0x${string}`,
      abi: STAKING_ABI,
      functionName: "getPendingUnstakeRequests",
      args: [address as `0x${string}`]
    });
    return pendingUnstakes as bigint[];
  } catch (error) {
    throw new Error(`Failed to check pending unstakes: ${error}`);
  }
}

// Restore sendTokens
async function sendTokens(tokenSymbol: string, recipientAddressOrDomain: string, amount: number): Promise<string> {
  const tokenInfo = await getTokenInfo(tokenSymbol);
  if (!tokenInfo) {
    throw new Error("Invalid token symbol");
  }
  const recipientAddress = await resolveDomainToAddress(recipientAddressOrDomain);
  if (!recipientAddress) {
    throw new Error(`Could not resolve address for ${recipientAddressOrDomain}`);
  }
  const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, tokenInfo.decimals)));
  if (tokenInfo.address === "0x0000000000000000000000000000000000000000") {
    // Send native MON
    const tx = await walletClient.sendTransaction({
      to: recipientAddress as `0x${string}`,
      value: amountInSmallestUnit,
      account: account,
    });
    return tx;
  } else {
    // Send ERC20 token (viem way)
    const { request } = await publicClient.simulateContract({
      address: tokenInfo.address as `0x${string}`,
      abi: [
        {
          inputs: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ],
      functionName: "transfer",
      args: [recipientAddress as `0x${string}`, amountInSmallestUnit],
      account: account,
    });
    const hash = await walletClient.writeContract(request);
    return hash;
  }
}

export const mcpHandler = initializeMcpApiHandler(
  (server) => {
    // BlockVision: Get account tokens
    server.tool(
      "get-blockvision-account-tokens",
      "Get all tokens held by an address using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for ERC-20 tokens"),
      },
      async ({ address }: { address: string }) => {
        try {
          const result = await getBlockvisionAccountTokens(address);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision tokens: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get account NFTs
    server.tool(
      "get-blockvision-account-nfts",
      "Get all NFTs held by an address using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for NFTs"),
        pageIndex: z.number().optional().describe("Page number for NFT collections (default 1)"),
      },
      async ({ address, pageIndex = 1 }: { address: string; pageIndex?: number }) => {
        try {
          const result = await getBlockvisionAccountNFTs(address, pageIndex);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision NFTs: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get account activities
    server.tool(
      "get-blockvision-account-activities",
      "Get historical activity for an address using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for activity"),
        limit: z.number().optional().describe("Max results per page (default 20, max 50)"),
        ascendingOrder: z.boolean().optional().describe("Order ascending (default false)"),
        cursor: z.string().optional().describe("Next page cursor"),
      },
      async ({ address, limit = 20, ascendingOrder = false, cursor }: { address: string; limit?: number; ascendingOrder?: boolean; cursor?: string }) => {
        try {
          const result = await getBlockvisionAccountActivities(address, limit, ascendingOrder, cursor);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision activities: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // Get block info
    server.tool(
      "get-block-info",
      "Get information about a specific block on Monad testnet",
      {
        blockNumber: z.number().describe("Block number to get information for"),
      },
      async ({ blockNumber }: { blockNumber: number }) => {
        try {
          const blockInfo = await getBlockInfo(blockNumber);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(blockInfo, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get block info: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Get transaction info
    server.tool(
      "get-transaction-info",
      "Get information about a specific transaction on Monad testnet",
      {
        hash: z.string().describe("Transaction hash to get information for"),
      },
      async ({ hash }: { hash: string }) => {
        try {
          const txInfo = await getTransactionInfo(hash);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(txInfo, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction info: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Get latest block
    server.tool(
      "get-latest-block",
      "Get the latest block number on Monad testnet",
      {
        random_string: z.string().describe("Dummy parameter for no-parameter tools"),
      },
      async () => {
        try {
          const latestBlock = await getLatestBlock();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(latestBlock, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get latest block: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Swap tokens
    server.tool(
      "swap-tokens",
      "Swap tokens on Monad testnet using Monorail",
      {
        tokenIn: z.string().describe("Token symbol to swap from (e.g., MON, USDC)"),
        tokenOut: z.string().describe("Token symbol to swap to (e.g., USDC, MON)"),
        amount: z.number().describe("Amount of tokens to swap"),
      },
      async ({ tokenIn, tokenOut, amount }: { tokenIn: string; tokenOut: string; amount: number }) => {
        try {
          const tx = await swapTokens(tokenIn, tokenOut, amount);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(tx, `Swapped ${amount} ${tokenIn} for ${tokenOut}`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to swap tokens: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Stake
    server.tool(
      "stake",
      "Stake MON tokens in the staking contract",
      {
        amount: z.number().describe("Amount of MON to stake"),
      },
      async ({ amount }: { amount: number }) => {
        try {
          const tx = await stakeMon(amount);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(tx, `Staked ${amount} MON`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to stake MON: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Unstake
    server.tool(
      "unstake",
      "Unstake MON tokens. If 'amount' is provided, requests unstake. If not, claims any available unstaked MON.",
      {
        amount: z.number().optional().describe("Amount of staked MON to unstake. If omitted, will claim any available unstaked MON."),
      },
      async ({ amount }: { amount?: number }) => {
        try {
          if (typeof amount === "number") {
            const tx = await requestUnstake(amount);
            return {
              content: [
                {
                  type: "text",
                  text: formatTransactionResponse(tx, `Requested unstake of ${amount} MON`),
                },
              ],
            };
          } else {
            const pendingUnstakes = await checkPendingUnstakes(account.address);
            const totalPending = pendingUnstakes.reduce((acc, v) => acc + v, BigInt(0));
            if (totalPending > BigInt(0)) {
              const tx = await claimUnstaked();
              return {
                content: [
                  {
                    type: "text",
                    text: formatTransactionResponse(tx, `Claimed unstaked MON (${formatUnits(totalPending, 18)} MON)`),
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: `No unstaked MON available to claim.`,
                  },
                ],
              };
            }
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to unstake or claim: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Send tokens
    server.tool(
      "send-tokens",
      "Send tokens to an address or domain name",
      {
        tokenSymbol: z.string().describe("Symbol of the token to send (e.g., MON, USDC)"),
        recipient: z.string().describe("Recipient address or domain name"),
        amount: z.number().describe("Amount of tokens to send"),
      },
      async ({ tokenSymbol, recipient, amount }: { tokenSymbol: string; recipient: string; amount: number }) => {
        try {
          const hash = await sendTokens(tokenSymbol, recipient, amount);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(hash, `Sent ${amount} ${tokenSymbol} to ${recipient}`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send tokens: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Create meme
    server.tool(
      "create-meme",
      "Create a meme using Imgflip API",
      {
        templateId: z.string().describe("Template ID from Imgflip (e.g., '181913649' for Drake Hotline Bling)"),
        topText: z.string().describe("Text to appear at the top of the meme"),
        bottomText: z.string().describe("Text to appear at the bottom of the meme"),
      },
      async ({ templateId, topText, bottomText }: { templateId: string; topText: string; bottomText: string }) => {
        try {
          const memeUrl = await createMeme(templateId, topText, bottomText);
          return {
            content: [
              {
                type: "text",
                text: formatMemeResponse(memeUrl, getTemplateName(templateId)),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to create meme: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Get meme templates
    server.tool(
      "get-meme-templates",
      "Get a list of popular meme templates",
      {
        random_string: z.string().describe("Dummy parameter for no-parameter tools"),
      },
      async () => {
        try {
          const templates = Object.entries(MEME_TEMPLATES).map(([id, template]) => 
            `${id}: ${template.name} - ${template.description}`
          ).join("\n");

        return {
          content: [
            {
              type: "text",
                text: `Available Meme Templates:\n${templates}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get meme templates: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            },
          ],
        };
        }
      }
    );

    // Mint meme as NFT
    server.tool(
      "mint-meme",
      "Mint the last created meme as an NFT",
      {
        memeUrl: z.string().describe("URL of the meme to mint as NFT"),
        prompt: z.string().describe("The prompt that inspired this meme"),
        template: z.string().describe("The template ID used for this meme"),
      },
      async ({ memeUrl, prompt, template }: { memeUrl: string; prompt: string; template: string }) => {
        try {
          const result = await mintNFT(memeUrl, prompt, template);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(
                  result.transactionHash,
                  `Minted meme as NFT!\nToken ID: ${result.tokenId}\nMetadata: ${result.metadataIpfsUrl}`
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to mint meme as NFT: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Buy from bonding curve
    server.tool(
      "buy-from-bonding-curve",
      "Buy tokens from Nad.fun bonding curve",
      {
        tokenAddress: z.string().describe("Token address to buy"),
        amount: z.string().describe("Amount of MON to spend"),
      },
      async ({ tokenAddress, amount }: { tokenAddress: string; amount: string }) => {
        try {
          const hash = await buyFromBondingCurve(tokenAddress, amount);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(hash, `Bought tokens from bonding curve`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to buy from bonding curve: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Buy exact tokens
    server.tool(
      "buy-exact-tokens",
      "Buy exact amount of tokens from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to buy"),
        amount: z.string().describe("Exact amount of tokens to buy"),
      },
      async ({ tokenAddress, amount }: { tokenAddress: string; amount: string }) => {
        try {
          const hash = await buyExactTokens(tokenAddress, amount);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(hash, `Bought exact amount of tokens`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to buy exact tokens: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Sell to DEX
    server.tool(
      "sell-to-dex",
      "Sell tokens on Nad.fun DEX",
      {
        tokenAddress: z.string().describe("Token address to sell"),
        amount: z.string().describe("Amount of tokens to sell"),
        slippage: z.number().optional().describe("Slippage tolerance in percentage (default: 0.5)"),
      },
      async ({ tokenAddress, amount, slippage }: { tokenAddress: string; amount: string; slippage?: number }) => {
        try {
          const hash = await sellToDex(tokenAddress, amount, slippage);
          return {
            content: [
              {
                type: "text",
                text: formatTransactionResponse(hash, `Sold tokens on DEX`),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to sell to DEX: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Get account positions
    server.tool(
      "get-account-positions",
      "Get account positions from Nad.fun",
      {
        address: z.string().describe("Account address to check positions for"),
        positionType: z.string().optional().describe("Position type (open/closed/all)"),
      },
      async ({ address, positionType }: { address: string; positionType?: string }) => {
        try {
          const positions = await NAD_FUN_API.getAccountPositions(address, positionType);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(positions, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get account positions: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Nad.fun Info/Analytics Tools
    server.tool(
      "get-tokens-created-by-account",
      "Get tokens created by an account from Nad.fun",
      {
        address: z.string().describe("Account address to check created tokens for"),
      },
      async ({ address }: { address: string }) => {
        try {
          const tokens = await NAD_FUN_API.getAccountCreatedTokens(address);
          return {
            content: [
              { type: "text", text: JSON.stringify(tokens, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get tokens created by account: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-tokens-by-creation-time",
      "Get tokens by creation time from Nad.fun",
      {
        page: z.number().optional().describe("Page number"),
        limit: z.number().optional().describe("Limit per page"),
      },
      async ({ page = 1, limit = 10 }: { page?: number; limit?: number }) => {
        try {
          const tokens = await NAD_FUN_API.getTokensByCreationTime(page, limit);
          return {
            content: [
              { type: "text", text: JSON.stringify(tokens, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get tokens by creation time: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-tokens-by-market-cap",
      "Get tokens by market cap from Nad.fun",
      {
        page: z.number().optional().describe("Page number"),
        limit: z.number().optional().describe("Limit per page"),
      },
      async ({ page = 1, limit = 10 }: { page?: number; limit?: number }) => {
        try {
          const tokens = await NAD_FUN_API.getTokensByMarketCap(page, limit);
          return {
            content: [
              { type: "text", text: JSON.stringify(tokens, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get tokens by market cap: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-tokens-by-latest-trade",
      "Get tokens by latest trade from Nad.fun",
      {
        page: z.number().optional().describe("Page number"),
        limit: z.number().optional().describe("Limit per page"),
      },
      async ({ page = 1, limit = 10 }: { page?: number; limit?: number }) => {
        try {
          const tokens = await NAD_FUN_API.getTokensByLatestTrade(page, limit);
          return {
            content: [
              { type: "text", text: JSON.stringify(tokens, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get tokens by latest trade: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-token-metadata",
      "Get token metadata from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to get metadata for"),
      },
      async ({ tokenAddress }: { tokenAddress: string }) => {
        try {
          const metadata = await NAD_FUN_API.getTokenMetadata(tokenAddress);
          return {
            content: [
              { type: "text", text: JSON.stringify(metadata, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get token metadata: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-token-chart-data",
      "Get token chart data from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to get chart data for"),
        timeframe: z.string().optional().describe("Timeframe (e.g., 24h, 7d, 30d)"),
      },
      async ({ tokenAddress, timeframe = "24h" }: { tokenAddress: string; timeframe?: string }) => {
        try {
          const chartData = await NAD_FUN_API.getTokenChartData(tokenAddress, timeframe);
          return {
            content: [
              { type: "text", text: JSON.stringify(chartData, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get token chart data: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-token-swap-history",
      "Get token swap history from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to get swap history for"),
        page: z.number().optional().describe("Page number"),
        limit: z.number().optional().describe("Limit per page"),
      },
      async ({ tokenAddress, page = 1, limit = 10 }: { tokenAddress: string; page?: number; limit?: number }) => {
        try {
          const swapHistory = await NAD_FUN_API.getTokenSwapHistory(tokenAddress, page, limit);
          return {
            content: [
              { type: "text", text: JSON.stringify(swapHistory, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get token swap history: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-token-market-info",
      "Get token market information from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to get market info for"),
      },
      async ({ tokenAddress }: { tokenAddress: string }) => {
        try {
          const marketInfo = await NAD_FUN_API.getTokenMarketInfo(tokenAddress);
          return {
            content: [
              { type: "text", text: JSON.stringify(marketInfo, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get token market info: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    server.tool(
      "get-token-holders",
      "Get token holders from Nad.fun",
      {
        tokenAddress: z.string().describe("Token address to get holders for"),
        page: z.number().optional().describe("Page number"),
        limit: z.number().optional().describe("Limit per page"),
      },
      async ({ tokenAddress, page = 1, limit = 10 }: { tokenAddress: string; page?: number; limit?: number }) => {
        try {
          const holders = await NAD_FUN_API.getTokenHolders(tokenAddress, page, limit);
          return {
            content: [
              { type: "text", text: JSON.stringify(holders, null, 2) },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to get token holders: ${error instanceof Error ? error.message : String(error)}` },
            ],
          };
        }
      }
    );

    // Alchemy: Get block by hash
    server.tool(
      "get-block-by-hash",
      "Get information about a block by its hash using Alchemy API",
      {
        hash: z.string().describe("Hash of the block"),
        fullTransactions: z.boolean().optional().describe("If true, returns full transaction objects"),
      },
      async ({ hash, fullTransactions = false }: { hash: string; fullTransactions?: boolean }) => {
        try {
          const result = await alchemyRequest("eth_getBlockByHash", [hash, fullTransactions]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get block by hash: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get block by number
    server.tool(
      "get-block-by-number",
      "Get information about a block by its number using Alchemy API",
      {
        blockNumber: z.string().describe("Block number or tag (earliest, latest, pending)"),
        fullTransactions: z.boolean().optional().describe("If true, returns full transaction objects"),
      },
      async ({ blockNumber, fullTransactions = false }: { blockNumber: string; fullTransactions?: boolean }) => {
        try {
          const result = await alchemyRequest("eth_getBlockByNumber", [blockNumber, fullTransactions]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get block by number: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get latest block number
    server.tool(
      "get-latest-block-number",
      "Get the latest block number using Alchemy API",
      {
        random_string: z.string().describe("Dummy parameter for no-parameter tools"),
      },
      async () => {
        try {
          const result = await alchemyRequest("eth_blockNumber");
          return {
            content: [
              {
                type: "text",
                text: `Latest block number: ${result}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get latest block number: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get block receipts
    server.tool(
      "get-block-receipts",
      "Get all transaction receipts for a given block using Alchemy API",
      {
        blockId: z.string().describe("Block number (hex), hash, or tag (latest, pending, etc.)"),
      },
      async ({ blockId }: { blockId: string }) => {
        try {
          const result = await alchemyRequest("eth_getBlockReceipts", [blockId]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get block receipts: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get block transaction count by hash
    server.tool(
      "get-block-transaction-count-by-hash",
      "Get the number of transactions in a block by its hash using Alchemy API",
      {
        blockHash: z.string().describe("32 Bytes - Hash of the block"),
      },
      async ({ blockHash }: { blockHash: string }) => {
        try {
          const result = await alchemyRequest("eth_getBlockTransactionCountByHash", [blockHash]);
          return {
            content: [
              {
                type: "text",
                text: `Number of transactions: ${parseInt(result, 16)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction count: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get block transaction count by number
    server.tool(
      "get-block-transaction-count-by-number",
      "Get the number of transactions in a block by its number using Alchemy API",
      {
        blockNumber: z.string().describe("Block number (hex) or tag (latest, pending, etc.)"),
      },
      async ({ blockNumber }: { blockNumber: string }) => {
        try {
          const result = await alchemyRequest("eth_getBlockTransactionCountByNumber", [blockNumber]);
          return {
            content: [
              {
                type: "text",
                text: `Number of transactions: ${parseInt(result, 16)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction count: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get transaction by hash
    server.tool(
      "get-transaction-by-hash",
      "Get transaction information by its hash using Alchemy API",
      {
        hash: z.string().describe("32 Bytes - Hash of the transaction"),
      },
      async ({ hash }: { hash: string }) => {
        try {
          const result = await alchemyRequest("eth_getTransactionByHash", [hash]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get transaction by block hash and index
    server.tool(
      "get-transaction-by-block-hash-and-index",
      "Get transaction information by block hash and index using Alchemy API",
      {
        blockHash: z.string().describe("32 Bytes - Hash of the block"),
        index: z.string().describe("Integer of the transaction index position (hex)"),
      },
      async ({ blockHash, index }: { blockHash: string; index: string }) => {
        try {
          const result = await alchemyRequest("eth_getTransactionByBlockHashAndIndex", [blockHash, index]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get transaction by block number and index
    server.tool(
      "get-transaction-by-block-number-and-index",
      "Get transaction information by block number and index using Alchemy API",
      {
        blockNumber: z.string().describe("Block number (hex) or tag (latest, pending, etc.)"),
        index: z.string().describe("Integer of the transaction index position (hex)"),
      },
      async ({ blockNumber, index }: { blockNumber: string; index: string }) => {
        try {
          const result = await alchemyRequest("eth_getTransactionByBlockNumberAndIndex", [blockNumber, index]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get transaction receipt
    server.tool(
      "get-transaction-receipt",
      "Get transaction receipt by transaction hash using Alchemy API",
      {
        hash: z.string().describe("32 Bytes - Hash of the transaction"),
      },
      async ({ hash }: { hash: string }) => {
        try {
          const result = await alchemyRequest("eth_getTransactionReceipt", [hash]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction receipt: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get transaction count
    server.tool(
      "get-transaction-count",
      "Get the number of transactions sent from an address using Alchemy API",
      {
        address: z.string().describe("20 Bytes - Address to get transaction count for"),
        blockParameter: z.string().optional().describe("Block number (hex) or tag (latest, pending, etc.)"),
      },
      async ({ address, blockParameter = "latest" }: { address: string; blockParameter?: string }) => {
        try {
          const result = await alchemyRequest("eth_getTransactionCount", [address, blockParameter]);
          return {
            content: [
              {
                type: "text",
                text: `Transaction count: ${parseInt(result, 16)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get transaction count: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );


    // Alchemy: Estimate gas
    server.tool(
      "estimate-gas",
      "Estimate gas for a transaction using Alchemy API",
      {
        from: z.string().optional().describe("20 Bytes - The address the transaction is sent from"),
        to: z.string().describe("20 Bytes - The address the transaction is directed to"),
        gas: z.string().optional().describe("Integer of gas provided for transaction execution (hex)"),
        gasPrice: z.string().optional().describe("Integer of gasPrice used for each paid gas (hex)"),
        value: z.string().optional().describe("Integer of value sent with transaction (hex)"),
        data: z.string().optional().describe("Hash of method signature and encoded parameters"),
        blockParameter: z.string().optional().describe("Block number (hex) or tag (latest, earliest, pending)"),
      },
      async ({ from, to, gas, gasPrice, value, data, blockParameter = "latest" }: {
        from?: string;
        to: string;
        gas?: string;
        gasPrice?: string;
        value?: string;
        data?: string;
        blockParameter?: string;
      }) => {
        try {
          const params = [{
            ...(from && { from }),
            to,
            ...(gas && { gas }),
            ...(gasPrice && { gasPrice }),
            ...(value && { value }),
            ...(data && { data }),
          }, blockParameter];

          const result = await alchemyRequest("eth_estimateGas", params);
          return {
            content: [
              {
                type: "text",
                text: `Estimated gas: ${parseInt(result, 16)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to estimate gas: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // Alchemy: Get gas price
    server.tool(
      "get-gas-price",
      "Get the current gas price in wei using Alchemy API",
      {
        random_string: z.string().describe("Dummy parameter for no-parameter tools"),
      },
      async () => {
        try {
          const result = await alchemyRequest("eth_gasPrice");
          const gasPriceInWei = BigInt(result);
          const gasPriceInGwei = Number(gasPriceInWei) / 1e9;
          return {
            content: [
              {
                type: "text",
                text: `Current gas price: ${gasPriceInGwei} Gwei (${result} wei)`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get gas price: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );


    // Alchemy: Get max priority fee
    server.tool(
      "get-max-priority-fee",
      "Get the estimated priority fee per gas using Alchemy API",
      {
        random_string: z.string().describe("Dummy parameter for no-parameter tools"),
      },
      async () => {
        try {
          const result = await alchemyRequest("eth_maxPriorityFeePerGas");
          const priorityFeeInWei = BigInt(result);
          const priorityFeeInGwei = Number(priorityFeeInWei) / 1e9;
          return {
            content: [
              {
                type: "text",
                text: `Max priority fee: ${priorityFeeInGwei} Gwei (${result} wei)`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get max priority fee: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    

    // Magic Eden: Get collections
    server.tool(
      "get-magiceden-collections",
      "Get Magic Eden collections metadata and statistics",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        id: z.string().optional().describe("Filter to a particular collection with collection id"),
        slug: z.string().optional().describe("Filter to a particular collection slug"),
        collectionsSetId: z.string().optional().describe("Filter to a particular collection set"),
        community: z.string().optional().describe("Filter to a particular community"),
        contract: z.array(z.string()).optional().describe("Filter by contract addresses (max 20)"),
        creator: z.string().optional().describe("Filter by creator"),
        name: z.string().optional().describe("Search for collections that match a string"),
        maxFloorAskPrice: z.number().optional().describe("Maximum floor price of the collection"),
        minFloorAskPrice: z.number().optional().describe("Minimum floor price of the collection"),
        includeAttributes: z.boolean().optional().describe("If true, attributes will be included in the response"),
        includeSalesCount: z.boolean().optional().describe("If true, sales count will be included in the response"),
        includeMintStages: z.boolean().optional().describe("If true, mint data for the collection will be included in the response"),
        includeSecurityConfigs: z.boolean().optional().describe("If true, security configuration data will be included in the response"),
        normalizeRoyalties: z.boolean().optional().describe("If true, prices will include missing royalties to be added on-top"),
        useNonFlaggedFloorAsk: z.boolean().optional().describe("If true, return the non flagged floor ask"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        sortDirection: z.string().optional().describe("Sort direction"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        startTimestamp: z.number().optional().describe("Start timestamp for filtering"),
        endTimestamp: z.number().optional().describe("End timestamp for filtering"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              value.forEach((v) => query.append(key, v));
            } else {
              query.append(key, value.toString());
            }
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/collections/v7?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get trending collections
    server.tool(
      "get-magiceden-trending-collections",
      "Get Magic Eden top selling and minting collections",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        period: z.string().optional().describe("Time window to aggregate (e.g., 1d)"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        normalizeRoyalties: z.boolean().optional().describe("If true, prices will include missing royalties to be added on-top"),
        useNonFlaggedFloorAsk: z.boolean().optional().describe("If true, return the non flagged floor ask"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query.append(key, value.toString());
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/collections/trending/v1?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get user collections
    server.tool(
      "get-magiceden-user-collections",
      "Get Magic Eden aggregate stats for a user, grouped by collection",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        user: z.string().describe("User address"),
        community: z.string().optional().describe("Filter to a particular community"),
        collectionsSetId: z.string().optional().describe("Filter to a particular collection set"),
        collection: z.string().optional().describe("Filter to a particular collection with collection-id"),
        includeTopBid: z.boolean().optional().describe("If true, top bid will be returned in the response"),
        includeLiquidCount: z.boolean().optional().describe("If true, liquid count will be returned in the response"),
        offset: z.number().optional().describe("Offset for pagination"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        types: z.array(z.string()).optional().describe("Types to filter"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              value.forEach((v) => query.append(key, v));
            } else {
              query.append(key, value.toString());
            }
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/users/${params.user}/collections/v3?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get token activity
    server.tool(
      "get-magiceden-token-activity",
      "Get Magic Eden token activity feed (sales, asks, transfers, etc)",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        token: z.string().describe("Token id (e.g., 0x...:123)"),
        limit: z.number().optional().describe("Amount of items returned"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        includeMetadata: z.boolean().optional().describe("If true, metadata is included in the response"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
        types: z.array(z.string()).optional().describe("Types to filter"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              value.forEach((v) => query.append(key, v));
            } else {
              query.append(key, value.toString());
            }
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/tokens/${params.token}/activity/v5?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get all attributes for a collection
    server.tool(
      "get-magiceden-collection-attributes",
      "Get all possible attributes within a Magic Eden collection",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        collection: z.string().describe("Collection id"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query.append(key, value.toString());
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/collections/${params.collection}/attributes/all/v4?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    

    // Magic Eden: Get tokens
    server.tool(
      "get-magiceden-tokens",
      "Get Magic Eden tokens (by collection, user, or token id)",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        collection: z.string().optional().describe("Filter to a particular collection with collection-id"),
        user: z.string().optional().describe("Filter to a particular user address"),
        token: z.string().optional().describe("Filter to a particular token (contract:tokenId)"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        sortDirection: z.string().optional().describe("Sort direction"),
        includeAttributes: z.boolean().optional().describe("If true, attributes will be returned in the response"),
        includeLastSale: z.boolean().optional().describe("If true, last sale data will be returned in the response"),
        includeRawData: z.boolean().optional().describe("If true, raw data is included in the response"),
        filterSpamTokens: z.boolean().optional().describe("If true, will filter any tokens marked as spam"),
        useNonFlaggedFloorAsk: z.boolean().optional().describe("If true, will return the collection non flagged floor ask"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query.append(key, value.toString());
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/tokens/v3?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get asks (listings)
    server.tool(
      "get-magiceden-asks",
      "Get Magic Eden asks (listings)",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        token: z.string().optional().describe("Filter to a particular token (contract:tokenId)"),
        collection: z.string().optional().describe("Filter to a particular collection with collection-id"),
        maker: z.string().optional().describe("Filter to a particular user address"),
        status: z.string().optional().describe("Status of the order (active, inactive, expired, cancelled, filled, any)"),
        includeCriteriaMetadata: z.boolean().optional().describe("If true, criteria metadata is included in the response"),
        includeRawData: z.boolean().optional().describe("If true, raw data is included in the response"),
        includeDynamicPricing: z.boolean().optional().describe("If true, dynamic pricing data will be returned in the response"),
        excludeEOA: z.boolean().optional().describe("Exclude orders that can only be filled by EOAs"),
        normalizeRoyalties: z.boolean().optional().describe("If true, prices will include missing royalties to be added on-top"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        sortDirection: z.string().optional().describe("Sort direction"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query.append(key, value.toString());
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/orders/asks/v5?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get bids (offers)
    server.tool(
      "get-magiceden-bids",
      "Get Magic Eden bids (offers)",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        token: z.string().optional().describe("Filter to a particular token (contract:tokenId)"),
        collection: z.string().optional().describe("Filter to a particular collection with collection-id"),
        maker: z.string().optional().describe("Filter to a particular user address"),
        status: z.string().optional().describe("Status of the order (active, inactive, expired, cancelled, filled, any)"),
        includeCriteriaMetadata: z.boolean().optional().describe("If true, criteria metadata is included in the response"),
        includeRawData: z.boolean().optional().describe("If true, raw data is included in the response"),
        includeDepth: z.boolean().optional().describe("If true, the depth of each order is included in the response"),
        excludeEOA: z.boolean().optional().describe("Exclude orders that can only be filled by EOAs"),
        normalizeRoyalties: z.boolean().optional().describe("If true, prices will include missing royalties to be added on-top"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        sortDirection: z.string().optional().describe("Sort direction"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query.append(key, value.toString());
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/orders/bids/v6?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    // Magic Eden: Get user activity
    server.tool(
      "get-magiceden-user-activity",
      "Get Magic Eden user activity feed (sales, asks, transfers, etc)",
      {
        chain: z.string().describe("The blockchain chain (e.g., monad-testnet)"),
        users: z.array(z.string()).describe("Array of user addresses"),
        collection: z.array(z.string()).optional().describe("Filter to a particular collection(s)"),
        collectionsSetId: z.string().optional().describe("Filter to a particular collection set"),
        contractsSetId: z.string().optional().describe("Filter to a particular contracts set"),
        community: z.string().optional().describe("Filter to a particular community"),
        limit: z.number().optional().describe("Amount of items returned in response"),
        sortBy: z.string().optional().describe("Order the items are returned in the response"),
        includeMetadata: z.boolean().optional().describe("If true, metadata is included in the response"),
        continuation: z.string().optional().describe("Continuation token for pagination"),
        types: z.array(z.string()).optional().describe("Types to filter"),
        displayCurrency: z.string().optional().describe("Return result in given currency"),
      },
      async (params: any) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              value.forEach((v) => query.append(key, v));
            } else {
              query.append(key, value.toString());
            }
          }
        });
        const url = `https://api-mainnet.magiceden.dev/v3/rtp/${params.chain}/users/activity/v6?${query.toString()}`;
        const response = await fetch(url, {
          headers: { Authorization: MAGIC_EDEN_API_KEY },
        });
        const data = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );


    // BlockVision: Get account transactions
    server.tool(
      "get-blockvision-account-transactions",
      "Get all transactions for an address using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for transactions"),
        limit: z.number().optional().describe("Max results per page (default 20, max 50)"),
        ascendingOrder: z.boolean().optional().describe("Order ascending (default false)"),
        cursor: z.string().optional().describe("Next page cursor"),
      },
      async ({ address, limit = 20, ascendingOrder = false, cursor }: { address: string; limit?: number; ascendingOrder?: boolean; cursor?: string }) => {
        try {
          const result = await getBlockvisionAccountTransactions(address, limit, ascendingOrder, cursor);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision transactions: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get account internal transactions
    server.tool(
      "get-blockvision-account-internal-transactions",
      "Get all internal transactions for an address using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for internal transactions"),
        filter: z.string().optional().describe("Filter (all, in, out)"),
        limit: z.number().optional().describe("Max results per page (default 20, max 50)"),
        ascendingOrder: z.boolean().optional().describe("Order ascending (default false)"),
        cursor: z.string().optional().describe("Next page cursor"),
      },
      async ({ address, filter = 'all', limit = 20, ascendingOrder = false, cursor }: { address: string; filter?: string; limit?: number; ascendingOrder?: boolean; cursor?: string }) => {
        try {
          const result = await getBlockvisionAccountInternalTransactions(address, filter, limit, ascendingOrder, cursor);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision internal transactions: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get token activities
    server.tool(
      "get-blockvision-token-activities",
      "Get token activities for an address and token using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for token activities"),
        tokenAddress: z.string().describe("Token contract address"),
        limit: z.number().optional().describe("Max results per page (default 20, max 50)"),
        ascendingOrder: z.boolean().optional().describe("Order ascending (default false)"),
        cursor: z.string().optional().describe("Next page cursor"),
      },
      async ({ address, tokenAddress, limit = 20, ascendingOrder = false, cursor }: { address: string; tokenAddress: string; limit?: number; ascendingOrder?: boolean; cursor?: string }) => {
        try {
          const result = await getBlockvisionTokenActivities(address, tokenAddress, limit, ascendingOrder, cursor);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision token activities: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get collection activities
    server.tool(
      "get-blockvision-collection-activities",
      "Get collection activities for an address and collection using BlockVision API",
      {
        address: z.string().describe("Wallet address to check for collection activities"),
        collectionAddress: z.string().describe("Collection contract address"),
        limit: z.number().optional().describe("Max results per page (default 20, max 50)"),
        ascendingOrder: z.boolean().optional().describe("Order ascending (default false)"),
        cursor: z.string().optional().describe("Next page cursor"),
      },
      async ({ address, collectionAddress, limit = 20, ascendingOrder = false, cursor }: { address: string; collectionAddress: string; limit?: number; ascendingOrder?: boolean; cursor?: string }) => {
        try {
          const result = await getBlockvisionCollectionActivities(address, collectionAddress, limit, ascendingOrder, cursor);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision collection activities: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get token holders
    server.tool(
      "get-blockvision-token-holders",
      "Get token holders for a contract using BlockVision API",
      {
        contractAddress: z.string().describe("Token contract address"),
        pageIndex: z.number().optional().describe("Page number (default 1)"),
        pageSize: z.number().optional().describe("Page size (default 20)"),
      },
      async ({ contractAddress, pageIndex = 1, pageSize = 20 }: { contractAddress: string; pageIndex?: number; pageSize?: number }) => {
        try {
          const result = await getBlockvisionTokenHolders(contractAddress, pageIndex, pageSize);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision token holders: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get native holders
    server.tool(
      "get-blockvision-native-holders",
      "Get native token holders using BlockVision API",
      {
        pageIndex: z.number().optional().describe("Page number (default 1)"),
        pageSize: z.number().optional().describe("Page size (default 20)"),
      },
      async ({ pageIndex = 1, pageSize = 20 }: { pageIndex?: number; pageSize?: number }) => {
        try {
          const result = await getBlockvisionNativeHolders(pageIndex, pageSize);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision native holders: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get collection holders
    server.tool(
      "get-blockvision-collection-holders",
      "Get collection holders for a contract using BlockVision API",
      {
        contractAddress: z.string().describe("Collection contract address"),
        pageIndex: z.number().optional().describe("Page number (default 1)"),
        pageSize: z.number().optional().describe("Page size (default 20)"),
      },
      async ({ contractAddress, pageIndex = 1, pageSize = 20 }: { contractAddress: string; pageIndex?: number; pageSize?: number }) => {
        try {
          const result = await getBlockvisionCollectionHolders(contractAddress, pageIndex, pageSize);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision collection holders: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get contract source code
    server.tool(
      "get-blockvision-contract-source-code",
      "Get contract source code using BlockVision API",
      {
        address: z.string().describe("Contract address to get source code for"),
      },
      async ({ address }: { address: string }) => {
        try {
          const result = await getBlockvisionContractSourceCode(address);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision contract source code: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );

    // BlockVision: Get token gating
    server.tool(
      "get-blockvision-token-gating",
      "Get token gating info using BlockVision API",
      {
        account: z.string().describe("Account address to check gating for"),
        contractAddress: z.string().describe("Token contract address"),
      },
      async ({ account, contractAddress }: { account: string; contractAddress: string }) => {
        try {
          const result = await getBlockvisionTokenGating(account, contractAddress);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Failed to get BlockVision token gating: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );
  }
);

// Alchemy API Configuration
const ALCHEMY_API_URL = getEnvVar('ALCHEMY_API_URL');

// Alchemy API Helper Functions
interface AlchemyResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

async function alchemyRequest(method: string, params: any[] = []) {
  const response = await fetch(ALCHEMY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Alchemy API request failed: ${response.statusText}`);
  }

  const data = await response.json() as AlchemyResponse;
  if (data.error) {
    throw new Error(`Alchemy API error: ${data.error.message}`);
  }

  return data.result;
}

const MAGIC_EDEN_API_KEY = getEnvVar('MAGIC_EDEN_API_KEY');

// BlockVision: Retrieve Account Transactions
async function getBlockvisionAccountTransactions(address: string, limit: number = 20, ascendingOrder: boolean = false, cursor?: string): Promise<any> {
  let url = `${BLOCKVISION_API_BASE}/account/transactions?address=${address}&limit=${limit}&ascendingOrder=${ascendingOrder}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Account Transactions error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Account Internal Transactions
async function getBlockvisionAccountInternalTransactions(address: string, filter: string = 'all', limit: number = 20, ascendingOrder: boolean = false, cursor?: string): Promise<any> {
  let url = `${BLOCKVISION_API_BASE}/account/internal/transactions?address=${address}&filter=${filter}&limit=${limit}&ascendingOrder=${ascendingOrder}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Account Internal Transactions error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Token Activities
async function getBlockvisionTokenActivities(address: string, tokenAddress: string, limit: number = 20, ascendingOrder: boolean = false, cursor?: string): Promise<any> {
  let url = `${BLOCKVISION_API_BASE}/token/activities?address=${address}&tokenAddress=${tokenAddress}&limit=${limit}&ascendingOrder=${ascendingOrder}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Token Activities error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Collection Activities
async function getBlockvisionCollectionActivities(address: string, collectionAddress: string, limit: number = 20, ascendingOrder: boolean = false, cursor?: string): Promise<any> {
  let url = `${BLOCKVISION_API_BASE}/collection/activities?address=${address}&collectionAddress=${collectionAddress}&limit=${limit}&ascendingOrder=${ascendingOrder}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Collection Activities error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Token Holders
async function getBlockvisionTokenHolders(contractAddress: string, pageIndex: number = 1, pageSize: number = 20): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/token/holders?contractAddress=${contractAddress}&pageIndex=${pageIndex}&pageSize=${pageSize}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Token Holders error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Native Holders
async function getBlockvisionNativeHolders(pageIndex: number = 1, pageSize: number = 20): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/native/holders?pageIndex=${pageIndex}&pageSize=${pageSize}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Native Holders error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Collection Holders
async function getBlockvisionCollectionHolders(contractAddress: string, pageIndex: number = 1, pageSize: number = 20): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/collection/holders?contractAddress=${contractAddress}&pageIndex=${pageIndex}&pageSize=${pageSize}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Collection Holders error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Contract Source Code
async function getBlockvisionContractSourceCode(address: string): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/contract/source/code?address=${address}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Contract Source Code error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// BlockVision: Retrieve Token Gating
async function getBlockvisionTokenGating(account: string, contractAddress: string): Promise<any> {
  const url = `${BLOCKVISION_API_BASE}/token/gating?account=${account}&contractAddress=${contractAddress}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Api-Key': BLOCKVISION_API_KEY,
    },
  });
  if (!response.ok) {
    throw new Error(`BlockVision Token Gating error: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}