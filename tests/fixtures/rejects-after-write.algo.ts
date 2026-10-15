import type { uint64 } from '@algorandfoundation/algorand-typescript'
import { assert, Contract, GlobalState } from '@algorandfoundation/algorand-typescript'

/** Writes state and only then rejects odd values, like a contract that checks late. */
export class RejectsAfterWrite extends Contract {
  count = GlobalState<uint64>({ initialValue: 0 })

  public bump(n: uint64): void {
    this.count.value = this.count.value + 1
    assert(n % 2 === 0, 'only even values')
  }
}
