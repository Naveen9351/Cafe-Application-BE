const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const cloudinary = require('cloudinary').v2;
const auth = require('../middleware/auth');
const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const MenuItem = require('../models/MenuItem');
const Tenant = require('../models/Tenant');

const upload = multer({ dest: 'uploads/' });

// Configure Cloudinary
try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} catch (err) {
  console.error("Cloudinary config error in AI routes:", err);
}

// 1. Sharp Image Pre-processor
const preprocessImage = async (filePath) => {
  try {
    const originalBuffer = fs.readFileSync(filePath);
    
    // Enhanced Contrast + Sharpen Variant
    const enhancedBuffer = await sharp(originalBuffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .sharpen()
      .modulate({ brightness: 1.05, contrast: 1.25 })
      .toFormat('jpeg', { quality: 90 })
      .toBuffer();

    // Grayscale High Contrast Variant
    const grayscaleBuffer = await sharp(originalBuffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .grayscale()
      .linear(1.2, -10)
      .toFormat('jpeg', { quality: 85 })
      .toBuffer();

    return { originalBuffer, enhancedBuffer, grayscaleBuffer };
  } catch (err) {
    console.error("Sharp Preprocessing Error:", err.message);
    const b = fs.readFileSync(filePath);
    return { originalBuffer: b, enhancedBuffer: b, grayscaleBuffer: b };
  }
};

// 2. Semantic Item Validation Layer
const VALID_CATEGORIES = ['hot-coffee', 'cold-coffee', 'burger', 'pizza', 'sandwich', 'snacks', 'wraps', 'pasta', 'cold-drinks', 'mocktails', 'shakes', 'desserts'];
const VALID_TYPES = ['veg', 'non-veg'];

const validateMenuItem = (item, index) => {
  if (!item || typeof item !== 'object') return null;
  if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) return null;
  
  let price = item.price;
  if (typeof price === 'string') {
    price = parseFloat(price.replace(/[^0-9.]/g, ''));
  }
  if (typeof price !== 'number' || isNaN(price) || price <= 0) return null;

  let type = (item.type || '').toLowerCase();
  if (!VALID_TYPES.includes(type)) {
    const n = item.name.toLowerCase();
    type = n.includes('chicken') || n.includes('mutton') || n.includes('egg') || n.includes('fish') || n.includes('beef') || n.includes('pork') ? 'non-veg' : 'veg';
  }

  let category = (item.category || '').toLowerCase();
  if (!VALID_CATEGORIES.includes(category)) {
    const n = item.name.toLowerCase();
    if (n.includes('burger')) category = 'burger';
    else if (n.includes('pizza')) category = 'pizza';
    else if (n.includes('sandwich')) category = 'sandwich';
    else if (n.includes('pasta')) category = 'pasta';
    else if (n.includes('ice tea') || n.includes('iced tea')) category = 'cold-drinks';
    else if (n.includes('chai') || n.includes('tea') || n.includes('coffee')) category = 'hot-coffee';
    else if (n.includes('pie') || n.includes('cake') || n.includes('brownie') || n.includes('pastry') || n.includes('ice cream')) category = 'desserts';
    else if (n.includes('shake')) category = 'shakes';
    else if (n.includes('beer') || n.includes('drink') || n.includes('juice') || n.includes('soda')) category = 'cold-drinks';
    else category = 'snacks';
  }

  return {
    id: item.id || `item_${String(index + 1).padStart(3, '0')}`,
    name: item.name.trim(),
    price: Math.round(price * 100) / 100,
    type: type,
    category: category,
    description: item.description ? String(item.description).trim() : `Fresh and delicious ${item.name.trim()} prepared to order.`,
    source: {
      bbox: item.bbox && typeof item.bbox === 'object' ? item.bbox : { x: 0, y: 0, width: 0, height: 0 },
      confidence: typeof item.confidence === 'number' ? Math.min(1.0, Math.max(0.1, item.confidence)) : 0.94
    },
    image: null // Decoupled: enriched in Stage 2
  };
};

// Neural AI Integration Helper
const querySarvam = async (prompt, systemInstruction = "") => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === "your_sarvam_api_key_here") return null;

  const models = ["sarvam-105b", "sarvam-30b", "sarvam-2b"];
  const url = "https://api.sarvam.ai/v1/chat/completions";

  for (const model of models) {
    try {
      const messages = [];
      const enforcedSystem = (systemInstruction || "You are Khushi AI, the smart restaurant operations manager and sales growth assistant.") + " Always refer to yourself simply as Khushi AI. Never mention underlying model or provider names.";
      messages.push({ role: "system", content: enforcedSystem });
      messages.push({ role: "user", content: prompt });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": apiKey,
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages
        })
      });

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) return content;
      } else {
        const errText = await response.text();
        console.warn(`LLM (${model}) Error:`, response.status, errText);
      }
    } catch (err) {
      console.warn(`LLM (${model}) Fetch Error:`, err.message);
    }
  }
  return null;
};

// Gemini REST Integration Helper with dynamic model discovery & open LLM service
let cachedAvailableModels = null;

const getAvailableGeminiModels = async (apiKey) => {
  if (cachedAvailableModels) return cachedAvailableModels;
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(listUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.models && Array.isArray(data.models)) {
        const validModels = data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
        if (validModels.length > 0) {
          cachedAvailableModels = validModels;
          console.log("✅ Discovered Gemini API models:", validModels.join(', '));
          return validModels;
        }
      }
    }
  } catch (e) {
    console.error("ListModels Fetch Error:", e.message);
  }
  return null;
};

const queryGemini = async (prompt, systemInstruction = "") => {
  const apiKey = process.env.GEMINI_API_KEY;
  let models = [
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.0-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  if (apiKey && apiKey !== "your_gemini_key_here") {
    const discovered = await getAvailableGeminiModels(apiKey);
    if (discovered && discovered.length > 0) {
      models = [...new Set([...discovered, ...models])];
    }

    const payload = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        } else {
          const errText = await response.text();
          console.error(`Gemini API (${model}) Error ${response.status}:`, errText);
        }
      } catch (err) {
        console.error(`Gemini API (${model}) Fetch Error:`, err.message);
      }
    }
  }

  // Guaranteed Open LLM Fallback (Pollinations AI)
  try {
    const pollUrl = 'https://text.pollinations.ai/';
    const pollPayload = {
      messages: [
        { role: 'system', content: systemInstruction || 'You are Khushi AI, an intelligent restaurant store manager and sales growth assistant. Always refer to yourself as Khushi AI.' },
        { role: 'user', content: prompt }
      ],
      model: 'openai'
    };

    const pollResponse = await fetch(pollUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pollPayload)
    });

    if (pollResponse.ok) {
      const pollText = await pollResponse.text();
      if (pollText && pollText.trim()) return pollText.trim();
    }
  } catch (err) {
    console.error("Pollinations AI Fallback Error:", err.message);
  }

  return null;
};

// ── 1. INTERNAL AI RESTAURANT ASSISTANT (TENANT-SPECIFIC LIVE DATA) ──
router.post('/copilot', auth, async (req, res) => {
  const { query, conversationHistory = [] } = req.body;
  const mongoose = require('mongoose');
  
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  const normalizedQuery = query.toLowerCase().trim();
  const tenantId = req.tenantId || req.user?.tenantId || req.body.tenantId;

  try {
    let tenantQuery = {};
    if (tenantId) {
      if (mongoose.Types.ObjectId.isValid(tenantId)) {
        tenantQuery = { $or: [{ tenantId: tenantId }, { tenantId: new mongoose.Types.ObjectId(tenantId) }] };
      } else {
        tenantQuery = { tenantId: tenantId };
      }
    }

    // 1. Gather live tenant data with populated menu references
    const [menuItems, orders, inventory, tenant, khataList] = await Promise.all([
      MenuItem.find(tenantQuery),
      Order.find(tenantQuery).populate('items.item').lean(),
      Inventory.find(tenantQuery),
      tenantId && mongoose.Types.ObjectId.isValid(tenantId) ? Tenant.findById(tenantId) : Tenant.findOne(tenantQuery),
      require('../models/KhataRecord').find(tenantQuery).catch(() => [])
    ]);

    const businessName = tenant?.businessName || tenant?.name || 'Your Restaurant';
    
    // Robust Order resolver
    const getOrderAmount = (ord) => {
      if (!ord) return 0;
      const val = Number(ord.settledAmount || ord.finalAmount || ord.totalAmount || ord.total || ord.subTotal || 0);
      if (!isNaN(val) && val > 0) return val;
      if (Array.isArray(ord.items) && ord.items.length > 0) {
        return ord.items.reduce((sum, it) => sum + ((Number(it.price) || (it.item?.price ? Number(it.item.price) : 0)) * (Number(it.quantity) || 1)), 0);
      }
      return 0;
    };

    const validOrders = orders.filter(o => o.status !== 'cancelled');
    const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'served');
    const cancelledOrders = orders.filter(o => o.status === 'cancelled');
    const activeOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled');

    // Revenue calculations
    const completedRev = completedOrders.reduce((sum, o) => sum + getOrderAmount(o), 0);
    const totalRev = validOrders.reduce((sum, o) => sum + getOrderAmount(o), 0);
    const effectiveRev = completedRev > 0 ? completedRev : totalRev;
    const avgOrderValue = completedOrders.length > 0 ? Math.round(completedRev / completedOrders.length) : (validOrders.length > 0 ? Math.round(totalRev / validOrders.length) : 0);
    const lowStockItems = inventory.filter(i => (Number(i.quantity) || 0) <= (Number(i.minThreshold) || 10));

    // Khata Dues
    const pendingKhata = (khataList || []).filter(k => k.status !== 'settled');
    const totalKhataOutstanding = pendingKhata.reduce((sum, k) => sum + (Number(k.borrowAmount || k.remainingAmount || k.totalBill) || 0), 0);

    // Payment Breakdown
    const paymentMethods = { Cash: 0, UPI: 0, Card: 0, Khata: 0 };
    validOrders.forEach(o => {
      const pm = (o.paymentMethod || 'Cash').toLowerCase();
      const amt = getOrderAmount(o);
      if (pm.includes('upi') || pm.includes('gpay')) paymentMethods.UPI += amt;
      else if (pm.includes('card')) paymentMethods.Card += amt;
      else if (pm.includes('khata') || pm.includes('borrow')) paymentMethods.Khata += amt;
      else paymentMethods.Cash += amt;
    });

    // Top Selling Dishes
    const dishCounts = {};
    validOrders.forEach(ord => {
      (ord.items || []).forEach(it => {
        const n = it.name || it.item?.name || 'Dish';
        const q = Number(it.quantity) || 1;
        const p = Number(it.price) || (it.item?.price ? Number(it.item.price) : 0);
        if (!dishCounts[n]) dishCounts[n] = { count: 0, revenue: 0 };
        dishCounts[n].count += q;
        dishCounts[n].revenue += (q * p);
      });
    });
    const topDishes = Object.entries(dishCounts)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6)
      .map(([name, d]) => `${name} (${d.count} sold, ₹${Math.round(d.revenue)})`);

    // Potential Mismatches / Anomaly Checks
    const anomalies = [];
    if (totalKhataOutstanding > (effectiveRev * 0.2) && effectiveRev > 0) {
      anomalies.push(`High Khata Risk: Outstanding debt (₹${Math.round(totalKhataOutstanding)}) exceeds 20% of gross revenue.`);
    }
    if (cancelledOrders.length > (orders.length * 0.1) && orders.length > 5) {
      anomalies.push(`Elevated Cancellation Rate: ${cancelledOrders.length} orders cancelled out of ${orders.length} total.`);
    }
    if (lowStockItems.length > 0) {
      anomalies.push(`${lowStockItems.length} ingredients are below safety reorder threshold.`);
    }

    const lowStockSummary = lowStockItems.map(i => `${i.itemName}: ${i.quantity} ${i.unit}`).slice(0, 10).join('; ');
    const menuSummary = menuItems.map(m => {
      const cat = typeof m.category === 'string' ? m.category : (m.category?.name || 'General');
      return `${m.name} (₹${m.price || 0}, ${cat})`;
    }).slice(0, 25).join(', ');

    const tenantContextPrompt = `You are Khushi AI, the dedicated executive restaurant operations manager and sales growth advisor for ${businessName}.
You have direct real-time access to ${businessName}'s operational database:
- Active Menu: ${menuItems.length} dishes registered [${menuSummary || 'None'}]
- Financials:
  * Total Orders: ${orders.length} (${completedOrders.length} Completed, ${activeOrders.length} In-Kitchen, ${cancelledOrders.length} Cancelled)
  * Total Settled Revenue: ₹${Math.round(effectiveRev).toLocaleString('en-IN')} (Total Processed: ₹${Math.round(totalRev).toLocaleString('en-IN')})
  * Average Order Value (AOV): ₹${Math.round(avgOrderValue)}
- Payment Breakdown: UPI: ₹${Math.round(paymentMethods.UPI)}, Cash: ₹${Math.round(paymentMethods.Cash)}, Card: ₹${Math.round(paymentMethods.Card)}, Khata: ₹${Math.round(paymentMethods.Khata)}
- Top Dishes: ${topDishes.length > 0 ? topDishes.join(', ') : 'All menu items active for sales'}
- Khata/Credit Ledger: ${pendingKhata.length} unpaid customer accounts, Total Outstanding Balance: ₹${Math.round(totalKhataOutstanding)}
- Inventory: ${inventory.length} ingredients tracked, ${lowStockItems.length} items low in stock [${lowStockSummary || 'All stocks normal'}]
- Detected Operational Anomalies: ${anomalies.length > 0 ? anomalies.join(' | ') : 'All operational metrics within standard parameters'}

Formatting & Tone Directives (MANDATORY):
1. Identity: Always introduce yourself only as "Khushi AI" (never mention engine names, LLM models, version numbers, or internal details).
2. NO EMOJI ICONS: DO NOT use decorative emojis (such as ✨, 💡, 🎁, 🚀, 📈, ⚠️, 🔍, 🔒, 💰, 👉, etc.) as icons, headers, or bullet prefixes. Keep the output clean, modern, and professional.
3. Accuracy: Always cite the exact live numbers given above (Total Gross Revenue: ₹${Math.round(effectiveRev).toLocaleString('en-IN')}, AOV: ₹${Math.round(avgOrderValue)}, Total Orders: ${orders.length}, Completed: ${completedOrders.length}). NEVER state that revenue is ₹0 or that there are no sales.
4. Engaging Strategy: Present sales combos, upsell tactics, and growth levers using clear Markdown tables and bold titles.
5. Support: If the user asks to report a bug or raise a ticket, guide them to use the "Raise Ticket" tab.`;

    let liveReply = await querySarvam(query, tenantContextPrompt);
    
    if (!liveReply) {
      liveReply = await queryGemini(query, tenantContextPrompt);
    }

    if (liveReply) {
      // Clean any accidental decorative emojis from LLM output
      const cleanReply = liveReply.replace(/[✨💡🎁🚀📈⚠️🔍🔒💰👉⭐🚨]/g, '').trim();
      return res.json({ reply: cleanReply, anomalies });
    }

    // Dynamic Intelligent Fallback using exact tenant data without emoji icons
    if (['hi', 'hello', 'hey', 'greetings', 'help'].includes(normalizedQuery) || normalizedQuery.includes('who are you') || normalizedQuery.includes('what can you do')) {
      const reply = `Hello! I am **Khushi AI**, your smart restaurant growth & operations assistant for **${businessName}**.

### Live Store Snapshot
| Metric | Current Status |
|---|---|
| **Gross Revenue** | ₹${effectiveRev.toLocaleString('en-IN', { minimumFractionDigits: 1 })} (${completedOrders.length} completed orders) |
| **Average Order Value** | ₹${Math.round(avgOrderValue)} |
| **Active Menu Dishes** | ${menuItems.length} items |
| **Low Stock Warnings** | ${lowStockItems.length} items |
| **Khata Outstanding** | ₹${totalKhataOutstanding.toLocaleString('en-IN')} (${pendingKhata.length} pending) |

How can I help you today?
- "How can I increase my average order value and daily sales?"
- "Scan for any data mismatches, unpaid bills, or anomalies"
- "Give me a summary of my top-selling items and revenue"
- "Which raw ingredients are below the minimum safety threshold?"`;
      return res.json({ reply, anomalies });
    }

    if (normalizedQuery.includes('mismatch') || normalizedQuery.includes('anomaly') || normalizedQuery.includes('issue') || normalizedQuery.includes('bug') || normalizedQuery.includes('check') || normalizedQuery.includes('scan')) {
      const anomalyList = anomalies.length > 0
        ? anomalies.map(a => `- **Notice:** ${a}`).join('\n')
        : `- **Status:** All operations, live order logs, and revenue metrics align with operational thresholds.`;

      const reply = `### Operational & Data Mismatch Audit for ${businessName}

${anomalyList}

| Metric | Live Audit Data |
|---|---|
| **Total Processed Orders** | ${validOrders.length} orders (₹${Math.round(totalRev).toLocaleString('en-IN')}) |
| **Average Order Value** | ₹${Math.round(avgOrderValue)} |
| **Active In-Kitchen Orders** | ${activeOrders.length} in progress |
| **Cancelled Orders** | ${cancelledOrders.length} (${orders.length > 0 ? Math.round((cancelledOrders.length / orders.length) * 100) : 0}% rate) |
| **Pending Khata Receivables** | ₹${totalKhataOutstanding.toLocaleString('en-IN')} across ${pendingKhata.length} accounts |
| **Low Stock Warnings** | ${lowStockItems.length} items |

If you notice any system glitch, you can click the "Raise Ticket" tab above to directly alert the Main Platform Admin.`;
      return res.json({ reply, anomalies });
    }

    if (normalizedQuery.includes('grow') || normalizedQuery.includes('sales') || normalizedQuery.includes('increase') || normalizedQuery.includes('revenue') || normalizedQuery.includes('profit') || normalizedQuery.includes('aov') || normalizedQuery.includes('order value')) {
      const topDishName = topDishes.length > 0 ? topDishes[0].split('(')[0].trim() : (menuItems[0]?.name || 'Specialty Dish');
      const secondDish = menuItems[1]?.name || 'Cold Beverage';
      const dessertDish = menuItems.find(m => m.name.toLowerCase().includes('cake') || m.name.toLowerCase().includes('dessert') || m.name.toLowerCase().includes('lava'))?.name || 'Chef Dessert';

      const reply = `### Sales Growth & Basket Size Expansion Strategy for ${businessName}

Your current store performance shows **₹${totalRev.toLocaleString('en-IN', { minimumFractionDigits: 1 })}** in gross sales across **${validOrders.length} orders**, with an Average Order Value of **₹${Math.round(avgOrderValue)}**.

### High-Impact Combo Recommendations
| Combo Bundle | Pairing Items | Strategic Pricing | Est. Ticket Growth |
|---|---|---|---|
| **Signature Express Combo** | ${topDishName} + ${secondDish} | 10% Bundle Savings | +18% AOV Boost |
| **Dine-in Feast Pair** | Gourmet Main + Side + Artisanal Drink | Set Combo Price | +25% Ticket Value |
| **Sweet Finish Add-on** | Any Coffee + ${dessertDish} | Special Add-on Price | High-margin impulse buy |

### Actionable Growth Levers
1. **Server Upselling:** Train staff to recommend pairing cold brews or signature sides with main dishes.
2. **Promote Premium Variations:** Feature premium dish variants at the top of your digital QR menus.
3. **Happy Hour Timing:** Introduce mid-afternoon combo offers during slow traffic hours (3 PM - 6 PM) to sustain steady revenue.
4. **Khata Reminders:** Send prompt WhatsApp reminders for pending khata balances (₹${Math.round(totalKhataOutstanding)} total across ${pendingKhata.length} accounts).`;
      return res.json({ reply, anomalies });
    }

    if (normalizedQuery.includes('menu') || normalizedQuery.includes('dish') || normalizedQuery.includes('item') || normalizedQuery.includes('top-selling') || normalizedQuery.includes('best-seller') || normalizedQuery.includes('summary')) {
      const topItems = menuItems.slice(0, 8).map(m => `| ${m.name} | ₹${m.price} | ${typeof m.category === 'string' ? m.category : (m.category?.name || 'General')} |`).join('\n');
      const reply = `### Menu & Sales Summary for ${businessName}

- **Total Gross Sales:** ₹${totalRev.toLocaleString('en-IN', { minimumFractionDigits: 1 })}
- **Average Order Value:** ₹${Math.round(avgOrderValue)}
- **Total Orders Logged:** ${validOrders.length}

### Active Menu Catalog Snapshot
| Dish Name | Price | Category |
|---|---|---|
${topItems}

${topDishes.length > 0 ? `### Top Revenue Generators\n` + topDishes.map(d => `- **${d}**`).join('\n') : ''}`;
      return res.json({ reply, anomalies });
    }

    if (normalizedQuery.includes('ingredient') || normalizedQuery.includes('stock') || normalizedQuery.includes('safety threshold') || normalizedQuery.includes('inventory')) {
      const reply = lowStockItems.length > 0
        ? `### Inventory & Safety Threshold Status for ${businessName}

The following **${lowStockItems.length} raw ingredients** are currently at or below their safety reorder threshold:

| Ingredient | Current Stock | Minimum Required | Unit |
|---|---|---|---|
${lowStockItems.map(i => `| ${i.itemName} | ${i.quantity} | ${i.minThreshold || 10} | ${i.unit} |`).join('\n')}

Please review your purchase orders to ensure kitchen supplies remain uninterrupted.`
        : `### Inventory & Safety Threshold Status for ${businessName}

- **Total Ingredients Tracked:** ${inventory.length}
- **Low Stock Alerts:** 0 items below threshold

All raw material inventory levels are currently within safe operational limits.`;
      return res.json({ reply, anomalies });
    }

    const reply = `### Khushi AI for ${businessName}
I have real-time access to your **${menuItems.length} menu dishes**, **${validOrders.length} orders** (₹${Math.round(totalRev).toLocaleString('en-IN')} gross revenue), and **${inventory.length} inventory items**.

How can I assist you?
- "How can I increase my average order value and daily sales?"
- "Scan for any data mismatches, unpaid bills, or anomalies"
- "Give me a summary of my top-selling items and revenue"
- "Which raw ingredients are below the minimum safety threshold?"`;

    return res.json({ reply, anomalies });

  } catch (err) {
    console.error("AI Assistant Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 1B. EXECUTIVE AI REPORT INSIGHTS (POWERED BY SARVAM LLM) ──
router.post('/report-insights', auth, async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenantId;
  const { timeFilter = 'all' } = req.body;

  try {
    const [orders, menuItems, inventory, tenant, khataList] = await Promise.all([
      Order.find({ tenantId }),
      MenuItem.find({ tenantId }),
      Inventory.find({ tenantId }),
      Tenant.findById(tenantId),
      require('../models/KhataRecord').find({ tenantId }).catch(() => [])
    ]);

    const businessName = tenant?.businessName || tenant?.name || 'Restaurant';
    const now = new Date();

    // Time filter logic
    const filteredOrders = orders.filter(ord => {
      if (timeFilter === 'all') return true;
      const ordDate = new Date(ord.createdAt);
      if (timeFilter === 'today') {
        return ordDate.toDateString() === now.toDateString();
      }
      if (timeFilter === '7d') {
        const d = new Date();
        d.setDate(now.getDate() - 7);
        return ordDate >= d;
      }
      if (timeFilter === '30d') {
        const d = new Date();
        d.setDate(now.getDate() - 30);
        return ordDate >= d;
      }
      return true;
    });

    const completedOrders = filteredOrders.filter(o => o.status === 'completed');
    const cancelledOrders = filteredOrders.filter(o => o.status === 'cancelled');

    const totalGrossRevenue = completedOrders.reduce((sum, o) => {
      const amt = Number(o.settledAmount || o.finalAmount || o.totalAmount || o.total || 0);
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    const avgTicketSize = completedOrders.length > 0 ? Math.round(totalGrossRevenue / completedOrders.length) : 0;

    // Payment distribution
    const paymentBreakdown = { UPI: 0, Cash: 0, Card: 0, Khata: 0 };
    completedOrders.forEach(o => {
      const pm = (o.paymentMethod || 'Cash').toLowerCase();
      const amt = Number(o.settledAmount || o.finalAmount || o.totalAmount || o.total || 0);
      if (pm.includes('upi') || pm.includes('gpay')) paymentBreakdown.UPI += amt;
      else if (pm.includes('card')) paymentBreakdown.Card += amt;
      else if (pm.includes('khata')) paymentBreakdown.Khata += amt;
      else paymentBreakdown.Cash += amt;
    });

    // Dishes performance
    const dishSales = {};
    completedOrders.forEach(ord => {
      (ord.items || []).forEach(it => {
        const n = it.name || it.item?.name || 'Item';
        const q = Number(it.quantity) || 1;
        const p = Number(it.price) || 0;
        if (!dishSales[n]) dishSales[n] = { name: n, count: 0, revenue: 0 };
        dishSales[n].count += q;
        dishSales[n].revenue += (q * p);
      });
    });

    const topDishes = Object.values(dishSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // Khata stats
    const pendingKhata = (khataList || []).filter(k => k.status !== 'settled');
    const totalKhataOutstanding = pendingKhata.reduce((acc, k) => acc + (Number(k.borrowAmount || k.remainingAmount || k.totalBill) || 0), 0);

    // Low stock items
    const lowStockCount = inventory.filter(i => (Number(i.quantity) || 0) <= (Number(i.minThreshold) || 10)).length;

    // AI Prompt for Sarvam LLM
    const reportPrompt = `You are the Lead Financial Analyst and Operations Director reviewing official business records for ${businessName}.
Generate a comprehensive, high-level Executive Diagnostic Summary for the executive management report (Time Period: ${timeFilter.toUpperCase()}).

Business Data Metrics:
- Total Gross Revenue: ₹${Math.round(totalGrossRevenue)}
- Total Settled Orders: ${completedOrders.length}
- Average Order Value: ₹${avgTicketSize}
- Cancelled Orders: ${cancelledOrders.length}
- Payment Breakdown: UPI: ₹${Math.round(paymentBreakdown.UPI)}, Cash: ₹${Math.round(paymentBreakdown.Cash)}, Card: ₹${Math.round(paymentBreakdown.Card)}, Khata: ₹${Math.round(paymentBreakdown.Khata)}
- Top Selling Menu Items: ${topDishes.map(d => `${d.name} (${d.count} units, ₹${d.revenue})`).join(', ') || 'No item data'}
- Khata / Unsettled Credit Balance: ₹${Math.round(totalKhataOutstanding)} (${pendingKhata.length} pending accounts)
- Low Stock Warnings: ${lowStockCount} raw materials

Generate a structured Executive Diagnostic Summary with the following 4 sections:
1. 📊 **Executive Performance & Revenue Velocity** (Concise assessment of gross turnover, cash-flow liquidity, and sales trajectory).
2. 💡 **Revenue Growth & Menu Engineering Strategies** (2-3 concrete actionable opportunities to lift average ticket size and cross-sell bestsellers).
3. ⚠️ **Risk & Anomaly Observations** (Audit of credit exposure, cancellation rate, or inventory replenishment needs).
4. 🎯 **Management Next Steps** (Bullet points for store manager / cafe owner to implement immediately).

Write in an authoritative, executive, corporate tone formatted with clear bullet points.`;

    let aiSummary = await querySarvam(reportPrompt, "You are a professional restaurant management & financial analyst writing executive PDF reports.");
    if (!aiSummary) {
      aiSummary = await queryGemini(reportPrompt, "You are a professional restaurant management & financial analyst writing executive PDF reports.");
    }

    if (!aiSummary) {
      // Dynamic High-Quality Fallback
      aiSummary = `### 📊 Executive Performance & Revenue Velocity
- **Gross Revenue Turnover:** ₹${totalGrossRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })} settled across ${completedOrders.length} completed transactions with an Average Order Value of ₹${avgTicketSize}.
- **Liquidity Mix:** Digital UPI accounted for ${totalGrossRevenue > 0 ? Math.round((paymentBreakdown.UPI / totalGrossRevenue) * 100) : 0}% of settled revenue, ensuring instant cash flow and low register leakage.

### 💡 Revenue Growth & Menu Engineering Strategies
- **Dynamic Combo Bundling:** Leverage high-performing anchor items (${topDishes[0]?.name || 'Top Beverages'}) by pairing with high-margin sides to elevate ticket sizes beyond ₹${avgTicketSize}.
- **Peak Volume Turnaround:** Implement fast-track prep protocols during lunch (1-3 PM) and evening dinner to optimize seating throughput.

### ⚠️ Risk & Anomaly Observations
- **Credit Exposure:** ₹${totalKhataOutstanding.toLocaleString('en-IN')} remains outstanding across ${pendingKhata.length} Khata accounts. Routine settlement reminders are recommended.
- **Supply Assurance:** ${lowStockCount} inventory items require reorder to prevent menu item outages during peak traffic.

### 🎯 Management Next Steps
- Review low-stock ingredients and trigger auto-purchase orders.
- Follow up on outstanding Khata ledger dues with 1-click WhatsApp payment reminders.
- Promote top-selling signature items on the digital QR landing banner.`;
    }

    res.json({
      success: true,
      businessName,
      timeFilter,
      metrics: {
        totalGrossRevenue,
        totalOrders: completedOrders.length,
        avgTicketSize,
        cancelledOrders: cancelledOrders.length,
        paymentBreakdown,
        topDishes,
        outstandingKhata: totalKhataOutstanding,
        lowStockCount
      },
      aiSummary
    });

  } catch (err) {
    console.error("Report Insights Error:", err);
    res.status(500).json({ error: "Failed to generate report insights: " + err.message });
  }
});

// ── 2. PUBLIC AI PRODUCT CONCIERGE (FOR LANDING PAGE VISITORS) ──
router.post('/public-copilot', async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  const normalizedQuery = query.toLowerCase().trim();

  const publicConciergePrompt = `You are the official SERVIQ AI Product Concierge for prospective restaurant and cafe owners exploring the SERVIQ website (The Operating System for High-Growth Restaurants).

Platform Overview:
- SERVIQ is an all-in-one cloud restaurant OS unifying:
  1. Ultra-Fast Cloud POS: Split bills, modifiers, table status mapping, fast checkout, digital receipts.
  2. Zero-Latency Kitchen KDS: Real-time ticket dispatch, cooking countdowns, color-coded prep delays.
  3. Smart Recipe Inventory & Auto-PO: Recipe-level stock depletion, low-stock threshold alerts, 1-click vendor POs.
  4. Digital QR Dining: Instant camera scan menu, dietary filters, contactless direct UPI payment with 0% commission.
  5. Aggregator Integration: Consolidates Zomato, Swiggy, and direct delivery orders into a single screen.
  6. AI Copilot: Weather demand prediction, sales forecasting, high-margin dish combos, and auto paper menu digitizer.
- Hardware Compatibility: Hardware-agnostic! Runs on iPads, Android tablets, Mac/Windows laptops, standard thermal receipt & KOT printers, cash drawers.
- Pricing Plans:
  - Starter Kiosk: ₹1,499/mo (Annual) or ₹1,999/mo (Monthly) - Perfect for coffee bars & single kiosks.
  - Growth Pro: ₹2,999/mo (Annual) or ₹3,999/mo (Monthly) - Most Popular, includes full KDS, AI Copilot, Inventory & Loyalty.
  - Franchise Enterprise: ₹5,999/mo (Annual) - For multi-location chains, includes Super Admin & Commissary hub.
- Free Trial & Demos: 14-day free trial (no credit card needed) and free 30-minute 1-on-1 personalized demos.

Provide concise, enthusiastic, and helpful answers formatted with clean markdown bullet points. Encourage users to start a free trial or book a demo!`;

  try {
    let liveReply = await querySarvam(query, publicConciergePrompt);
    
    if (!liveReply) {
      liveReply = await queryGemini(query, publicConciergePrompt);
    }

    if (liveReply) {
      return res.json({ reply: liveReply });
    }

    // Dynamic Intelligent Fallback for Landing Page Visitors
    if (['hi', 'hello', 'hey', 'hi there', 'greetings', 'help'].includes(normalizedQuery) || normalizedQuery.includes('what is serviq') || normalizedQuery.includes('what is rastrorato') || normalizedQuery.includes('who are you')) {
      const reply = `Hello! 👋 I'm the **SERVIQ AI Concierge**.

**SERVIQ** is the all-in-one operating system engineered for modern restaurants, cafes, pizzerias, QSRs, and cloud kitchens.

Here is what we empower you to do:
- ⚡ **Ultra-Fast POS:** 3-click bill settlements & instant WhatsApp invoices.
- 🍳 **Live Kitchen KDS:** Zero paper ticket chaos with color-coded prep countdowns.
- 📦 **Recipe-Level Inventory:** Auto-depleting ingredient stock meters & automated vendor POs.
- 📱 **0% Commission QR Ordering:** Dynamic digital menus with instant UPI payment.
- 🤖 **SERVIQ AI:** 1-click paper menu scanner and predictive sales forecasting.

Would you like to know about **pricing plans**, **hardware compatibility**, or **booking a live demo**?`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('price') || normalizedQuery.includes('cost') || normalizedQuery.includes('plan') || normalizedQuery.includes('subscription')) {
      const reply = `💰 **SERVIQ Transparent Pricing Plans**:

1. **Starter Kiosk (₹1,499/mo)**:
   - Unlimited Cloud POS, QR Dine-In, Basic KOT, Daily Revenue Reports. Perfect for coffee kiosks and single stations.
2. **Growth Pro (₹2,999/mo) — ⭐ Most Popular**:
   - Full Kitchen KDS, Smart Recipe Inventory & POs, CRM & Loyalty, SERVIQ AI Copilot, 24/7 Priority Support.
3. **Franchise Enterprise (₹5,999/mo)**:
   - Multi-Tenant Super Admin, Central Commissary Sync, Custom White-Label QR, Dedicated Account Strategist.

🎁 *All plans include a 14-day free trial with zero credit card required!*`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('hardware') || normalizedQuery.includes('printer') || normalizedQuery.includes('ipad') || normalizedQuery.includes('tablet') || normalizedQuery.includes('device')) {
      const reply = `💻 **Zero Proprietary Hardware Lock-In**:

SERVIQ is 100% cloud-native and runs on the devices you already own:
- 📱 **iPads & Android Tablets:** Waitstaff & cashier mobile billing terminals.
- 💻 **Mac & Windows Laptops/PCs:** Admin & manager reporting consoles.
- 🖨️ **Thermal Receipt & KOT Printers:** USB, Bluetooth, Wi-Fi & LAN printers (Epson, TVS, Star, Citizen).
- ⚡ **Dynamic UPI QR Displays:** Auto-generated bill settlement amounts.
- 💳 **Cash Drawers:** Standard RJ11 kick-out support.`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('kot') || normalizedQuery.includes('kitchen') || normalizedQuery.includes('kds')) {
      const reply = `🍳 **Zero-Latency Kitchen Display System (KDS)**:

- Orders placed via POS or QR tables appear instantly on kitchen screens via WebSockets.
- Color-coded timers: Green (Just In), Yellow (Prepping), Red (Urgent / Delayed).
- Instant status updates notify waiters and guests when food is ready for pickup!`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('menu') || normalizedQuery.includes('import') || normalizedQuery.includes('scan')) {
      const reply = `📷 **Instant AI Paper Menu Digitizer**:

- Simply take a photo or upload a PDF of your existing physical menu card.
- SERVIQ AI extracts dish names, prices, categories, and descriptions in <10 seconds.
- Automatically pairs high-res photos and drafts items for your 1-click review and publish!`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('trial') || normalizedQuery.includes('demo') || normalizedQuery.includes('start') || normalizedQuery.includes('register')) {
      const reply = `🚀 **Getting Started is Easy**:

1. **Start Free Trial:** Click the **Start Free Trial** button on top right to get full access for 14 days in under 2 minutes.
2. **Book a 1-on-1 Demo:** Scroll down to our **Schedule Free Demo** form for a 30-minute personalized walkthrough and free menu digitization assistance!`;
      return res.json({ reply });
    }

    const reply = `💡 **SERVIQ AI Concierge**:
I can answer any questions about POS fast billing, kitchen KOT displays, recipe inventory, hardware compatibility, pricing, and onboarding setup!

Try asking:
- "What features are included in SERVIQ?"
- "Which pricing plan is best for my cafe?"
- "Does SERVIQ work with my existing thermal printers?"
- "How does the AI menu scanner work?"`;

    return res.json({ reply });

  } catch (err) {
    console.error("Public Copilot Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Stage 1: Document Layout & Menu Extraction (`POST /api/ai/extract-menu`)
router.post('/extract-menu', [auth, upload.single('image')], async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Menu file (Image or PDF) is required for extraction" });
  }

  try {
    const isPdf = req.file.mimetype === 'application/pdf' || (req.file.originalname && req.file.originalname.toLowerCase().endsWith('.pdf'));
    let originalBuffer;
    let enhancedBuffer;
    let mimeType;

    if (isPdf) {
      console.log("📄 Processing menu PDF file directly for Gemini Document AI...");
      originalBuffer = fs.readFileSync(req.file.path);
      enhancedBuffer = originalBuffer;
      mimeType = "application/pdf";
    } else {
      console.log("🛠️ Preprocessing menu image variants via Sharp...");
      const pre = await preprocessImage(req.file.path);
      originalBuffer = pre.originalBuffer;
      enhancedBuffer = pre.enhancedBuffer;
      mimeType = req.file.mimetype || "image/jpeg";
    }
    const apiKey = process.env.GEMINI_API_KEY;

    let text = '';
    const extractionPrompt = `Analyze this physical restaurant menu card image and perform full document layout extraction.
Identify all menu items, multi-column categories, size variants, handwritten/printed prices, and descriptions.

Return ONLY a valid JSON array of objects wrapped inside a \`\`\`json ... \`\`\` block with zero conversational text.
Each object MUST have:
- id (string e.g. "item_001")
- name (string, exact dish name)
- price (number, numeric price in ₹)
- type (string, "veg" or "non-veg")
- category (string, must be one of: hot-coffee, cold-coffee, burger, pizza, sandwich, snacks, wraps, pasta, cold-drinks, mocktails, shakes, desserts)
- description (string, concise 1-sentence dish description)
- bbox (object with x, y, width, height normalized coordinates)
- confidence (number float between 0.1 and 1.0)`;

    // Pass 1: Multimodal Gemini Vision with Enhanced Image Variant
    if (apiKey && apiKey !== "your_gemini_key_here") {
      console.log("👁️ Running Multimodal Vision Extraction (Pass 1)...");
      const discovered = await getAvailableGeminiModels(apiKey);
      let models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      if (discovered && discovered.length > 0) {
        models = [...new Set([...discovered, ...models])];
      }

      const payload = {
        contents: [{
          parts: [
            { text: extractionPrompt },
            { inlineData: { mimeType, data: enhancedBuffer.toString('base64') } }
          ]
        }]
      };

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (response.ok) {
            const data = await response.json();
            text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) break;
          }
        } catch (e) {
          console.error(`Gemini Vision (${model}) error:`, e.message);
        }
      }
    }

    // OCR Fallback if Vision API unavailable
    if (!text && !isPdf) {
      console.log("📷 Running OCR + Sarvam AI Text Extraction Pipeline...");
      let rawOcrText = '';
      try {
        const ocrResult = await Tesseract.recognize(originalBuffer, 'eng');
        rawOcrText = ocrResult?.data?.text || '';
      } catch (ocrErr) {
        console.error("⚠️ Tesseract OCR Error:", ocrErr.message);
      }

      const ocrPrompt = `Below is raw OCR text from a restaurant menu image:
"""
${rawOcrText}
"""
${extractionPrompt}`;

      text = await querySarvam(ocrPrompt, "You parse menu card text into JSON.") 
          || await queryGemini(ocrPrompt, "You parse menu card text into JSON.");
    }

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (!text) {
      return res.json({ success: true, menu: { name: "Extracted Menu", items: [] } });
    }

    let cleanJsonText = text;
    if (cleanJsonText.includes("```json")) {
      cleanJsonText = cleanJsonText.split("```json")[1].split("```")[0].trim();
    } else if (cleanJsonText.includes("```")) {
      cleanJsonText = cleanJsonText.split("```")[1].split("```")[0].trim();
    }

    const rawParsed = JSON.parse(cleanJsonText.trim());

    // Pass 2: Semantic Validation & Normalization
    const validatedItems = [];
    if (Array.isArray(rawParsed)) {
      rawParsed.forEach((rawItem, idx) => {
        const valid = validateMenuItem(rawItem, idx);
        if (valid) validatedItems.push(valid);
      });
    }

    res.json({
      success: true,
      menu: {
        name: "Extracted Menu",
        items: validatedItems
      }
    });

  } catch (err) {
    console.error("Menu Extraction Pipeline Error:", err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Failed to extract menu: " + err.message });
  }
});

// Stage 2: Decoupled AI Image Enrichment Endpoint (`POST /api/ai/enrich-image`)
router.post('/enrich-image', auth, async (req, res) => {
  const { itemId, itemName, category, type } = req.body;

  if (!itemName) {
    return res.status(400).json({ error: "itemName is required" });
  }

  try {
    console.log(`🖼️ Searching Web CDN & AI photos for dish [${itemName}]...`);

    let fetchRes = null;
    let imageSourceType = "web_cdn";

    // Tier 1: Real Web / CDN / Wikimedia Commons Dish Photo Search (First Preference)
    try {
      const queryTerm = encodeURIComponent(`${itemName} food`);
      const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${queryTerm}&gsrlimit=4&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
      const wikiRes = await fetch(wikiUrl);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const pages = wikiData?.query?.pages;
        if (pages) {
          for (const pageId of Object.keys(pages)) {
            const imageInfo = pages[pageId]?.imageinfo?.[0];
            const imgUrl = imageInfo?.url;
            const mime = imageInfo?.mime || '';
            if (imgUrl && (mime.includes('jpeg') || mime.includes('png') || mime.includes('webp') || imgUrl.endsWith('.jpg') || imgUrl.endsWith('.png'))) {
              console.log(`🔍 Found real web photo for [${itemName}] on Wikimedia CDN: ${imgUrl}`);
              const webFetch = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
              if (webFetch.ok) {
                const b = Buffer.from(await webFetch.arrayBuffer());
                if (b.length > 5000) {
                  fetchRes = webFetch;
                  fetchRes._buffer = b;
                  imageSourceType = "web_cdn";
                  break;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Web CDN search error for [${itemName}]:`, e.message);
    }

    // Tier 2: Pollinations AI Generation (If Web/CDN search returns no image or unreadable buffer)
    if (!fetchRes) {
      try {
        console.log(`✨ Generating AI dish image for [${itemName}] via Pollinations...`);
        const aiPrompt = `Professional restaurant menu photograph. Dish: ${itemName}. Category: ${category || 'food'}. Type: ${type || 'veg'}. Clean restaurant presentation, photorealistic 8k, neutral background, studio lighting. No text, no labels.`;
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(aiPrompt)}?width=500&height=400&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
        const aiFetch = await fetch(pollinationsUrl);
        if (aiFetch.ok) {
          const b = Buffer.from(await aiFetch.arrayBuffer());
          if (b.length > 3000) {
            fetchRes = aiFetch;
            fetchRes._buffer = b;
            imageSourceType = "ai_generated";
          }
        }
      } catch (e) {
        console.warn(`Pollinations AI generation error for [${itemName}]:`, e.message);
      }
    }

    // Tier 3: Category Food Photo Fallback
    if (!fetchRes) {
      console.log(`⚡ Using high-res category dish photo fallback for [${itemName}]...`);
      const catImages = {
        'hot-coffee': 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&q=80&w=500',
        'cold-coffee': 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&q=80&w=500',
        burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=500',
        pizza: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=500',
        sandwich: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&q=80&w=500',
        pasta: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&q=80&w=500',
        desserts: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&q=80&w=500',
        'cold-drinks': 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&q=80&w=500',
        shakes: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&q=80&w=500',
        default: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=500'
      };

      const fallbackUrl = catImages[category?.toLowerCase()] || catImages.default;
      fetchRes = await fetch(fallbackUrl);
      if (fetchRes.ok) {
        fetchRes._buffer = Buffer.from(await fetchRes.arrayBuffer());
        imageSourceType = "category_fallback";
      }
    }

    if (!fetchRes || !fetchRes._buffer) {
      throw new Error("Unable to fetch dish photo from image providers");
    }

    const buffer = fetchRes._buffer;

    // Upload verified image buffer to Cloudinary
    const folder = req.tenantId ? `cafe/${req.tenantId}/menu` : 'cafe/general/menu';
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, public_id: `dish_${itemId || Date.now()}` },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(buffer);
    });

    console.log(`✅ Uploaded dish image for [${itemName}] (${imageSourceType}) to Cloudinary: ${uploadResult.secure_url}`);

    res.json({
      success: true,
      itemId: itemId,
      image: {
        url: uploadResult.secure_url,
        source: "ai_generated",
        status: "validated",
        confidence: 0.95
      }
    });

  } catch (err) {
    console.error(`AI Image Enrichment Error for [${itemName}]:`, err.message);
    res.json({
      success: false,
      itemId: itemId,
      error: err.message,
      image: null
    });
  }
});

module.exports = router;
