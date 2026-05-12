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
    
    // Limpar cache periodicamente (30 segundos)
    setInterval(() => {
      this.processedWebhooks.clear();
    }, 30000);
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

      // Preparar dados adicionais para salvar
      const additionalData = {};
      
      if (state === 'open') {
        // Conexão aberta - limpar QR e salvar informações do usuário
        additionalData.qr_code = null;
        
        console.log('🔍 CONNECTION UPDATE USER DATA:', JSON.stringify(connectionData.user, null, 2));
        
        if (connectionData.user) {
          const phone = connectionData.user.id?.replace('@s.whatsapp.net', '') || null;
          const profileName = connectionData.user.name || null;
          
          additionalData.phone = phone;
          additionalData.profile_name = profileName;
          
          console.log('🎯 EXTRACTED USER INFO:', {
            phone,
            profileName,
            originalId: connectionData.user.id
          });
        }
      }

      // 🛡️ SALVAR PHONE DIRETAMENTE NO BANCO
      console.log('💾 SAVING CONNECTION UPDATE TO DATABASE...');
      console.log('Instance:', instanceName);
      console.log('Status:', mappedStatus);
      console.log('Additional Data:', additionalData);
      
      try {
        // 🛡️ VERIFICAR SE SESSÃO EXISTE ANTES DE ATUALIZAR
        const { data: existingSession, error: checkError } = await this.supabaseService.client
          .from('whatsapp_sessions')
          .select('store_id')
          .eq('instance_name', instanceName)
          .maybeSingle();

        if (checkError) {
          console.error('❌ ERROR CHECKING SESSION:', checkError);
          throw checkError;
        }

        let result;
        
        if (!existingSession) {
          // 🛡️ SESSÃO NÃO EXISTE - CRIAR PRIMEIRO
          console.log('⚠️ SESSION NOT FOUND - CREATING NEW SESSION');
          const { data: newSession, error: insertError } = await this.supabaseService.client
            .from('whatsapp_sessions')
            .insert({
              store_id: storeId,
              instance_name: instanceName,
              connection_status: mappedStatus,
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...additionalData
            })
            .select()
            .single();

          if (insertError) {
            console.error('❌ FAILED TO CREATE SESSION:', insertError);
            throw insertError;
          }

          result = newSession;
          console.log('✅ NEW SESSION CREATED:', result);
        } else {
          // 🛡️ SESSÃO EXISTE - ATUALIZAR
          const { data: updatedSession, error: updateError } = await this.supabaseService.client
            .from('whatsapp_sessions')
            .update({
              connection_status: mappedStatus,
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...additionalData
            })
            .eq('instance_name', instanceName)
            .select()
            .maybeSingle();

          if (updateError) {
            console.error('❌ FAILED TO UPDATE SESSION:', updateError);
            throw updateError;
          }

          result = updatedSession;
          console.log('✅ SESSION UPDATED:', result);
        }

        console.log('✅ CONNECTION UPDATE SAVED SUCCESSFULLY');
        console.log('Result Session:', result);

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

      // 🛡️ EVOLUTION API PODE ENVIAR DIFERENTES FORMATOS
      let qrcode = qrData?.qrcode || qrData?.base64 || qrData?.code || qrData;
      
      console.log('🎯 EXTRACTED QR:', qrcode ? 'FOUND' : 'NOT FOUND');
      console.log('QR Type:', typeof qrcode);
      console.log('QR Length:', qrcode?.length || 0);
      
      // Verificar duplicação de QR Code
      const lastQr = this.lastQrByInstance.get(instanceName);
      if (lastQr === qrcode) {
        webhookLogger.debug(`Ignoring duplicate QR code for ${instanceName}`);
        return { success: false, reason: 'Duplicate QR code ignored' };
      }
      
      // 🛡️ VALIDAÇÃO CRÍTICA - QR pode ser null
      if (!qrcode) {
        console.log('❌ NO QR CODE FOUND IN PAYLOAD - IGNORING');
        webhookLogger.warn(`No QR code found in webhook payload for ${instanceName}`);
        return { success: false, reason: 'No QR code in payload' };
      }
      
      // Atualizar cache
      this.lastQrByInstance.set(instanceName, qrcode);
      
      // 🛡️ SALVAR QR DIRETAMENTE USANDO instance_name
      console.log('💾 SAVING QR TO DATABASE...');
      console.log('Instance Name:', instanceName);
      console.log('QR Length:', qrcode?.length || 0);
      
      try {
        // 🛡️ VERIFICAR SE SESSÃO EXISTE ANTES DE ATUALIZAR
        const { data: existingSession, error: checkError } = await this.supabaseService.client
          .from('whatsapp_sessions')
          .select('store_id')
          .eq('instance_name', instanceName)
          .maybeSingle();

        if (checkError) {
          console.error('❌ ERROR CHECKING SESSION:', checkError);
          throw checkError;
        }

        let result;
        
        if (!existingSession) {
          // 🛡️ SESSÃO NÃO EXISTE - CRIAR PRIMEIRO
          console.log('⚠️ SESSION NOT FOUND - CREATING NEW SESSION');
          const { data: newSession, error: insertError } = await this.supabaseService.client
            .from('whatsapp_sessions')
            .insert({
              store_id: storeId,
              instance_name: instanceName,
              qr_code: qrcode,
              connection_status: 'connecting',  // 🛡️ CORRIGIDO: status válido para constraint
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();

          if (insertError) {
            console.error('❌ FAILED TO CREATE SESSION:', insertError);
            throw insertError;
          }

          result = newSession;
          console.log('✅ NEW SESSION CREATED:', result);
        } else {
          // 🛡️ SESSÃO EXISTE - ATUALIZAR
          const { data: updatedSession, error: updateError } = await this.supabaseService.client
            .from('whatsapp_sessions')
            .update({
              qr_code: qrcode,
              connection_status: 'connecting',  // 🛡️ CORRIGIDO: status válido para constraint
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('instance_name', instanceName)
            .select()
            .maybeSingle();

          if (updateError) {
            console.error('❌ FAILED TO UPDATE SESSION:', updateError);
            throw updateError;
          }

          result = updatedSession;
          console.log('✅ SESSION UPDATED:', result);
        }

        console.log('✅ QR SAVED SUCCESSFULLY');
        console.log('Result Session:', result);

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
      'connecting': 'qr',  // 🛡️ Mudar para 'qr' para respeitar constraint do banco
      'close': 'disconnected',
      'disconnecting': 'disconnected',
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
    // Para QR Code, usar hash do QR
    else if (event.includes('qrcode') && data?.qrcode) {
      // 🛡️ CORREÇÃO: data.qrcode agora é OBJETO, não STRING
      // Formato novo: { pairingCode, code, base64 }
      const qrString = data.qrcode?.base64 || data.qrcode?.code || JSON.stringify(data.qrcode);
      dataHash = qrString ? qrString.substring(0, 50) : Date.now().toString();
    }
    // Para connection, usar timestamp ou state
    else if (event.includes('connection')) {
      dataHash = data?.state || Date.now().toString();
    }
    // Para outros, usar timestamp atual
    else {
      dataHash = Date.now().toString();
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
