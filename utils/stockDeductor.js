const Inventory = require('../models/Inventory');
const MenuItem = require('../models/MenuItem');

/**
 * Deducts raw materials from Inventory based on the recipe of the ordered items.
 * @param {Object} order - The mongoose order document.
 */
async function deductStockForOrder(order) {
  try {
    for (const orderItem of order.items) {
      const menuItem = await MenuItem.findById(orderItem.item);
      if (!menuItem || !menuItem.recipe || menuItem.recipe.length === 0) {
        continue;
      }

      // Deduct ingredients
      for (const recipeItem of menuItem.recipe) {
        const quantityToDeduct = recipeItem.quantity * orderItem.quantity;
        
        await Inventory.findOneAndUpdate(
          { _id: recipeItem.inventoryId, tenantId: order.tenantId },
          { $inc: { quantity: -quantityToDeduct } }
        );
      }
    }
    console.log(`Stock successfully deducted for Order: ${order._id}`);
  } catch (err) {
    console.error('Error deducting stock for order:', err);
  }
}

module.exports = deductStockForOrder;
