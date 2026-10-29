import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({
  plugins:[react()],
  base:mode==='pages'?'/bali-circle/':'/',
  define:{'import.meta.env.VITE_STATIC_DEMO':JSON.stringify(mode==='pages'?'true':'false')},
  build:{outDir:mode==='pages'?'dist-pages':'dist'},
  server:{allowedHosts:['localhost','127.0.0.1']}
}));
