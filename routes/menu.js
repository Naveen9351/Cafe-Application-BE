const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const MenuItem = require('../models/MenuItem');

// Configure Cloudinary
try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} catch (err) {
  console.error("Cloudinary config error:", err);
}

const upload = multer({ dest: 'uploads/' });

// GET Public Menu (Filter by Tenant)
router.get('/', async (req, res) => {
  try {
    const { tenantId, category, search } = req.query;

    if (!tenantId) {
      // Allow fallback if no tenantId provided, but ideally we want it
      // return res.status(400).json({ error: 'Tenant ID is required to fetch menu' });
    }

    let query = { isAvailable: true };
    if (tenantId) query.tenantId = tenantId;

    if (category && category !== 'all') {
      query.category = category;
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const items = await MenuItem.find(query).sort({ category: 1, name: 1 });
    res.json(items);
  } catch (err) {
    console.error('Get menu error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST Add Item (Admin only)
router.post(
  '/',
  [
    auth,
    checkRole(['admin', 'super_admin']),
    upload.single('image'),
    body('name').notEmpty(),
    body('price').isFloat({ min: 0 }),
    body('category').notEmpty()
  ],
  async (req, res) => {
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { name, description, price, category } = req.body;

      if (!cloudinary.config().cloud_name) {
        return res.status(500).json({ error: 'Cloudinary not configured' });
      }

      let imageUrl = '';
      if (req.file) {
        // Fix: Ensure we have a valid tenantId even if req.tenantId is missing (SuperAdmin fallback)
        const folder = req.tenantId ? `cafe/${req.tenantId}/menu` : 'cafe/general/menu';

        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: folder
        });
        imageUrl = result.secure_url;
      } else {
        return res.status(400).json({ error: 'Image is required' });
      }

      const newItem = new MenuItem({
        tenantId: req.tenantId || req.user.tenantId, // Fallback
        name,
        description,
        price,
        category,
        image: imageUrl
      });

      await newItem.save();
      res.status(201).json(newItem);

    } catch (err) {
      console.error('Add menu item error:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  }
);

// PUT Update Item
router.put('/:id', [auth, checkRole(['admin'])], upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, isAvailable } = req.body;

    let updateData = { name, description, price, category, isAvailable };

    if (req.file) {
      if (!cloudinary.config().cloud_name) {
        return res.status(500).json({ error: 'Cloudinary not configured' });
      }
      const folder = req.tenantId ? `cafe/${req.tenantId}/menu` : 'cafe/general/menu';
      const result = await cloudinary.uploader.upload(req.file.path, { folder: folder });
      updateData.image = result.secure_url;
    }

    // Ensure we only update items belonging to this tenant
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      updateData,
      { new: true }
    );

    if (!item) return res.status(404).json({ error: 'Item not found or unauthorized' });

    res.json(item);

  } catch (err) {
    console.error('Update item error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE Item
router.delete('/:id', [auth, checkRole(['admin'])], async (req, res) => {
  try {
    const item = await MenuItem.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;