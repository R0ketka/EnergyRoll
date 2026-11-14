import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import Winner from './models/Winner.js';
import State from './models/State.js';
import Rig from './models/Rig.js';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

mongoose.connect(MONGODB_URI, { dbName: 'energyroll' })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((e) => { console.error('❌ MongoDB error:', e.message); process.exit(1); });

// ---------- Победители ----------
app.get('/api/winners', async (req, res) => {
  const { streamer } = req.query;
  const filter = streamer ? { streamer: streamer.toLowerCase() } : {};
  const list = await Winner.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map((w) => ({ ...w, id: w._id })));
});

app.post('/api/winners', async (req, res) => {
  const { name, payout, dep, site, streamer } = req.body;
  if (!name || !streamer) return res.status(400).json({ error: 'name and streamer required' });
  const doc = await Winner.create({ name, payout, dep, site, streamer: streamer.toLowerCase() });
  res.status(201).json({ ...doc.toObject(), id: doc._id });
});

app.put('/api/winners/:id', async (req, res) => {
  const { payout, dep, site } = req.body;
  const updated = await Winner.findByIdAndUpdate(req.params.id, { $set: { payout, dep, site } }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ ...updated, id: updated._id });
});

app.delete('/api/winners/:id', async (req, res) => {
  await Winner.findByIdAndDelete(req.params.id);
  res.status(204).end();
});

// ---------- ПОДКРУТКА ----------
app.get('/api/rig/:streamer', async (req, res) => {
  const { streamer } = req.params;
  const rig = await Rig.findOne({ streamer: streamer.toLowerCase() });
  if (!rig) return res.json({ targetUser: null, isUsed: true });
  res.json({ targetUser: rig.targetUser, isUsed: rig.isUsed });
});

app.post('/api/rig', async (req, res) => {
  const { streamer, targetUser } = req.body;
  if (!streamer) return res.status(400).json({ error: 'streamer required' });
  
  let rig = await Rig.findOne({ streamer: streamer.toLowerCase() });
  if (rig) {
    rig.targetUser = targetUser ? targetUser.toLowerCase() : null;
    rig.isUsed = false; // Сбрасываем, чтобы подкрутка снова сработала
    await rig.save();
  } else {
    rig = await Rig.create({ streamer: streamer.toLowerCase(), targetUser: targetUser ? targetUser.toLowerCase() : null, isUsed: false });
  }
  res.json(rig);
});

app.post('/api/rig/use', async (req, res) => {
  const { streamer } = req.body;
  if (streamer) {
    await Rig.updateOne({ streamer: streamer.toLowerCase() }, { $set: { isUsed: true } });
  }
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));