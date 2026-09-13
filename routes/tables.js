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
    const tables = await Table.find(filter).sort({ tableNumber: 1 });
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
    const { tableNumber, seatingCapacity, status } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    if (!tableNumber || String(tableNumber).trim() === '') {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const cleanTableNumber = String(tableNumber).trim();

    // Check for duplicate table number within the same tenant
    const existing = await Table.findOne({ tenantId, tableNumber: cleanTableNumber });
    if (existing) {
      return res.status(400).json({ error: `Table ${cleanTableNumber} already exists` });
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

    const updateData = {};
    if (tableNumber !== undefined) updateData.tableNumber = String(tableNumber).trim();
    if (seatingCapacity !== undefined) updateData.seatingCapacity = Number(seatingCapacity);
    if (status !== undefined) updateData.status = status;

    const filter = { _id: req.params.id };
    if (req.user.role !== 'super_admin') {
      filter.tenantId = tenantId;
    }

    const updatedTable = await Table.findOneAndUpdate(filter, updateData, { new: true });
    if (!updatedTable) {
      return res.status(404).json({ error: 'Table not found or unauthorized' });
    }

    res.json(updatedTable);
  } catch (err) {
    console.error('Update table error:', err);
    res.status(500).json({ error: 'Failed to update table' });
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

module.exports = router;
