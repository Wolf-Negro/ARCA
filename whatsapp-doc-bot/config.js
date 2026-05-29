require('dotenv').config();

const config = {
  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,

  // App
  PORT: parseInt(process.env.PORT || '3000', 10),
  MAX_SEARCH_RESULTS: parseInt(process.env.MAX_SEARCH_RESULTS || '3', 10),
  RECENT_DOCS_LIMIT: parseInt(process.env.RECENT_DOCS_LIMIT || '10', 10),
  PENDING_EXPIRY_MINUTES: parseInt(process.env.PENDING_EXPIRY_MINUTES || '10', 10),
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || 'documents',

  // WhatsApp session
  WWEBJS_AUTH_PATH: process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth',
};

function validate() {
  const required = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno requeridas no configuradas: ${missing.join(', ')}`
    );
  }
}

module.exports = { ...config, validate };
