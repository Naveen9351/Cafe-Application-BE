const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Table = require('../models/Table');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

const jwt = require('jsonwebtoken');

// GET /api/tables - Fetch all tables for the tenant (supports token or tenantId query)
router.get('/', async (req, res) => {
  try {
    let tenantId = req.query.tenantId;

    if (!tenantId && req.headers['x-auth-token']) {
      try {
        const decoded = jwt.verify(req.headers['x-auth-token'], process.env.JWT_SECRET || 'secret');
        tenantId = decoded.user?.tenantId || decoded.tenantId;
      } catch (e) {}
    }

    const filter = tenantId ? { tenantId } : {};
    let tables = await Table.find(filter).sort({ createdAt: 1, _id: 1 }).lean();

    if (tenantId && tables.length === 0) {
      const initialTables = [
        { tenantId, tableNumber: '1', seatingCapacity: 4, status: 'available' },
        { tenantId, tableNumber: '2', seatingCapacity: 4, status: 'available' },
        { tenantId, tableNumber: '3', seatingCapacity: 4, status: 'available' },
        { tenantId, tableNumber: '4', seatingCapacity: 4, status: 'available' }
      ];
      try {
        tables = await Table.insertMany(initialTables);
      } catch (seedErr) {
        console.log('Seed tables fallback warning:', seedErr.message);
      }
    }

    res.json(tables);
  } catch (err) {
    console.error('Fetch tables error:', err);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

// POST /api/tables - Create a new table for the tenant
router.post('/', [auth, checkRole(['admin', 'super_admin'])], async (req, res) => {
  try {
    const tenantId = req.user.tenantId || req.tenantId;
    const { tableNumber, seatingCapacity, status, section } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    if (!tableNumber || String(tableNumber).trim() === '') {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const cleanTableNumber = String(tableNumber).trim();

    // Check for duplicate table number within the same tenant (case-insensitive)
    const existing = await Table.findOne({
      tenantId,
      tableNumber: { $regex: new RegExp(`^${cleanTableNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (existing) {
      return res.status(400).json({ error: `Table "${cleanTableNumber}" already exists` });
    }

    const newTable = new Table({
      tenantId,
      tableNumber: cleanTableNumber,
      seatingCapacity: Number(seatingCapacity) || 4,
      status: status || 'available'
    });

    await newTable.save();
    res.status(201).json(newTable);
  } catch (err) {
    console.error('Create table error:', err);
    res.status(500).json({ error: 'Failed to create table: ' + err.message });
  }
});

// PUT /api/tables/:id - Update table
router.put('/:id', [auth, checkRole(['admin', 'super_admin'])], async (req, res) => {
  try {
    const tenantId = req.user.tenantId || req.tenantId;
    const { tableNumber, seatingCapacity, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Table ID' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role !== 'super_admin') {
      filter.tenantId = tenantId;
    }

    const updateData = {};
    if (tableNumber !== undefined) {
      const cleanTableNumber = String(tableNumber).trim();
      if (!cleanTableNumber) {
        return res.status(400).json({ error: 'Table number is required' });
      }

      // Check for duplicate table number within the same tenant
      const duplicate = await Table.findOne({
        tenantId: filter.tenantId || tenantId,
        tableNumber: { $regex: new RegExp(`^${cleanTableNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        _id: { $ne: req.params.id }
      });

      if (duplicate) {
        return res.status(400).json({ error: `Table "${cleanTableNumber}" already exists` });
      }

      updateData.tableNumber = cleanTableNumber;
    }

    if (seatingCapacity !== undefined) updateData.seatingCapacity = Number(seatingCapacity);
    if (section !== undefined) updateData.section = String(section).trim();
    if (status !== undefined) updateData.status = status;

    const updatedTable = await Table.findOneAndUpdate(filter, updateData, { new: true });
    if (!updatedTable) {
      return res.status(404).json({ error: 'Table not found or unauthorized' });
    }

    res.json(updatedTable);
  } catch (err) {
    console.error('Update table error:', err);
    res.status(500).json({ error: 'Failed to update table: ' + err.message });
  }
});

// DELETE /api/tables/:id - Delete a table
router.delete('/:id', [auth, checkRole(['admin', 'super_admin'])], async (req, res) => {
  try {
    const tenantId = req.user.tenantId || req.tenantId;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Table ID' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role !== 'super_admin') {
      filter.tenantId = tenantId;
    }

    const deleted = await Table.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ error: 'Table not found or unauthorized' });
    }

    res.json({ message: 'Table deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete table error:', err);
    res.status(500).json({ error: 'Failed to delete table' });
  }
});

const ServiceRequest = require('../models/ServiceRequest');

// POST /api/tables/service-request - Customer calls staff or requests bill
router.post('/service-request', async (req, res) => {
  try {
    const { tableNumber, tenantId, type, customerName, customerPhone, paymentMethod, amount, notes } = req.body;

    if (!tableNumber) {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const cleanTable = String(tableNumber).trim().replace(/^Table\s*#?/i, '');
    const targetTenant = tenantId || 'default';

    // Anti-spam rate limit: check if same table & type requested within last 45 seconds
    const fortyFiveSecsAgo = new Date(Date.now() - 45 * 1000);
    const recentRequest = await ServiceRequest.findOne({
      tenantId: targetTenant,
      tableNumber: cleanTable,
      type: type || 'call_waiter',
      status: 'pending',
      createdAt: { $gte: fortyFiveSecsAgo }
    });

    if (recentRequest) {
      return res.json({
        success: true,
        alreadyActive: true,
        message: 'Staff has already been alerted! They are on their way.',
        request: recentRequest
      });
    }

    const newRequest = new ServiceRequest({
      tenantId: targetTenant,
      tableNumber: cleanTable,
      customerName: customerName || 'Guest Diner',
      customerPhone: customerPhone || '',
      type: type || 'call_waiter',
      paymentMethod: paymentMethod || null,
      amount: Number(amount) || 0,
      notes: notes || '',
      status: 'pending'
    });

    await newRequest.save();

    // If bill requested, mark table status in DB
    if (type === 'request_bill') {
      try {
        await Table.findOneAndUpdate(
          { tenantId: targetTenant, tableNumber: cleanTable },
          { status: 'bill_requested' }
        );
      } catch (tErr) {}
    }

    // Live real-time broadcast via Socket.io
    const alertPayload = {
      _id: newRequest._id,
      id: newRequest._id,
      tableNumber: cleanTable,
      tenantId: targetTenant,
      type: newRequest.type,
      customerName: newRequest.customerName,
      customerPhone: newRequest.customerPhone,
      paymentMethod: newRequest.paymentMethod,
      amount: newRequest.amount,
      notes: newRequest.notes,
      status: newRequest.status,
      createdAt: newRequest.createdAt
    };

    if (global.io) {
      // 1. Broadcast to tenant room
      if (targetTenant && targetTenant !== 'default') {
        global.io.to(targetTenant.toString()).emit('tableServiceAlert', alertPayload);
      }
      // 2. Also emit to all connected staff sockets (fallback for unassigned rooms)
      global.io.emit('tableServiceAlert', alertPayload);
    }

    console.log(`🛎️ Table service alert dispatched: Table ${cleanTable} - ${newRequest.type}`);

    res.status(201).json({
      success: true,
      message: type === 'request_bill' ? 'Bill requested' : 'Staff called',
      request: alertPayload
    });
  } catch (err) {
    console.error('Service request error:', err);
    res.status(500).json({ error: 'Failed to notify staff: ' + err.message });
  }
});

// GET /api/tables/service-requests - Fetch active service alerts for tenant/staff
router.get('/service-requests', async (req, res) => {
  try {
    let tenantId = req.query.tenantId;

    if (!tenantId && req.headers['x-auth-token']) {
      try {
        const decoded = jwt.verify(req.headers['x-auth-token'], process.env.JWT_SECRET || 'secret');
        tenantId = decoded.user?.tenantId || decoded.tenantId;
      } catch (e) {}
    }

    const filter = {};
    if (tenantId && tenantId !== 'all') {
      filter.tenantId = tenantId;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    } else {
      filter.status = { $in: ['pending', 'attending'] };
    }

    const requests = await ServiceRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    res.json(requests);
  } catch (err) {
    console.error('Fetch service requests error:', err);
    res.status(500).json({ error: 'Failed to fetch service requests' });
  }
});

// PUT /api/tables/service-requests/:id - Mark request as attending or resolved
router.put('/service-requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'attending', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = await ServiceRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (global.io) {
      if (updated.tenantId) {
        global.io.to(updated.tenantId.toString()).emit('tableServiceResolved', {
          id: updated._id,
          status: updated.status,
          tableNumber: updated.tableNumber
        });
      }
      global.io.emit('tableServiceResolved', {
        id: updated._id,
        status: updated.status,
        tableNumber: updated.tableNumber
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update service request error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

module.exports = router;

