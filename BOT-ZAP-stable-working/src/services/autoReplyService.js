/**
 * Auto Reply Service - Sistema de resposta automática
 * Gerencia respostas automáticas com cooldown anti-spam
 */

const EvolutionService = require('./evolutionService');
const SupabaseService = require('./supabaseService');
const { whatsapp: config } = require('../config');
const { logger } = require('../utils/logger');

class AutoReplyService {
  constructor() {
    this.evolutionService = new EvolutionService();
    this.supabaseService = new SupabaseService();
  }

  /**
   * Processar mensagem recebida e enviar resposta automática
   * 
   * @param {Object} messageData - Dados da mensagem recebida
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processIncomingMessage(messageData) {
    try {
      const {
        instanceName,
        remoteJid,
        messageContent,
        messageId,
        timestamp
      } = messageData;

      // Extrair store_id do instance_name (formato: store_{storeId})
      const storeId = this.extractStoreIdFromInstance(instanceName);
      
      if (!storeId) {
        logger.warn(`Invalid instance format: ${instanceName}`);
        return { success: false, reason: 'Invalid instance format' };
      }

      logger.info(`Processing message for store ${storeId} from ${remoteJid}`);

      // 1. Verificar se auto-resposta está ativo para este store
      const autoReplyConfig = await this.supabaseService.getAutoReplyConfig(storeId, true);

      if (!autoReplyConfig || !autoReplyConfig.is_active) {
        logger.debug(`Auto-reply not active for store ${storeId}`);
        return { success: false, reason: 'Auto-reply not active' };
      }

      // 2. Verificar cooldown anti-spam
      const isInCooldown = await this.supabaseService.isInCooldown(
        storeId, 
        remoteJid, 
        config.defaultCooldownHours
      );

      if (isInCooldown) {
        logger.debug(`Message from ${remoteJid} is in cooldown for store ${storeId}`);
        return { success: false, reason: 'In cooldown' };
      }

      // 3. Aguardar delay para parecer natural
      await this.delay(config.autoReplyDelay);

      // 4. Enviar resposta automática
      const replyText = this.processMessageTemplate(autoReplyConfig.message_text, {
        customerPhone: this.formatPhoneNumberForDisplay(remoteJid),
        timestamp: new Date().toLocaleString('pt-BR')
      });

      const sendResult = await this.evolutionService.sendText(
        instanceName,
        remoteJid,
        replyText
      );

      if (sendResult.success) {
        // 5. Salvar log da mensagem enviada
        await this.supabaseService.logMessage({
          storeId,
          instanceName,
          messageId: sendResult.messageId,
          remoteJid,
          messageType: 'text',
          messageContent: replyText,
          direction: 'out',
          timestamp: new Date().toISOString()
        });

        logger.info(`Auto-reply sent successfully to ${remoteJid} for store ${storeId}`);

        return {
          success: true,
          messageId: sendResult.messageId,
          replyText,
          cooldownHours: config.defaultCooldownHours
        };
      } else {
        throw new Error('Failed to send auto-reply');
      }

    } catch (error) {
      logger.error('Error processing incoming message:', error);
      return {
        success: false,
        reason: error.message
      };
    }
  }

  /**
   * Extrair store_id do instance_name
   * 
   * @param {string} instanceName - Nome da instância (formato: store_{storeId})
   * @returns {string|null} Store ID
   */
  extractStoreIdFromInstance(instanceName) {
    const match = instanceName.match(/^store_(.+)$/);
    return match ? match[1] : null;
  }

  /**
   * Processar template de mensagem com variáveis
   * 
   * @param {string} template - Template da mensagem
   * @param {Object} variables - Variáveis para substituir
   * @returns {string} Mensagem processada
   */
  processMessageTemplate(template, variables) {
    let processed = template;

    // Substituir variáveis comuns
    const replacements = {
      '{{customer_phone}}': variables.customerPhone || '',
      '{{timestamp}}': variables.timestamp || '',
      '{{date}}': new Date().toLocaleDateString('pt-BR'),
      '{{time}}': new Date().toLocaleTimeString('pt-BR'),
      '{{store_name}}': variables.storeName || 'nosso restaurante'
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      processed = processed.replace(new RegExp(placeholder, 'g'), value);
    }

    return processed;
  }

  /**
   * Format phone number for display
   * 
   * @param {string} phone - Phone number from JID
   * @returns {string} Formatted phone
   */
  formatPhoneNumberForDisplay(phone) {
    // Remover @s.whatsapp.net e formatar
    const cleanPhone = phone.replace('@s.whatsapp.net', '');
    
    if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
      // Formato brasileiro: (xx) xxxxx-xxxx
      const ddd = cleanPhone.substring(2, 4);
      const part1 = cleanPhone.substring(4, 9);
      const part2 = cleanPhone.substring(9, 13);
      return `(${ddd}) ${part1}-${part2}`;
    }

    return cleanPhone;
  }

  /**
   * Verificar se deve responder à mensagem
   * 
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<boolean>} Se deve responder
   */
  async shouldReply(messageData) {
    try {
      const { instanceName, remoteJid, messageContent } = messageData;
      
      // Ignorar mensagens do próprio número
      if (this.isOwnMessage(remoteJid)) {
        return false;
      }

      // Ignorar mensagens de grupo
      if (this.isGroupMessage(remoteJid)) {
        return false;
      }

      // Ignorar mensagens vazias ou apenas mídia
      if (!messageContent || messageContent.trim().length === 0) {
        return false;
      }

      // Verificar se auto-resposta está ativo
      const storeId = this.extractStoreIdFromInstance(instanceName);
      if (!storeId) return false;

      const autoReplyConfig = await this.supabaseService.getAutoReplyConfig(storeId, true);
      if (!autoReplyConfig || !autoReplyConfig.is_active) {
        return false;
      }

      // Verificar cooldown
      const isInCooldown = await this.supabaseService.isInCooldown(
        storeId,
        remoteJid,
        config.defaultCooldownHours
      );

      return !isInCooldown;

    } catch (error) {
      logger.error('Error checking if should reply:', error);
      return false;
    }
  }

  /**
   * Verificar se é mensagem própria
   * 
   * @param {string} remoteJid - Remote JID
   * @returns {boolean} Se é mensagem própria
   */
  isOwnMessage(remoteJid) {
    // Implementar lógica para detectar mensagens do próprio número
    // Por enquanto, retorna false
    return false;
  }

  /**
   * Verificar se é mensagem de grupo
   * 
   * @param {string} remoteJid - Remote JID
   * @returns {boolean} Se é mensagem de grupo
   */
  isGroupMessage(remoteJid) {
    // Grupos terminam com @g.us
    return remoteJid.endsWith('@g.us');
  }

  /**
   * Delay utilitário
   * 
   * @param {number} ms - Milissegundos
   * @returns {Promise} Promise com delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enviar mensagem manual (forçar resposta)
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} phoneNumber - Número de telefone
   * @param {string} message - Mensagem
   * @returns {Promise<Object>} Resultado do envio
   */
  async sendManualMessage(storeId, phoneNumber, message) {
    try {
      const instanceName = `store_${storeId}`;

      // Verificar se instância existe e está conectada
      const session = await this.supabaseService.getSession(storeId);
      
      if (!session || session.connection_status !== 'connected') {
        throw new Error('WhatsApp session not connected');
      }

      const result = await this.evolutionService.sendText(
        instanceName,
        phoneNumber,
        message
      );

      if (result.success) {
        // Salvar log
        await this.supabaseService.logMessage({
          storeId,
          instanceName,
          messageId: result.messageId,
          remoteJid: phoneNumber,
          messageType: 'text',
          messageContent: message,
          direction: 'out',
          timestamp: new Date().toISOString()
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending manual message:', error);
      throw error;
    }
  }

  /**
   * Obter estatísticas de respostas automáticas
   * 
   * @param {string} storeId - ID do restaurante
   * @param {number} days - Dias para analisar
   * @returns {Promise<Object>} Estatísticas
   */
  async getAutoReplyStats(storeId, days = 7) {
    try {
      const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

      const { data, error } = await this.supabaseService.client
        .from('whatsapp_message_logs')
        .select('*')
        .eq('store_id', storeId)
        .eq('direction', 'out')
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: false });

      if (error) throw error;

      const stats = {
        totalReplies: data?.length || 0,
        uniqueCustomers: new Set(data?.map(m => m.remote_jid)).size,
        averageResponseTime: config.autoReplyDelay,
        periodDays: days,
        dailyAverage: Math.round((data?.length || 0) / days)
      };

      return stats;

    } catch (error) {
      logger.error('Error getting auto-reply stats:', error);
      throw error;
    }
  }
}

module.exports = AutoReplyService;
