import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const SECRET = () => process.env.SECRET_KEY || 'dev-secret';
const EXPIRES_MINUTES = () => parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || '1440');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ detail: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ detail: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ detail: 'An account with this email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashed });

    res.status(201).json({ id: user._id, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

router.post('/token', async (req, res) => {
  try {
    const email = req.body.username || req.body.email;
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ detail: 'Incorrect email or password' });
    }

    const token = jwt.sign({ sub: user._id.toString() }, SECRET(), {
      expiresIn: `${EXPIRES_MINUTES()}m`,
    });

    res.json({ access_token: token, token_type: 'bearer' });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  const { _id, name, email, xp, level, badges, streak, active_goals } = req.user;
  res.json({ id: _id, name, email, xp: xp || 0, level: level || 1, badges: badges || [], streak: streak || 0, active_goals: active_goals || null });
});

router.post('/goals', authenticate, async (req, res) => {
  try {
    const { from_session_id, level, target_score, goals } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      active_goals: { from_session_id, accepted_at: new Date(), level, target_score, goals },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

export default router;
