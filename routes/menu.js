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
const { resolveFoodImage } = require('../utils/foodImageResolver');

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

    let rawItems = await MenuItem.find(query).sort({ category: 1, name: 1 }).lean();
    

    
    // Auto-repair items with missing, broken, or rate-limited pollinations images
    const items = rawItems.map(item => {
      if (!item.image || typeof item.image !== 'string' || item.image.includes('pollinations.ai') || (!item.image.startsWith('http://') && !item.image.startsWith('https://') && !item.image.startsWith('/uploads'))) {
        item.image = resolveFoodImage(item.name, item.category);
        MenuItem.updateOne({ _id: item._id }, { image: item.image }).exec().catch(() => {});
      }
      return item;
    });

    // Deduplicate items so identical dishes (by id or name+category) are never returned multiple times
    const seen = new Set();
    const uniqueItems = [];
    for (const item of items) {
      const idKey = String(item._id || item.id || '');
      const nameCatKey = `${String(item.name || '').toLowerCase().trim()}__${String(item.category || '').toLowerCase().trim()}`;
      if (idKey && seen.has(idKey)) continue;
      if (nameCatKey && seen.has(nameCatKey)) continue;
      if (idKey) seen.add(idKey);
      if (nameCatKey) seen.add(nameCatKey);
      uniqueItems.push(item);
    }

    res.json(uniqueItems);
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
      const numPrice = Math.round(Number(price));
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ error: 'Price must be a valid integer number' });
      }

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
      
      if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.includes('pollinations.ai') || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/uploads'))) {
        imageUrl = resolveFoodImage(name, category);
      }

      let variantsArr = [];
      if (req.body.variants) {
        try {
          const parsed = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
          if (Array.isArray(parsed)) {
            variantsArr = parsed
              .filter(v => v && typeof v === 'object' && v.name && String(v.name).trim())
              .map(v => ({
                name: String(v.name).trim(),
                price: Number(v.price) >= 0 ? Math.round(Number(v.price)) : numPrice
              }));
          }
        } catch (e) {
          console.warn('Variants parse error:', e.message);
        }
      }

      let addonsArr = [];
      if (req.body.addons) {
        try {
          const parsed = typeof req.body.addons === 'string' ? JSON.parse(req.body.addons) : req.body.addons;
          if (Array.isArray(parsed)) {
            addonsArr = parsed
              .filter(a => a && typeof a === 'object' && a.name && String(a.name).trim())
              .map(a => ({
                name: String(a.name).trim(),
                price: Number(a.price) >= 0 ? Math.round(Number(a.price)) : 0
              }));
          }
        } catch (e) {
          console.warn('Addons parse error:', e.message);
        }
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
        discount: discountObj,
        variants: variantsArr,
        addons: addonsArr
      });

      await newItem.save();
      res.status(201).json(newItem);

    } catch (err) {
      console.error('Add menu item error:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  }
);

// POST Bulk Insert Menu Items (From AI Menu Card Extraction or Bulk CSV)
router.post(
  '/bulk',
  [auth, checkRole(['admin', 'super_admin'])],
  async (req, res) => {
    try {
      const rawItems = Array.isArray(req.body.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);
      if (!rawItems || rawItems.length === 0) {
        return res.status(400).json({ error: 'No menu items provided for bulk insert' });
      }

      const tenantId = req.tenantId || req.user?.tenantId || '6a762ef86c9d5c8be315f10a';

      const validDocs = [];
      for (const item of rawItems) {
        if (!item || !item.name) continue;
        const name = String(item.name).trim();
        if (!name) continue;

        let numPrice = Math.round(Number(item.price));
        if (isNaN(numPrice) || numPrice < 0) numPrice = 0;

        let category = item.category ? String(item.category).trim().toLowerCase() : 'snacks';
        
        let isVeg = true;
        if (item.type !== undefined) {
          isVeg = String(item.type).toLowerCase() === 'veg';
        } else if (item.isVeg !== undefined) {
          isVeg = item.isVeg === true || item.isVeg === 'true';
        }

        let imageUrl = item.image || '';
        if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.includes('pollinations.ai') || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/uploads'))) {
          imageUrl = resolveFoodImage(name, category);
        }

        validDocs.push({
          tenantId,
          name,
          description: item.description ? String(item.description).trim() : `Fresh and delicious ${name} prepared to order.`,
          price: numPrice,
          category,
          image: imageUrl,
          isVeg,
          isAvailable: item.isAvailable !== false,
          discount: item.discount || { isDiscounted: false, type: 'percentage', value: 0 },
          variants: Array.isArray(item.variants) ? item.variants : [],
          addons: Array.isArray(item.addons) ? item.addons : []
        });
      }

      if (validDocs.length === 0) {
        return res.status(400).json({ error: 'No valid items found to insert' });
      }

      const inserted = await MenuItem.insertMany(validDocs);

      console.log(`✅ Bulk inserted ${inserted.length} menu items for tenant ${tenantId}`);

      res.status(201).json({
        success: true,
        count: inserted.length,
        items: inserted
      });
    } catch (err) {
      console.error('Bulk menu insert error:', err);
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
      const numPrice = Math.round(Number(price));
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ error: 'Price must be a non-negative integer' });
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

    // Handle Variants / Labels & Pricing
    if (req.body.variants !== undefined) {
      let variantsArr = [];
      try {
        const parsed = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
        if (Array.isArray(parsed)) {
          variantsArr = parsed
            .filter(v => v && typeof v === 'object' && v.name && String(v.name).trim())
            .map(v => ({
              name: String(v.name).trim(),
              price: Number(v.price) >= 0 ? Math.round(Number(v.price)) : (updateData.price || 0)
            }));
        }
      } catch (e) {
        console.warn('Variants parse error in update:', e.message);
      }
      updateData.variants = variantsArr;
    }

    // Handle Addons
    if (req.body.addons !== undefined) {
      let addonsArr = [];
      try {
        const parsed = typeof req.body.addons === 'string' ? JSON.parse(req.body.addons) : req.body.addons;
        if (Array.isArray(parsed)) {
          addonsArr = parsed
            .filter(a => a && typeof a === 'object' && a.name && String(a.name).trim())
            .map(a => ({
              name: String(a.name).trim(),
              price: Number(a.price) >= 0 ? Math.round(Number(a.price)) : 0
            }));
        }
      } catch (e) {
        console.warn('Addons parse error in update:', e.message);
      }
      updateData.addons = addonsArr;
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