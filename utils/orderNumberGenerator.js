/**
 * Meaningful & Compact Order Number Generator
 * Default Format: [3 letters Customer]-[HHMM] (e.g. NAV-2204, GST-2204, LAK-1936)
 * Total length: 8 characters!
 * Highly readable, concise, non-random, and easy to speak/remember.
 */
function generateMeaningfulOrderNumber({ cafeName = '', customerName = '', date = new Date(), includeCafePrefix = false } = {}) {
  // 1. 3 letters of customer name (e.g. "Naveen" -> "NAV", "Lakshya" -> "LAK", Walk-in/Guest -> "GST")
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

  // 2. Time in HHMM (e.g. 22:04 -> 2204)
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date || Date.now());
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  // If cafe prefix is explicitly requested (e.g. "L-NAV-2204", 10 chars)
  if (includeCafePrefix && cafeName) {
    const cafeInitial = cafeName.replace(/^the\s+/i, '').trim().charAt(0).toUpperCase() || 'C';
    return `${cafeInitial}-${cust}-${hh}${min}`;
  }

  // Compact 8-character format: "NAV-2204"
  return `${cust}-${hh}${min}`;
}

module.exports = { generateMeaningfulOrderNumber };
