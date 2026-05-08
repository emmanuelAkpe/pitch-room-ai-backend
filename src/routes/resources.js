import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getResourcesForDimensions } from '../services/resourceService.js';

const router = Router();
router.use(authenticate);

router.get('/', (req, res) => {
  const dimensions = (req.query.dimensions || '')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean);

  if (!dimensions.length) {
    return res.status(400).json({ detail: 'dimensions query param required' });
  }

  const level = parseInt(req.query.level, 10) || req.user?.level || 1;
  const resources = getResourcesForDimensions(dimensions, level);
  res.json({ resources });
});

export default router;
