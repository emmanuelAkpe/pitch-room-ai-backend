import mongoose from 'mongoose';

const transcriptEntrySchema = new mongoose.Schema({
  speaker: { type: String, enum: ['user', 'pia'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const scoresSchema = new mongoose.Schema({
  problem_clarity: { type: Number, default: 0 },
  value_proposition: { type: Number, default: 0 },
  market_size: { type: Number, default: 0 },
  competitors: { type: Number, default: 0 },
  monetization: { type: Number, default: 0 },
  go_to_market: { type: Number, default: 0 },
  defensibility: { type: Number, default: 0 },
  founder_credibility: { type: Number, default: 0 },
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mode: { type: String, enum: ['elevator', 'vc', 'deep'], required: true },
  startup_name: { type: String, default: '' },
  voice: { type: String, default: 'onyx' },
  transcript: [transcriptEntrySchema],
  scores: { type: scoresSchema, default: () => ({}) },
  conversation_history: [{ role: String, content: String }],
  summary: { type: String, default: null },
  final_report: { type: mongoose.Schema.Types.Mixed, default: null },
  ended_at: { type: Date, default: null },
}, { timestamps: true });

export const Session = mongoose.model('Session', sessionSchema);
