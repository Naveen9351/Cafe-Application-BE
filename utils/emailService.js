const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

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
  tagline: 'NEXT-GEN RESTAURANT & CAFE OPERATING SYSTEM',
  supportEmail: process.env.ADMIN_EMAIL || 'support@dineviq.com',
  website: process.env.FRONTEND_URL || 'https://www.dineviq.com',
  primaryColor: '#047857',
  accentColor: '#059669'
};

/**
 * Base email layout wrapper with modern, luxury card design
 * Matches exact UI: Emerald top banner with App Logo, rounded card on subtle canvas, footer pill
 */
function wrapCard({ title, subtitle, preheader, contentHtml }) {
  const headerSubtitle = subtitle || BRAND.tagline;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    table { border-collapse: collapse; }
    .wrapper-table {
      width: 100%;
      background-color: #f1f5f9;
      padding: 40px 12px;
    }
    .email-card {
      max-width: 540px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 12px 35px rgba(15, 23, 42, 0.08);
      border: 1px solid #e2e8f0;
    }
    .header-banner {
      background: #047857;
      padding: 24px 20px 20px;
      text-align: center;
    }
    .body-content {
      padding: 32px 34px 24px;
      color: #334155;
      font-size: 15px;
      line-height: 1.6;
    }
    .heading {
      margin: 0 0 14px 0;
      color: #0f172a;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .footer-pill {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 20px;
      margin: 0 24px 24px;
      text-align: center;
      font-size: 11px;
      line-height: 1.6;
      color: #64748b;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9;">
  <div style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden">${preheader || title}</div>

  <table class="wrapper-table" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background-color: #f1f5f9; padding: 36px 12px;">
    <tr>
      <td align="center">
        <div class="email-card" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 35px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0; text-align: left;">
          
          <!-- Top Emerald Header Banner with Application Logo -->
          <div class="header-banner" style="background: #047857; padding: 24px 20px 20px; text-align: center;">
            <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto;">
              <tr>
                <td style="vertical-align: middle; padding-right: 12px;">
                  <img src="cid:dineviq-logo" alt="DINEVIQ" width="38" height="38" style="display: block; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.5); background: #ffffff; object-fit: contain;" />
                </td>
                <td style="vertical-align: middle; text-align: left;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; line-height: 1.1;">DINEVIQ</h1>
                  <p style="margin: 4px 0 0 0; color: #a7f3d0; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; line-height: 1;">${headerSubtitle}</p>
                </td>
              </tr>
            </table>
          </div>

          <!-- Main Content -->
          <div class="body-content" style="padding: 32px 34px 24px; color: #334155; font-size: 15px; line-height: 1.6;">
            ${contentHtml}
          </div>

          <!-- Bottom Footer Pill -->
          <div class="footer-pill" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin: 0 24px 24px; text-align: center; font-size: 11px; line-height: 1.6; color: #64748b;">
            <p style="margin: 0 0 6px 0;">
              Need immediate assistance? Contact our team at <a href="mailto:${BRAND.supportEmail}" style="color: #059669; text-decoration: none; font-weight: 600;">${BRAND.supportEmail}</a>
            </p>
            <p style="margin: 0;">
              © 2026 DINEVIQ Technologies India Pvt. Ltd. All rights reserved.
            </p>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Dispatch an email with inline CID logo attachment
 */
async function sendMail({ to, subject, html, text }) {
  const mailer = getTransporter();
  const rawUser = (process.env.SMTP_USER || '').replace(',', '.').trim();
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';

  const from = rawUser ? `"${BRAND.name}" <${rawUser}>` : (process.env.SMTP_FROM || `"${BRAND.name}" <${BRAND.supportEmail}>`);
  const replyTo = rawUser || BRAND.supportEmail;

  // Resolve logo attachment for inline CID display
  const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
  const attachments = [];
  if (fs.existsSync(logoPath)) {
    attachments.push({
      filename: 'dineviq-logo.png',
      path: logoPath,
      cid: 'dineviq-logo'
    });
  }

  if (mailer) {
    try {
      console.log(`[EmailService] 📤 Dispatching email from "${from}" to "${to}" | Subject: "${subject}"`);
      const info = await mailer.sendMail({
        from,
        to,
        replyTo,
        subject,
        html,
        text,
        attachments
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
 * 1. Email OTP for Verification (Matches User Design Image 1)
 */
async function sendOtpEmail({ to, otp, cafeName }) {
  const title = `Your Verification Code`;
  const preheader = `Your 6-digit DINEVIQ verification code is ${otp}`;

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #0f172a; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      Your Verification Code
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Hello,</p>

    <p style="margin: 0 0 20px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      Please use the <strong>6-digit</strong> verification code below to verify your restaurant email and complete your setup.
    </p>

    <!-- Large Centered OTP Highlight Card -->
    <div style="background: #e8f8f0; border: 1px solid #bbf7d0; border-radius: 16px; padding: 26px 20px 20px; text-align: center; margin: 24px 0;">
      <div style="font-size: 58px; font-weight: 900; letter-spacing: 6px; color: #047857; margin: 0 0 10px 0; line-height: 1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        ${otp}
      </div>
      <p style="margin: 0; font-size: 13px; color: #059669; font-weight: 600;">
        This OTP is valid for 15 minutes.
      </p>
    </div>

    <p style="margin: 22px 0 0 0; font-size: 14px; color: #475569; line-height: 1.5;">
      If you did not request this code, you can <strong>safely ignore</strong> this email.
    </p>
  `;

  const html = wrapCard({
    title: `${otp} is your DINEVIQ verification code`,
    subtitle: 'VERIFICATION',
    preheader,
    contentHtml
  });

  return sendMail({
    to,
    subject: `${otp} is your DINEVIQ verification code`,
    html,
    text: `Your DINEVIQ verification code is: ${otp}. It expires in 15 minutes. If you did not request this code, you can safely ignore this email.`
  });
}

/**
 * 2. Super Admin Direct Invite Email (Matches User Design Image 2)
 */
async function sendInviteEmail({ to, inviteLink, cafeName }) {
  const title = `You're Invited to Join DINEVIQ!`;
  const preheader = `Exclusive onboarding invitation for ${cafeName || 'your restaurant'}`;

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #0f172a; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      You're Invited to Join DINEVIQ!
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Hello,</p>

    <p style="margin: 0 0 20px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      The Super Admin team has created an exclusive onboarding invitation for <strong>${cafeName || 'your cafe / restaurant'}</strong> to experience DINEVIQ's Autonomous POS, QR Ordering, and Live Kitchen Display System.
    </p>

    <!-- 2x2 Feature Grid Box -->
    <div style="background: #e8f8f0; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px 22px; margin: 22px 0 26px;">
      <h3 style="margin: 0 0 16px 0; font-size: 15px; font-weight: 800; color: #064e3b;">
        What you get with DINEVIQ:
      </h3>

      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="50%" style="vertical-align: top; padding: 0 8px 14px 0;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <div style="width: 36px; height: 36px; background: #ffffff; border-radius: 10px; text-align: center; line-height: 36px; font-size: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); border: 1px solid #d1fae5;">
                    🪑
                  </div>
                </td>
                <td style="vertical-align: middle; font-size: 13px; color: #1e293b; line-height: 1.35;">
                  <strong>Interactive QR Code</strong><br><span style="color: #64748b; font-size: 12px;">Menu (Guests order)</span>
                </td>
              </tr>
            </table>
          </td>

          <td width="50%" style="vertical-align: top; padding: 0 0 14px 8px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <div style="width: 36px; height: 36px; background: #ffffff; border-radius: 10px; text-align: center; line-height: 36px; font-size: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); border: 1px solid #d1fae5;">
                    💻
                  </div>
                </td>
                <td style="vertical-align: middle; font-size: 13px; color: #1e293b; line-height: 1.35;">
                  <strong>Kitchen Display/Tablet</strong><br><span style="color: #64748b; font-size: 12px;">& Waiter Tablet Sync</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td width="50%" style="vertical-align: top; padding: 0 8px 0 0;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <div style="width: 36px; height: 36px; background: #ffffff; border-radius: 10px; text-align: center; line-height: 36px; font-size: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); border: 1px solid #d1fae5;">
                    🧾
                  </div>
                </td>
                <td style="vertical-align: middle; font-size: 13px; color: #1e293b; line-height: 1.35;">
                  <strong>Instant UPI & Payment</strong><br><span style="color: #64748b; font-size: 12px;">Billing/ Ledger</span>
                </td>
              </tr>
            </table>
          </td>

          <td width="50%" style="vertical-align: top; padding: 0 0 0 8px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <div style="width: 36px; height: 36px; background: #ffffff; border-radius: 10px; text-align: center; line-height: 36px; font-size: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); border: 1px solid #d1fae5;">
                    📊
                  </div>
                </td>
                <td style="vertical-align: middle; font-size: 13px; color: #1e293b; line-height: 1.35;">
                  <strong>Data Visualization/</strong><br><span style="color: #64748b; font-size: 12px;">Analytics</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <!-- Centered Call to Action Button -->
    <div style="text-align: center; margin: 26px 0 22px;">
      <a href="${inviteLink}" style="display: inline-block; background: #047857; color: #ffffff !important; text-decoration: none; padding: 14px 34px; border-radius: 9999px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(4, 120, 87, 0.35);">
        Complete Cafe Onboarding &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; line-height: 1.6; margin: 18px 0 6px;">
      Or copy and paste this link in your browser:<br>
      <a href="${inviteLink}" style="color: #059669; word-break: break-all;">${inviteLink}</a>
    </p>

    <p style="font-size: 12px; color: #64748b; margin: 0;">
      This invitation link is valid for 7 days.
    </p>
  `;

  const html = wrapCard({
    title,
    subtitle: BRAND.tagline,
    preheader,
    contentHtml
  });

  return sendMail({
    to,
    subject: `You're invited to join DINEVIQ - Launch your digital cafe`,
    html,
    text: `You have been invited to join DINEVIQ for ${cafeName || 'your cafe'}. Complete your setup here: ${inviteLink} (Valid for 7 days)`
  });
}

/**
 * 3. Application Submitted / Pending Review Notification Email
 */
async function sendApplicationSubmittedEmail({ to, cafeName, ownerName }) {
  const title = `Application Under Review`;
  const preheader = `Your DINEVIQ cafe registration is under Super Admin review`;

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #0f172a; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      Onboarding Application Under Review
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Dear ${ownerName || 'Cafe Owner'},</p>

    <p style="margin: 0 0 18px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      We have successfully received your registration details for <strong>${cafeName}</strong>.
    </p>

    <div style="background: #e8f8f0; border: 1px solid #bbf7d0; border-radius: 14px; padding: 18px 20px; margin: 20px 0;">
      <p style="margin: 0; font-size: 14px; color: #1e293b;">
        <strong>Application Status:</strong> 
        <span style="background: #fef3c7; color: #b45309; padding: 3px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; margin-left: 6px;">
          Under Super Admin Review
        </span>
      </p>
      <p style="margin: 8px 0 0 0; font-size: 13px; color: #065f46;">
        Estimated review time: <strong>Within 2 to 6 business hours</strong>.
      </p>
    </div>

    <p style="margin: 0 0 14px 0; font-size: 14px; color: #334155; line-height: 1.6;">
      To maintain platform quality and security standards, our platform administrators review every applicant. Once your account is verified and approved, you will receive an official onboarding confirmation email with your login access.
    </p>

    <p style="margin: 0; font-size: 13px; color: #64748b;">
      If you have urgent requirements, feel free to reply to this email or reach us on direct WhatsApp Support.
    </p>
  `;

  const html = wrapCard({
    title,
    subtitle: 'APPLICATION REVIEW',
    preheader,
    contentHtml
  });

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

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #065f46; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      🎉 Congratulations! Your Cafe is Onboarded
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Dear ${ownerName || 'Cafe Owner'},</p>

    <p style="margin: 0 0 18px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      We are delighted to inform you that your cafe <strong>${cafeName}</strong> has been officially approved and activated on <strong>DINEVIQ</strong> with your <strong>${planName}</strong> plan!
    </p>

    <div style="background: #e8f8f0; border: 1px solid #bbf7d0; border-radius: 14px; padding: 18px 20px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-weight: 700; color: #065f46; font-size: 14px;">
        🚀 Your Store is Ready for Business:
      </p>
      <ul style="margin: 0; padding-left: 20px; color: #1e293b; font-size: 13px; line-height: 1.7;">
        <li><strong>Registered Email:</strong> ${to}</li>
        <li><strong>POS & Management Console:</strong> Active</li>
        <li><strong>QR Dine-In Menus:</strong> Ready for custom dishes</li>
        <li><strong>Google Sign-in:</strong> Enabled for your account</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 26px 0 20px;">
      <a href="${effectiveLoginUrl}" style="display: inline-block; background: #047857; color: #ffffff !important; text-decoration: none; padding: 14px 34px; border-radius: 9999px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(4, 120, 87, 0.35);">
        Access Restaurant Dashboard &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
      Or visit: <a href="${effectiveLoginUrl}" style="color: #059669;">${effectiveLoginUrl}</a>
    </p>
  `;

  const html = wrapCard({
    title,
    subtitle: 'RESTAURANT ACTIVATED',
    preheader,
    contentHtml
  });

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

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #991b1b; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      Application Status Update
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Dear ${ownerName || 'Cafe Owner'},</p>

    <p style="margin: 0 0 18px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      Thank you for your interest in joining the DINEVIQ restaurant operating platform with <strong>${cafeName}</strong>.
    </p>

    <p style="margin: 0 0 18px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      After reviewing the details provided in your onboarding submission, our team is unable to approve your application at this time.
    </p>

    ${reason ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; padding: 18px 20px; margin: 20px 0;">
        <p style="margin: 0; font-size: 13px; color: #991b1b; line-height: 1.5;">
          <strong>Feedback from Platform Admin:</strong><br>${reason}
        </p>
      </div>
    ` : ''}

    <p style="margin: 20px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      If you believe this was in error, or if you would like to provide updated establishment verification documents, please reach out to our team at <a href="mailto:${BRAND.supportEmail}" style="color: #059669;">${BRAND.supportEmail}</a>.
    </p>
  `;

  const html = wrapCard({
    title,
    subtitle: 'APPLICATION STATUS',
    preheader,
    contentHtml
  });

  return sendMail({
    to,
    subject: `Update regarding your DINEVIQ application for ${cafeName}`,
    html,
    text: `Your application for ${cafeName} could not be approved at this time. Reason: ${reason || 'Details could not be verified'}`
  });
}

/**
 * 6. Admin Password Reset Email
 */
async function sendPasswordResetEmail({ to, cafeName, userName, tempPassword, loginUrl }) {
  const title = `Password Reset — DINEVIQ Account`;
  const preheader = `Your account credentials for ${cafeName || 'your cafe'} have been reset`;
  const effectiveLoginUrl = loginUrl || `${BRAND.website}/login`;

  const contentHtml = `
    <h2 class="heading" style="margin: 0 0 14px 0; color: #065f46; font-size: 22px; font-weight: 800; letter-spacing: -0.01em;">
      🔐 Your Password Has Been Reset
    </h2>

    <p style="margin: 0 0 12px 0; color: #334155; font-size: 15px;">Dear ${userName || 'Cafe Owner'},</p>

    <p style="margin: 0 0 18px 0; color: #334155; font-size: 15px; line-height: 1.6;">
      Your password for your <strong>DINEVIQ</strong> management console (<strong>${cafeName || 'Cafe Portal'}</strong>) has been reset by the platform administrator.
    </p>

    <div style="background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 14px; padding: 20px; margin: 20px 0; text-align: center;">
      <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
        Your Login Credentials
      </p>
      <p style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">
        <strong>Email:</strong> ${to}
      </p>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; display: inline-block; padding: 10px 22px; border-radius: 10px; margin: 4px 0;">
        <span style="font-size: 11px; color: #64748b; display: block; margin-bottom: 2px;">Temporary Password</span>
        <code style="font-size: 20px; font-weight: 800; color: #047857; letter-spacing: 2px;">${tempPassword}</code>
      </div>
    </div>

    <div style="text-align: center; margin: 26px 0 20px;">
      <a href="${effectiveLoginUrl}" style="display: inline-block; background: #047857; color: #ffffff !important; text-decoration: none; padding: 14px 34px; border-radius: 9999px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(4, 120, 87, 0.35);">
        Log In to Your Console &rarr;
      </a>
    </div>

    <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0 0 12px 0;">
      Or visit: <a href="${effectiveLoginUrl}" style="color: #059669;">${effectiveLoginUrl}</a>
    </p>

    <p style="font-size: 12px; color: #94a3b8; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin: 16px 0 0 0; line-height: 1.5;">
      ⚠️ <strong>Security Tip:</strong> For security, please log in with this temporary password and update it immediately in your <strong>Profile / Settings</strong> section.
    </p>
  `;

  const html = wrapCard({
    title,
    subtitle: 'SECURITY & ACCESS',
    preheader,
    contentHtml
  });

  return sendMail({
    to,
    subject: `Password Reset for your DINEVIQ Account (${cafeName || 'Cafe'})`,
    html,
    text: `Your password for DINEVIQ (${cafeName}) has been reset. Email: ${to} | Temporary Password: ${tempPassword} | Log in at: ${effectiveLoginUrl}`
  });
}

module.exports = {
  sendOtpEmail,
  sendInviteEmail,
  sendApplicationSubmittedEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendPasswordResetEmail
};
