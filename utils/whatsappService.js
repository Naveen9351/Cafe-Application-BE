const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// In-memory registry of active sessions: tenantId -> session object
const activeSessions = new Map();

const getSessionBaseDir = () => {
  const dir = path.join(__dirname, '../uploads/whatsapp_sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const getTenantSessionDir = (tenantId) => {
  const cleanId = String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(getSessionBaseDir(), cleanId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

/**
 * Get current session state for a given tenant
 */
const getWhatsAppStatus = (tenantId) => {
  const key = String(tenantId || 'default');
  const session = activeSessions.get(key);

  if (!session) {
    // Check if session files exist on disk
    const sessionDir = getTenantSessionDir(tenantId);
    const hasCreds = fs.existsSync(path.join(sessionDir, 'creds.json'));
    return {
      connected: false,
      connecting: false,
      hasSavedSession: hasCreds,
      qrCode: null,
      user: null
    };
  }

  return {
    connected: session.connected || false,
    connecting: session.connecting || false,
    hasSavedSession: true,
    qrCode: session.qrCode || null,
    user: session.user || null
  };
};

/**
 * Initialize or connect WhatsApp session for a tenant
 */
const initWhatsApp = async (tenantId, forceNew = false) => {
  const key = String(tenantId || 'default');
  let session = activeSessions.get(key);

  if (session && session.connected && !forceNew) {
    return getWhatsAppStatus(tenantId);
  }

  const sessionDir = getTenantSessionDir(tenantId);

  if (forceNew) {
    try {
      if (session?.sock) {
        session.sock.ev.removeAllListeners();
        session.sock.end();
      }
    } catch (e) {
      // ignore
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
    fs.mkdirSync(sessionDir, { recursive: true });
    activeSessions.delete(key);
  }

  // Set up in-memory tracker
  session = {
    connected: false,
    connecting: true,
    qrCode: null,
    user: null,
    sock: null
  };
  activeSessions.set(key, session);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['DINEVIQ Cafe OS', 'Chrome', '1.0.0'],
      syncFullHistory: false
    });

    session.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 6
          });
          session.qrCode = qrDataUrl;
          session.connecting = true;
          session.connected = false;

          if (global.io) {
            global.io.to(key).emit('whatsapp_qr', { qrCode: qrDataUrl });
          }
        } catch (qrErr) {
          console.error('[WhatsApp] QR DataURL generation error:', qrErr);
        }
      }

      if (connection === 'open') {
        session.connected = true;
        session.connecting = false;
        session.qrCode = null;
        session.user = {
          id: sock.user?.id ? sock.user.id.split(':')[0] : null,
          name: sock.user?.name || 'Cafe WhatsApp Number'
        };

        console.log(`[WhatsApp] Connected successfully for tenant: ${key} (${session.user.id})`);

        if (global.io) {
          global.io.to(key).emit('whatsapp_connected', { user: session.user });
        }
      }

      if (connection === 'close') {
        session.connected = false;
        session.connecting = false;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(`[WhatsApp] Connection closed for tenant: ${key}, reason statusCode: ${statusCode}`);

        if (isLoggedOut) {
          console.log(`[WhatsApp] Device logged out for tenant: ${key}. Cleaning credentials.`);
          fs.rmSync(sessionDir, { recursive: true, force: true });
          session.qrCode = null;
          session.user = null;
          activeSessions.delete(key);

          if (global.io) {
            global.io.to(key).emit('whatsapp_disconnected', { reason: 'logged_out' });
          }
        } else {
          const hasSavedCreds = fs.existsSync(path.join(sessionDir, 'creds.json'));
          if (hasSavedCreds) {
            // Reconnect automatically if connection dropped unexpectedly for an existing paired account
            console.log(`[WhatsApp] Temporary disconnect for tenant: ${key}. Attempting reconnect in 5s...`);
            setTimeout(() => {
              initWhatsApp(tenantId, false).catch(err => {
                console.error('[WhatsApp] Auto-reconnect failed:', err.message);
              });
            }, 5000);
          } else {
            console.log(`[WhatsApp] QR timeout for tenant: ${key}. Waiting for user interaction.`);
            session.qrCode = null;
          }
        }
      }
    });

    return getWhatsAppStatus(tenantId);
  } catch (err) {
    console.error(`[WhatsApp] Failed to init session for tenant: ${key}`, err);
    session.connecting = false;
    session.connected = false;
    throw err;
  }
};

/**
 * Send WhatsApp text message to customer directly
 */
const sendWhatsAppMessage = async (tenantId, { phone, message }) => {
  const key = String(tenantId || 'default');
  let session = activeSessions.get(key);

  // If not in memory but credentials exist on disk, attempt fast auto-connect
  if (!session || !session.connected) {
    const sessionDir = getTenantSessionDir(tenantId);
    if (fs.existsSync(path.join(sessionDir, 'creds.json'))) {
      console.log(`[WhatsApp] Re-awakening saved session for tenant: ${key}...`);
      await initWhatsApp(tenantId, false);
      session = activeSessions.get(key);

      // Wait up to 6 seconds for connection to open
      let waitCount = 0;
      while (session && !session.connected && waitCount < 12) {
        await new Promise(r => setTimeout(r, 500));
        session = activeSessions.get(key);
        waitCount++;
      }
    }
  }

  if (!session || !session.connected || !session.sock) {
    return {
      success: false,
      notConnected: true,
      error: 'WhatsApp is not connected on the cafe server. Please link your WhatsApp in Restaurant Settings.'
    };
  }

  // Format recipient phone number
  let cleanPhone = String(phone || '').replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone; // Default to India country code for 10-digit mobile
  }

  if (cleanPhone.length < 10) {
    return {
      success: false,
      error: 'A valid customer phone number with country code is required.'
    };
  }

  const jid = `${cleanPhone}@s.whatsapp.net`;

  try {
    const sent = await session.sock.sendMessage(jid, { text: message });
    return {
      success: true,
      phone: cleanPhone,
      messageId: sent?.key?.id || null
    };
  } catch (sendErr) {
    console.error(`[WhatsApp] Error sending message to ${jid}:`, sendErr);
    return {
      success: false,
      error: sendErr.message || 'Failed to dispatch WhatsApp message.'
    };
  }
};

/**
 * Disconnect / unlink WhatsApp session
 */
const disconnectWhatsApp = async (tenantId) => {
  const key = String(tenantId || 'default');
  const session = activeSessions.get(key);

  if (session?.sock) {
    try {
      session.sock.ev.removeAllListeners();
      await session.sock.logout();
    } catch (e) {
      try {
        session.sock.end();
      } catch (err) {}
    }
  }

  const sessionDir = getTenantSessionDir(tenantId);
  fs.rmSync(sessionDir, { recursive: true, force: true });
  activeSessions.delete(key);

  if (global.io) {
    global.io.to(key).emit('whatsapp_disconnected', { reason: 'manual_unlink' });
  }

  return { success: true };
};

/**
 * Auto-restore any saved sessions on server boot
 */
const autoRestoreSavedSessions = async () => {
  try {
    const baseDir = getSessionBaseDir();
    const tenants = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const tId of tenants) {
      const credsPath = path.join(baseDir, tId, 'creds.json');
      if (fs.existsSync(credsPath)) {
        console.log(`[WhatsApp] Restoring saved session for tenant: ${tId}`);
        initWhatsApp(tId, false).catch(err => {
          console.warn(`[WhatsApp] Auto-restore for ${tId} encountered:`, err.message);
        });
      }
    }
  } catch (err) {
    console.warn('[WhatsApp] Auto-restore error:', err.message);
  }
};

module.exports = {
  getWhatsAppStatus,
  initWhatsApp,
  sendWhatsAppMessage,
  disconnectWhatsApp,
  autoRestoreSavedSessions
};
