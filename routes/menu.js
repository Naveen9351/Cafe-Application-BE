const express = require('express');
const router = express.Router();
const MenuItem = require('../models/MenuItem');

router.get('/', async (req, res) => {
  try {
    const { ids } = req.query;
    let query = {};
    if (ids) {
      const idArray = Array.isArray(ids) ? ids : ids.split(',');
      query = { _id: { $in: idArray } };
    }
    const items = await MenuItem.find(query).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error('Get menu error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;