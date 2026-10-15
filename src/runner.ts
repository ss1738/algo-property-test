import type { Account, Asset } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import fc from 'fast-check'

/** Everything a command or an invariant needs to talk to the contract under test. */
export interface Harness<TContract> {
  readonly ctx: TestExecutionContext
  readonly contract: TContract
  readonly accounts: readonly Account[]
  /** Run `body` as a call sent by `accounts[who]`. */
  as<T>(who: number, body: () => T): T
  /** The contract's own address. */
  readonly appAddress: Account
  /**
   * A payment transaction from `accounts[who]`, to pass as an argument to a contract method.
   * The receiver defaults to the contract's address.
   */
  payment(who: number, amount: number, receiver?: Account): ReturnType<TestExecutionContext['any']['txn']['payment']>
  /** Amount of the most recent payment inner transaction the contract sent. */
  lastPaymentSent(): number
  /** Create an asset to use in asset transfers. */
  newAsset(decimals?: number): Asset
  /**
   * An asset transfer transaction from `accounts[who]`, to pass as an argument to a contract method.
   * The receiver defaults to the contract's address.
   */
  assetTransfer(who: number, asset: Asset, amount: number, receiver?: Account): ReturnType<TestExecutionContext['any']['txn']['assetTransfer']>
  /** The most recent asset transfer inner transaction the contract sent. */
  lastAssetSent(): { asset: Asset; receiver: Account; amount: number }
}

export interface Command<TContract, TModel, TArgs = undefined> {
  name: string
  /** Generator for extra arguments. Leave out for commands that take none. */
  args?: fc.Arbitrary<TArgs>
  /**
   * Make the call. Let it throw when the contract rejects the call: the property test records
   * it as rejected and carries on. Update `model` only after the call has succeeded.
   */
  run(h: Harness<TContract>, who: number, args: TArgs, model: TModel): void
}

export interface Invariant<TContract, TModel> {
  name: string
  /**
   * Checked after every step. Return normally when it holds. Report a violation by throwing
   * (for example with `expect`), by returning `false`, or by returning a message string.
   */
  check(h: Harness<TContract>, model: TModel): void | boolean | string
}

export interface PropertyTestOptions<TContract, TModel> {
  /** The contract class to test. A fresh instance is created for every generated sequence. */
  contract: new () => TContract
  /** Called on a fresh contract before each sequence, for example to run `createApplication`. */
  setup?: (h: Harness<TContract>) => void
  /** Creates the model your invariants compare against. Called once per sequence. */
  model?: () => TModel
  commands: ReadonlyArray<Command<TContract, TModel, any>>
  invariants: ReadonlyArray<Invariant<TContract, TModel>>
  /** Number of accounts that can send calls. Default 3. */
  accounts?: number
  /** Number of random sequences to try. Default 200. */
  runs?: number
  /** Longest sequence of commands. Default 25. */
  maxSteps?: number
  /** Fix the seed to reproduce a failure. */
  seed?: number
  /** Reuse an existing context. The testing library allows only one at a time. */
  ctx?: TestExecutionContext
}

export interface FailureReport {
  seed: number
  runs: number
  shrinks: number
  steps: string[]
  invariant: string
  message: string
  failedAtStep: number
}

export class PropertyTestFailure extends Error {
  readonly report: FailureReport
  constructor(report: FailureReport) {
    super(formatFailure(report))
    this.name = 'PropertyTestFailure'
    this.report = report
  }
}

interface Step {
  command: number
  who: number
  args: unknown
}

interface Outcome {
  steps: string[]
  failure?: { invariant: string; message: string; step: number }
}

// The testing library allows a single execution context at a time, so share one by default.
let sharedContext: TestExecutionContext | undefined
function defaultContext(): TestExecutionContext {
  sharedContext ??= new TestExecutionContext()
  return sharedContext
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.split('\n')[0]
  return String(error)
}

function describeStep(name: string, who: number, args: unknown): string {
  const extra = args === undefined ? '' : `, ${JSON.stringify(args)}`
  return `${name}(account ${who}${extra})`
}

function formatFailure(r: FailureReport): string {
  const lines = r.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
  return [
    `Property test failed after ${r.runs} run(s), shrunk in ${r.shrinks} step(s). Seed: ${r.seed}`,
    '',
    'Smallest failing sequence:',
    lines,
    '',
    `Invariant "${r.invariant}" was violated after step ${r.failedAtStep}:`,
    `  ${r.message}`,
    '',
    `Reproduce with: seed ${r.seed}`,
  ].join('\n')
}

/**
 * Generate random sequences of contract calls by several accounts, and check your invariants
 * after every call. On failure, throws a PropertyTestFailure that shows the smallest failing sequence.
 */
export function runPropertyTest<TContract, TModel = Record<string, never>>(options: PropertyTestOptions<TContract, TModel>): void {
  const ctx = options.ctx ?? defaultContext()
  const accountCount = options.accounts ?? 3
  const { commands, invariants } = options
  if (commands.length === 0) throw new Error('runPropertyTest needs at least one command')
  if (invariants.length === 0) throw new Error('runPropertyTest needs at least one invariant')

  const whoArb = fc.integer({ min: 0, max: accountCount - 1 })
  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    ...commands.map((c, command) =>
      fc.record({
        command: fc.constant(command),
        who: whoArb,
        args: (c.args ?? fc.constant(undefined)) as fc.Arbitrary<unknown>,
      }),
    ),
  )

  interface Built {
    harness: Harness<TContract>
    model: TModel
  }

  // Build a fresh contract, then replay the calls that succeeded. The testing library does not undo
  // state written by a call that is rejected part-way, but a real network does, so after a rejection
  // we rebuild the state from the successful calls only.
  const build = (successful: readonly Step[]): Built => {
    ctx.reset()
    const accounts = Array.from({ length: accountCount }, () => ctx.any.account())
    const contract = ctx.contract.create(options.contract as never) as TContract
    const harness: Harness<TContract> = {
      ctx,
      contract,
      accounts,
      as: (who, body) => {
        let result!: ReturnType<typeof body>
        ctx.txn.createScope([ctx.any.txn.applicationCall({ sender: accounts[who], appId: ctx.ledger.getApplicationForContract(contract as never) })]).execute(() => {
          result = body()
        })
        return result
      },
      appAddress: ctx.ledger.getApplicationForContract(contract as never).address,
      payment: (who, amount, receiver) =>
        ctx.any.txn.payment({ sender: accounts[who], receiver: receiver ?? ctx.ledger.getApplicationForContract(contract as never).address, amount }),
      newAsset: (decimals = 0) => ctx.any.asset({ decimals }),
      assetTransfer: (who, asset, amount, receiver) =>
        ctx.any.txn.assetTransfer({
          sender: accounts[who],
          assetReceiver: receiver ?? ctx.ledger.getApplicationForContract(contract as never).address,
          xferAsset: asset,
          assetAmount: amount,
        }),
      lastAssetSent: () => {
        const t = ctx.txn.lastGroup.lastItxnGroup().getAssetTransferInnerTxn()
        return { asset: t.xferAsset, receiver: t.assetReceiver, amount: Number(t.assetAmount) }
      },
      lastPaymentSent: () => Number(ctx.txn.lastGroup.lastItxnGroup().getPaymentInnerTxn().amount),
    }
    options.setup?.(harness)
    const model = (options.model ? options.model() : {}) as TModel
    for (const step of successful) {
      commands[step.command].run(harness, step.who, step.args, model)
    }
    return { harness, model }
  }

  const execute = (sequence: readonly Step[]): Outcome => {
    let state = build([])
    const successful: Step[] = []
    const log: string[] = []
    for (const [index, step] of sequence.entries()) {
      const command = commands[step.command]
      const label = describeStep(command.name, step.who, step.args)
      try {
        command.run(state.harness, step.who, step.args, state.model)
        successful.push(step)
        log.push(label)
      } catch (error) {
        log.push(`${label} (rejected: ${describeError(error)})`)
        state = build(successful)
      }
      for (const invariant of invariants) {
        let message: string | undefined
        try {
          const verdict = invariant.check(state.harness, state.model)
          if (verdict === false) message = 'check returned false'
          else if (typeof verdict === 'string') message = verdict
        } catch (error) {
          message = describeError(error)
        }
        if (message !== undefined) {
          return { steps: log, failure: { invariant: invariant.name, message, step: index + 1 } }
        }
      }
    }
    return { steps: log }
  }

  const details = fc.check(
    fc.property(fc.array(stepArb, { minLength: 1, maxLength: options.maxSteps ?? 25 }), (sequence) => execute(sequence).failure === undefined),
    { numRuns: options.runs ?? 200, seed: options.seed },
  )

  if (!details.failed) return

  const shrunk = details.counterexample?.[0] as Step[] | undefined
  const replay = shrunk ? execute(shrunk) : undefined
  if (!replay?.failure) {
    // The shrunk sequence did not fail on replay, which means the contract or test is not deterministic.
    throw new Error(
      `Property test found a failure (seed ${details.seed}) but could not reproduce it when replaying. ` +
        'Check that your contract and commands do not depend on state that survives ctx.reset().',
    )
  }
  throw new PropertyTestFailure({
    seed: details.seed,
    runs: details.numRuns,
    shrinks: details.numShrinks,
    steps: replay.steps,
    invariant: replay.failure.invariant,
    message: replay.failure.message,
    failedAtStep: replay.failure.step,
  })
}
