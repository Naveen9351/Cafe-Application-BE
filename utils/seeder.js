const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

/**
 * Seeds default database records if the collections are empty.
 */
async function seedDatabase() {
  try {
    // 1. Check Super Admin
    const adminEmail = process.env.ADMIN_EMAIL || 'naveen@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'naveen123';
    
    let superAdmin = await User.findOne({ role: 'super_admin' });
    if (!superAdmin) {
      console.log('🌱 Seeding Super Admin User...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);
      
      superAdmin = new User({
        name: 'Naveen Super Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'super_admin',
        status: 'active'
      });
      await superAdmin.save();
      console.log('✅ Super Admin seeded successfully!');
    }

    // 2. Check if a Tenant exists, if not seed a default Tenant and Admin
    const tenantCount = await Tenant.countDocuments();
    if (tenantCount === 0) {
      console.log('🌱 Seeding Default Tenant and Admin...');
      const tenant = new Tenant({
        name: 'Naveen Cafe & POS',
        email: 'cafe@naveen.com',
        phone: '9876543210',
        address: 'Jaipur, Rajasthan',
        subscription: {
          plan: 'pro',
          price: 500,
          startDate: new Date(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          isActive: true,
          orderLimit: 9999
        }
      });
      await tenant.save();

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      const tenantAdmin = new User({
        tenantId: tenant._id,
        name: 'Naveen Cafe Manager',
        email: 'manager@naveen.com',
        password: hashedPassword,
        role: 'admin',
        status: 'active'
      });
      await tenantAdmin.save();

      tenant.ownerId = tenantAdmin._id;
      await tenant.save();
      
      console.log('✅ Default Tenant ("Naveen Cafe & POS") and Tenant Admin seeded successfully!');
      console.log('👉 You can log in to the Cafe Manager panel with:');
      console.log('   Email: manager@naveen.com');
      console.log('   Password: password123');
    }
  } catch (err) {
    console.error('❌ Database seeding error:', err);
  }
}

module.exports = seedDatabase;
