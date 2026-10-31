/**
 * Multi-provider SMS Dispatcher
 * Priority:
 * 1. HanuOTP (No DLT required, fast Indian OTP route)
 * 2. Fast2SMS (Indian SMS Gateway fallback)
 * 3. Twilio (International fallback)
 * 4. Dev console fallback
 */
const https = require('https');

function makeHttpsGet(urlStr) {
    return new Promise((resolve, reject) => {
        https.get(urlStr, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, data: JSON.parse(data), raw: data });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: null, raw: data });
                }
            });
        }).on('error', reject);
    });
}

function makeHttpsPost(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, data: JSON.parse(data), raw: data });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: null, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function sendSmsOtp(phone, otp) {
    const rawDigits = phone.replace(/[^0-9]/g, '');
    const cleanPhone = rawDigits.length > 10 && rawDigits.startsWith('91') ? rawDigits.slice(2) : rawDigits;

    // 1. HanuOTP Gateway (No DLT required - Without DLT SMS OTP)
    const hanuApiKey = process.env.HANU_OTP_API_KEY || process.env.HANUOTP_API_KEY;
    if (hanuApiKey) {
        try {
            console.log(`[HanuOTP] Dispatching OTP ${otp} to +91 ${cleanPhone}...`);
            // Attempt 1: Standard 10-digit mobile number
            const hanuUrl = `https://api.hanuotp.in/sms-otp.php?number=${cleanPhone}&OTP=${otp}&apikey=${encodeURIComponent(hanuApiKey)}&templatesid=default`;
            let res = await makeHttpsGet(hanuUrl);
            console.log(`[HanuOTP Response] for ${cleanPhone}:`, res.raw);

            const isSuccess = res.data?.return === true || 
                            res.data?.status === 'success' || 
                            res.data?.request_id || 
                            (res.raw && res.raw.toLowerCase().includes('success'));

            if (isSuccess) {
                return { sent: true, provider: 'hanuotp' };
            }

            // Attempt 2: If failed or returned invalid format, retry with 91 prefix
            console.log(`[HanuOTP] Retrying with 91 prefix for 91${cleanPhone}...`);
            const retryUrl = `https://api.hanuotp.in/sms-otp.php?number=91${cleanPhone}&OTP=${otp}&apikey=${encodeURIComponent(hanuApiKey)}&templatesid=default`;
            res = await makeHttpsGet(retryUrl);
            console.log(`[HanuOTP 91-prefix Response] for 91${cleanPhone}:`, res.raw);

            if (res.data?.return === true || res.data?.status === 'success' || res.data?.request_id || (res.raw && res.raw.toLowerCase().includes('success'))) {
                return { sent: true, provider: 'hanuotp' };
            }
        } catch (err) {
            console.error('[HanuOTP Error]:', err.message);
        }
    }

    // 2. Fast2SMS Gateway (Fallback)
    if (process.env.FAST2SMS_API_KEY) {
        try {
            const postData = JSON.stringify({
                variables_values: otp,
                route: 'otp',
                numbers: cleanPhone
            });

            const options = {
                hostname: 'www.fast2sms.com',
                path: '/dev/bulkV2',
                method: 'POST',
                headers: {
                    'authorization': process.env.FAST2SMS_API_KEY,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const fast2Res = await makeHttpsPost(options, postData);
            console.log(`[Fast2SMS Response] for +91 ${cleanPhone}:`, fast2Res.raw);

            if (fast2Res.data && fast2Res.data.return === true) {
                return { sent: true, provider: 'fast2sms' };
            }

            // Fallback to Quick SMS route if OTP route has restrictions
            const quickPost = JSON.stringify({
                message: `Your DineviQ verification OTP is ${otp}. Valid for 5 minutes.`,
                language: 'english',
                route: 'q',
                numbers: cleanPhone
            });
            options.headers['Content-Length'] = Buffer.byteLength(quickPost);
            const quickRes = await makeHttpsPost(options, quickPost);
            console.log(`[Fast2SMS Quick SMS Response]:`, quickRes.raw);

            if (quickRes.data && quickRes.data.return === true) {
                return { sent: true, provider: 'fast2sms' };
            }
        } catch (err) {
            console.error('[Fast2SMS Error]:', err.message);
        }
    }

    // 3. Twilio Gateway (International)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        try {
            const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
            const postData = new URLSearchParams({
                To: `+91${cleanPhone}`,
                From: process.env.TWILIO_PHONE_NUMBER,
                Body: `Your verification OTP is ${otp}. Valid for 5 minutes.`
            }).toString();

            const options = {
                hostname: 'api.twilio.com',
                path: `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const twilioRes = await makeHttpsPost(options, postData);
            console.log(`[Twilio Response] for +91 ${cleanPhone}:`, twilioRes.raw);
            return { sent: true, provider: 'twilio' };
        } catch (err) {
            console.error('[Twilio Error]:', err.message);
        }
    }

    // Fallback in Dev: Log to server terminal
    console.log(`\n========================================`);
    console.log(`📱 [SMS SIMULATION] To: +91 ${cleanPhone}`);
    console.log(`🔑 [OTP CODE]: ${otp}`);
    console.log(`⚠️  To send real SMS, configure HANU_OTP_API_KEY in backend environment`);
    console.log(`========================================\n`);

    return { sent: false, provider: 'console_simulation' };
}

module.exports = { sendSmsOtp };
