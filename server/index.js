// Express + Socket.io num serviço só.
// npm run dev  → Vite roda dentro do Express (middleware), com recarga ao salvar.
// npm start    → serve o build de client/dist.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { NET } from '../shared/constants.js';
import { attachRooms } from './rooms.js';

const DEV = process.argv.includes('--dev');
// Alguns hosts (como o preview do Studio) já sobem com NODE_ENV=production,
// o que desliga import.meta.env.DEV no Vite e esconde os atalhos de debug.
if (DEV) process.env.NODE_ENV = 'development';
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const DIST_DIR = path.join(CLIENT_DIR, 'dist');

const app = express();
const httpServer = createServer(app);

// destroyUpgrade: false deixa o WebSocket de recarga do Vite usar a mesma porta.
const io = new Server(httpServer, {
  destroyUpgrade: false,
  pingInterval: NET.SOCKET_PING_INTERVAL_MS,
  pingTimeout: NET.SOCKET_PING_TIMEOUT_MS,
});

attachRooms(io);

// Checagem de saúde do Render (e de qualquer host): responde sem tocar no jogo
app.get('/healthz', (req, res) => res.type('text').send('ok'));

if (DEV) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    root: CLIENT_DIR,
    appType: 'spa',
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      // Preview do Studio e deploys em *.vercel.run; localhost já é liberado pelo Vite.
      allowedHosts: ['.vercel.run'],
    },
    // Em dev a prévia do link usa caminho relativo
    plugins: [{ name: 'origin', transformIndexHtml: (html) => html.replaceAll('__ORIGIN__', '') }],
  });
  app.use(vite.middlewares);
} else {
  // Atrás do proxy do Render, para saber que o endereço público é https
  app.set('trust proxy', true);
  const indexHtml = readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  // A prévia do link precisa de endereço completo: usa o host de quem pediu
  const sendIndex = (req, res) => {
    res.set('Cache-Control', 'no-cache');
    // No Render, RENDER_EXTERNAL_URL já vem com o endereço público
    const origin = process.env.RENDER_EXTERNAL_URL ?? `${req.protocol}://${req.get('host')}`;
    res.type('html').send(indexHtml.replaceAll('__ORIGIN__', origin));
  };
  app.get(['/', '/index.html'], sendIndex);
  // Arquivos do build com nome versionado podem ficar em cache por um ano; o resto, um dia
  app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(DIST_DIR, {
    index: false,
    maxAge: '1d',
    // o manifesto muda quando entra asset novo: sempre confere
    setHeaders: (res, file) => file.endsWith('.json') && res.set('Cache-Control', 'no-cache'),
  }));
  app.get('*', sendIndex);
}

httpServer.listen(PORT, HOST, () => {
  console.log(`King of The Animals on http://${HOST}:${PORT} (${DEV ? 'dev' : 'production'})`);
});
