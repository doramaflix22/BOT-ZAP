/**
 * Logger Configurado - Pino
 * Centraliza configuração de logging para toda aplicação
 */

const pino = require('pino');

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// Configuração base do logger
const baseConfig = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label) => ({ level: label }),
    log: (object) => {
      // Adicionar timestamp customizado
      return {
        ...object,
        timestamp: new Date().toISOString(),
        service: 'whatsapp-engine'
      };
    }
  }
};

// Configuração para desenvolvimento (com pretty print)
if (isDevelopment) {
  baseConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname,service',
      messageFormat: '{msg}',
      customPrettifiers: {
        time: (timestamp) => timestamp,
        level: (label) => label.toUpperCase()
      }
    }
  };
}

// Configuração para produção (JSON structured logs)
if (isProduction) {
  baseConfig.formatters.log = (object) => ({
    ...object,
    timestamp: new Date().toISOString(),
    service: 'whatsapp-engine',
    environment: 'production'
  });
}

// Criar logger principal
const logger = pino(baseConfig);

// Logger específico para Evolution API
const evolutionLogger = logger.child({ component: 'evolution-api' });

// Logger específico para Supabase
const supabaseLogger = logger.child({ component: 'supabase' });

// Logger específico para Webhooks
const webhookLogger = logger.child({ component: 'webhook' });

// Logger específico para Controllers
const controllerLogger = logger.child({ component: 'controller' });

// Logger para erros críticos
const errorLogger = logger.child({ level: 'error', component: 'critical-errors' });

module.exports = {
  logger,
  evolutionLogger,
  supabaseLogger,
  webhookLogger,
  controllerLogger,
  errorLogger
};
