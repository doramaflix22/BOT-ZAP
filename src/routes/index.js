/**
 * Router Principal - Configuração de todas as rotas
 * Centraliza middlewares e configurações de roteamento
 */

const express = require('express');
const cors = require('cors');
const { server: serverConfig } = require('../config');
const { logger } = require('../utils/logger');

// Importar rotas
const sessionsRoutes = require('./sessions');
const webhooksRoutes = require('./webhooks');

const router = express.Router();

// Middleware CORS configurado para Railway e frontend
router.use(cors({
  origin: serverConfig.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-client-info'],
  credentials: true
}));

// Body parser com limite configurado
router.use(express.json({ limit: serverConfig.bodyLimit }));
router.use(express.urlencoded({ extended: true, limit: serverConfig.bodyLimit }));

// Middleware de logging de requisições
router.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'unknown';
  
  logger.info(`${req.method} ${req.path} - IP: ${clientIp} - User-Agent: ${userAgent}`);
  next();
});

// Middleware para medir tempo de resposta
router.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Registrar rotas da API
router.use('/sessions', sessionsRoutes);
router.use('/webhooks', webhooksRoutes);

// Endpoint raiz da API
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'WhatsApp Engine - Evolution API v2',
      version: '2.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
      environment: serverConfig.nodeEnv,
      endpoints: {
        sessions: {
          connect: 'POST /api/sessions/connect/:storeId',
          status: 'GET /api/sessions/status/:storeId',
          qr: 'GET /api/sessions/qr/:storeId',
          disconnect: 'POST /api/sessions/disconnect/:storeId',
          delete: 'DELETE /api/sessions/:storeId',
          reconnect: 'POST /api/sessions/reconnect/:storeId',
          list: 'GET /api/sessions',
          testConnection: 'GET /api/sessions/test-connection'
        },
        webhooks: {
          evolution: 'POST /api/webhooks/evolution',
          health: 'GET /api/webhooks/health',
          test: 'POST /api/webhooks/test',
          check: 'GET /api/webhooks/check/:instanceName'
        }
      }
    }
  });
});

// Endpoint de health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      environment: serverConfig.nodeEnv,
      nodeVersion: process.version,
      service: 'whatsapp-engine'
    }
  });
});

// Middleware para rotas não encontradas
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: {
      sessions: '/api/sessions/*',
      webhooks: '/api/webhooks/*',
      health: '/api/health'
    }
  });
});

module.exports = router;
