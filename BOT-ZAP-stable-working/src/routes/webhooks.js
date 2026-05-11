/**
 * Webhooks Routes - Rotas de Webhooks
 * Endpoints para receber webhooks da Evolution API
 */

const express = require('express');
const WebhookController = require('../controllers/webhookController');
const { webhookLogger } = require('../utils/logger');

const router = express.Router();
const webhookController = new WebhookController();

// Middleware para logging de requisições de webhook
router.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'unknown';
  
  webhookLogger.info(`Webhook ${req.method} ${req.path} - IP: ${clientIp} - User-Agent: ${userAgent}`);
  next();
});

/**
 * POST /api/webhooks/evolution
 * Endpoint principal para receber webhooks da Evolution API
 */
router.post('/evolution', async (req, res) => {
  console.log('\n🔥 ROUTE /evolution CALLED');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================\n');
  
  try {
    await webhookController.handleWebhook(req, res);
  } catch (error) {
    console.error('💥 ROUTE ERROR:', error);
    console.error('💥 STACK:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Route error'
    });
  }
});

/**
 * GET /api/webhooks/health
 * Health check do endpoint de webhook
 */
router.get('/health', async (req, res) => {
  await webhookController.webhookHealthCheck(req, res);
});

/**
 * POST /api/webhooks/test
 * Testar webhook (apenas desenvolvimento)
 */
router.post('/test', async (req, res) => {
  await webhookController.testWebhook(req, res);
});

/**
 * GET /api/webhooks/check/:instanceName
 * Verificar configuração do webhook para uma instância
 */
router.get('/check/:instanceName', async (req, res) => {
  await webhookController.checkWebhookConfig(req, res);
});

module.exports = router;
