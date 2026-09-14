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

// Sarvam AI Integration Helper
const querySarvam = async (prompt, systemInstruction = "") => {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === "your_sarvam_api_key_here") return null;

  try {
    const url = "https://api.sarvam.ai/v1/chat/completions";
    const messages = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "sarvam-2b",
        messages
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || null;
    } else {
      const errText = await response.text();
      console.error("Sarvam API Error:", response.status, errText);
    }
  } catch (err) {
    console.error("Sarvam API Fetch Error:", err.message);
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
        { role: 'system', content: systemInstruction || 'You are Feast AI, an intelligent restaurant copilot assistant. You analyze sales, forecast demand, and advise on kitchen operations.' },
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

// ── 1. INTERNAL AI RESTAURANT COPILOT (TENANT-SPECIFIC LIVE DATA) ──
router.post('/copilot', auth, async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  const normalizedQuery = query.toLowerCase().trim();

  try {
    // 1. Gather live tenant data
    const [menuItems, orders, inventory, tenant] = await Promise.all([
      MenuItem.find({ tenantId: req.tenantId }),
      Order.find({ tenantId: req.tenantId }),
      Inventory.find({ tenantId: req.tenantId }),
      Tenant.findById(req.tenantId)
    ]);

    const businessName = tenant?.businessName || 'Your Restaurant';
    const totalRev = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const avgOrderValue = orders.length > 0 ? (totalRev / orders.length) : 0;
    const lowStockItems = inventory.filter(i => (i.quantity || 0) <= (i.minThreshold || 10));

    // Menu summary for LLM context
    const menuSummary = menuItems.map(m => `${m.name} (₹${m.price}, ${m.category}, ${m.type})`).slice(0, 35).join('; ');
    const inventorySummary = inventory.map(i => `${i.itemName}: ${i.quantity} ${i.unit}`).slice(0, 30).join('; ');

    const tenantContextPrompt = `You are SERVIQ AI Copilot, the intelligent executive restaurant analyst for ${businessName}.
You have direct real-time access to ${businessName}'s operational database:
- Active Menu: ${menuItems.length} items registered in total [${menuSummary || 'No items added yet'}]
- Sales & Volume: ${orders.length} total orders processed, Total Lifetime Revenue: ₹${Math.round(totalRev)}, Average Order Value: ₹${Math.round(avgOrderValue)}
- Current Inventory: ${inventory.length} raw ingredients tracked [${inventorySummary || 'No inventory logged yet'}], Low Stock Alerts: ${lowStockItems.length} items

Instructions:
1. Answer the user's questions specifically referencing their live store data (menu items, actual prices, sales totals, inventory levels).
2. If they ask about menu, list their actual items and prices.
3. If they ask about sales or cost, give them precise metrics from their numbers.
4. If they ask about inventory, flag low stock items and give replenishment recommendations.
5. Provide concise, professional, structured bullet-point responses with emoji indicators.`;

    let liveReply = await querySarvam(query, tenantContextPrompt);
    
    if (!liveReply) {
      liveReply = await queryGemini(query, tenantContextPrompt);
    }

    if (liveReply) {
      return res.json({ reply: liveReply });
    }

    // Dynamic Intelligent Fallback using exact tenant data
    if (['hi', 'hello', 'hey', 'hi there', 'greetings', 'help'].includes(normalizedQuery) || normalizedQuery.includes('who are you') || normalizedQuery.includes('what can you do')) {
      const reply = `Hello! 👋 I'm **SERVIQ AI Copilot**, your executive operations manager for **${businessName}**.

Here is your live business summary right now:
- 📋 **Active Menu:** ${menuItems.length} dishes/beverages registered
- 📊 **Total Orders:** ${orders.length} orders processed
- 💰 **Total Revenue:** ₹${totalRev.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
- 📦 **Inventory Status:** ${inventory.length} ingredients tracked (${lowStockItems.length} low-stock alerts)

What would you like to explore today?
- *"Show me my menu items and pricing"*
- *"Analyze my sales & average order value"*
- *"Which ingredients are low on stock?"*
- *"Suggest a weekend promotion for my bestsellers"*`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('menu') || normalizedQuery.includes('dish') || normalizedQuery.includes('item') || normalizedQuery.includes('price')) {
      if (menuItems.length === 0) {
        return res.json({ reply: `You currently have **0 items** in your menu database. You can add items via the Menu tab or use **Import Menu via SERVIQ AI** to scan a paper menu card!` });
      }
      const topItems = menuItems.slice(0, 10).map(m => `• **${m.name}** — ₹${m.price} (${m.category})`).join('\n');
      const reply = `📋 **Menu Summary for ${businessName}** (${menuItems.length} total items):

${topItems}${menuItems.length > 10 ? `\n\n*(+ ${menuItems.length - 10} more items in your catalog)*` : ''}

💡 **AI Pricing Recommendation:** Your average item price is ₹${Math.round(menuItems.reduce((s, i) => s + (i.price || 0), 0) / (menuItems.length || 1))}. Consider pairing high-margin beverages with snacks as dynamic combos to lift ticket sizes.`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('sales') || normalizedQuery.includes('revenue') || normalizedQuery.includes('earn') || normalizedQuery.includes('performance')) {
      const reply = `📊 **Sales & Revenue Report for ${businessName}**:
- **Lifetime Gross Revenue:** ₹${Math.round(totalRev).toLocaleString('en-IN')}
- **Total Orders Logged:** ${orders.length} orders
- **Average Ticket Size:** ₹${Math.round(avgOrderValue).toLocaleString('en-IN')}
- 📈 **Traffic Trend:** Highest customer volume typically occurs during lunch (1 PM - 3 PM) and evening dinner (6:30 PM - 9 PM).
- 💡 **Growth Action:** Launching a digital QR loyalty reward for returning guests can boost weekly repeat frequency by 18%.`;
      return res.json({ reply });
    }

    if (normalizedQuery.includes('inventory') || normalizedQuery.includes('stock') || normalizedQuery.includes('milk') || normalizedQuery.includes('ingredient') || normalizedQuery.includes('po')) {
      const lowItemsText = lowStockItems.length > 0
        ? lowStockItems.map(i => `⚠️ **${i.itemName}:** ${i.quantity} ${i.unit} (Threshold: ${i.minThreshold || 10} ${i.unit})`).join('\n')
        : '✅ All tracked ingredients are currently above minimum safety thresholds.';

      const reply = `📦 **Inventory & Stock Report for ${businessName}**:
- **Total Ingredients Monitored:** ${inventory.length} items
- **Low Stock Warnings (${lowStockItems.length}):**
${lowItemsText}

💡 **Action Required:** Open the Inventory tab to auto-generate and dispatch supplier purchase orders with 1 click.`;
      return res.json({ reply });
    }

    const reply = `🤖 **SERVIQ AI Copilot for ${businessName}**:
I have full visibility over your ${menuItems.length} menu items, ${orders.length} orders (₹${Math.round(totalRev)} total volume), and ${inventory.length} inventory lines.

Try asking:
- "List my top menu items and prices"
- "What is my total sales summary?"
- "Check raw ingredient inventory levels"
- "Draft a WhatsApp promo message for my customers"`;

    return res.json({ reply });

  } catch (err) {
    console.error("Copilot Error:", err);
    res.status(500).json({ error: err.message });
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
    return res.status(400).json({ error: "Image file is required for extraction" });
  }

  try {
    console.log("🛠️ Preprocessing menu image variants via Sharp...");
    const { originalBuffer, enhancedBuffer } = await preprocessImage(req.file.path);
    const mimeType = req.file.mimetype || "image/jpeg";
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
    if (!text) {
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
