/**
 * Meaningful & Compact Order Number Generator
 * Format: [3 letters Cafe]-[3 letters Customer]-[DateMonth 4-digits]-[Time 4-digits]
 * Example: LAN-NAV-0111-2245 (Total 17 chars, readable, concise, non-random)
 */
function generateMeaningfulOrderNumber({ cafeName, customerName, date = new Date() }) {
  // 1. 3 letters of cafe name (e.g. "The Landmark" -> "LAN", "DineviQ" -> "DIN")
  let cafe = (cafeName || 'DIN')
    .replace(/^the\s+/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  if (cafe.length < 3) cafe = (cafe + 'CAF').slice(0, 3);
  else cafe = cafe.slice(0, 3);

  // 2. 3 letters of customer name (e.g. "Naveen" -> "NAV", "Lakshya" -> "LAK", Walk-in/Guest -> "GST")
  let cust = (customerName || 'GST')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  if (!cust || cust === 'GUEST' || cust === 'WALKIN' || cust === 'WALKINCUSTOMER') {
    cust = 'GST';
  } else if (cust.length < 3) {
    cust = (cust + 'X').slice(0, 3);
  } else {
    cust = cust.slice(0, 3);
  }

  // 3. Date, Month, Time (e.g. 0111-2245 for 1st Nov, 22:45)
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date || Date.now());
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  return `${cafe}-${cust}-${dd}${mm}-${hh}${min}`;
}

module.exports = { generateMeaningfulOrderNumber };

