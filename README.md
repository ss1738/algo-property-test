# algo-property-test

Property-based testing for Algorand TypeScript smart contracts.

A normal unit test checks one case you thought of. This tool generates many random sequences of calls from several accounts, and checks the rules you care about after every call. When a rule breaks, it shrinks the sequence to the smallest one that still fails and prints it.

It builds on `@algorandfoundation/algorand-typescript-testing` for the contract simulation and on `fast-check` for the random generation.

Status: version 0.1, early. The API may change.

## Why

Many contract bugs only show up after a particular order of calls. For example, an account deposits twice and the second deposit overwrites the first. One test per method will not find that. A random sequence of deposits and withdrawals will.

While trying this idea on an example auction contract from the Algorand Foundation's testing library, a property test found a case where a bidder who raised their own bid left the earlier deposit locked in the contract. It shrank to two calls. The example is a teaching contract, so this is not a security report. It shows the kind of bug the technique finds.

## Install

```
npm install --save-dev algo-property-test fast-check
```

You also need `@algorandfoundation/algorand-typescript` and `@algorandfoundation/algorand-typescript-testing` (version 1.2 or newer), set up as the testing library's own documentation describes, including its vitest transformer. Contract files end in `.algo.ts` and test files in `.algo.spec.ts`.

## Example

A pool where each account deposits and later withdraws. This version has a bug: a second deposit replaces the balance instead of adding to it.

```ts
import { runPropertyTest, fc } from 'algo-property-test'
import { DepositPool } from './contract.algo'

runPropertyTest({
  contract: DepositPool,
  model: () => ({ paidIn: [0, 0, 0], paidOut: [0, 0, 0] }),
  commands: [
    {
      name: 'deposit',
      args: fc.integer({ min: 1, max: 1000 }),
      run: (h, who, amount, model) => {
        h.as(who, () => h.contract.deposit(h.payment(who, amount)))
        model.paidIn[who] += amount // only runs if the call was accepted
      },
    },
    {
      name: 'withdraw',
      args: fc.integer({ min: 1, max: 1000 }),
      run: (h, who, amount, model) => {
        h.as(who, () => h.contract.withdraw(amount))
        model.paidOut[who] += h.lastPaymentSent()
      },
    },
  ],
  invariants: [
    {
      name: 'the contract holds exactly what it owes',
      check: (h, model) => {
        const held = sum(model.paidIn) - sum(model.paidOut)
        const owed = sum(h.accounts.map((a) => (h.contract.balance(a).hasValue ? Number(h.contract.balance(a).value) : 0)))
        if (held !== owed) return `contract holds ${held} but owes ${owed}`
      },
    },
  ],
})
```

The test fails with:

```
Property test failed after 2 run(s), shrunk in 9 step(s). Seed: 42

Smallest failing sequence:
  1. deposit(account 0, 1)
  2. deposit(account 0, 1)

Invariant "the contract holds exactly what it owes" was violated after step 2:
  contract holds 2 but owes 1

Reproduce with: seed 42
```

The full working version is in `examples/deposit-pool`, with the same contract fixed.

## How it works

1. For each run, it builds a fresh contract and some accounts, then generates a random list of commands, each with an account and random arguments.
2. It runs them in order. A call the contract rejects is recorded as rejected, and the run goes on.
3. After every call it checks each invariant.
4. On a violation, fast-check shrinks the list to the smallest failing one, and the runner replays it to build the report.

## API

`runPropertyTest(options)` throws a `PropertyTestFailure` when an invariant is violated. Its `report` field has the seed, the steps and the message.

| Option | Meaning |
|---|---|
| `contract` | The contract class. A fresh one is created for every sequence. |
| `setup(h)` | Runs on each fresh contract, for example to call `createApplication`. |
| `model()` | Creates the state your invariants compare against. |
| `commands` | The calls to make. Each has a `name`, optional `args` generator and a `run` function. |
| `invariants` | Rules checked after every call. Return nothing when it holds. Return a message, return `false` or throw to report a violation. |
| `accounts` | Number of accounts that send calls. Default 3. |
| `runs` | Number of random sequences. Default 200. |
| `maxSteps` | Longest sequence. Default 25. |
| `seed` | Fix it to reproduce a failure. |
| `ctx` | Reuse your own `TestExecutionContext`. |

The harness `h` gives you `h.contract`, `h.accounts`, `h.ctx`, `h.as(who, body)` to send a call from an account, `h.appAddress` for the contract's address, `h.payment(who, amount, receiver?)` to build a payment argument (it goes to the contract unless you pass a receiver), `h.lastPaymentSent()` to read the last inner payment the contract made, `h.newAsset()` to create an asset, `h.assetTransfer(who, asset, amount, receiver?)` to build an asset transfer argument, and `h.lastAssetSent()` to read the last inner asset transfer the contract made.

To check that the contract rejects what it should, let the command succeed, compare with your model, and record the mismatch in the model. An invariant then reports it. `examples/asset-vault` and `tests/asset.algo.spec.ts` do this: a vault that checks its total instead of the caller's balance lets account 1 withdraw what account 0 deposited, and the shrunk failure is two steps.

## Things to know

- The testing library does not undo state written by a call that fails part-way, but a real network does. This tool handles that: after a rejected call it rebuilds the state from the calls that succeeded. A test in this repo checks it.
- The testing library allows one execution context at a time. This tool shares one by default. If you create your own, pass it as `ctx`.
- This tests contract logic in the simulator. It does not replace tests on a real network.
- It works with Algorand TypeScript. There is no Python version yet.
- Your model and invariants decide what gets checked. A property that is too weak finds nothing.

## Tests

```
npm install
npm test
```

## Licence

MIT. See LICENSE.
