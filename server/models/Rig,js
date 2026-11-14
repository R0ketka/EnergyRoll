import mongoose from 'mongoose';

const rigSchema = new mongoose.Schema({
  streamer: { type: String, required: true, unique: true, lowercase: true },
  targetUser: { type: String, default: null, lowercase: true },
  isUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('Rig', rigSchema);