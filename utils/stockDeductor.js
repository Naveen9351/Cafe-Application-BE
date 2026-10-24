const Inventory = require('../models/Inventory');
const MenuItem = require('../models/MenuItem');

/**
 * Deducts raw materials from Inventory based on the recipe of the ordered items.
 * Uses single $in query and bulkWrite for ultra-fast execution.
 * @param {Object} order - The order object or document.
 */
async function deductStockForOrder(order) {
  try {
    if (!order || !order.items || order.items.length === 0) return;

    const itemIds = order.items.map(i => i.item).filter(Boolean);
    if (itemIds.length === 0) return;

    const menuItems = await MenuItem.find({ _id: { $in: itemIds } }).select('recipe').lean();
    const recipeMap = new Map(menuItems.map(m => [m._id.toString(), m.recipe]));

    const bulkOps = [];

    for (const orderItem of order.items) {
      const recipe = recipeMap.get(orderItem.item?.toString());
      if (!recipe || recipe.length === 0) continue;

      for (const recipeItem of recipe) {
        const quantityToDeduct = (recipeItem.quantity || 0) * (orderItem.quantity || 1);
        if (quantityToDeduct > 0 && recipeItem.inventoryId) {
          bulkOps.push({
            updateOne: {
              filter: { _id: recipeItem.inventoryId, tenantId: order.tenantId },
              update: { $inc: { quantity: -quantityToDeduct } }
            }
          });
        }
      }
    }

    if (bulkOps.length > 0) {
      await Inventory.bulkWrite(bulkOps, { ordered: false });
    }
  } catch (err) {
    console.error('Error deducting stock for order:', err.message);
  }
}

module.exports = deductStockForOrder;

