# Double-Entry Bookkeeping & Ordnungsgemäße Buchführung — Data Layer

Scope: the **persistence layer only**. Schema, invariants, constraints, and the rules the store itself must enforce. No UI, no workflow, no report rendering, no tax-authority exports. Those live on top of this layer.

---

## 1. Core concept

Every business event is stored as a **journal entry (Buchung)** composed of **two or more lines**, where the sum of debits equals the sum of credits.

```
Σ debits == Σ credits    (per entry)
```

The ledger is always balanced because every entry is. This is a hard data-layer invariant, not a business rule.

### 1.1 Accounts

An **account (Konto)** is a numbered container that accumulates monetary movements. Fields:

- `number` — primary key, immutable
- `name`
- `type` — determines sign convention
- `normalSide` — `D` or `C`
- `isActive` — archived accounts reject new references

Account types:

| Type      | Normal side | Increases on |
|-----------|-------------|--------------|
| asset     | D           | D            |
| liability | C           | C            |
| equity    | C           | C            |
| revenue   | C           | C            |
| expense   | D           | D            |
| contra    | opposite of parent | opposite |

### 1.2 Journal entry (Buchungssatz)

Minimum fields:

- `id` — immutable, unique, monotonic, gap-free
- `bookingDate` (Buchungsdatum) — business date, determines the period
- `documentDate` (Belegdatum) — date on the source document
- `documentRef` (Belegnummer) — required; enforces "Keine Buchung ohne Beleg"
- `description` (Buchungstext)
- `lines[]` — two or more
- `status` — `posted` | `reversed`
- `createdAt`, `createdBy` — audit fields, immutable
- `reverses?`, `reversedBy?` — reversal linkage

Each **line (Buchungszeile)**:

- `accountNumber` — FK to `Account.number`
- `side` — `D` or `C`
- `amount` — positive integer, minor units
- optional: `taxCode`, `costCenter`, `currency`, `fxRate`

Per-entry invariants enforced in the store:

1. `Σ D.amount == Σ C.amount`
2. `lines.length >= 2`
3. All `amount > 0`
4. All referenced accounts exist and `isActive` at `bookingDate`
5. `bookingDate` falls in a period whose `status = 'open'`
6. `documentRef` is non-empty

### 1.3 Posting conventions

Pick one and enforce in the schema:

- **Sided**: `{side: 'D'|'C', amount: positive}` — recommended; matches "Soll an Haben" and keeps amounts non-negative.
- **Signed**: debits positive, credits negative; entry balanced when `Σ amount == 0`.

### 1.4 Money

- Store as **integer minor units** (cents) or fixed-precision decimal. **Never** floats.
- Each line carries a single currency; multi-currency entries store original + booking currency + fx rate per line.
- Rounding differences post to a dedicated account — the store must allow such an account to be configured, not silently drop fractions.

---

## 2. Ledger structure

### 2.1 Chart of accounts

- **Kontenrahmen** = template (SKR 03, SKR 04, IKR).
- **Kontenplan** = instantiated per company, potentially extended.
- Account numbers are typically 4 digits (SKR 03), extensible to 5–8.
- Once an account has been referenced by any posting, its `number` and `type` are **frozen**.

SKR 03 top-level ranges:

| Class | Range       | Meaning                                   |
|-------|-------------|-------------------------------------------|
| 0     | 0000–0999   | Fixed assets and capital accounts         |
| 1     | 1000–1999   | Financial and private accounts            |
| 2     | 2000–2999   | Accrual accounts                          |
| 3     | 3000–3999   | Goods receipt & stock                     |
| 4     | 4000–4999   | Operating expenses                        |
| 5–6   | 5000–6999   | Free (user-defined)                       |
| 7     | 7000–7999   | Inventories of products                   |
| 8     | 8000–8999   | Revenue                                   |
| 9     | 9000–9999   | Carryforward, capital, statistical        |
| —     | 10000–69999 | Accounts receivable (Debitoren)           |
| —     | 70000–99999 | Accounts payable (Kreditoren)             |

### 2.2 Sub-ledgers

- **Debitoren** (AR) — one account per customer, `10000–69999`
- **Kreditoren** (AP) — one account per supplier, `70000–99999`
- Each sub-ledger account has a `parentAccount` pointing to a general-ledger reconciliation account (e.g. `1400`, `1600`).

### 2.3 Opening balances

- A new fiscal year opens via **Saldovortrag** — entries that copy closing balances from year N into opening balances of year N+1.
- Balance-sheet accounts carry forward; P&L accounts reset to zero and their net result is posted to equity.
- SKR 03 uses the `9000` account family for opening balances.
- The store treats these as ordinary journal entries against dedicated carryforward accounts.

---

## 3. GoB / GoBD — data-layer obligations

Legal basis: **§ 238–261 HGB**, **§ 140–148 AO**, **GoBD**. These translate to schema- and storage-level requirements — the ones the data layer must enforce regardless of the application on top:

- **Append-only journal.** Posted entries are never mutated or deleted. Corrections are new entries (reversals + re-postings) that reference the original.
- **Immutable after post.** Drafts may be edited or deleted. Once `status = 'posted'`, no field of the entry or its lines may change. `status` may only transition `posted → reversed`, and only via a reversal entry that exists.
- **Gap-free sequence.** `id` (or a separate `sequenceNo`) is strictly monotonic with no gaps. Allocated at post time, not at draft creation.
- **Audit log.** Every state change (`entry.post`, `entry.reverse`, `period.close`, `account.create`, `account.archive`, ...) writes an append-only audit event with actor, server-clock timestamp, and before/after snapshot.
- **Document linkage.** Every posted entry carries `documentRef`. If documents are stored in the same system, they live in their own append-only table referenced by the entry.
- **Period locking.** A `Period` row has `status ∈ {open, closed}`. Postings and reversals with `bookingDate` inside a closed period are rejected.
- **Internal consistency.** At any point in time: `Σ D-balance == Σ C-balance` across all accounts.
- **Clock authority.** `postedAt`, `createdAt`, `closedAt` use the server clock, not client-supplied values. `bookingDate` and `documentDate` are business fields and may be supplied.

Retention (10 years for books/journals, 6 for commercial letters) is a storage-policy concern, but the schema must not make deletion the normal path — only scheduled archival.

### 3.1 VAT representation

VAT affects the schema, not just reporting. A typical purchase splits into net + tax across three lines:

```
Debit  4400  Goods/services purchased      100.00
Debit  1576  Deductible input tax 19%       19.00
Credit 1600  Trade payables                        119.00
```

Data-layer implications:

- A `TaxCode` table maps codes to rate, direction (input/output), and the target tax account.
- Each `JournalLine` may carry a `taxCode`; lines that carry one are linkable to the tax-account line of the same entry (either by grouping within the entry or by enforcing that the tax-account line exists).

---

## 4. Entry lifecycle (persistence states)

```
  draft  ──post──►  posted  ──reverse──►  reversed  (+ new correcting entry)
    │
  delete (allowed only while draft)
```

- **draft** — mutable, no final `id`, not counted in balances.
- **posted** — immutable, sequence-numbered, contributes to balances.
- **reversed** — a reversal entry exists that negates it; the original row remains.
- **period-closed** — entries inside a closed period are frozen; corrections happen in the next open period.

Transactional requirements on `post`:

- Balance check, period check, sequence allocation, write — single transaction, serializable or equivalent.
- Sequence allocation is serialized (DB sequence or `SELECT ... FOR UPDATE` on a counter).

---

## 5. Schema (reference)

```ts
type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra';
type Side = 'D' | 'C';
type EntryStatus = 'draft' | 'posted' | 'reversed';
type PeriodStatus = 'open' | 'closed';

interface Account {
  number: string;              // PK, immutable
  name: string;
  type: AccountType;           // frozen once referenced
  normalSide: Side;
  isActive: boolean;
  parentAccount?: string;      // sub-ledger → reconciliation account
  taxRate?: number;
}

interface JournalEntry {
  id: bigint;                  // PK, monotonic, gap-free
  status: EntryStatus;
  bookingDate: Date;           // business date
  documentDate: Date;
  documentRef: string;         // required when status != 'draft'
  description: string;
  postedAt?: Date;             // server clock, set on post
  createdAt: Date;
  createdBy: string;
  reverses?: bigint;
  reversedBy?: bigint;
}

interface JournalLine {
  entryId: bigint;             // FK → JournalEntry.id
  lineNo: number;              // PK(entryId, lineNo)
  accountNumber: string;       // FK → Account.number
  side: Side;
  amount: bigint;              // minor units, > 0
  taxCode?: string;
  costCenter?: string;
  currency?: string;
  fxRate?: number;
}

interface Period {
  id: string;                  // "2026-03", "2026"
  from: Date;
  to: Date;
  status: PeriodStatus;
  closedAt?: Date;
  closedBy?: string;
}

interface TaxCode {
  code: string;                // PK
  rate: number;
  direction: 'input' | 'output';
  taxAccount: string;          // FK → Account.number
}

interface AuditEvent {
  id: bigint;                  // PK
  at: Date;                    // server clock
  actor: string;
  action: string;              // 'entry.post' | 'entry.reverse' | 'period.close' | ...
  subjectTable: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
}
```

### 5.1 Store operations

The data layer exposes a narrow surface:

```ts
createAccount(a): Account
archiveAccount(number): void                 // sets isActive=false; never deletes

saveDraft(draft): JournalEntry                // status='draft'
discardDraft(id): void
postEntry(draftId): JournalEntry              // enforces all invariants, allocates id

reverseEntry(entryId, reason, bookingDate): JournalEntry
closePeriod(periodId): void

getBalance(accountNumber, asOf): bigint
listEntriesByPeriod(periodId): JournalEntry[]
listLinesByAccount(accountNumber, from, to): JournalLine[]
```

`getBalance` is the primitive on top of which any report is built. The data layer does not produce reports — it answers balance queries and returns line iterators.

### 5.2 Constraints the store must enforce

- `PRIMARY KEY` on `JournalEntry.id`; backed by a DB sequence.
- `PRIMARY KEY (entryId, lineNo)` on `JournalLine`.
- `FOREIGN KEY JournalLine.accountNumber → Account.number`.
- `FOREIGN KEY JournalLine.entryId → JournalEntry.id`.
- `FOREIGN KEY JournalEntry.reverses → JournalEntry.id`.
- `CHECK JournalLine.amount > 0`.
- `CHECK JournalEntry.documentRef <> ''` when `status <> 'draft'`.
- Deferred / trigger check on commit: `Σ D == Σ C` per entry.
- Deny `UPDATE`/`DELETE` on `JournalEntry` and `JournalLine` when `status IN ('posted', 'reversed')` — at the DB role or trigger level, not the application.
- Deny any `UPDATE`/`DELETE` on `AuditEvent`.
- Reject inserts on `JournalEntry` whose `bookingDate` falls in a `closed` period.
- Reject inserts on `JournalLine` whose `accountNumber` has `isActive = false`.
- Reject change of `Account.number` or `Account.type` if any `JournalLine` references it.

### 5.3 Concurrency

- Sequence allocation: serialized via DB sequence or row lock on a counter.
- `postEntry` runs at read-committed minimum; `closePeriod` at serializable (must see all committed posts in the period).
- Balance queries may run under any isolation — they are always computed from committed lines.

---

## 6. What the store must reject

Any data layer claiming GoB compliance refuses:

- Insert of a `JournalEntry` whose lines don't balance.
- `UPDATE` of any field on a posted entry or its lines.
- `DELETE` of a posted entry or any line of one.
- Insert of a `JournalEntry` with `bookingDate` in a closed period.
- Insert of a posted `JournalEntry` without `documentRef`.
- Re-use of a `JournalEntry.id` or a gap in the sequence.
- Client-supplied `postedAt`, `createdAt`, or audit timestamps.
- Change of `Account.number` or `Account.type` once referenced.
- Any `UPDATE`/`DELETE` on `AuditEvent`.

These are the bright lines for the persistence layer. Everything built on top — workflow, reporting, tax exports, reconciliation — assumes the store holds them.
