import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { env } from './backend/src/config/env.js';
import { connectDB } from './backend/src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Connect to Database
  await connectDB();

  const app = express();
  const PORT = env.PORT;

  app.use(cors());
  app.use(express.json());

  // API Routes Placeholder
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Federated Learning Backend is running' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✨ Server running on http://localhost:${PORT}`);
  });
}

startServer();
