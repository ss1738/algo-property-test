import { Global } from '@algorandfoundation/algorand-typescript'
import { describe, expect, it } from 'vitest'
import { DepositPool, DepositPoolFixed } from '../examples/deposit-pool/contract.algo.js'
import { commands, invariants, newModel } from '../examples/deposit-pool/properties.js'
import { fc, PropertyTestFailure, runPropertyTest } from '../src/index.js'

const base = { commands, invariants, model: newModel, runs: 300 }

function failureOf(run: () => void): PropertyTestFailure {
  try {
    run()
  } catch (error) {
    if (error instanceof PropertyTestFailure) return error
    throw error
  }
  throw new Error('expected the property test to fail, but it passed')
}

describe('runPropertyTest', () => {
  it('finds the lost-deposit bug and reports the smallest sequence', () => {
    const failure = failureOf(() => runPropertyTest({ ...base, contract: DepositPool }))
    expect(failure.report.steps).toHaveLength(2)
    expect(failure.report.steps.every((s) => s.startsWith('deposit('))).toBe(true)
    expect(failure.report.invariant).toBe('the contract holds exactly what it owes')
    expect(failure.message).toContain('Smallest failing sequence')
    expect(failure.message).toContain('Reproduce with: seed')
  })

  it('passes on the fixed contract', () => {
    expect(() => runPropertyTest({ ...base, contract: DepositPoolFixed })).not.toThrow()
  })

  it('reproduces the same failure from a seed', () => {
    const first = failureOf(() => runPropertyTest({ ...base, contract: DepositPool, seed: 12345 }))
    const second = failureOf(() => runPropertyTest({ ...base, contract: DepositPool, seed: 12345 }))
    expect(second.report.steps).toEqual(first.report.steps)
    expect(second.report.seed).toBe(12345)
  })

  it('treats calls the contract rejects as normal and keeps going', () => {
    // Withdrawing from an account with no balance is always rejected; the invariants still hold.
    const withdrawOnly = commands.filter((c) => c.name === 'withdraw')
    expect(() => runPropertyTest({ ...base, contract: DepositPoolFixed, commands: withdrawOnly })).not.toThrow()
  })

  it('reports a violation returned as a message', () => {
    const failure = failureOf(() =>
      runPropertyTest({
        ...base,
        contract: DepositPoolFixed,
        invariants: [{ name: 'no deposit ever', check: (h) => (h.accounts.length > 0 ? 'always fails' : undefined) }],
      }),
    )
    expect(failure.report.message).toBe('always fails')
    expect(failure.report.steps).toHaveLength(1)
  })

  it('reports an invariant that throws', () => {
    const failure = failureOf(() =>
      runPropertyTest({
        ...base,
        contract: DepositPoolFixed,
        invariants: [
          {
            name: 'throws',
            check: () => {
              throw new Error('boom')
            },
          },
        ],
      }),
    )
    expect(failure.report.message).toBe('boom')
  })

  it('asks for at least one command and one invariant', () => {
    expect(() => runPropertyTest({ ...base, contract: DepositPoolFixed, commands: [] })).toThrow(/at least one command/)
    expect(() => runPropertyTest({ ...base, contract: DepositPoolFixed, invariants: [] })).toThrow(/at least one invariant/)
  })
})

describe('rejected calls', () => {
  it('are rolled back, as they would be on a real network', async () => {
    const { RejectsAfterWrite } = await import('./fixtures/rejects-after-write.algo.js')
    const model = () => ({ bumps: 0 })
    expect(() =>
      runPropertyTest({
        contract: RejectsAfterWrite,
        model,
        commands: [
          {
            name: 'bump',
            args: fc.integer({ min: 0, max: 9 }),
            run: (h, who, n, m) => {
              h.as(who, () => h.contract.bump(n))
              m.bumps += 1
            },
          },
        ],
        invariants: [
          {
            name: 'count equals the number of accepted bumps',
            check: (h, m) => {
              const count = Number(h.contract.count.value)
              if (count !== m.bumps) return `count is ${count} but ${m.bumps} bump(s) were accepted`
            },
          },
        ],
      }),
    ).not.toThrow()
  })

  it('runs calls as the contract\'s own app, so payments to it and Global match', () => {
    expect(() =>
      runPropertyTest({
        contract: DepositPool,
        commands: [
          {
            name: 'inspect',
            run: (h, who) => {
              h.as(who, () => {
                if (Global.currentApplicationAddress !== h.appAddress) throw new Error('wrong application address')
              })
              if (h.payment(who, 1).receiver !== h.appAddress) throw new Error('payment does not default to the app')
            },
          },
        ],
        invariants: [{ name: 'always true', check: () => true }],
        runs: 5,
      }),
    ).not.toThrow()
  })
})
