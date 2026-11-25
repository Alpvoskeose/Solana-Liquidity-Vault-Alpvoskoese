import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createAccount,
  createMint,
  getAccount,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { assert } from "chai";
import { LiquidityVault } from "../target/types/liquidity_vault";

describe("liquidity_vault week 08", () => {
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed"),
    env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.LiquidityVault as Program<LiquidityVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  let tokenMint: PublicKey;
  let vaultState: PublicKey;
  let vaultTokenAccount: PublicKey;
  let shareMint: PublicKey;

  async function expectFailure(action: () => Promise<unknown>): Promise<void> {
    let failed = false;
    try {
      await action();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "expected the operation to fail");
  }

  async function fundUser(user: Keypair): Promise<void> {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: user.publicKey,
        lamports: 100_000_000,
      }),
    );
    await provider.sendAndConfirm(transaction, [admin]);
  }

  before(async () => {
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6,
    );
    [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId,
    );
    [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId,
    );
    [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId,
    );
  });

  it("initializes vault, share mint, and token account with correct authorities and zero balances", async () => {
    await program.methods
      .initializeVault()
      .accountsPartial({
        vaultState,
        vaultTokenAccount,
        shareMint,
        tokenMint,
        admin: admin.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const vault = await program.account.vaultState.fetch(vaultState);
    const mint = await getMint(provider.connection, shareMint);
    const tokenAccount = await getAccount(provider.connection, vaultTokenAccount);

    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.vaultTokenAccount.toBase58(), vaultTokenAccount.toBase58());
    assert.equal(vault.shareMint.toBase58(), shareMint.toBase58());
    assert.equal(vault.totalTokens.toString(), "0");
    assert.equal(vault.totalShares.toString(), "0");
    assert.equal(vault.bump, PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId,
    )[1]);

    assert.equal(mint.decimals, 6);
    assert.equal(mint.mintAuthority?.toBase58(), vaultState.toBase58());
    assert.equal(mint.supply, 0n);
    assert.equal(tokenAccount.mint.toBase58(), tokenMint.toBase58());
    assert.equal(tokenAccount.owner.toBase58(), vaultState.toBase58());
    assert.equal(tokenAccount.amount, 0n);
  });

  it("creates distinct zeroed user cards for two signing users", async () => {
    const userA = Keypair.generate();
    const userB = Keypair.generate();
    await fundUser(userA);
    await fundUser(userB);

    const [cardA] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultState.toBuffer(), userA.publicKey.toBuffer()],
      program.programId,
    );
    const [cardB] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultState.toBuffer(), userB.publicKey.toBuffer()],
      program.programId,
    );
    assert.notEqual(cardA.toBase58(), cardB.toBase58());

    for (const [user, card] of [[userA, cardA], [userB, cardB]] as const) {
      await program.methods
        .createUserCard()
        .accountsPartial({
          vaultState,
          userCard: card,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const state = await program.account.userCard.fetch(card);
      assert.equal(state.vault.toBase58(), vaultState.toBase58());
      assert.equal(state.owner.toBase58(), user.publicKey.toBase58());
      assert.equal(state.deposited.toString(), "0");
      assert.equal(state.shares.toString(), "0");
      assert.equal(state.bump, PublicKey.findProgramAddressSync(
        [Buffer.from("user_card"), vaultState.toBuffer(), user.publicKey.toBuffer()],
        program.programId,
      )[1]);
    }
  });

  it("rejects a second card for the same user", async () => {
    const user = Keypair.generate();
    await fundUser(user);
    const [userCard] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultState.toBuffer(), user.publicKey.toBuffer()],
      program.programId,
    );
    const accounts = {
      vaultState,
      userCard,
      user: user.publicKey,
      systemProgram: SystemProgram.programId,
    };

    await program.methods
      .createUserCard()
      .accountsPartial(accounts)
      .signers([user])
      .rpc();
    await expectFailure(() =>
      program.methods
        .createUserCard()
        .accountsPartial(accounts)
        .signers([user])
        .rpc(),
    );

    const impersonator = Keypair.generate();
    const victim = Keypair.generate();
    const [victimCard] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultState.toBuffer(), victim.publicKey.toBuffer()],
      program.programId,
    );
    await expectFailure(() =>
      program.methods
        .createUserCard()
        .accountsPartial({
          vaultState,
          userCard: victimCard,
          user: victim.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([impersonator])
        .rpc(),
    );
  });

  it("rejects repeat vault initialization and substituted PDA accounts", async () => {
    await expectFailure(() =>
      program.methods
        .initializeVault()
        .accountsPartial({
          vaultState,
          vaultTokenAccount,
          shareMint,
          tokenMint,
          admin: admin.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );

    const wrongPda = Keypair.generate().publicKey;
    await expectFailure(() =>
      program.methods
        .initializeVault()
        .accountsPartial({
          vaultState: wrongPda,
          vaultTokenAccount,
          shareMint,
          tokenMint,
          admin: admin.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );

    const user = Keypair.generate();
    await fundUser(user);
    const [userCard] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultState.toBuffer(), user.publicKey.toBuffer()],
      program.programId,
    );
    await expectFailure(() =>
      program.methods
        .createUserCard()
        .accountsPartial({
          vaultState: wrongPda,
          userCard,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc(),
    );
  });

  it("does not allow the admin to mint shares directly", async () => {
    const userTokenAccount = await createAccount(
      provider.connection,
      admin,
      shareMint,
      admin.publicKey,
    );

    await expectFailure(() =>
      mintTo(
        provider.connection,
        admin,
        shareMint,
        userTokenAccount,
        admin,
        1,
      ),
    );
  });
});
