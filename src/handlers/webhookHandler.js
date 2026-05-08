/**
 * Webhook Handler - Processador de Webhooks Evolution API
 * Interpreta eventos da Evolution e dispara ações apropriadas
 */

const AutoReplyService = require('../services/autoReplyService');
const SupabaseService = require('../services/supabaseService');
const { webhookLogger } = require('../utils/logger');

class WebhookHandler {
  constructor() {
    this.autoReplyService = new AutoReplyService();
    this.supabaseService = new SupabaseService();
    
    // Cache para deduplicação de QR codes
    this.qrCodeCache = new Map();
    this.QR_CACHE_TTL = 30000; // 30 segundos
    
    // Lock para evitar processamento simultâneo
    this.processingQRCodes = new Set();
  }

  /**
   * Validar e formatar QR code
   * 
   * @param {string} qrCode - QR code bruto
   * @returns {string|null} QR code formatado ou null se inválido
   */
  validateAndFormatQRCode(qrCode) {
    if (!qrCode || typeof qrCode !== 'string') {
      return null;
    }

    let formattedQR = qrCode.trim();

    // Remover prefixos inválidos
    if (formattedQR.startsWith('base64://')) {
      formattedQR = formattedQR.replace('base64://', '');
    }

    // Garantir formato correto data:image/png;base64,
    if (!formattedQR.startsWith('data:image')) {
      if (formattedQR.startsWith('data:')) {
        // Já tem data: mas não tem image/png
        formattedQR = formattedQR.replace('data:', 'data:image/png;base64,');
      } else {
        // Não tem data: prefix
        formattedQR = `data:image/png;base64,${formattedQR}`;
      }
    }

    // Validação básica do formato base64
    try {
      const base64Part = formattedQR.split(',')[1];
      if (!base64Part || base64Part.length < 100) {
        return null; // QR code muito curto ou inválido
      }
      
      // Testar se é base64 válido
      Buffer.from(base64Part, 'base64');
      
      return formattedQR;
    } catch (error) {
      webhookLogger.warn('Invalid QR code format:', error.message);
      return null;
    }
  }

  /**
   * Verificar se QR code é duplicado (cache)
   * 
   * @param {string} storeId - ID da loja
   * @param {string} qrCode - QR code formatado
   * @returns {boolean} True se é duplicado
   */
  isQRCodeDuplicate(storeId, qrCode) {
    const cacheKey = `${storeId}_qr`;
    const cached = this.qrCodeCache.get(cacheKey);
    
    if (!cached) {
      return false;
    }
    
    // Verificar se o QR code é o mesmo
    if (cached.qrCode === qrCode) {
      const now = Date.now();
      if (now - cached.timestamp < this.QR_CACHE_TTL) {
        return true; // Duplicado dentro do TTL
      }
    }
    
    return false;
  }

  /**
   * Salvar QR code no cache
   * 
   * @param {string} storeId - ID da loja
   * @param {string} qrCode - QR code formatado
   */
  cacheQRCode(storeId, qrCode) {
    const cacheKey = `${storeId}_qr`;
    this.qrCodeCache.set(cacheKey, {
      qrCode,
      timestamp: Date.now()
    });
    
    // Limpar cache antigo periodicamente
    this.cleanQRCache();
  }

  /**
   * Limpar cache antigo
   */
  cleanQRCache() {
    const now = Date.now();
    for (const [key, value] of this.qrCodeCache.entries()) {
      if (now - value.timestamp > this.QR_CACHE_TTL) {
        this.qrCodeCache.delete(key);
      }
    }
  }

  /**
   * Processar webhook recebido da Evolution API
   * 
   * @param {Object} webhookData - Dados do webhook
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processWebhook(webhookData) {
    try {
      const { event, instance, data } = webhookData;

      webhookLogger.info(`Processing webhook event: ${event} for instance: ${instance}`);

      switch (event) {
        case 'messages.upsert':
          return await this.handleMessageUpsert(instance, data);
        
        case 'connection.update':
          return await this.handleConnectionUpdate(instance, data);
        
        case 'qrcode.updated':
          return await this.handleQRCodeUpdated(instance, data);
        
        // Compatibilidade com formato antigo
        case 'MESSAGES_UPSERT':
          return await this.handleMessageUpsert(instance, data);
        
        case 'CONNECTION_UPDATE':
          return await this.handleConnectionUpdate(instance, data);
        
        case 'QRCODE_UPDATED':
          return await this.handleQRCodeUpdated(instance, data);
        
        default:
          webhookLogger.warn(`Unhandled webhook event: ${event}`);
          return { success: false, reason: 'Unhandled event' };
      }

    } catch (error) {
      webhookLogger.error('Error processing webhook:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Processar mensagem recebida (MESSAGES_UPSERT)
   * 
   * @param {string} instanceName - Nome da instância
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} Resultado do processamento
   */
  async handleMessageUpsert(instanceName, messageData) {
    try {
      webhookLogger.info(`Processing message upsert for ${instanceName}`);

      // Extrair informações da mensagem
      const messageInfo = this.extractMessageInfo(messageData);
      
      if (!messageInfo) {
        webhookLogger.warn('Invalid message format received');
        return { success: false, reason: 'Invalid message format' };
      }

      const {
        messageId,
        remoteJid,
        messageContent,
        messageType,
        timestamp,
        isFromMe
      } = messageInfo;

      // Ignorar mensagens próprias
      if (isFromMe) {
        webhookLogger.debug(`Ignoring own message: ${messageId}`);
        return { success: false, reason: 'Own message ignored' };
      }

      // Ignorar mensagens de grupo
      if (this.isGroupMessage(remoteJid)) {
        webhookLogger.debug(`Ignoring group message: ${messageId}`);
        return { success: false, reason: 'Group message ignored' };
      }

      // Extrair store_id do instance_name
      const storeId = this.extractStoreIdFromInstance(instanceName);
      
      if (!storeId) {
        webhookLogger.error(`Invalid instance format: ${instanceName}`);
        return { success: false, reason: 'Invalid instance format' };
      }

      // Salvar log da mensagem recebida
      await this.supabaseService.logMessage({
        storeId,
        instanceName,
        messageId,
        remoteJid,
        messageType,
        messageContent,
        direction: 'in',
        timestamp: timestamp || new Date().toISOString()
      });

      // Processar resposta automática
      const autoReplyResult = await this.autoReplyService.processIncomingMessage({
        instanceName,
        remoteJid,
        messageContent,
        messageId,
        timestamp
      });

      webhookLogger.info(`Message processed for store ${storeId}`, {
        messageId,
        remoteJid,
        autoReplySent: autoReplyResult.success
      });

      return {
        success: true,
        messageId,
        storeId,
        remoteJid,
        autoReply: autoReplyResult
      };

    } catch (error) {
      webhookLogger.error('Error handling message upsert:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Processar atualização de conexão (CONNECTION_UPDATE)
   * 
   * @param {string} instanceName - Nome da instância
   * @param {Object} connectionData - Dados da conexão
   * @returns {Promise<Object>} Resultado do processamento
   */
  async handleConnectionUpdate(instanceName, connectionData) {
    try {
      webhookLogger.info(`Processing connection update for ${instanceName}`);

      const { state, reason } = connectionData;
      
      // Mapear status Evolution para status interno
      const mappedStatus = this.mapConnectionStatus(state);
      
      // Extrair store_id
      const storeId = this.extractStoreIdFromInstance(instanceName);
      
      if (!storeId) {
        webhookLogger.error(`Invalid instance format: ${instanceName}`);
        return { success: false, reason: 'Invalid instance format' };
      }

      // Preparar dados adicionais para salvar
      const additionalData = {};
      
      if (state === 'open') {
        // Conexão aberta - limpar QR e salvar informações do usuário
        additionalData.qr_code = null;
        
        if (connectionData.user) {
          additionalData.phone = connectionData.user.id?.replace('@s.whatsapp.net', '') || null;
          additionalData.profile_name = connectionData.user.name || null;
        }
      }

      // Atualizar status no Supabase
      await this.supabaseService.updateConnectionStatus(
        storeId,
        mappedStatus,
        additionalData
      );

      webhookLogger.info(`Connection status updated for store ${storeId}`, {
        instanceName,
        status: mappedStatus,
        state,
        reason
      });

      return {
        success: true,
        storeId,
        instanceName,
        status: mappedStatus,
        state,
        reason
      };

    } catch (error) {
      webhookLogger.error('Error handling connection update:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Processar atualização de QR Code (QRCODE_UPDATED)
   * 
   * @param {string} instanceName - Nome da instância
   * @param {Object} qrData - Dados do QR Code
   * @returns {Promise<Object>} Resultado do processamento
   */
  async handleQRCodeUpdated(instanceName, qrData) {
    const processKey = `${instanceName}_qr`;
    
    // Verificar lock anti-duplicação
    if (this.processingQRCodes.has(processKey)) {
      webhookLogger.warn(`QR update already processing for ${instanceName}`);
      return {
        success: true,
        instanceName,
        action: 'ignored_locked',
        message: 'QR update already in progress'
      };
    }

    // Adicionar lock
    this.processingQRCodes.add(processKey);
    
    try {
      webhookLogger.info(`Processing QR code update for ${instanceName}`);

      // Extrair store_id
      const storeId = this.extractStoreIdFromInstance(instanceName);
      
      if (!storeId) {
        webhookLogger.error(`Invalid instance format: ${instanceName}`);
        return { success: false, reason: 'Invalid instance format' };
      }

      // Verificar status atual da sessão
      const currentSession = await this.supabaseService.getSession(storeId);
      
      // Se já estiver conectado, ignorar QR
      if (currentSession?.connection_status === 'connected') {
        webhookLogger.info(`QR update ignored for store ${storeId} - already connected`);
        return {
          success: true,
          storeId,
          instanceName,
          action: 'ignored_connected',
          message: 'Session already connected'
        };
      }

      // Extrair QR code bruto
      const rawQRCode = qrData.qrcode?.base64 || qrData.qrcode;
      
      // Validar e formatar QR code
      const formattedQRCode = this.validateAndFormatQRCode(rawQRCode);
      
      if (!formattedQRCode) {
        webhookLogger.warn(`Invalid QR code received for store ${storeId}`);
        return { success: false, reason: 'Invalid QR code format' };
      }
      if (currentSession?.qr_code === formattedQRCode) {
        webhookLogger.info(`Duplicate QR ignored for store ${storeId} (same as database)`);
        return {
          success: true,
          storeId,
          instanceName,
          action: 'ignored_duplicate',
          message: 'QR code already exists'
        };
      }

      // Verificar duplicação no cache
      if (this.isQRCodeDuplicate(storeId, formattedQRCode)) {
        webhookLogger.info(`Duplicate QR code ignored for store ${storeId} (cache)`);
        return {
          success: true,
          storeId,
          instanceName,
          action: 'ignored_duplicate',
          message: 'Duplicate QR code ignored'
        };
      }

      // Salvar no cache
      this.cacheQRCode(storeId, formattedQRCode);

      // Atualizar QR Code no Supabase
      await this.supabaseService.updateQRCode(storeId, formattedQRCode);

      webhookLogger.info(`QR Code updated for store ${storeId}`, {
        qrLength: formattedQRCode.length,
        format: formattedQRCode.startsWith('data:image/png;base64,') ? 'valid' : 'invalid',
        action: 'updated'
      });

      return {
        success: true,
        storeId,
        instanceName,
        qrCode: formattedQRCode,
        action: 'updated'
      };

    } catch (error) {
      webhookLogger.error('Error handling QR code update:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        instanceName,
        qrData: JSON.stringify(qrData).substring(0, 500) // Primeiros 500 chars
      });
      return { success: false, error: error.message };
    } finally {
      // Remover lock
      this.processingQRCodes.delete(processKey);
    }
  }

  /**
   * Extrair informações da mensagem do payload Evolution
   * 
   * @param {Object} messageData - Payload da mensagem
   * @returns {Object|null} Informações extraídas
   */
  extractMessageInfo(messageData) {
    try {
      // Evolution API pode enviar diferentes formatos
      const message = messageData.message || messageData;
      
      if (!message) {
        return null;
      }

      // Extrair ID da mensagem
      const messageId = message.key?.id || message.id;
      
      // Extrair remote JID
      const remoteJid = message.key?.remoteJid || message.remoteJid;
      
      // Extrair conteúdo da mensagem
      let messageContent = '';
      let messageType = 'text';

      if (message.message?.conversation) {
        messageContent = message.message.conversation;
        messageType = 'text';
      } else if (message.message?.extendedTextMessage?.text) {
        messageContent = message.message.extendedTextMessage.text;
        messageType = 'text';
      } else if (message.message?.imageMessage?.caption) {
        messageContent = message.message.imageMessage.caption;
        messageType = 'image';
      } else if (message.message?.videoMessage?.caption) {
        messageContent = message.message.videoMessage.caption;
        messageType = 'video';
      } else if (message.message?.audioMessage) {
        messageContent = '[Áudio]';
        messageType = 'audio';
      } else if (message.message?.documentMessage) {
        messageContent = message.message.documentMessage.fileName || '[Documento]';
        messageType = 'document';
      } else if (message.text) {
        messageContent = message.text;
        messageType = 'text';
      }

      // Extrair timestamp
      const timestamp = message.messageTimestamp || message.timestamp || new Date().toISOString();

      // Verificar se é mensagem própria
      const isFromMe = message.key?.fromMe || message.fromMe || false;

      return {
        messageId,
        remoteJid,
        messageContent,
        messageType,
        timestamp,
        isFromMe
      };

    } catch (error) {
      webhookLogger.error('Error extracting message info:', error);
      return null;
    }
  }

  /**
   * Mapear status de conexão Evolution para status interno
   * 
   * @param {string} evolutionState - Status da Evolution
   * @returns {string} Status mapeado
   */
  mapConnectionStatus(evolutionState) {
    const statusMap = {
      'open': 'connected',
      'connecting': 'connecting',
      'close': 'disconnected',
      'disconnecting': 'disconnecting',
      'refused': 'error',
      'timeout': 'error'
    };

    return statusMap[evolutionState] || 'unknown';
  }

  /**
   * Extrair store_id do instance_name
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {string|null} Store ID
   */
  extractStoreIdFromInstance(instanceName) {
    const match = instanceName.match(/^store_(.+)$/);
    return match ? match[1] : null;
  }

  /**
   * Verificar se é mensagem de grupo
   * 
   * @param {string} remoteJid - Remote JID
   * @returns {boolean} Se é mensagem de grupo
   */
  isGroupMessage(remoteJid) {
    return remoteJid.endsWith('@g.us');
  }

  /**
   * Validar webhook (segurança)
   * 
   * @param {Object} req - Request Express
   * @returns {boolean} Se webhook é válido
   */
  validateWebhook(req) {
    try {
      // Verificar se tem dados necessários
      if (!req.body || !req.body.event || !req.body.instance) {
        webhookLogger.warn('Invalid webhook format: missing required fields');
        return false;
      }

      // Verificar origem (opcional - implementar se necessário)
      // const webhookSecret = process.env.WEBHOOK_SECRET;
      // if (webhookSecret) {
      //   const signature = req.headers['x-evolution-signature'];
      //   // Implementar validação de assinatura
      // }

      return true;
    } catch (error) {
      webhookLogger.error('Error validating webhook:', error);
      return false;
    }
  }

  /**
   * Processar múltiplos eventos (batch)
   * 
   * @param {Array} events - Array de eventos
   * @returns {Promise<Array>} Resultados do processamento
   */
  async processBatchEvents(events) {
    try {
      const results = [];

      for (const event of events) {
        const result = await this.processWebhook(event);
        results.push(result);
      }

      webhookLogger.info(`Processed batch of ${events.length} events`);
      return results;

    } catch (error) {
      webhookLogger.error('Error processing batch events:', error);
      throw error;
    }
  }
}

module.exports = WebhookHandler;
