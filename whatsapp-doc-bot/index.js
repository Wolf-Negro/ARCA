require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const config = require('./config');
const whatsappService = require('./services/whatsapp');
const { handleMessage } = require('./handlers/messageHandler');

// ── Validar variables de entorno antes de arrancar ──
try {
  config.validate();
} catch (err) {
  console.error('❌ Error de configuración:', err.message);
  process.exit(1);
}

// ── Express (health check y endpoint básico) ──
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-doc-bot', version: '2.0.0' });
});

// ── Cliente de WhatsApp ──
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath:
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// Pasar el cliente al servicio de WhatsApp para que pueda enviar mensajes
whatsappService.init(client);

// ── Eventos del cliente ──

client.on('qr', (qr) => {
  console.log('\n📱 Escaneá el código QR con WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\n⚠️  El QR expira en ~60 segundos. Si expira, reiniciá el proceso.\n');
});

client.on('loading_screen', (percent, message) => {
  process.stdout.write(`\r⏳ Cargando... ${percent}% - ${message}   `);
});

client.on('authenticated', () => {
  console.log('\n✅ Sesión autenticada');
});

client.on('auth_failure', (msg) => {
  console.error('\n❌ Fallo de autenticación:', msg);
  console.error('   Eliminá la carpeta .wwebjs_auth/ y volvé a intentarlo.');
  process.exit(1);
});

client.on('ready', () => {
  const phone = client.info?.wid?.user || 'desconocido';
  console.log(`\n🤖 Bot conectado ✅`);
  console.log(`📞 Número activo: +${phone}`);
  console.log(`🌐 Servidor en puerto ${config.PORT}`);
  console.log('─'.repeat(40));
});

client.on('message', async (msg) => {
  console.log(`[DEBUG] message event | from: ${msg.from} | type: ${msg.type} | fromMe: ${msg.fromMe} | body: "${(msg.body || '').slice(0, 60)}"`);

  // Ignorar mensajes propios (cuando el bot responde)
  if (msg.fromMe) {
    console.log('[DEBUG] Mensaje ignorado: fromMe=true');
    return;
  }

  try {
    await handleMessage(msg, client);
  } catch (err) {
    console.error('[messageHandler] Error no capturado:', err);
  }
});

client.on('message_create', async (msg) => {
  // Ignorar mensajes enviados por el bot
  if (!msg.fromMe) return;
});

client.on('disconnected', (reason) => {
  console.warn('\n⚠️  Bot desconectado:', reason);
  console.warn('   Reiniciando en 10 segundos...');
  setTimeout(() => client.initialize(), 10_000);
});

// ── Iniciar cliente y servidor ──
console.log('🚀 Iniciando bot de WhatsApp...');
client.initialize();

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`🌐 Express escuchando en http://localhost:${PORT}`);
});

// Manejo limpio de cierre
process.on('SIGINT', async () => {
  console.log('\n👋 Cerrando bot...');
  await client.destroy();
  process.exit(0);
});
