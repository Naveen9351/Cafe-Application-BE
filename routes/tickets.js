const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const Tenant = require('../models/Tenant');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

/**
 * @route   POST /api/tickets
 * @desc    Raise a new support ticket with optional screenshot
 * @access  Private (Tenant Admin / Staff)
 */
router.post('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { subject, category, description, priority, screenshotUrl, contactEmail, contactPhone } = req.body;

        if (!subject || !description) {
            return res.status(400).json({ error: 'Subject and description are required' });
        }

        const tenant = await Tenant.findById(tenantId);
        const ticketNumber = `TCK-${Math.floor(100000 + Math.random() * 900000)}`;

        const ticket = new SupportTicket({
            tenantId,
            tenantName: tenant ? tenant.name : 'Unknown Cafe',
            ticketNumber,
            subject,
            category: category || 'POS Terminal',
            description,
            priority: priority || 'normal',
            screenshotUrl: screenshotUrl || '',
            contactEmail: contactEmail || (tenant ? tenant.email : ''),
            contactPhone: contactPhone || (tenant ? tenant.phone : ''),
            status: 'open'
        });

        await ticket.save();

        console.log(`[SUPPORT TICKET] New ticket #${ticketNumber} created by ${tenant?.name || 'Cafe'}`);
        res.status(201).json({ success: true, message: `Ticket #${ticketNumber} raised successfully! Our engineering team will review it.`, ticket });
    } catch (err) {
        console.error('Raise ticket error:', err);
        res.status(500).json({ error: 'Failed to raise ticket: ' + err.message });
    }
});

/**
 * @route   GET /api/tickets
 * @desc    Get all tickets for the authenticated tenant
 * @access  Private
 */
router.get('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const tickets = await SupportTicket.find({ tenantId }).sort({ createdAt: -1 });
        res.json(tickets);
    } catch (err) {
        console.error('Fetch tickets error:', err);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

/**
 * @route   GET /api/tickets/all
 * @desc    Get all system tickets (Super Admin Only)
 * @access  Private (Super Admin)
 */
router.get('/all', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tickets = await SupportTicket.find().sort({ createdAt: -1 });
        res.json(tickets);
    } catch (err) {
        console.error('Fetch all tickets error:', err);
        res.status(500).json({ error: 'Failed to fetch all tickets' });
    }
});

/**
 * @route   PUT /api/tickets/:id/status
 * @desc    Update ticket status & admin notes
 * @access  Private
 */
router.put('/:id/status', auth, async (req, res) => {
    try {
        const { status, adminNotes } = req.body;
        const ticket = await SupportTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        if (status) ticket.status = status;
        if (adminNotes) ticket.adminNotes = adminNotes;
        ticket.updatedAt = new Date();

        await ticket.save();
        res.json({ success: true, ticket });
    } catch (err) {
        console.error('Update ticket error:', err);
        res.status(500).json({ error: 'Failed to update ticket' });
    }
});

module.exports = router;
