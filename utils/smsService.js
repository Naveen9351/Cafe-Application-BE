/**
 * Multi-provider SMS Dispatcher
 * Supports Fast2SMS (popular in India with instant OTP route), Twilio, and dev console fallback
 */
const https = require('https');

function makeFast2SmsRequest(apiKey, postData) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.fast2sms.com',
            path: '/dev/bulkV2',
            method: 'POST',
            headers: {
                'authorization': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve({ return: false, raw: data });
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function sendSmsOtp(phone, otp) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    // 1. Fast2SMS (Indian SMS Gateway - Automatic Dual-Route Strategy)
    if (process.env.FAST2SMS_API_KEY) {
        try {
            // Route Attempt 1: 'otp' route (requires website verification on Fast2SMS)
            const otpPayload = JSON.stringify({
                variables_values: otp,
                route: 'otp',
                numbers: cleanPhone
            });

            const otpRes = await makeFast2SmsRequest(process.env.FAST2SMS_API_KEY, otpPayload);
            console.log(`[Fast2SMS OTP Route Response] for +91 ${cleanPhone}:`, otpRes);

            if (otpRes && otpRes.return === true) {
                return { sent: true, provider: 'fast2sms' };
            }

            // Route Attempt 2: 'q' (Quick SMS route - works instantly after ₹100 recharge)
            console.log(`[Fast2SMS] OTP route returned: ${otpRes?.message || 'pending verification'}. Falling back to Quick SMS route ('q')...`);
            const quickPayload = JSON.stringify({
                message: `Your DineviQ verification OTP is ${otp}. Valid for 5 minutes.`,
                language: 'english',
                route: 'q',
                numbers: cleanPhone
            });

            const quickRes = await makeFast2SmsRequest(process.env.FAST2SMS_API_KEY, quickPayload);
            console.log(`[Fast2SMS Quick Route Response] for +91 ${cleanPhone}:`, quickRes);

            if (quickRes && quickRes.return === true) {
                return { sent: true, provider: 'fast2sms' };
            }
        } catch (err) {
            console.error('[Fast2SMS Error]:', err.message);
        }
    }

    // 2. Twilio Gateway (International)
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

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.log(`[Twilio Response] for +91 ${cleanPhone}:`, data);
                        resolve(data);
                    });
                });
                req.on('error', reject);
                req.write(postData);
                req.end();
            });

            return { sent: true, provider: 'twilio' };
        } catch (err) {
            console.error('[Twilio Error]:', err.message);
        }
    }

    // Fallback in Dev: Log to server terminal
    console.log(`\n========================================`);
    console.log(`📱 [SMS SIMULATION] To: +91 ${cleanPhone}`);
    console.log(`🔑 [OTP CODE]: ${otp}`);
    console.log(`⚠️  To send real SMS to mobile phones, add FAST2SMS_API_KEY in backend .env`);
    console.log(`========================================\n`);

    return { sent: false, provider: 'console_simulation' };
}

module.exports = { sendSmsOtp };
