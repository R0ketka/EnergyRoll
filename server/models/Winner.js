import mongoose from 'mongoose';

const winnerSchema = new mongoose.Schema({
  streamer: { type: String, required: true, index: true }, 
  name:   { type: String, required: true },
  payout: { type: String, default: '' },
  dep:    { type: String, default: '' },
  site:   { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('Winner', winnerSchema);