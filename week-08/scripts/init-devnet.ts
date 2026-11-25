import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createInitializeMintInstruction,
  getAccount,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { strict as assert } from "node:assert";
import { LiquidityVault } from "../target/types/liquidity_vault";

async function main(): Promise<void> {
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed"),
    env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.LiquidityVault as Program<LiquidityVault>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const connection = provider.connection;

  assert.match(connection.rpcEndpoint, /devnet/i, "RPC endpoint must be devnet");
  const balance = await connection.getBalance(payer.publicKey, "confirmed");
  assert.ok(balance > 0, "test wallet needs devnet SOL for rent and transaction fees");

  const tokenMint = anchor.web3.Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const createMintTransaction = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenMint.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      tokenMint.publicKey,
      6,
      payer.publicKey,
      null,
      TOKEN_PROGRAM_ID,
    ),
  );
  const mintSignature = await provider.sendAndConfirm(createMintTransaction, [tokenMint]);

  const [vaultState] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.publicKey.toBuffer()],
    program.programId,
  );
  const [vaultTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tokens"), tokenMint.publicKey.toBuffer()],
    program.programId,
  );
  const [shareMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), tokenMint.publicKey.toBuffer()],
    program.programId,
  );

  const initializeSignature = await program.methods
    .initializeVault()
    .accountsPartial({
      vaultState,
      vaultTokenAccount,
      shareMint,
      tokenMint: tokenMint.publicKey,
      admin: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  const [userCard] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), payer.publicKey.toBuffer()],
    program.programId,
  );
  const cardSignature = await program.methods
    .createUserCard()
    .accountsPartial({
      vaultState,
      userCard,
      user: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const vault = await program.account.vaultState.fetch(vaultState, "confirmed");
  const card = await program.account.userCard.fetch(userCard, "confirmed");
  const shareMintData = await getMint(connection, shareMint, "confirmed");
  const tokenAccountData = await getAccount(
    connection,
    vaultTokenAccount,
    "confirmed",
  );

  assert.equal(vault.admin.toBase58(), payer.publicKey.toBase58());
  assert.equal(vault.tokenMint.toBase58(), tokenMint.publicKey.toBase58());
  assert.equal(vault.shareMint.toBase58(), shareMint.toBase58());
  assert.equal(card.owner.toBase58(), payer.publicKey.toBase58());
  assert.equal(card.vault.toBase58(), vaultState.toBase58());
  assert.equal(shareMintData.mintAuthority?.toBase58(), vaultState.toBase58());
  assert.equal(shareMintData.supply, 0n);
  assert.equal(tokenAccountData.owner.toBase58(), vaultState.toBase58());
  assert.equal(tokenAccountData.amount, 0n);

  const addressLink = (address: string) =>
    `https://explorer.solana.com/address/${address}?cluster=devnet`;
  const transactionLink = (signature: string) =>
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

  console.log(
    JSON.stringify(
      {
        cluster: "devnet",
        programId: program.programId.toBase58(),
        admin: payer.publicKey.toBase58(),
        tokenMint: tokenMint.publicKey.toBase58(),
        vaultState: vaultState.toBase58(),
        shareMint: shareMint.toBase58(),
        vaultTokenAccount: vaultTokenAccount.toBase58(),
        userCard: userCard.toBase58(),
        addresses: {
          tokenMint: addressLink(tokenMint.publicKey.toBase58()),
          vaultState: addressLink(vaultState.toBase58()),
          shareMint: addressLink(shareMint.toBase58()),
          vaultTokenAccount: addressLink(vaultTokenAccount.toBase58()),
          userCard: addressLink(userCard.toBase58()),
        },
        confirmedTransactions: {
          tokenMint: { signature: mintSignature, url: transactionLink(mintSignature) },
          initializeVault: {
            signature: initializeSignature,
            url: transactionLink(initializeSignature),
          },
          createUserCard: { signature: cardSignature, url: transactionLink(cardSignature) },
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error("Devnet initialization failed:", error);
  process.exitCode = 1;
});
