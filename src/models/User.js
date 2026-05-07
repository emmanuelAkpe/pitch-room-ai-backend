import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, required: true },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  badges: [{ type: String }],
  streak: { type: Number, default: 0 },
  lastSessionDate: { type: Date },
  active_goals: {
    from_session_id: String,
    accepted_at: Date,
    level: Number,
    target_score: Number,
    goals: [{
      id: String,
      dimension: String,
      title: String,
      completed: { type: Boolean, default: false },
    }],
  },
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
