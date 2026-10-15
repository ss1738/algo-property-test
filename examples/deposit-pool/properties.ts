import { fc } from '../../src/index.js'
import type { Command, Harness, Invariant } from '../../src/index.js'
import type { DepositPool } from './contract.algo.js'

export interface Model {
  paidIn: number[]
  paidOut: number[]
}

type Pool = Pick<DepositPool, 'deposit' | 'withdraw' | 'total' | 'balance'>

const amount = fc.integer({ min: 1, max: 1000 })

export const newModel = (): Model => ({ paidIn: [0, 0, 0], paidOut: [0, 0, 0] })

export const commands: Command<Pool, Model, number>[] = [
  {
    name: 'deposit',
    args: amount,
    run: (h, who, value, model) => {
      h.as(who, () => h.contract.deposit(h.payment(who, value)))
      model.paidIn[who] += value
    },
  },
  {
    name: 'withdraw',
    args: amount,
    run: (h, who, value, model) => {
      h.as(who, () => h.contract.withdraw(value))
      model.paidOut[who] += h.lastPaymentSent()
    },
  },
]

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

/** What the contract says each account can withdraw. */
const owed = (h: Harness<Pool>): number[] =>
  h.accounts.map((account) => (h.contract.balance(account).hasValue ? Number(h.contract.balance(account).value) : 0))

export const invariants: Invariant<Pool, Model>[] = [
  {
    name: 'the contract holds exactly what it owes',
    check: (h, model) => {
      const held = sum(model.paidIn) - sum(model.paidOut)
      const owedTotal = sum(owed(h))
      if (held !== owedTotal) return `contract holds ${held} but owes ${owedTotal}`
    },
  },
  {
    name: 'total equals the sum of balances',
    check: (h) => {
      const total = Number(h.contract.total.value)
      const owedTotal = sum(owed(h))
      if (total !== owedTotal) return `total is ${total} but balances add up to ${owedTotal}`
    },
  },
]
