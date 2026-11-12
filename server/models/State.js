import mongoose from 'mongoose';

const stateSchema = new mongoose.Schema({
  key:      { type: String, unique: true, required: true },
  users:    { type: Map, of: String, default: {} },
  messages: { type: Array, default: [] },
  updatedAt:{ type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('State', stateSchema);