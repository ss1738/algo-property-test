import type { Asset, gtxn, uint64 } from '@algorandfoundation/algorand-typescript'
import { assert, assertMatch, Contract, GlobalState, itxn, LocalState, Txn } from '@algorandfoundation/algorand-typescript'

/**
 * A vault where each account deposits one asset and can later withdraw it.
 * This version has a deliberate bug, to show a property test driving asset transfers.
 */
export class AssetVault extends Contract {
  total = GlobalState<uint64>({ initialValue: 0 })
  balance = LocalState<uint64>()

  public deposit(xfer: gtxn.AssetTransferTxn): void {
    assertMatch(xfer, { sender: Txn.sender })
    const existing = this.balance(Txn.sender).hasValue ? this.balance(Txn.sender).value : 0
    this.balance(Txn.sender).value = existing + xfer.assetAmount
    this.total.value = this.total.value + xfer.assetAmount
  }

  public withdraw(asset: Asset, amount: uint64): void {
    // BUG: checks the vault's total instead of the caller's own balance, so an account
    // can withdraw tokens that another account deposited.
    assert(amount <= this.total.value)
    const own = this.balance(Txn.sender).hasValue ? this.balance(Txn.sender).value : 0
    this.balance(Txn.sender).value = own > amount ? own - amount : 0
    this.total.value = this.total.value - amount
    itxn.assetTransfer({ xferAsset: asset, assetReceiver: Txn.sender, assetAmount: amount }).submit()
  }
}

/** The same vault with the check fixed: a caller can only withdraw their own balance. */
export class AssetVaultFixed extends Contract {
  total = GlobalState<uint64>({ initialValue: 0 })
  balance = LocalState<uint64>()

  public deposit(xfer: gtxn.AssetTransferTxn): void {
    assertMatch(xfer, { sender: Txn.sender })
    const existing = this.balance(Txn.sender).hasValue ? this.balance(Txn.sender).value : 0
    this.balance(Txn.sender).value = existing + xfer.assetAmount
    this.total.value = this.total.value + xfer.assetAmount
  }

  public withdraw(asset: Asset, amount: uint64): void {
    assert(this.balance(Txn.sender).hasValue)
    assert(amount <= this.balance(Txn.sender).value)
    this.balance(Txn.sender).value = this.balance(Txn.sender).value - amount
    this.total.value = this.total.value - amount
    itxn.assetTransfer({ xferAsset: asset, assetReceiver: Txn.sender, assetAmount: amount }).submit()
  }
}
