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

    // Clean and validate phone number
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.slice(2);
    } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
      cleanPhone = cleanPhone.slice(1);
    }

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'Mobile number must be exactly 10 digits' });
    }

    if (!/^[6-9]/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Invalid mobile number: Indian numbers must start with 6, 7, 8, or 9' });
    }

    if (/^(\d)\1{9}$/.test(cleanPhone) || cleanPhone === '1234567890' || cleanPhone === '0123456789') {
      return res.status(400).json({ success: false, error: 'Please enter a valid active mobile number' });
    }

    // Clean and validate email
    const rawEmail = String(workEmail || email || '').trim();
    if (!rawEmail) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(rawEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address (e.g. name@company.com)' });
    }

    const leadData = {
      fullName: fullName || contactName || name || 'Prospective Partner',
      workEmail: workEmail || email || `${cleanPhone}@lead.restaurant`,
      phone: cleanPhone,
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

    // Automatically record to real-time ActivityLog
    try {
      const ActivityLog = require('../models/ActivityLog');
      await ActivityLog.create({
        eventType: 'LEAD_SUBMISSION',
        action: `Submitted Live Demo Walkthrough Request (${leadData.restaurantName})`,
        category: 'Lead',
        path: '/demo',
        user: {
          name: leadData.fullName,
          email: leadData.workEmail,
          role: 'prospective_client',
          tenantName: leadData.restaurantName
        },
        city: leadData.city || 'Bangalore',
        device: req.headers['user-agent'] && /mobile/i.test(req.headers['user-agent']) ? 'Mobile' : 'Desktop',
        browser: 'Chrome',
        referrer: req.headers.referer || 'Website Demo Form',
        metadata: { phone: cleanPhone, outletType: leadData.outletType },
        timestamp: new Date()
      });
    } catch (logErr) {
      // Non-blocking analytics
    }

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
