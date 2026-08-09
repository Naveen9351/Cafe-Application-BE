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

    const rawItems = await MenuItem.find(query).sort({ category: 1, name: 1 });
    
    // Auto-repair items with missing or non-URL images
    const items = rawItems.map(item => {
      const plain = item.toObject();
      const img = plain.image;
      if (!img || typeof img !== 'string' || (!img.startsWith('http://') && !img.startsWith('https://') && !img.startsWith('/uploads'))) {
        plain.image = `https://image.pollinations.ai/prompt/delicious%20food%20photo%20of%20${encodeURIComponent(plain.name || 'food')}%20gourmet%20dish?width=500&height=400&nologo=true`;
        // Background DB fix
        MenuItem.updateOne({ _id: plain._id }, { image: plain.image }).exec().catch(() => {});
      }
      return plain;
    });

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

      let imageUrl = req.body.image || '';
      if (req.file) {
        const folder = req.tenantId ? `cafe/${req.tenantId}/menu` : 'cafe/general/menu';
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: folder
        });
        imageUrl = result.secure_url;
      }
      
      if (!imageUrl || typeof imageUrl !== 'string' || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/uploads'))) {
        imageUrl = `https://image.pollinations.ai/prompt/delicious%20food%20photo%20of%20${encodeURIComponent(name)}%20gourmet%20dish?width=500&height=400&nologo=true`;
      }

      const newItem = new MenuItem({
        tenantId: req.tenantId || req.user?.tenantId || '6a762ef86c9d5c8be315f10a',
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
router.put('/:id', [auth, checkRole(['admin', 'super_admin'])], upload.single('image'), async (req, res) => {
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

    let filter = { _id: req.params.id };
    if (req.tenantId && req.user.role !== 'super_admin') {
      filter.tenantId = req.tenantId;
    }

    const item = await MenuItem.findOneAndUpdate(
      filter,
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

// Helper to delete image from Cloudinary
const deleteCloudinaryImage = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('res.cloudinary.com')) return;
  try {
    const urlParts = imageUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    if (uploadIndex === -1) return;
    
    let publicIdParts = urlParts.slice(uploadIndex + 1);
    if (publicIdParts[0] && publicIdParts[0].startsWith('v')) {
      publicIdParts = publicIdParts.slice(1);
    }
    
    const fullFilename = publicIdParts.join('/');
    const publicId = fullFilename.substring(0, fullFilename.lastIndexOf('.'));
    
    if (publicId && cloudinary.config().cloud_name) {
      console.log(`🗑️ Deleting image from Cloudinary: ${publicId}`);
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (err) {
    console.error("Cloudinary Image Deletion Error:", err.message);
  }
};

// DELETE Item
router.delete('/:id', [auth, checkRole(['admin', 'super_admin'])], async (req, res) => {
  try {
    let filter = { _id: req.params.id };
    if (req.tenantId && req.user.role !== 'super_admin') {
      filter.tenantId = req.tenantId;
    }

    const item = await MenuItem.findOne(filter);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (item.image) {
      await deleteCloudinaryImage(item.image);
    }

    await MenuItem.deleteOne({ _id: item._id });
    res.json({ message: 'Item and image deleted successfully' });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;