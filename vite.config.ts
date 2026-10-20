import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serves /api/* locally with the same code Vercel deploys as serverless functions.
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/fund', async (req, res) => {
        const { handle } = await server.ssrLoadModule('/api/fund.ts');
        const response: Response = await handle(new URL(req.url ?? '', 'http://localhost'));
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({ plugins: [react(), devApi()] });
