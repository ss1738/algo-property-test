import typescript from '@rollup/plugin-typescript'
import { puyaTsTransformer } from '@algorandfoundation/algorand-typescript-testing/vitest-transformer'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {},
  test: {
    setupFiles: 'vitest.setup.ts',
    testTimeout: 30_000,
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      transformers: {
        before: [puyaTsTransformer],
      },
    }),
  ],
})
