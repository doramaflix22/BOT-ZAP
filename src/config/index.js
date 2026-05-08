/**
 * Configuração Central da Aplicação
 * Exporta todas as configurações de forma organizada
 */

require('dotenv').config();

const { logger } = require('../utils/logger');

// Validação de variáveis de ambiente obrigatórias
const requiredEnvVars = [
  'EVOLUTION_API_URL',
  'EVOLUTION_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WEBHOOK_URL'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Configuração do Servidor
const server = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:8080', 'https://www.treexonline.online'],
  bodyLimit: process.env.BODY_LIMIT || '10mb'
};

// Configuração Evolution API
const evolution = {
  baseURL: process.env.EVOLUTION_API_URL,
  apiKey: process.env.EVOLUTION_API_KEY,
  webhookURL: process.env.WEBHOOK_URL,
  timeout: parseInt(process.env.EVOLUTION_TIMEOUT) || 30000,
  retryAttempts: parseInt(process.env.EVOLUTION_RETRY_ATTEMPTS) || 3
};

// Configuração Supabase
const supabase = {
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  options: {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
};

// Configuração WhatsApp
const whatsapp = {
  autoReplyDelay: parseInt(process.env.AUTO_REPLY_DELAY) || 2000,
  defaultCooldownHours: parseInt(process.env.DEFAULT_COOLDOWN_HOURS) || 1,
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH) || 4096,
  qrExpirationTime: parseInt(process.env.QR_EXPIRATION_TIME) || 60000 // 1 minuto
};

// Configuração de Logs
const logging = {
  level: process.env.LOG_LEVEL || 'info',
  enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
  filePath: process.env.LOG_FILE_PATH || './logs/app.log'
};

// Configuração de Rate Limiting
const rateLimit = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutos
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 100
};

// Configuração de Cache
const cache = {
  ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutos
  maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 100
};

// Validação de configurações
logger.info('Configuration loaded:', {
  server: {
    port: server.port,
    host: server.host,
    nodeEnv: server.nodeEnv
  },
  evolution: {
    baseURL: evolution.baseURL,
    timeout: evolution.timeout,
    retryAttempts: evolution.retryAttempts
  },
  supabase: {
    url: supabase.url,
    hasServiceRoleKey: !!supabase.serviceRoleKey
  },
  whatsapp: {
    autoReplyDelay: whatsapp.autoReplyDelay,
    defaultCooldownHours: whatsapp.defaultCooldownHours,
    maxMessageLength: whatsapp.maxMessageLength
  }
});

module.exports = {
  server,
  evolution,
  supabase,
  whatsapp,
  logging,
  rateLimit,
  cache
};
