import { Router } from 'express';
import { getSettings, saveSettings, Settings } from '../lib/settings';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Get settings
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update settings
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const settings: Settings = req.body;
    // Basic validation could go here
    await saveSettings(settings);
    res.json(settings);
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export { router as settingsRoutes };
