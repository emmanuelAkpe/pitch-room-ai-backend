import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.SECRET_KEY || 'dev-secret');
    const user = await User.findById(payload.sub).select('-password');
    if (!user) return res.status(401).json({ detail: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ detail: 'Invalid or expired token' });
  }
}
