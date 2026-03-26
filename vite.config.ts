import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/ipl-feed': {
          target: 'https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/ipl-feed/, '/ipl/feeds/284-matchschedule.js'),
        },
      },
    },
  };
});
