import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import Winner from './models/Winner.js';
import State from './models/State.js';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// ⬇ ВОТ ЗДЕСЬ ПРОИСХОДИТ ПОДКЛЮЧЕНИЕ
mongoose.connect(MONGODB_URI, { dbName: 'energyroll' })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((e) => { console.error('❌ MongoDB error:', e.message); process.exit(1); });

// ---------- Победители ----------
app.get('/api/winners', async (_req, res) => {
  const list = await Winner.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((w) => ({ ...w, id: w._id })));
});

app.post('/api/winners', async (req, res) => {
  const { name, payout, dep, site } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const doc = await Winner.create({ name, payout, dep, site });
  res.status(201).json({ ...doc.toObject(), id: doc._id });
});

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

app.delete('/api/winners/:id', async (req, res) => {
  await Winner.findByIdAndDelete(req.params.id);
  res.status(204).end();
});

// ---------- Топ по сообщениям ----------
app.get('/api/state', async (_req, res) => {
  const doc = await State.findOne({ key: 'chat_state' }).lean();
  res.json(doc || { key: 'chat_state', users: {}, messages: [] });
});

app.put('/api/state', async (req, res) => {
  const { users, messages } = req.body;
  const doc = await State.findOneAndUpdate(
    { key: 'chat_state' },
    { $set: { users, messages, updatedAt: new Date() } },
    { upsert: true, new: true }
  ).lean();
  res.json(doc);
});

app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));