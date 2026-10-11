import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `vite --mode phone` serves over HTTPS on the local network so phones can open
// the app and use the camera (browsers only allow the camera on HTTPS).
export default defineConfig(({ mode }) => {
  const phone = mode === 'phone';
  return {
    plugins: [react(), tailwindcss(), ...(phone ? [basicSsl()] : [])],
    server: {
      host: phone ? '0.0.0.0' : '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
