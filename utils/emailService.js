const nodemailer = require('nodemailer');

// Build transporter if SMTP config is provided in environment
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const rawUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
  const rawPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';

  const user = rawUser.replace(',', '.').trim();
  const pass = rawPass.replace(/\s+/g, '');

  if (user && pass) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });
      console.log(`[EmailService] ✅ Configured SMTP transport via ${host}:${port} (${user})`);
    } catch (err) {
      console.warn('[EmailService] Failed to initialize SMTP transport:', err.message);
      transporter = null;
    }
  }

  return transporter;
}

const BRAND = {
  name: 'DINEVIQ',
  tagline: 'Next-Gen Restaurant & Cafe Operating System',
  supportEmail: process.env.ADMIN_EMAIL || 'support@dineviq.com',
  website: process.env.FRONTEND_URL || 'https://www.dineviq.com',
  primaryColor: '#059669',
  accentColor: '#10b981'
};

/**
 * Base email layout wrapper with modern, responsive styling
 */
function wrapHtml(title, preheader, contentHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .email-wrapper { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%); padding: 36px 32px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; color: #a7f3d0; font-size: 13px; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase; }
    .content { padding: 36px 32px; font-size: 15px; line-height: 1.65; color: #334155; }
    .highlight-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin: 24px 0; }
    .cta-button { display: inline-block; background: #059669; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; text-align: center; margin: 20px 0; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25); }
    .code-box { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #047857; text-align: center; background: #ecfdf5; padding: 18px; border-radius: 10px; border: 2px dashed #10b981; margin: 20px 0; }
    .footer { background: #f1f5f9; padding: 24px 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .footer a { color: #059669; text-decoration: none; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden">${preheader}</div>
  <div class="email-wrapper">
    <div class="header">
      <h1>${BRAND.name}</h1>
      <p>${BRAND.tagline}</p>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p style="margin: 0 0 8px 0;">Need immediate assistance? Contact our team at <a href="mailto:${BRAND.supportEmail}">${BRAND.supportEmail}</a></p>
      <p style="margin: 0;">© ${new Date().getFullYear()} ${BRAND.name} Technologies India Pvt. Ltd. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Dispatch an email, or log in developer console if SMTP is not configured
 */
async function sendMail({ to, subject, html, text }) {
  const mailer = getTransporter();
  const rawUser = (process.env.SMTP_USER || '').replace(',', '.').trim();
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  
  // Use clean sender header that matches SMTP auth user for Google delivery
  const from = rawUser ? `"${BRAND.name}" <${rawUser}>` : (process.env.SMTP_FROM || `"${BRAND.name}" <${BRAND.supportEmail}>`);
  const replyTo = rawUser || BRAND.supportEmail;

  if (mailer) {
    try {
      console.log(`[EmailService] 📤 Dispatching email from "${from}" to "${to}" | Subject: "${subject}"`);
      const info = await mailer.sendMail({
        from,
        to,
        replyTo,
        subject,
        html,
        text
      });
      console.log(`[EmailService] ✅ Email delivered to ${to} (MessageId: ${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[EmailService] ❌ SMTP send error to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    console.log(`\n================== [EMAIL SIMULATION (SMTP NOT CONFIGURED)] ==================`);
    console.log(`From: ${from}`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Text Preview: ${text || 'HTML Email Body'}`);
    console.log(`============================================================================\n`);
    return { success: true, simulated: true };
  }
}

/**
 * 1. Email OTP for Verification
 */
async function sendOtpEmail({ to, otp, cafeName }) {
  const title = `Verify Your Email for ${cafeName || 'Your Cafe'}`;
  const preheader = `Your 6-digit DINEVIQ email verification code is ${otp}`;
  const html = wrapHtml(
    title,
    preheader,
    `
      <h2 style="margin-top:0; color:#0f172a; font-size:20px;">Email Verification Code</h2>
      <p>Hello,</p>
      <p>Thank you for initiating onboarding for <strong>${cafeName || 'your restaurant/cafe'}</strong> on DINEVIQ. To ensure the security of your business account, please verify your email address using the 6-digit code below:</p>
      
      <div class="code-box">${otp}</div>
      
      <p style="font-size:13px; color:#64748b;">This code is valid for <strong>15 minutes</strong>. If you did not request this verification, you can safely ignore this email.</p>
    `
  );

  return sendMail({
    to,
    subject: `${otp} is your DINEVIQ verification code`,
    html,
    text: `Your DINEVIQ verification code is: ${otp}. It expires in 15 minutes.`
  });
}

/**
 * 2. Super Admin Direct Invite Email
 */
async function sendInviteEmail({ to, inviteLink, cafeName }) {
  const title = `Invitation to Join DINEVIQ OS`;
  const preheader = `You've been invited by Super Admin to activate ${cafeName || 'your cafe'} on DINEVIQ`;
  const html = wrapHtml(
    title,
    preheader,
    `
      <div style="text-align:center; margin-bottom:20px;">
        <span style="font-size:40px;">✉️</span>
        <h2 style="margin:8px 0 0 0; color:#065f46; font-size:22px;">You're Invited to DINEVIQ</h2>
      </div>

      <p>Hello,</p>
      <p>A DINEVIQ Super Administrator has invited you to set up and launch <strong>${cafeName || 'your restaurant / cafe'}</strong> on the DINEVIQ autonomous dining platform.</p>

      <div class="highlight-box">
        <p style="margin: 0 0 8px 0; font-weight: 700; color: #065f46;">What's Included in Your Invitation:</p>
        <ul style="margin: 0; padding-left: 20px; color: #1e293b; font-size: 14px; line-height: 1.7;">
          <li><strong>Direct Super Admin Approval:</strong> Fast-track verification</li>
          <li><strong>14-Day Free Access:</strong> Full POS, live KDS & digital QR dine-in ordering</li>
          <li><strong>Zero Card Required:</strong> Get started in under 2 minutes</li>
        </ul>
      </div>

      <p>To complete your onboarding registration, simply click the secure invitation link below:</p>

      <div style="text-align: center;">
        <a href="${inviteLink}" class="cta-button" target="_blank">Complete Cafe Onboarding →</a>
      </div>

      <p style="font-size: 12px; color: #64748b; word-break: break-all; margin-top: 20px;">
        Or copy and paste this URL into your browser:<br>
        <a href="${inviteLink}" style="color: #059669;">${inviteLink}</a>
      </p>
    `
  );

  return sendMail({
    to,
    subject: `You're invited to join DINEVIQ - Launch your digital cafe`,
    html,
    text: `You have been invited to join DINEVIQ. Complete your setup here: ${inviteLink}`
  });
}

/**
 * 3. Application Submitted / Pending Review Notification Email
 */
async function sendApplicationSubmittedEmail({ to, cafeName, ownerName }) {
  const title = `Application Received: ${cafeName || 'Your Cafe'}`;
  const preheader = `Your DINEVIQ cafe registration is under Super Admin review`;
  const html = wrapHtml(
    title,
    preheader,
    `
      <h2 style="margin-top:0; color:#0f172a; font-size:20px;">Onboarding Application Under Review</h2>
      <p>Dear ${ownerName || 'Cafe Owner'},</p>
      <p>We have successfully received your registration details for <strong>${cafeName}</strong>.</p>
      
      <div class="highlight-box">
        <p style="margin:0 0 6px 0; font-size:14px; color:#1e293b;">
          <strong>Application Status:</strong> <span style="background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:6px; font-weight:700; font-size:12px;">Under Super Admin Review</span>
        </p>
      </div>

      <p>To maintain platform quality and security standards, our platform administrators review every applicant. Once your account is verified and approved, you will receive an official onboarding confirmation email with your login access.</p>

      <p>Our typical review time is <strong>within 2 to 6 business hours</strong>. If you have urgent requirements, feel free to reply to this email or reach us on Indian WhatsApp Support.</p>
    `
  );

  return sendMail({
    to,
    subject: `Application Received: ${cafeName} is under review - DINEVIQ`,
    html,
    text: `Your onboarding application for ${cafeName} has been received and is under review by Super Admin. You will receive an email once approved.`
  });
}

/**
 * 4. Application Approved & Onboarded Email
 */
async function sendApprovalEmail({ to, cafeName, ownerName, loginUrl, planName = '14-Day Free Trial' }) {
  const title = `Welcome to DINEVIQ — Your Cafe is Live!`;
  const preheader = `Congratulations! Your cafe ${cafeName} has been approved and onboarded`;
  const effectiveLoginUrl = loginUrl || `${BRAND.website}/login`;

  const html = wrapHtml(
    title,
    preheader,
    `
      <div style="text-align:center; margin-bottom:20px;">
        <span style="font-size:48px;">🎉</span>
        <h2 style="margin:8px 0 0 0; color:#065f46; font-size:22px;">Congratulations! Your Cafe is Onboarded</h2>
      </div>

      <p>Dear ${ownerName || 'Cafe Owner'},</p>
      <p>We are delighted to inform you that your cafe <strong>${cafeName}</strong> has been officially approved and activated on <strong>DINEVIQ</strong> with your <strong>${planName}</strong> plan!</p>
      
      <div class="highlight-box">
        <p style="margin:0 0 8px 0; font-weight:700; color:#065f46;">🚀 Your Store is Ready for Business:</p>
        <ul style="margin:0; padding-left:20px; color:#1e293b; font-size:14px; line-height:1.7;">
          <li><strong>Registered Email:</strong> ${to}</li>
          <li><strong>POS & Management Console:</strong> Active</li>
          <li><strong>QR Dine-In Menus:</strong> Ready for custom dishes</li>
          <li><strong>Google Sign-in:</strong> Enabled for your account</li>
        </ul>
      </div>

      <p>You can now sign in to your restaurant dashboard to upload your menu, generate table QR codes, and start taking digital orders immediately:</p>

      <div style="text-align:center;">
        <a href="${effectiveLoginUrl}" class="cta-button" target="_blank">Access Restaurant Dashboard →</a>
      </div>

      <p style="font-size:13px; color:#64748b;">If you need assistance configuring your thermal printer, KDS, or import menu via AI, our onboarding specialists are always here to help.</p>
    `
  );

  return sendMail({
    to,
    subject: `Welcome to DINEVIQ! Your Cafe ${cafeName} is Approved and Live`,
    html,
    text: `Congratulations! Your cafe ${cafeName} has been approved on DINEVIQ. You can log in at: ${effectiveLoginUrl}`
  });
}

/**
 * 5. Application Rejected Email
 */
async function sendRejectionEmail({ to, cafeName, ownerName, reason }) {
  const title = `Update on Your DINEVIQ Application`;
  const preheader = `Status update regarding your onboarding application for ${cafeName}`;
  const html = wrapHtml(
    title,
    preheader,
    `
      <h2 style="margin-top:0; color:#991b1b; font-size:20px;">Application Status Update</h2>
      <p>Dear ${ownerName || 'Cafe Owner'},</p>
      <p>Thank you for your interest in joining the DINEVIQ restaurant operating platform with <strong>${cafeName}</strong>.</p>
      
      <p>After reviewing the details provided in your onboarding submission, our team is unable to approve your application at this time.</p>
      
      ${reason ? `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:18px; margin:20px 0;">
          <p style="margin:0; font-size:14px; color:#991b1b;">
            <strong>Reason / Feedback from Super Admin:</strong><br>${reason}
          </p>
        </div>
      ` : ''}

      <p>If you believe this was an error, or if you would like to provide updated credentials and re-apply, please feel free to reach out to our team at <a href="mailto:${BRAND.supportEmail}" style="color:#059669;">${BRAND.supportEmail}</a>.</p>
    `
  );

  return sendMail({
    to,
    subject: `Update regarding your DINEVIQ application for ${cafeName}`,
    html,
    text: `Your application for ${cafeName} could not be approved at this time. Reason: ${reason || 'Details could not be verified'}`
  });
}

module.exports = {
  sendOtpEmail,
  sendInviteEmail,
  sendApplicationSubmittedEmail,
  sendApprovalEmail,
  sendRejectionEmail
};
