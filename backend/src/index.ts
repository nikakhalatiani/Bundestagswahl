import express from 'express';
import prisma from './db';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/items', async (_req, res) => {
  const items = await prisma.item.findMany({ orderBy: { id: 'desc' } });
  res.json(items);
});

app.post('/api/items', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const item = await prisma.item.create({ data: { name } });
  res.status(201).json(item);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});
