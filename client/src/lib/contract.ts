export const BRIDGE_CONTRACT_ADDRESS = '0xa4fac7a16d43f53adf0870001ccec603155eacdd';
export const BRIDGE_OUT_ADDRESS = '0x8c6cEf00ec5bB62Be675E472BA900BE24A2D32e8';

export const BRIDGE_CONTRACT_ABI = [
  {
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'paused',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nonce',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'destinationChainId', type: 'uint256' },
      { indexed: false, name: 'nonce', type: 'uint256' },
      { indexed: false, name: 'timestamp', type: 'uint256' },
    ],
    name: 'DepositRequested',
    type: 'event',
  },
] as const;

export const BASE_CHAIN_ID = 8453;
export const MEGAETH_CHAIN_ID = 4326;

export const MIN_DEPOSIT = '0';
export const MAX_DEPOSIT = '100';
