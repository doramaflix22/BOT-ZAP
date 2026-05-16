/**
 * Webhook Handler Singleton - Instância única do WebhookHandler
 * Evita reinicialização do cache com hot reload/redeploy
 */

const WebhookHandler = require('./webhookHandler');

// 🛡️ SINGLETON - Instância única compartilhada
let webhookHandlerInstance = null;

/**
 * Obter instância única do WebhookHandler
 * @returns {WebhookHandler} Instância singleton
 */
function getWebhookHandler() {
  if (!webhookHandlerInstance) {
    webhookHandlerInstance = new WebhookHandler();
    console.log('🛡️ WEBHOOK HANDLER SINGLETON CREATED');
  }
  return webhookHandlerInstance;
}

/**
 * Resetar instância (apenas para testes)
 * Não usar em produção
 */
function resetWebhookHandler() {
  webhookHandlerInstance = null;
}

module.exports = {
  getWebhookHandler,
  resetWebhookHandler
};
