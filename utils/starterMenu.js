const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');

const starterDishes = [
  {
    name: 'Wagyu Truffle Burger',
    description: 'Premium wagyu beef patty, black truffle oil, fontina cheese, and arugula on a toasted brioche bun.',
    price: 480,
    category: 'burger',
    isVeg: false,
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=600',
    variants: [
      { name: 'Single Patty', price: 480 },
      { name: 'Double Wagyu', price: 620 }
    ],
    isAvailable: true
  },
  {
    name: 'Smoked Vanilla Cold Brew',
    description: '24-hour slow steeped Ethiopian single-origin coffee with housemade Madagascar vanilla bean syrup.',
    price: 189,
    category: 'cold-coffee',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&q=80&w=600',
    variants: [
      { name: 'Small (250ml)', price: 189 },
      { name: 'Medium (350ml)', price: 239 },
      { name: 'Large (500ml)', price: 279 }
    ],
    isAvailable: true
  },
  {
    name: 'Valrhona Molten Chocolate Lava',
    description: 'Warm dark chocolate fondant with Madagascar vanilla gelato.',
    price: 249,
    category: 'desserts',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&q=80&w=600',
    isAvailable: true
  },
  {
    name: 'Burrata Caprese Salad',
    description: 'Creamy pugliese burrata, heirloom cherry tomatoes, cold-pressed olive oil, aged balsamic, and toasted sourdough.',
    price: 289,
    category: 'snacks',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1592417817098-8f3d6910985c?auto=format&fit=crop&q=80&w=600',
    isAvailable: true
  },
  {
    name: 'Artisan Cappuccino',
    description: 'Rich double espresso balanced with velvety steamed whole milk and deep froth layer.',
    price: 160,
    category: 'hot-coffee',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&q=80&w=600',
    variants: [
      { name: 'Regular', price: 160 },
      { name: 'Large', price: 210 }
    ],
    isAvailable: true
  },
  {
    name: 'Masala Chai',
    description: 'Freshly brewed Assam tea with crushed ginger, cardamom, clove and whole milk.',
    price: 60,
    category: 'chai',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&q=80&w=600',
    isAvailable: true
  },
  {
    name: 'Farmhouse Gourmet Pizza',
    description: 'Hand-stretched sourdough crust with San Marzano tomato sauce, mozzarella, bell peppers, olives and basil.',
    price: 349,
    category: 'pizza',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600',
    variants: [
      { name: 'Medium 8"', price: 349 },
      { name: 'Large 12"', price: 499 }
    ],
    isAvailable: true
  },
  {
    name: 'Grilled Paneer Club Sandwich',
    description: 'Spiced cottage cheese, mint chutney, crispy veggies, and melted cheddar between toasted artisan multigrain.',
    price: 219,
    category: 'sandwich',
    isVeg: true,
    image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&q=80&w=600',
    isAvailable: true
  }
];

/**
 * Seed starter menu items for a tenant if they don't have any items yet.
 * @param {string|mongoose.Types.ObjectId} tenantId
 * @returns {Promise<Array>} Seeded items
 */
async function seedStarterMenuItems(tenantId) {
  if (!tenantId) return [];

  const existingCount = await MenuItem.countDocuments({ tenantId });
  if (existingCount > 0) {
    return await MenuItem.find({ tenantId });
  }

  const itemsToInsert = starterDishes.map(dish => ({
    ...dish,
    tenantId: new mongoose.Types.ObjectId(tenantId)
  }));

  const inserted = await MenuItem.insertMany(itemsToInsert);
  console.log(`✅ Seeded ${inserted.length} starter menu items for tenant: ${tenantId}`);
  return inserted;
}

module.exports = {
  starterDishes,
  seedStarterMenuItems
};
