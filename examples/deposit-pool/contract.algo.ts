import type { gtxn, uint64 } from '@algorandfoundation/algorand-typescript'
import { assert, assertMatch, Contract, GlobalState, itxn, LocalState, Txn } from '@algorandfoundation/algorand-typescript'

/**
 * A pool where each account deposits ALGO and can later withdraw up to its own balance.
 * This version has a deliberate bug, to show what a property test finds.
 */
export class DepositPool extends Contract {
  total = GlobalState<uint64>({ initialValue: 0 })
  balance = LocalState<uint64>()

  public deposit(payment: gtxn.PaymentTxn): void {
    assertMatch(payment, { sender: Txn.sender })
    // BUG: a second deposit replaces the account's balance instead of adding to it,
    // so the first deposit stays in the contract but can never be withdrawn.
    this.balance(Txn.sender).value = payment.amount
    this.total.value = this.total.value + payment.amount
  }

  public withdraw(amount: uint64): void {
    assert(this.balance(Txn.sender).hasValue)
    assert(amount <= this.balance(Txn.sender).value)
    this.balance(Txn.sender).value = this.balance(Txn.sender).value - amount
    this.total.value = this.total.value - amount
    itxn.payment({ receiver: Txn.sender, amount }).submit()
  }
}

/** The same pool with the bug fixed: deposits add to the existing balance. */
export class DepositPoolFixed extends Contract {
  total = GlobalState<uint64>({ initialValue: 0 })
  balance = LocalState<uint64>()

  public deposit(payment: gtxn.PaymentTxn): void {
    assertMatch(payment, { sender: Txn.sender })
    const existing = this.balance(Txn.sender).hasValue ? this.balance(Txn.sender).value : 0
    this.balance(Txn.sender).value = existing + payment.amount
    this.total.value = this.total.value + payment.amount
  }

  public withdraw(amount: uint64): void {
    assert(this.balance(Txn.sender).hasValue)
    assert(amount <= this.balance(Txn.sender).value)
    this.balance(Txn.sender).value = this.balance(Txn.sender).value - amount
    this.total.value = this.total.value - amount
    itxn.payment({ receiver: Txn.sender, amount }).submit()
  }
}
