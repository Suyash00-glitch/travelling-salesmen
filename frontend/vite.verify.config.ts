import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import baseConfig from './vite.config';

// Verification server: separate port, optional API port override (API_PORT=4100).
const apiTarget = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;

export default defineConfig((env) => {
  const base = (typeof baseConfig === 'function' ? baseConfig(env) : baseConfig) as UserConfig;
  return {
    ...base,
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: {
      ...base.server,
      host: '127.0.0.1',
      port: 5182,
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
  };
});
