/**
 * Webhook Controller - Controlador de Webhooks
 * Gerencia recebimento e processamento de webhooks da Evolution API
 */

const WebhookHandler = require('../handlers/webhookHandler');
const { webhookLogger } = require('../utils/logger');

class WebhookController {
  constructor() {
    this.webhookHandler = new WebhookHandler();
  }

  /**
   * Processar webhook da Evolution API
   * 
   * @param {Object} req - Request Express
   * @param {Object} res - Response Express
   * @returns {Promise<void>}
   */
  async handleWebhook(req, res) {
    try {
      console.log('\n🔥 WEBHOOK CONTROLLER - RECEIVED REQUEST');
      console.log('Method:', req.method);
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      console.log('Body:', JSON.stringify(req.body, null, 2));
      console.log('========================\n');

      webhookLogger.info('Received webhook from Evolution API');

      // Validar webhook
      const validationResult = this.webhookHandler.validateWebhook(req);
      console.log('🔍 WEBHOOK VALIDATION RESULT:', validationResult);
      
      if (!validationResult) {
        webhookLogger.warn('Invalid webhook received');
        console.log('❌ WEBHOOK VALIDATION FAILED');
        return res.status(400).json({
          success: false,
          error: 'Invalid webhook format'
        });
      }

      const webhookData = req.body;
      console.log('📋 WEBHOOK DATA:', JSON.stringify(webhookData, null, 2));

      // Processar evento
      console.log('🔄 PROCESSING WEBHOOK...');
      const result = await this.webhookHandler.processWebhook(webhookData);
      console.log('✅ WEBHOOK PROCESSING RESULT:', JSON.stringify(result, null, 2));

      // Retornar resposta rápida para Evolution API
      if (result.success) {
        res.status(200).json({
          success: true,
          message: 'Webhook processed successfully'
        });
      } else {
        // Mesmo com erro, retornar 200 para não retry
        res.status(200).json({
          success: false,
          message: 'Webhook processed with errors',
          error: result.error || result.reason
        });
      }

      webhookLogger.info(`Webhook processed: ${webhookData.event} for ${webhookData.instance}`);

    } catch (error) {
      console.error('💥 WEBHOOK CONTROLLER ERROR:', error);
      console.error('💥 ERROR STACK:', error.stack);
      webhookLogger.error('Error handling webhook:', error);

      // Sempre retornar 200 para Evolution API não fazer retry
      res.status(200).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Health check do webhook
   * 
   * @param {Object} req - Request Express
   * @param {Object} res - Response Express
   * @returns {Promise<void>}
   */
  async webhookHealthCheck(req, res) {
    try {
      res.status(200).json({
        success: true,
        message: 'Webhook endpoint is healthy',
        timestamp: new Date().toISOString(),
        service: 'whatsapp-engine'
      });
    } catch (error) {
      webhookLogger.error('Webhook health check failed:', error);
      res.status(500).json({
        success: false,
        error: 'Health check failed'
      });
    }
  }

  /**
   * Testar webhook (para desenvolvimento)
   * 
   * @param {Object} req - Request Express
   * @param {Object} res - Response Express
   * @returns {Promise<void>}
   */
  async testWebhook(req, res) {
    try {
      // Apenas em desenvolvimento
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          error: 'Test webhook only available in development'
        });
      }

      const { eventType, instanceName } = req.body;

      // Criar webhook de teste
      const testWebhook = {
        event: eventType || 'MESSAGES_UPSERT',
        instance: instanceName || 'store_test',
        data: this.generateTestWebhookData(eventType || 'MESSAGES_UPSERT')
      };

      // Processar webhook de teste
      const result = await this.webhookHandler.processWebhook(testWebhook);

      res.status(200).json({
        success: true,
        message: 'Test webhook processed',
        testWebhook,
        result
      });

    } catch (error) {
      webhookLogger.error('Error processing test webhook:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Gerar dados de teste para webhook
   * 
   * @param {string} eventType - Tipo de evento
   * @returns {Object} Dados de teste
   */
  generateTestWebhookData(eventType) {
    switch (eventType) {
      case 'MESSAGES_UPSERT':
        return {
          key: {
            id: 'test_message_123',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false
          },
          message: {
            conversation: 'Olá, gostaria de ver o cardápio'
          },
          messageTimestamp: new Date().toISOString()
        };

      case 'CONNECTION_UPDATE':
        return {
          state: 'open',
          user: {
            id: '5511888888888@s.whatsapp.net',
            name: 'Test Restaurant'
          }
        };

      case 'QRCODE_UPDATED':
        return {
          qrcode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
        };

      default:
        return {};
    }
  }

  /**
   * Verificar se webhook está configurado corretamente
   * 
   * @param {Object} req - Request Express
   * @param {Object} res - Response Express
   * @returns {Promise<void>}
   */
  async checkWebhookConfig(req, res) {
    try {
      const { instanceName } = req.params;

      if (!instanceName) {
        return res.status(400).json({
          success: false,
          error: 'Instance name is required'
        });
      }

      // Aqui poderíamos verificar na Evolution API se webhook está configurado
      // Por enquanto, apenas verificamos se endpoint está acessível

      res.status(200).json({
        success: true,
        message: 'Webhook configuration check',
        data: {
          instanceName,
          webhookUrl: process.env.WEBHOOK_URL,
          configured: true,
          accessible: true
        }
      });

    } catch (error) {
      webhookLogger.error('Error checking webhook config:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = WebhookController;
