# Liquidity Vault — Week 08

Учебный проект Solana: безопасный каркас vault и персональных карточек пользователей. Проект этой недели самостоятелен и находится в `week-08/`.

## Цель

Liquidity Vault в следующих неделях будет хранить токены пользователей и выпускать share-токены, учитывающие их доли. На неделе 08 создаются только базовые аккаунты и инструкции — токены пользователей пока не принимаются.

## Реализовано

- `initialize_vault`: создаёт PDA состояния vault, SPL mint для будущих shares и SPL token account для принимаемого mint.
- `create_user_card`: создаёт одну PDA-карточку для подписавшего транзакцию пользователя.
- Числовые поля учета и балансы начинаются с нуля.
- Anchor constraints проверяют seeds, bump, mint, token authority и подпись пользователя.

В этой версии нет депозитов, выпуска shares, снятия средств, комиссий или взаимодействия с Raydium. Программа не имеет административной инструкции для выпуска shares или перемещения токенов.

## Технологии и версии

| Инструмент | Версия |
|---|---|
| Ubuntu | 24.04 LTS |
| Архитектура | x86_64 |
| Rust / Cargo | 1.100.0 |
| Solana CLI | 2.1.0 |
| Anchor CLI / `anchor-lang` / `anchor-spl` | 0.31.1 |
| AVM | 1.2.2 |
| SBF platform-tools / bundled Rust | 1.51.1 / 1.84.1-dev |
| Node.js / npm | 24.22.2 / 11.19.1 |
| Yarn | 1.22.22 |
| TypeScript | 5.3.3 |
| SPL Token JS SDK | 0.4.9 |

Версии Anchor выбраны по проекту преподавателя. Его README указывает Solana CLI 1.18+, но не закрепляет конкретную версию; здесь установлен и проверен Solana CLI 2.1.0, а `anchor test` успешно запускал с ним local validator. Для SBF-сборки Anchor отдельно установил platform-tools 1.51.1. TypeScript и SPL Token SDK закреплены в `package.json`, Rust-зависимости — в `Cargo.lock`.

SBF builder использует собственный Rust 1.84.1-dev, поэтому Cargo.lock сохраняет совместимые версии транзитивных crates. Прямые pins `blake3` и `constant_time_eq` повторяют обоснование из manifest преподавателя и не добавляют функциональность программы.

## Архитектура аккаунтов и PDA

| Аккаунт | Seeds | Владелец аккаунта Solana | Полномочия / данные |
|---|---|---|---|
| `VaultState` | `["vault", token_mint]` | программа | admin, mint-ы, адрес token account, нулевые totals и bump |
| Vault token account | `["vault_tokens", token_mint]` | SPL Token Program | mint равен `token_mint`; внутренний token authority — PDA `VaultState` |
| Share mint | `["share_mint", token_mint]` | SPL Token Program | decimals = 6; mint authority — PDA `VaultState`; supply = 0 |
| `UserCard` | `["user_card", vault_state, user]` | программа | vault, владелец, deposited = 0, shares = 0 и bump |

`VaultState::LEN` включает 8 байт Anchor discriminator: `8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 = 153` байта. `UserCard::LEN`: `8 + 32 + 32 + 8 + 8 + 1 = 89` байт.

SPL token account принадлежит Token Program на уровне аккаунта Solana, но его внутреннее поле `owner` (token authority) указывает на PDA vault. У PDA нет приватного ключа: только программа может подписать CPI от имени PDA с корректными seeds. Поэтому администратор не может подписать перевод или mint shares своей обычной подписью. В этой неделе соответствующие инструкции перевода и mint вообще не реализованы.

## Инструкции

### `initialize_vault`

Администратор подписывает транзакцию и оплачивает rent. Создаются все три аккаунта. `token_mint` должен быть существующим SPL Mint. Seeds однозначно задают адреса относительно этого mint, поэтому повторная инициализация того же vault и подмена PDA отклоняются. Mint shares фиксирован на 6 decimals, его supply при создании равен нулю.

### `create_user_card`

Пользователь подписывает транзакцию и оплачивает собственную карточку. `vault_state` проверяется как PDA, а карточка выводится из seeds vault и подписавшегося пользователя. Для пары (vault, user) существует только один адрес, поэтому повторный `init` отклоняется. Карточка не может быть создана для чужого пользователя без его подписи.

## Схема

```mermaid
flowchart LR
    Admin[Администратор] -->|initialize_vault| Program[Solana-программа]
    User[Подписавший пользователь] -->|create_user_card| Program
    Program --> Vault[VaultState PDA]
    Program --> ShareMint[Share Mint<br/>authority: Vault PDA]
    Program --> TokenAccount[Vault Token Account<br/>token authority: Vault PDA]
    Program --> Card[UserCard PDA<br/>vault + user]
    TokenMint[Принимаемый SPL Mint] --> TokenAccount
    Vault --> ShareMint
    Vault --> TokenAccount
    Vault --> Card
```

## Подготовка окружения

На Ubuntu/Codespaces установите Rust stable, Solana CLI 2.1.0 и Anchor CLI 0.31.1 через AVM:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.0/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.31.1
avm use 0.31.1
```

Для SBF-сборки Anchor загрузит совместимые platform-tools. Затем из этой папки установите JS-зависимости:

```bash
cd week-08
corepack yarn@1.22.22 install --frozen-lockfile
```

Первый `yarn install` создаёт и фиксирует `yarn.lock`. Не добавляйте `target/`, `node_modules/`, `.anchor/` или wallet keypair в Git.

## Сборка и тестирование

```bash
cd week-08
anchor build
anchor test
```

`anchor test` поднимает локальный validator, деплоит программу в localnet и запускает TypeScript-интеграционные тесты. В тестах создаются настоящий тестовый SPL Mint и аккаунты; они проверяют состояние vault и mint-ов, права, PDA-карточки, повторное создание и неавторизованный выпуск shares.

Проверка в Codespaces (2026-11-25): `yarn tsc --noEmit` и `cargo check --locked` завершились успешно; Rust-проверка выдала три предупреждения Anchor 0.31.1. `anchor test --skip-build` завершился успешно: **5 passing, 0 failing**. Тесты использовали существующий `target/deploy/liquidity_vault.so`; SBF-сборка в этой проверке не запускалась.

## Devnet

Используйте только отдельный тестовый keypair. В текущем Codespace его публичный адрес:

`8e4137ux92gPoVgbAhx3kSYiaG927NWeuj5BDfXinfSF`

Приватный keypair находится вне репозитория в `~/.config/solana/id.json`. Не копируйте его в проект и не публикуйте. Убедитесь, что на этом пути нет чужого ключа, прежде чем создавать собственный кошелёк на другой машине.

После успешных localnet-тестов:

```bash
cd week-08
solana config set --url devnet
solana balance
anchor deploy --provider.cluster devnet
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
  corepack yarn@1.22.22 init:devnet
```

Для нехватки тестовых SOL используйте официальный faucet или один ограниченный запрос, например `solana airdrop 2`. Не повторяйте запросы при rate limit. `scripts/init-devnet.ts` создаёт отдельный тестовый mint, инициализирует vault и карточку, затем перечитывает данные и печатает подтверждённые подписи и Explorer-ссылки. Program ID, появление которого в конфигурации не подтверждает деплой, проверяется отдельно командой:

```bash
solana program show 4sPijvz6HPcDKjFx8BWZEomVy5G3N1oJpeZXMCtPL2qs --url devnet
```

### Результаты Devnet (2026-11-25)

Деплой программы, создание тестового mint, инициализация vault и создание карточки пользователя завершены. Все четыре транзакции проверены командой `solana confirm` и имеют статус **Finalized**. Скрипт инициализации перечитал аккаунты из Devnet и подтвердил их ожидаемые адреса, полномочия и нулевые балансы. После операций остаток кошелька — **1.09219812 SOL**.

| Сущность | Адрес / состояние |
|---|---|
| Тестовый кошелёк (admin / upgrade authority) | [8e4137ux92gPoVgbAhx3kSYiaG927NWeuj5BDfXinfSF](https://explorer.solana.com/address/8e4137ux92gPoVgbAhx3kSYiaG927NWeuj5BDfXinfSF?cluster=devnet) |
| Program ID | [4sPijvz6HPcDKjFx8BWZEomVy5G3N1oJpeZXMCtPL2qs](https://explorer.solana.com/address/4sPijvz6HPcDKjFx8BWZEomVy5G3N1oJpeZXMCtPL2qs?cluster=devnet) |
| ProgramData | [9dPKWs519gdSUzaii71wPSykqLxEtrsrrBgPXxcTJWBv](https://explorer.solana.com/address/9dPKWs519gdSUzaii71wPSykqLxEtrsrrBgPXxcTJWBv?cluster=devnet) |
| Token Mint | [3furDzWi5zE7v34NvWv7vJk2gnqqEe6UWf6LEXr9mGQ1](https://explorer.solana.com/address/3furDzWi5zE7v34NvWv7vJk2gnqqEe6UWf6LEXr9mGQ1?cluster=devnet) |
| Vault State | [9R3GsMgsSmt1kowJKFiWuCG5DgpzTLyCpimJmW4e2V2w](https://explorer.solana.com/address/9R3GsMgsSmt1kowJKFiWuCG5DgpzTLyCpimJmW4e2V2w?cluster=devnet) |
| Share Mint | [BzHqsRh8Pb56NvLioKrjsyLKWZGTw3qvtXVPCKxGbkv8](https://explorer.solana.com/address/BzHqsRh8Pb56NvLioKrjsyLKWZGTw3qvtXVPCKxGbkv8?cluster=devnet) |
| Vault Token Account | [9de1NTjekiTcQrX2Frt8N6HBZssSVW4C52DnVALEc53H](https://explorer.solana.com/address/9de1NTjekiTcQrX2Frt8N6HBZssSVW4C52DnVALEc53H?cluster=devnet) |
| User Card | [BUJ3zqKCuSyJLkZnmxSH3esX4cHRP7GYgozBsRTZpZh9](https://explorer.solana.com/address/BUJ3zqKCuSyJLkZnmxSH3esX4cHRP7GYgozBsRTZpZh9?cluster=devnet) |

| Операция | Подтверждённая транзакция |
|---|---|
| Деплой программы | [4P9FYbc3MynmNBdBwzFVBxyhNaEaMzPq5F5GNsVUiS68zji3w95icPCjj2cLECQbGso2m53SDRxAcHbruDxdiMrQ](https://explorer.solana.com/tx/4P9FYbc3MynmNBdBwzFVBxyhNaEaMzPq5F5GNsVUiS68zji3w95icPCjj2cLECQbGso2m53SDRxAcHbruDxdiMrQ?cluster=devnet) |
| Создание Token Mint | [2n2Q7LDCpU9YCYaXp6C8CMgrdFVamxEFHdnMPbPFaLZbHTkRsZ1NtEA8B9p8aQUZHwg23okdpmxUqjERambNgTYu](https://explorer.solana.com/tx/2n2Q7LDCpU9YCYaXp6C8CMgrdFVamxEFHdnMPbPFaLZbHTkRsZ1NtEA8B9p8aQUZHwg23okdpmxUqjERambNgTYu?cluster=devnet) |
| Инициализация Vault | [4UjKBNCd3e4C9jD7omHyEdVFhpP8L9aKQqwbMPFmE7epf11VWvWGYdj2e1BeChjATxgjQ5jJLrusg5EK4yNiE7TP](https://explorer.solana.com/tx/4UjKBNCd3e4C9jD7omHyEdVFhpP8L9aKQqwbMPFmE7epf11VWvWGYdj2e1BeChjATxgjQ5jJLrusg5EK4yNiE7TP?cluster=devnet) |
| Создание User Card | [2LmxjGdB5dJ9PfB1LUSKK7CocSm55RKpEQEB2ug2oLFkLyu23dHNJWsxqHSLMZa1bM6DDVPA3RLjZtq8Mdy79wpi](https://explorer.solana.com/tx/2LmxjGdB5dJ9PfB1LUSKK7CocSm55RKpEQEB2ug2oLFkLyu23dHNJWsxqHSLMZa1bM6DDVPA3RLjZtq8Mdy79wpi?cluster=devnet) |

## Ограничения

- Нет deposit, share minting для пользователей, withdraw, комиссий, pause/unpause и Raydium.
- Тесты localnet не заменяют подтверждение отдельного devnet deployment.
- Пользовательская карточка хранит только поля каркаса и пока не обновляется.

## Источники

- [Репозиторий курса: README и программа](https://github.com/0xnurda/vault-dev/tree/students-vault-card)
- [Solana Documentation](https://solana.com/docs)
- [Anchor Documentation](https://www.anchor-lang.com/docs)
- [Официальный Solana Faucet](https://faucet.solana.com/)
