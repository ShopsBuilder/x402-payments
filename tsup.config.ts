import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'invoice/index': 'src/invoice/index.ts',
    'server/index':  'src/server/index.ts',
    'client/index':  'src/client/index.ts',
    'utils/index':   'src/utils/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
});
