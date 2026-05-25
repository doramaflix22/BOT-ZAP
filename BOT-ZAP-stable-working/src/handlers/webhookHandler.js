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
    
    // Cache para evitar QR Code duplicado
    this.lastQrByInstance = new Map();
    
    // Set para deduplicação de webhooks
    this.processedWebhooks = new Set();
    
    // 🛡️ REMOVIDO: Não limpar cache periodicamente
    // Isso causava reprocessamento de webhooks antigos e QR duplicados
  }

  /**
   * Processar webhook recebido da Evolution API
   * 
   * @param {Object} webhookData - Dados do webhook
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processWebhook(webhookData) {
    try {
      console.log('\n🔥 WEBHOOK PROCESSING START');
      // 🛡️ LOG LEVE - sem base64 pesado
      console.log({
        event: webhookData.event,
        instance: webhookData.instance,
        hasQr: !!webhookData.data?.qrcode,
        pairingCode: webhookData.data?.qrcode?.pairingCode
      });
      console.log('========================\n');

      const { event, instance, data } = webhookData;

      // 🛡️ IGNORAR historySyncNotification (payloads gigantes inúteis)
      if (data?.historySyncNotification) {
        webhookLogger.debug(`Ignoring historySyncNotification for ${instance}`);
        return { success: true, ignored: true, reason: 'historySyncNotification ignored' };
      }

      console.log('🎯 EXTRACTED VALUES:');
      console.log('Event:', event);
      console.log('Instance:', instance);
      console.log('Data exists:', !!data);
      console.log('Data keys:', data ? Object.keys(data) : 'null');

      // Deduplicação de webhook
      const webhookKey = this.generateWebhookKey(event, instance, data);
      if (this.processedWebhooks.has(webhookKey)) {
        webhookLogger.debug(`Ignoring duplicate webhook: ${webhookKey}`);
        return { success: false, reason: 'Duplicate webhook ignored' };
      }
      this.processedWebhooks.add(webhookKey);

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
      console.error('\n💥 WEBHOOK PROCESSING ERROR');
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('Full webhook data:', JSON.stringify(webhookData, null, 2));
      console.error('========================\n');
      
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
      console.log('\n🔥 MESSAGE UPSERT PROCESSING');
      // 🛡️ LOG LEVE - sem payload completo
      console.log({
        instance: instanceName,
        hasMessage: !!messageData,
        messageType: messageData?.message?.conversation ? 'text' : 'other'
      });
      console.log('========================\n');

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
      console.error('🔥 ERROR REAL NO PROCESSAMENTO:', error);
      console.error('🔥 STACK TRACE:', error.stack);
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

      // 🛡️ FIX: Preparar dados específicos para UPDATE (não sobrescrever qr_code desnecessariamente)
      const updateFields = {
        connection_status: mappedStatus,
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      if (state === 'open') {
        // Conexão aberta - limpar QR e salvar informações do usuário
        updateFields.qr_code = null;
        
        // 🛡️ LIMPAR CACHE DE QR quando conectar
        this.lastQrByInstance.delete(instanceName);
        
        console.log('🔍 CONNECTION UPDATE USER DATA:', JSON.stringify(connectionData.user, null, 2));
        
        if (connectionData.user) {
          const phone = connectionData.user.id?.replace('@s.whatsapp.net', '') || null;
          const profileName = connectionData.user.name || null;
          
          updateFields.phone = phone;
          updateFields.profile_name = profileName;
          
          console.log('🎯 EXTRACTED USER INFO:', {
            phone,
            profileName,
            originalId: connectionData.user.id
          });
        }
      }

      // 🛡️ SALVAR CONNECTION UPDATE NO BANCO
      console.log('💾 SAVING CONNECTION UPDATE TO DATABASE...');
      console.log('Instance:', instanceName);
      console.log('Status:', mappedStatus);
      console.log('Update Fields:', Object.keys(updateFields));
      
      try {
        // 🛡️ FIX: Use UPDATE with specific fields only
        // This prevents overwriting qr_code and other fields that shouldn't be touched by connection updates
        const result = await this.supabaseService.client
          .from('whatsapp_sessions')
          .update(updateFields)
          .eq('store_id', storeId)
          .select()
          .maybeSingle();

        if (result.error) {
          console.error('❌ FAILED TO UPDATE CONNECTION:', result.error);
          throw result.error;
        }

        console.log('✅ CONNECTION UPDATE SAVED SUCCESSFULLY (UPDATE)');
        console.log('Result Session:', result.data);

      } catch (saveError) {
        console.error('💥 CONNECTION UPDATE SAVE ERROR:', saveError);
        throw saveError;
      }

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
    try {
      console.log('\n🔥 QR WEBHOOK PROCESSING');
      // 🛡️ LOG LEVE - sem base64 pesado
      console.log({
        instance: instanceName,
        hasQr: !!qrData?.qrcode,
        pairingCode: qrData?.qrcode?.pairingCode,
        qrLength: qrData?.qrcode?.base64?.length || 0
      });
      console.log('========================\n');

      webhookLogger.info(`Processing QR code update for ${instanceName}`);

      // 🛡️ EXTRAIR storeId DO instance_name (CRÍTICO)
      const storeId = this.extractStoreIdFromInstance(instanceName);
      
      if (!storeId) {
        webhookLogger.error(`Invalid instance format: ${instanceName}`);
        return { success: false, reason: 'Invalid instance format' };
      }

      // 🛡️ EVOLUTION API v2 - PRIORIZAR BASE64 COMO STRING
      // Formato novo: { pairingCode, code, base64 }
      const qrcode = qrData?.qrcode?.base64 || qrData?.qrcode?.code || qrData?.base64 || qrData?.code || qrData?.qrcode;
      
      console.log('🎯 EXTRACTED QR:', qrcode ? 'FOUND' : 'NOT FOUND');
      console.log('QR Type:', typeof qrcode);
      console.log('QR Length:', qrcode?.length || 0);
      
      // 🛡️ REMOVIDO: Não bloquear QR updates legítimos
      // QR novo deve sempre sobrescrever o antigo (reconexões, expiração, etc)
      
      // 🛡️ VERIFICAR DUPLICAÇÃO POR HASH DO BASE64 (não pairingCode)
      // pairingCode pode repetir em reconnects, base64 é mais confiável
      const qrString = qrData?.qrcode?.base64 || qrData?.qrcode?.code || JSON.stringify(qrData?.qrcode);
      const lastQr = this.lastQrByInstance.get(instanceName);
      
      // Verificar por base64 (string)
      if (lastQr === qrString) {
        webhookLogger.debug(`Ignoring duplicate QR code for ${instanceName} (base64)`);
        return { success: false, reason: 'Duplicate QR code ignored' };
      }
      
      // 🛡️ VALIDAÇÃO CRÍTICA - QR pode ser null
      if (!qrcode) {
        console.log('❌ NO QR CODE FOUND IN PAYLOAD - IGNORING');
        webhookLogger.warn(`No QR code found in webhook payload for ${instanceName}`);
        return { success: false, reason: 'No QR code in payload' };
      }
      
      // 🛡️ FIX: Salvar string base64 no cache APENAS UMA VEZ (não objeto)
      // Isso previne inconsistência na comparação de duplicados
      this.lastQrByInstance.set(instanceName, qrString);

      // Log com pairingCode para debug
      const pairingCode = qrData?.qrcode?.pairingCode;
      if (pairingCode) {
        console.log(`🔑 Pairing Code: ${pairingCode}`);
      }
      
      // 🛡️ SALVAR QR DIRETAMENTE USANDO instance_name
      console.log('💾 SAVING QR TO DATABASE...');
      console.log('Instance Name:', instanceName);
      console.log('QR Length:', qrcode?.length || 0);
      
      try {
        // 🛡️ FIX: Use UPDATE instead of UPSERT to only update QR field
        // This prevents overwriting other fields like phone, connection_status, etc.
        const result = await this.supabaseService.client
          .from('whatsapp_sessions')
          .update({
            qr_code: qrcode,
            connection_status: 'connecting',
            last_activity: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('store_id', storeId)
          .select()
          .maybeSingle();

        if (result.error) {
          console.error('❌ FAILED TO UPDATE QR:', result.error);
          throw result.error;
        }

        console.log('✅ QR SAVED SUCCESSFULLY (UPDATE)');
        console.log('Result Session:', result.data);

      } catch (saveError) {
        console.error('💥 QR SAVE ERROR:', saveError);
        throw saveError;
      }

      webhookLogger.info(`QR Code updated for store ${storeId}`);

      return {
        success: true,
        storeId,
        instanceName,
        qrCode: qrcode
      };

    } catch (error) {
      webhookLogger.error('Error handling QR code update:', error);
      return { success: false, error: error.message };
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
      console.log('🧪 EXTRACTING MESSAGE INFO FROM:', JSON.stringify(messageData, null, 2));
      
      // 🛡️ Evolution API pode enviar diferentes formatos
      let message = null;
      
      // Formato 1: { messages: [...] }
      if (messageData.messages && Array.isArray(messageData.messages)) {
        message = messageData.messages[0];
        console.log('📱 Using messages[0] format');
      }
      // Formato 2: { message: {...} }
      else if (messageData.message) {
        message = messageData.message;
        console.log('📱 Using message format');
      }
      // Formato 3: direto no payload
      else if (messageData.key) {
        message = messageData;
        console.log('📱 Using direct payload format');
      }
      
      if (!message) {
        console.log('❌ No valid message found in payload');
        return null;
      }

      console.log('✅ Message extracted:', JSON.stringify(message, null, 2));

      // Extrair ID da mensagem
      const messageId = message.key?.id || message.id;
      
      // Extrair remote JID
      const remoteJid = message.key?.remoteJid || message.remoteJid;
      
      // Extrair conteúdo da mensagem
      let messageContent = '';
      let messageType = 'text';

      console.log('🔍 PARSING MESSAGE CONTENT FROM:', JSON.stringify(message.message || {}, null, 2));

      // 🛡️ Estrutura Baileys correta
      if (message.message?.conversation) {
        messageContent = message.message.conversation;
        messageType = 'text';
        console.log('✅ Found conversation text:', messageContent);
      } else if (message.message?.extendedTextMessage?.text) {
        messageContent = message.message.extendedTextMessage.text;
        messageType = 'text';
        console.log('✅ Found extended text:', messageContent);
      } else if (message.message?.imageMessage?.caption) {
        messageContent = message.message.imageMessage.caption;
        messageType = 'image';
        console.log('✅ Found image caption:', messageContent);
      } else if (message.message?.videoMessage?.caption) {
        messageContent = message.message.videoMessage.caption;
        messageType = 'video';
        console.log('✅ Found video caption:', messageContent);
      } else if (message.message?.audioMessage) {
        messageContent = '[Áudio]';
        messageType = 'audio';
        console.log('✅ Found audio message');
      } else if (message.message?.documentMessage) {
        messageContent = message.message.documentMessage.fileName || '[Documento]';
        messageType = 'document';
        console.log('✅ Found document:', messageContent);
      } else if (message.text) {
        messageContent = message.text;
        messageType = 'text';
        console.log('✅ Found direct text:', messageContent);
      } else {
        console.log('❌ No recognizable message content found');
        messageContent = '[Mensagem não suportada]';
        messageType = 'unknown';
      }

      // Extrair timestamp
      const timestamp = message.messageTimestamp || message.timestamp || new Date().toISOString();

      // Verificar se é mensagem própria
      const isFromMe = message.key?.fromMe || message.fromMe || false;

      console.log('🎯 FINAL EXTRACTED INFO:', {
        messageId,
        remoteJid,
        messageContent,
        messageType,
        timestamp,
        isFromMe
      });

      return {
        messageId,
        remoteJid,
        messageContent,
        messageType,
        timestamp,
        isFromMe
      };

    } catch (error) {
      console.error('🔥 ERROR EXTRACTING MESSAGE INFO:', error);
      console.error('🔥 STACK TRACE:', error.stack);
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
      'connecting': 'connecting',  // 🛡️ FIX: 'connecting' should map to 'connecting', not 'qr'
      'close': 'disconnected',
      'disconnecting': 'disconnected',
      'refused': 'disconnected',  // 🛡️ FIX: Map refused to disconnected (valid status)
      'timeout': 'disconnected'     // 🛡️ FIX: Map timeout to disconnected (valid status)
    };

    return statusMap[evolutionState] || 'disconnected';  // 🛡️ FIX: Default to disconnected (valid status)
  }

  /**
   * Extrair store_id do instance_name
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {string|null} Store ID
   */
  extractStoreIdFromInstance(instanceName) {
    // 🛡️ Regex mais robusto: case insensitive, trim espaços, aceita variações
    const match = instanceName?.trim()?.toLowerCase()?.match(/^store_(.+)$/);
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
   * Gerar chave única para deduplicação de webhook
   * 
   * @param {string} event - Tipo do evento
   * @param {string} instance - Nome da instância
   * @param {Object} data - Dados do evento
   * @returns {string} Chave única
   */
  generateWebhookKey(event, instance, data) {
    let dataHash = '';
    
    // Para mensagens, usar ID da mensagem
    if (event.includes('message') && data?.key?.id) {
      dataHash = data.key.id;
    }
    // Para QR Code, usar hash do base64 (não pairingCode - pode repetir em reconnects)
    else if (event.toLowerCase().includes('qrcode') && data?.qrcode) {
      // 🛡️ CORREÇÃO: Usar apenas base64 para dedupe (pairingCode repete em reconnects)
      const qrBase64 = data.qrcode?.base64 || data.qrcode?.code;
      
      if (qrBase64) {
        // Use first 50 chars of base64 as hash
        dataHash = `base64:${qrBase64.substring(0, 50)}`;
      } else {
        // Last resort: use object structure hash
        dataHash = `obj:${JSON.stringify(data.qrcode).substring(0, 50)}`;
      }
    }
    // Para connection, usar state + user info (se disponível) para deduplicação estável
    else if (event.toLowerCase().includes('connection')) {
      const state = data?.state || 'unknown';
      const userId = data?.user?.id || 'no-user';
      // 🛡️ FIX: Use state + user ID instead of Date.now() for stable deduplication
      // This prevents duplicate connection events from being processed
      dataHash = `${state}:${userId}`;
    }
    // Para outros eventos, usar hash estável dos dados
    else {
      // 🛡️ FIX: Use hash of data content instead of Date.now()
      // This ensures same data produces same key
      const dataStr = JSON.stringify(data || {}).substring(0, 100);
      dataHash = `data:${dataStr}`;
    }
    
    return `${event}:${instance}:${dataHash}`;
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
