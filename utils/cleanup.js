const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const mongoose = require('mongoose');

const archiveOldOrders = async () => {
    try {
        console.log('🧹 Starting Monthly Order Cleanup...');

        // 1. Find orders older than 30 days that are completed or cancelled
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Get unique tenant IDs from old orders
        const oldOrders = await Order.find({
            createdAt: { $lt: thirtyDaysAgo },
            status: { $in: ['completed', 'cancelled'] }
        });

        if (oldOrders.length === 0) {
            console.log('✅ No old orders to cleanup.');
            return;
        }

        // 2. Group revenue and count by tenant
        const totalsByTenant = oldOrders.reduce((acc, order) => {
            const tid = order.tenantId.toString();
            if (!acc[tid]) acc[tid] = { revenue: 0, count: 0 };

            // Only add revenue if completed
            if (order.status === 'completed') {
                acc[tid].revenue += order.total;
            }
            acc[tid].count += 1;
            return acc;
        }, {});

        // 3. Update Tenant historical data
        const updatePromises = Object.entries(totalsByTenant).map(async ([tid, totals]) => {
            return Tenant.findByIdAndUpdate(tid, {
                $inc: {
                    'analytics.historicalRevenue': totals.revenue,
                    'analytics.historicalOrderCount': totals.count
                }
            });
        });

        await Promise.all(updatePromises);

        // 4. Delete the archived orders
        const orderIds = oldOrders.map(o => o._id);
        const result = await Order.deleteMany({ _id: { $in: orderIds } });

        console.log(`✅ Successfully archived ${result.deletedCount} orders and updated historical data.`);
    } catch (err) {
        console.error('❌ Cleanup Task Error:', err);
    }
};

module.exports = archiveOldOrders;
