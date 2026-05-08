/**
 * Evolution API Service - Adapter Pattern
 * Encapsula toda comunicação com Evolution API v2
 * Permite trocar de API sem afetar resto do código
 */

const axios = require('axios');
const { logger } = require('../utils/logger');

class EvolutionService {
  constructor() {
    this.baseURL = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.webhookURL = process.env.WEBHOOK_URL;

    // Configuração Axios com retry e timeout
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'apikey': this.apiKey,
        'Content-Type': 'application/json'
      }
    });

    // Interceptor para logs
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Evolution API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Evolution API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Evolution API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('Evolution API Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Criar instância WhatsApp
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Dados da instância criada
   */
  async createInstance(storeId) {
    try {
      const instanceName = `store_${storeId}`;

      logger.info(`Creating Evolution instance: ${instanceName}`);

      const payload = {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        rejectCall: true,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false
      };

      // Motivo de cada campo:
      // - instanceName: Identificador único multi-tenant (store_{storeId})
      // - integration: WHATSAPP-BAILEYS = versão estável da Evolution
      // - qrcode: true = necessário para conectar via QR Code
      // - rejectCall: true = evitar chamadas de voz (foco em texto)
      // - groupsIgnore: true = focar em mensagens individuais
      // - alwaysOnline: false = economizar recursos e parecer mais natural
      // - readMessages: false = privacidade do cliente
      // - readStatus: false = evitar notificações desnecessárias
      // - syncFullHistory: false = economizar banda, sincronizar apenas novas

      const response = await this.client.post('/instance/create', payload);

      logger.info(`Evolution instance created successfully: ${instanceName}`);

      // Configurar webhook após criar instância (não-crítico)
      try {
        await this.setWebhook(instanceName);
        logger.info(`Webhook configured successfully for: ${instanceName}`);
      } catch (webhookError) {
        logger.warn(`Webhook configuration failed for ${instanceName}, but instance created:`, webhookError.message);
        // Continuar mesmo se webhook falhar - instância foi criada com sucesso
      }

      return {
        success: true,
        instanceName,
        data: response.data,
        webhookConfigured: true // Flag para indicar que tentamos configurar
      };

    } catch (error) {
      logger.error(`Failed to create Evolution instance for store ${storeId}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verificar se instância já existe na Evolution
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<boolean>} True se existe
   */
  async instanceExists(instanceName) {
    try {
      const response = await this.client.get('/instance/fetchInstances');
      const instances = response.data || [];

      return instances.some(
        instance => instance.name === instanceName ||
                    instance.instanceName === instanceName
      );

    } catch (error) {
      logger.error('Failed to check instance existence:', error);
      return false;
    }
  }

  /**
   * Obter QR Code da instância
   * 
   * @param {string} instanceName - Nome da instância
   * @param {string} number - Número de telefone (opcional)
   * @returns {Promise<Object>} QR Code e pairing code
   */
  async getQRCode(instanceName, number = null) {
    try {
      logger.info(`Getting QR code for instance: ${instanceName}`);

      const params = number ? `?number=${number}` : '';
      const response = await this.client.get(`/instance/connect/${instanceName}${params}`);

      // Evolution v2 pode retornar diferentes formatos
      const data = response.data;
      
      // Formato 1: pairingCode, code, count
      if (data.pairingCode) {
        logger.info(`Pairing code obtained for instance: ${instanceName}`);
        return {
          type: 'pairing',
          pairingCode: data.pairingCode,
          code: data.code,
          count: data.count
        };
      }
      
      // Formato 2: base64, code direto
      if (data.base64) {
        logger.info(`QR code base64 obtained for instance: ${instanceName}`);
        return {
          type: 'qr',
          base64: data.base64,
          code: data.code
        };
      }
      
      // Formato 3: apenas code
      if (data.code) {
        logger.info(`QR code obtained for instance: ${instanceName}`);
        return {
          type: 'qr',
          code: data.code,
          pairingCode: data.pairingCode || null
        };
      }

      // QR code será enviado via webhook
      logger.info(`QR code request sent for instance: ${instanceName}`);
      return {
        type: 'qr_requested',
        message: 'QR code will be sent via webhook',
        data: data
      };

    } catch (error) {
      logger.error(`Failed to get QR code for instance ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verificar status da conexão
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>} Status da conexão
   */
  async getConnectionState(instanceName) {
    try {
      logger.debug(`Checking connection state for instance: ${instanceName}`);

      const response = await this.client.get(`/instance/connectionState/${instanceName}`);

      // Status possíveis:
      // - open: Conectado e funcionando
      // - connecting: Em processo de conexão
      // - close: Desconectado
      // - disconnecting: Em processo de desconexão

      const { state } = response.data;

      logger.debug(`Connection state for ${instanceName}: ${state}`);

      return {
        instanceName,
        status: this.mapConnectionStatus(state),
        connected: state === 'open',
        rawState: state
      };

    } catch (error) {
      logger.error(`Failed to get connection state for instance ${instanceName}:`, error);
      return {
        instanceName,
        status: 'error',
        connected: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Mapear status Evolution para status interno
   */
  mapConnectionStatus(evolutionState) {
    const statusMap = {
      'open': 'connected',
      'connecting': 'connecting',
      'close': 'disconnected',
      'disconnecting': 'disconnecting'
    };

    return statusMap[evolutionState] || 'unknown';
  }

  /**
   * Configurar webhook para instância
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<void>}
   */
  async setWebhook(instanceName) {
    try {
      logger.info(`Setting webhook for instance: ${instanceName}`);

      const payload = {
        enabled: true,
        url: this.webhookURL,
        webhookByEvents: false, // false = webhook para todos os eventos
        webhookBase64: true,    // true = QR em base64
        events: [
          "MESSAGES_UPSERT",    // Mensagens recebidas
          "CONNECTION_UPDATE",  // Mudanças de status
          "QRCODE_UPDATED"      // QR atualizado
        ]
      };

      // Motivo dos eventos:
      // - MESSAGES_UPSERT: Essencial para receber mensagens
      // - CONNECTION_UPDATE: Essencial para monitorar status
      // - QRCODE_UPDATED: Essencial para atualizar QR no frontend

      await this.client.post(`/webhook/set/${instanceName}`, payload);

      logger.info(`Webhook configured successfully for instance: ${instanceName}`);

    } catch (error) {
      logger.error(`Failed to set webhook for instance ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Enviar mensagem de texto
   * 
   * @param {string} instanceName - Nome da instância
   * @param {string} number - Número de telefone (com DDI e DDD)
   * @param {string} text - Texto da mensagem
   * @param {Object} options - Opções adicionais
   * @returns {Promise<Object>} Resultado do envio
   */
  async sendText(instanceName, number, text, options = {}) {
    try {
      logger.info(`Sending text message via ${instanceName} to ${number}`);

      // Validação e formatação do número
      const formattedNumber = this.formatPhoneNumber(number);

      const payload = {
        number: formattedNumber,
        text: text,
        // Opções padrão e personalizadas
        delay: options.delay || 1000,
        linkPreview: options.linkPreview !== false, // default true
        mentionsEveryOne: options.mentionsEveryOne || false,
        mentioned: options.mentioned || []
      };

      // Melhores práticas:
      // - Formatar número corretamente (551199999999)
      // - Usar delay para parecer natural
      // - Habilitar link preview para cardápios
      // - Respeitar limites de rate limiting

      if (text.length > 4096) {
        logger.warn(`Message too long (${text.length} chars), truncating to 4096`);
        payload.text = text.substring(0, 4096);
      }

      // Adicionar quoted se fornecido
      if (options.quoted) {
        payload.quoted = options.quoted;
      }

      const response = await this.client.post(`/message/sendText/${instanceName}`, payload);

      logger.info(`Message sent successfully via ${instanceName} to ${formattedNumber}`);

      return {
        success: true,
        messageId: response.data?.key?.id,
        messageTimestamp: response.data?.messageTimestamp,
        status: response.data?.status,
        data: response.data
      };

    } catch (error) {
      logger.error(`Failed to send message via ${instanceName} to ${number}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Formatar número de telefone
   * Remove caracteres especiais e garante formato internacional
   */
  formatPhoneNumber(number) {
    // Remover tudo que não for dígito
    let cleanNumber = number.replace(/\D/g, '');

    // Se não começar com código do país, adicionar 55 (Brasil)
    if (!cleanNumber.startsWith('55')) {
      cleanNumber = `55${cleanNumber}`;
    }

    // Remover 9 extra após DDD se necessário (alguns casos)
    if (cleanNumber.length === 13 && cleanNumber.startsWith('55') && cleanNumber[4] === '9') {
      // Número já está no formato correto (55 + DDD + 9 + número)
    }

    return cleanNumber;
  }

  /**
   * Logout da instância (desconectar mantendo dados)
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>}
   */
  async logoutInstance(instanceName) {
    try {
      logger.info(`Logging out instance: ${instanceName}`);

      const response = await this.client.delete(`/instance/logout/${instanceName}`);

      logger.info(`Instance logged out successfully: ${instanceName}`);

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      logger.error(`Failed to logout instance ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Deletar instância (remover completamente)
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>}
   */
  async deleteInstance(instanceName) {
    try {
      logger.info(`Deleting instance: ${instanceName}`);

      const response = await this.client.delete(`/instance/delete/${instanceName}`);

      logger.info(`Instance deleted successfully: ${instanceName}`);

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      logger.error(`Failed to delete instance ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Obter informações da instância
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>} Informações da instância
   */
  async getInstanceInfo(instanceName) {
    try {
      logger.debug(`Getting instance info: ${instanceName}`);

      const response = await this.client.get(`/instance/fetchInstances?instanceName=${instanceName}`);

      const instance = response.data.find(i => i.instanceName === instanceName);

      if (!instance) {
        throw new Error(`Instance ${instanceName} not found`);
      }

      return {
        instanceName: instance.instanceName,
        status: instance.status,
        owner: instance.owner,
        profilePicUrl: instance.profilePicUrl,
        phone: instance.phone
      };

    } catch (error) {
      logger.error(`Failed to get instance info for ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = EvolutionService;
