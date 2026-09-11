const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
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

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'dish-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Helper to safely upload file to Cloudinary with local static fallback
const uploadDishImage = async (filePath, tenantId) => {
  if (cloudinary.config().cloud_name && cloudinary.config().api_key) {
    try {
      const folder = tenantId ? `cafe/${tenantId}/menu` : 'cafe/general/menu';
      const result = await cloudinary.uploader.upload(filePath, { folder });
      // Delete temporary local file after Cloudinary upload
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return result.secure_url;
    } catch (err) {
      console.warn("Cloudinary upload failed, falling back to local static URL:", err.message);
    }
  }

  // Fallback: Return relative local /uploads path
  const filename = path.basename(filePath);
  return `/uploads/${filename}`;
};

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

// GET Public Menu (Filter by Tenant)
router.get('/', async (req, res) => {
  try {
    const { tenantId, category, search, includeUnavailable } = req.query;

    let query = {};
    if (includeUnavailable !== 'true') {
      query.isAvailable = true;
    }

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
    body('name').trim().notEmpty().withMessage('Dish name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a valid positive number'),
    body('category').trim().notEmpty().withMessage('Category is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { name, description, price, category, isVeg, isAvailable } = req.body;
      const numPrice = Number(price);

      // Parse & Validate Discount
      let discountObj = { isDiscounted: false, type: 'percentage', value: 0 };
      if (req.body.discount) {
        try {
          const parsed = typeof req.body.discount === 'string' ? JSON.parse(req.body.discount) : req.body.discount;
          discountObj.isDiscounted = Boolean(parsed.isDiscounted);
          discountObj.type = parsed.type === 'amount' ? 'amount' : 'percentage';
          discountObj.value = Number(parsed.value) || 0;
        } catch (e) {
          // ignore parse error
        }
      }

      if (discountObj.isDiscounted) {
        if (discountObj.value <= 0) {
          return res.status(400).json({ error: 'Discount value must be greater than 0' });
        }
        if (discountObj.type === 'percentage' && discountObj.value >= 100) {
          return res.status(400).json({ error: 'Percentage discount must be less than 100%' });
        }
        if (discountObj.type === 'amount' && discountObj.value >= numPrice) {
          return res.status(400).json({ error: `Discount amount (₹${discountObj.value}) must be less than the original price (₹${numPrice})` });
        }
      }

      let imageUrl = req.body.image || '';
      if (req.file) {
        imageUrl = await uploadDishImage(req.file.path, req.tenantId || req.user?.tenantId);
      }
      
      if (!imageUrl || typeof imageUrl !== 'string' || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/uploads'))) {
        imageUrl = `https://image.pollinations.ai/prompt/delicious%20food%20photo%20of%20${encodeURIComponent(name)}%20gourmet%20dish?width=500&height=400&nologo=true`;
      }

      const newItem = new MenuItem({
        tenantId: req.tenantId || req.user?.tenantId || '6a762ef86c9d5c8be315f10a',
        name: name.trim(),
        description: description ? description.trim() : '',
        price: numPrice,
        category: category.trim(),
        image: imageUrl,
        isVeg: isVeg !== undefined ? (isVeg === 'true' || isVeg === true) : true,
        isAvailable: isAvailable !== undefined ? (isAvailable === 'true' || isAvailable === true) : true,
        discount: discountObj
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
    const { name, description, price, category, isVeg, isAvailable } = req.body;
    let updateData = {};

    if (name !== undefined) updateData.name = String(name).trim();
    if (description !== undefined) updateData.description = String(description).trim();
    if (category !== undefined) updateData.category = String(category).trim();
    if (isVeg !== undefined) updateData.isVeg = (isVeg === 'true' || isVeg === true);
    if (isAvailable !== undefined) updateData.isAvailable = (isAvailable === 'true' || isAvailable === true);

    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ error: 'Price must be a non-negative number' });
      }
      updateData.price = numPrice;
    }

    // Handle Discount
    if (req.body.discount !== undefined) {
      let discountObj = { isDiscounted: false, type: 'percentage', value: 0 };
      try {
        const parsed = typeof req.body.discount === 'string' ? JSON.parse(req.body.discount) : req.body.discount;
        discountObj.isDiscounted = Boolean(parsed.isDiscounted);
        discountObj.type = parsed.type === 'amount' ? 'amount' : 'percentage';
        discountObj.value = Number(parsed.value) || 0;
      } catch (e) {
        // ignore parse error
      }

      const effectivePrice = updateData.price !== undefined ? updateData.price : (await MenuItem.findById(req.params.id))?.price || 0;

      if (discountObj.isDiscounted) {
        if (discountObj.value <= 0) {
          return res.status(400).json({ error: 'Discount value must be greater than 0' });
        }
        if (discountObj.type === 'percentage' && discountObj.value >= 100) {
          return res.status(400).json({ error: 'Percentage discount must be less than 100%' });
        }
        if (discountObj.type === 'amount' && discountObj.value >= effectivePrice) {
          return res.status(400).json({ error: `Discount amount (₹${discountObj.value}) must be less than original price (₹${effectivePrice})` });
        }
      }

      updateData.discount = discountObj;
    }

    if (req.file) {
      updateData.image = await uploadDishImage(req.file.path, req.tenantId || req.user?.tenantId);
    } else if (req.body.image) {
      updateData.image = req.body.image;
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
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// DELETE Item
router.delete('/:id', [auth, checkRole(['admin', 'super_admin'])], async (req, res) => {
  try {
    let filter = { _id: req.params.id };
    if (req.tenantId && req.user.role !== 'super_admin') {
      filter.tenantId = req.tenantId;
    }

    const item = await MenuItem.findOne(filter);
    if (!item) return res.status(404).json({ error: 'Item not found or unauthorized' });

    if (item.image) {
      await deleteCloudinaryImage(item.image);
    }

    await MenuItem.deleteOne({ _id: item._id });
    res.json({ message: 'Item deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;