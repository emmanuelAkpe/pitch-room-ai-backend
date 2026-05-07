import { Router } from 'express';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { generateFinalReport } from '../services/aiService.js';

const router = Router();
router.use(authenticate);

// ── Gamification helpers ────────────────────────────────────────────────────

function avgScoreObj(scores) {
  if (!scores) return 0;
  const vals = Object.values(scores).filter(v => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function calculateLevel(xp) {
  if (xp >= 5000) return 6;
  if (xp >= 2000) return 5;
  if (xp >= 1000) return 4;
  if (xp >= 500) return 3;
  if (xp >= 200) return 2;
  return 1;
}

function computeNewBadges(user, session, report, prevSessions) {
  const earned = [];
  const existing = new Set(user.badges || []);
  const overall = report?.overall_score || avgScoreObj(session.scores) || 0;

  if (!existing.has('first_pitch') && prevSessions.length === 0) earned.push('first_pitch');
  if (!existing.has('survivor') && overall >= 50) earned.push('survivor');
  if (!existing.has('vc_gauntlet') && session.mode === 'vc') earned.push('vc_gauntlet');
  if (!existing.has('deep_diver') && session.mode === 'deep') earned.push('deep_diver');
  if (!existing.has('high_scorer') && overall >= 70) earned.push('high_scorer');
  if (!existing.has('investor_ready') && overall >= 80 && (session.mode === 'vc' || session.mode === 'deep')) {
    earned.push('investor_ready');
  }
  const allModes = new Set([...prevSessions.map(s => s.mode), session.mode]);
  if (!existing.has('triple_threat') && allModes.size >= 3) earned.push('triple_threat');
  const dimScores = Object.values(report?.scores || session.scores || {});
  if (!existing.has('perfectionist') && dimScores.some(s => s >= 90)) earned.push('perfectionist');

  return earned;
}

// ── Response formatter ──────────────────────────────────────────────────────

function fmt(s, xpPayload) {
  return {
    id: s._id,
    user_id: s.user_id,
    mode: s.mode,
    startup_name: s.startup_name,
    transcript: s.transcript,
    scores: s.scores,
    summary: s.summary,
    final_report: s.final_report,
    voice: s.voice || 'onyx',
    ended_at: s.ended_at,
    created_at: s.createdAt,
    ...(xpPayload || {}),
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { mode, startup_name, voice } = req.body;
    if (!mode) return res.status(400).json({ detail: 'mode is required' });
    const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    const safeVoice = VALID_VOICES.includes(voice) ? voice : 'onyx';
    const session = await Session.create({ user_id: req.user._id, mode, startup_name: startup_name || '', voice: safeVoice });
    res.status(201).json(fmt(session));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const sessions = await Session.find({ user_id: req.user._id }).sort({ createdAt: -1 });
    res.json(sessions.map(s => fmt(s)));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!session) return res.status(404).json({ detail: 'Session not found' });
    res.json(fmt(session));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

router.post('/:id/end', async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!session) return res.status(404).json({ detail: 'Session not found' });

    let report = session.final_report;
    if (session.transcript.length > 0 && !report) {
      report = await generateFinalReport(session);
      if (report) {
        session.final_report = report;
        session.summary = report.summary;
      }
    }

    session.ended_at = new Date();
    await session.save();

    // ── XP + badge calculation ──────────────────────────────────────────────
    let xpPayload = {};
    if (session.transcript.length >= 2) {
      let xpEarned = 50; // base for completing
      const overall = report?.overall_score || avgScoreObj(session.scores) || 0;
      if (overall >= 50) xpEarned += 25;
      if (overall >= 70) xpEarned += 50;
      if (overall >= 85) xpEarned += 100;

      // Bonus for first session in this mode
      const prevSessions = await Session.find({
        user_id: req.user._id,
        ended_at: { $ne: null },
        _id: { $ne: session._id },
      });
      const usedModes = new Set(prevSessions.map(s => s.mode));
      if (!usedModes.has(session.mode)) xpEarned += 30;

      // Perfect dimension bonus
      const dimScores = Object.values(report?.scores || session.scores || {});
      xpEarned += dimScores.filter(s => s >= 90).length * 10;

      // Update user
      const freshUser = await User.findById(session.user_id);
      const prevXP = freshUser.xp || 0;
      const newXP = prevXP + xpEarned;
      const prevLevel = freshUser.level || 1;
      const newLevel = calculateLevel(newXP);
      const leveledUp = newLevel > prevLevel;
      const newBadges = computeNewBadges(freshUser, session, report, prevSessions);

      // Auto-complete active goals based on this session's scores
      let goalsCompleted = [];
      const ag = freshUser.active_goals;
      if (ag?.goals?.length && ag.from_session_id !== session._id.toString()) {
        const sessionScores = report?.scores || session.scores || {};
        const tgt = ag.target_score || 45;
        const updatedGoals = ag.goals.map(g => {
          if (g.completed) return g;
          if ((sessionScores[g.dimension] || 0) >= tgt) {
            goalsCompleted.push({ id: g.id, title: g.title, dimension: g.dimension });
            return { ...g.toObject(), completed: true };
          }
          return g;
        });
        if (goalsCompleted.length) {
          await User.findByIdAndUpdate(freshUser._id, { 'active_goals.goals': updatedGoals });
          xpEarned += goalsCompleted.length * 30; // +30 XP per completed goal
        }
      }

      await User.findByIdAndUpdate(freshUser._id, {
        xp: newXP,
        level: newLevel,
        lastSessionDate: new Date(),
        ...(newBadges.length ? { $addToSet: { badges: { $each: newBadges } } } : {}),
      });

      xpPayload = { xp_earned: xpEarned, new_badges: newBadges, user_xp: newXP, user_level: newLevel, leveled_up: leveledUp, goals_completed: goalsCompleted };
    }

    res.json(fmt(session, xpPayload));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

export default router;
