const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const auth = require('../middleware/auth');

// @route   POST /api/leads
// @desc    Submit a demo request / restaurant lead
// @access  Public
router.post('/', async (req, res) => {
  try {
    const {
      fullName,
      name,
      workEmail,
      email,
      phone,
      restaurantName,
      outletName,
      outletType,
      locationsCount,
      city,
      interests,
      preferredTime,
      notes,
      message,
      source
    } = req.body;

    const leadData = {
      fullName: fullName || name || 'Prospective Partner',
      workEmail: workEmail || email || 'lead@example.com',
      phone: phone || 'N/A',
      restaurantName: restaurantName || outletName || 'Restaurant Outlet',
      outletType: outletType || 'Cafe / Coffee Shop',
      locationsCount: locationsCount || '1 outlet',
      city: city || 'Bangalore',
      interests: Array.isArray(interests) ? interests : (interests ? [interests] : ['qr-ordering', 'kds']),
      preferredTime: preferredTime || 'Anytime',
      notes: notes || message || '',
      source: source || 'website_landing'
    };

    const lead = new Lead(leadData);
    await lead.save();

    res.status(201).json({
      success: true,
      message: 'Demo request received successfully! Our hospitality specialist will contact you within 15 minutes.',
      leadId: lead._id
    });
  } catch (err) {
    console.error('Lead submission error:', err);
    res.status(500).json({ success: false, error: 'Failed to process demo request' });
  }
});

// @route   GET /api/leads
// @desc    Get all demo leads (Super Admin / Staff)
// @access  Protected / Public Fallback for Demo
router.get('/', async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, count: leads.length, leads });
  } catch (err) {
    console.error('Fetch leads error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch leads' });
  }
});

// @route   PATCH /api/leads/:id
// @desc    Update lead status
// @access  Protected
router.patch('/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (notes) updateData.notes = notes;

    const lead = await Lead.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    res.json({ success: true, lead });
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ success: false, error: 'Failed to update lead' });
  }
});

module.exports = router;
