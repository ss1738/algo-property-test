import type { Asset } from '@algorandfoundation/algorand-typescript'
import { describe, expect, it } from 'vitest'
import { AssetVault, AssetVaultFixed } from '../examples/asset-vault/contract.algo.js'
import { fc, PropertyTestFailure, runPropertyTest } from '../src/index.js'

interface Model {
  balances: number[]
  overdrew: string | undefined
}

function run(contract: new () => AssetVault | AssetVaultFixed) {
  let asset!: Asset
  runPropertyTest<AssetVault | AssetVaultFixed, Model>({
    contract,
    runs: 300,
    model: () => ({ balances: [0, 0, 0], overdrew: undefined }),
    setup: (h) => {
      asset = h.newAsset()
    },
    commands: [
      {
        name: 'deposit',
        args: fc.integer({ min: 1, max: 20 }),
        run: (h, who, amount, m) => {
          h.as(who, () => h.contract.deposit(h.assetTransfer(who, asset, amount)))
          m.balances[who] += amount
        },
      },
      {
        name: 'withdraw',
        args: fc.integer({ min: 1, max: 20 }),
        run: (h, who, amount, m) => {
          h.as(who, () => h.contract.withdraw(asset, amount))
          // The call was accepted. If the account did not own that much, record it.
          if (amount > m.balances[who]) m.overdrew = `account ${who} withdrew ${amount} but had deposited ${m.balances[who]}`
          m.balances[who] = Math.max(0, m.balances[who] - amount)
          expect(h.lastAssetSent().receiver).toEqual(h.accounts[who])
        },
      },
    ],
    invariants: [{ name: 'nobody withdraws more than they deposited', check: (_h, m) => m.overdrew }],
  })
}

describe('asset transfers', () => {
  it('finds an account withdrawing another account\'s tokens', () => {
    try {
      run(AssetVault)
    } catch (error) {
      expect(error).toBeInstanceOf(PropertyTestFailure)
      const report = (error as PropertyTestFailure).report
      expect(report.steps.length).toBeLessThanOrEqual(3)
      expect(report.message).toContain('withdrew')
      return
    }
    throw new Error('expected a failure')
  })

  it('passes on the fixed vault', () => {
    expect(() => run(AssetVaultFixed)).not.toThrow()
  })
})
