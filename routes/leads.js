const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

// Handler for creating a lead
const createLeadHandler = async (req, res) => {
  try {
    const {
      fullName,
      contactName,
      name,
      workEmail,
      email,
      phone,
      restaurantName,
      outletName,
      outletType,
      locationsCount,
      outletCount,
      city,
      address,
      interests,
      preferredTime,
      notes,
      message,
      source
    } = req.body;

    const leadData = {
      fullName: fullName || contactName || name || 'Prospective Partner',
      workEmail: workEmail || email || (phone ? `${phone}@lead.restaurant` : 'lead@example.com'),
      phone: phone || 'N/A',
      restaurantName: restaurantName || outletName || name || 'Restaurant Outlet',
      outletType: outletType || 'Cafe / Coffee Shop',
      locationsCount: locationsCount || outletCount || '1 outlet',
      city: city || 'Bangalore',
      interests: Array.isArray(interests) ? interests : (interests ? [interests] : ['qr-ordering', 'kds']),
      preferredTime: preferredTime || 'Anytime',
      notes: notes || message || address || '',
      source: source || 'website_landing'
    };

    const lead = new Lead(leadData);
    await lead.save();

    res.status(201).json({
      success: true,
      message: 'Demo request received successfully! Our hospitality specialist will contact you within 15 minutes.',
      leadId: lead._id,
      lead
    });
  } catch (err) {
    console.error('Lead submission error:', err);
    res.status(500).json({ success: false, error: 'Failed to process demo request' });
  }
};

// @route   POST /api/leads & POST /api/leads/demo-request
// @desc    Submit a demo request / restaurant lead
// @access  Public
router.post('/', createLeadHandler);
router.post('/demo-request', createLeadHandler);

// @route   GET /api/leads
// @desc    Get all demo leads (Super Admin Only)
// @access  Protected
router.get('/', [auth, checkRole(['super_admin'])], async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, count: leads.length, leads });
  } catch (err) {
    console.error('Fetch leads error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch leads' });
  }
});

// @route   PATCH /api/leads/:id
// @desc    Update lead status (Super Admin Only)
// @access  Protected
router.patch('/:id', [auth, checkRole(['super_admin'])], async (req, res) => {
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

// @route   DELETE /api/leads/:id
// @desc    Delete lead (Super Admin Only)
// @access  Protected
router.delete('/:id', [auth, checkRole(['super_admin'])], async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete lead' });
  }
});

module.exports = router;
