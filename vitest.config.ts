import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: 'true',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react-native': 'react-native-web',
    },
  },
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
});
