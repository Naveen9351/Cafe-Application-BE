/**
 * Multi-provider SMS Dispatcher
 * Supports Fast2SMS (popular in India with instant OTP route), Twilio, and dev console fallback
 */
const https = require('https');

async function sendSmsOtp(phone, otp) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    // 1. Fast2SMS (Indian SMS Gateway - Quick OTP Route)
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

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.log(`[Fast2SMS Response] for +91 ${cleanPhone}:`, data);
                        resolve(data);
                    });
                });
                req.on('error', reject);
                req.write(postData);
                req.end();
            });

            return { sent: true, provider: 'fast2sms' };
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
