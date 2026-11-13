import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import Winner from './models/Winner.js';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) process.exit(1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

mongoose.connect(MONGODB_URI, { dbName: 'energyroll' })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((e) => { console.error('❌ MongoDB error:', e.message); process.exit(1); });

// Получить победителей конкретного стримера
app.get('/api/winners', async (req, res) => {
  const { streamer } = req.query;
  const filter = streamer ? { streamer: streamer.toLowerCase() } : {};
  
  const list = await Winner.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((w) => ({ ...w, id: w._id })));
});

// Сохранить победителя для стримера
app.post('/api/winners', async (req, res) => {
  const { name, payout, dep, site, streamer } = req.body;
  if (!name || !streamer) return res.status(400).json({ error: 'name and streamer required' });
  
  const doc = await Winner.create({ name, payout, dep, site, streamer: streamer.toLowerCase() });
  res.status(201).json({ ...doc.toObject(), id: doc._id });
});

// Обновить данные
app.put('/api/winners/:id', async (req, res) => {
  const { payout, dep, site } = req.body;
  const updated = await Winner.findByIdAndUpdate(
    req.params.id,
    { $set: { payout, dep, site } },
    { new: true }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ ...updated, id: updated._id });
});

// Удалить
app.delete('/api/winners/:id', async (req, res) => {
  await Winner.findByIdAndDelete(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));