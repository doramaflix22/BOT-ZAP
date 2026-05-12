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
        console.log(`🔵 API REQUEST: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Evolution API Request Error:', error);
        console.error('🔴 REQUEST ERROR:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Evolution API Response: ${response.status} ${response.config.url}`);
        console.log(`🟢 API RESPONSE: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        // 🔥 DEBUG ESPECÍFICO PARA 401
        if (error?.response?.status === 401) {
          console.error('\n💥💥💥 401 UNAUTHORIZED DETECTED 💥💥💥');
          console.error('URL:', error.config?.url);
          console.error('Method:', error.config?.method);
          console.error('Headers:', error.config?.headers);
          console.error('Response Data:', error.response?.data);
          console.error('💥💥💥 END 401 DEBUG 💥💥💥\n');
        }

        logger.error('Evolution API Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url
        });
        
        console.error('🔴 RESPONSE ERROR:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.response?.data?.message || error.message
        });
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Criar instância WhatsApp
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} phoneNumber - Número de telefone para a instância
   * @returns {Promise<Object>} Dados da instância criada
   */
  async createInstance(storeId, phoneNumber) {
    try {
      const instanceName = `store_${storeId}`;

      if (!phoneNumber) {
        throw new Error('Phone number is required to create WhatsApp instance');
      }

      logger.info(`Creating Evolution instance: ${instanceName} with phone: ${phoneNumber}`);

      const payload = {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        rejectCall: true,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        // 🛡️ OBRIGATÓRIO: Número fornecido pelo usuário
        number: phoneNumber
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
   * Forçar conexão da instância
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>} Resultado da conexão
   */
  async connectInstance(instanceName) {
    try {
      logger.info(`Forcing connection for instance: ${instanceName}`);

      const response = await this.client.post(`/instance/connect/${instanceName}`);

      logger.info(`Connection initiated successfully for: ${instanceName}`);

      return {
        success: true,
        instanceName,
        data: response.data
      };

    } catch (error) {
      logger.error(`Failed to connect instance ${instanceName}:`, error);
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
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

      // 🛡️ CORREÇÃO CRÍTICA: Evolution API retorna {instance: {state: "open"}}
      const state = 
        response.data?.instance?.state ||
        response.data?.state ||
        response.data?.connectionStatus ||
        'unknown';

      logger.debug(`Connection state for ${instanceName}: ${state}`);
      logger.debug(`Raw response structure:`, JSON.stringify(response.data, null, 2));

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
      'connecting': 'connecting',  // 🛡️ STATUS VÁLIDO - aguardando QR/conexão
      'close': 'disconnected',
      'disconnecting': 'disconnected'
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
        webhookByEvents: true,  // true = webhook apenas para eventos específicos
        webhookBase64: true,    // true = QR em base64
        events: [
          "QRCODE_UPDATED",     // QR atualizado - ESSENCIAL
          "CONNECTION_UPDATE"   // Mudanças de status - ESSENCIAL
        ]
      };

      // Motivo dos eventos:
      // - QRCODE_UPDATED: ESSENCIAL para receber QR Codes
      // - CONNECTION_UPDATE: ESSENCIAL para monitorar status da conexão

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
   * Listar todas as instâncias - FONTE CONFIÁVEL DE EXISTÊNCIA
   * 
   * @returns {Promise<Array>} Lista de todas as instâncias
   */
  async listInstances() {
    try {
      logger.debug(`Fetching all instances from Evolution API`);

      const response = await this.client.get('/instance/fetchInstances');
      
      logger.debug(`Found ${response.data?.length || 0} instances in Evolution API`);

      return {
        success: true,
        instances: response.data || [],
        total: response.data?.length || 0
      };

    } catch (error) {
      logger.error(`Failed to fetch instances from Evolution API:`, {
        message: error.message,
        status: error?.response?.status,
        data: error?.response?.data
      });
      
      throw new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verificar se instância existe - REGRA MATEMATICAMENTE FECHADA
   * 
   * 🚨 PROBLEMAS CRÍTICOS CORRIGIDOS:
   * 1. Não confia mais em exceções como lógica de fluxo
   * 2. Trata múltiplos formatos de resposta da Evolution API
   * 3. canCreate é matematicamente fechado para evitar 403
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<{exists: boolean, canCreate: boolean, source: string, fromInfo?: boolean, fromList?: boolean}>} Resultado da verificação
   */
  async instanceExists(instanceName) {
    let fromInfo = null;
    let fromList = null;
    let finalDecision = false;
    let canCreate = false;
    let source = 'unknown';

    // 🔥 STEP 1 - getInstanceInfo com tratamento robusto de erros
    try {
      logger.debug(`🔍 STEP 1 - getInstanceInfo: ${instanceName}`);
      const instanceInfo = await this.getInstanceInfo(instanceName);
      fromInfo = true;
      finalDecision = true;
      canCreate = false;
      source = 'getInstanceInfo-success';
      
      logger.debug(`✅ Instance CONFIRMED via getInstanceInfo: ${instanceName}`);
      
    } catch (infoError) {
      fromInfo = false;
      
      // 🛡️ PROBLEMA 1 CORRIGIDO: Não confiar em exceções!
      // Verificar se é 404 REAL ou erro técnico disfarçado
      const isReal404 = this.isReal404Error(infoError);
      
      if (isReal404) {
        logger.debug(`❌ Real 404 confirmed via getInstanceInfo: ${instanceName}`);
        finalDecision = false;
        source = 'getInstanceInfo-real404';
        
        // 🔥 STEP 2 - fetchInstances com tratamento robusto
        try {
          logger.debug(`🔄 STEP 2 - fetchInstances for confirmation: ${instanceName}`);
          const instances = await this.listInstances();
          
          console.log('\n========================');
          console.log('🔥 RAW FETCH INSTANCES');
          console.log(JSON.stringify(instances, null, 2));
          console.log('========================\n');
          
          // 🛡️ PROBLEMA 2 CORRIGIDO: Tratar múltiplos formatos
          fromList = this.findInstanceInList(instances.instances, instanceName);
          
          if (fromList) {
            // Inconsistência detectada → EXISTE
            finalDecision = true;
            canCreate = false;
            source = 'fetchInstances-inconsistency';
            logger.warn(`⚠️ INCONSISTENCY: Found in list but 404 in info: ${instanceName}`);
          } else {
            // 🛡️ PROBLEMA 3 CORRIGIDO: canCreate matematicamente fechado
            // Dupla verificação negativa → PODE CRIAR
            finalDecision = false; // 🛡️ INSTÂNCIA NÃO EXISTE
            canCreate = true;
            source = 'dual-confirmation-not-exists';
            logger.debug(`✅ DUAL CONFIRMATION: Instance does NOT exist: ${instanceName}`);
          }
          
        } catch (listError) {
          // fetchInstances falhou → NÃO PODE CRIAR sem confirmação
          canCreate = false;
          source = 'getInstanceInfo-404-fallback-failed';
          logger.warn(`⚠️ fetchInstances failed, cannot create without confirmation: ${instanceName}`);
        }
        
      } else {
        // Erro técnico (500, timeout, etc) → NÃO DECIDIR
        logger.warn(`⚠️ Technical error in getInstanceInfo: ${infoError.message}`);
        
        // Tentar fetchInstances como backup
        try {
          logger.debug(`🔄 STEP 2 - fetchInstances as backup: ${instanceName}`);
          const instances = await this.listInstances();
          
          console.log('\n========================');
          console.log('🔥 RAW FETCH INSTANCES (BACKUP)');
          console.log(JSON.stringify(instances, null, 2));
          console.log('========================\n');
          
          fromList = this.findInstanceInList(instances.instances, instanceName);
          
          if (fromList) {
            finalDecision = true;
            canCreate = false;
            source = 'fetchInstances-backup-found';
            logger.debug(`✅ Found via fetchInstances backup: ${instanceName}`);
          } else {
            finalDecision = false;
            canCreate = false; // 🛡️ NUNCA criar em erro técnico
            source = 'both-sources-uncertain';
            logger.debug(`❌ Both sources uncertain, cannot create: ${instanceName}`);
          }
          
        } catch (listError) {
          logger.error(`💥 Both sources failed completely:`, {
            infoError: infoError.message,
            listError: listError.message
          });
          finalDecision = false;
          canCreate = false; // 🛡️ NUNCA criar sem validação
          source = 'both-failed';
        }
      }
    }

    // 🧪 DEBUG OBRIGATÓRIO - CONSISTÊNCIA ENTRE FONTES
    console.log("🧪 INSTANCE CONSISTENCY CHECK", {
      instanceName,
      fromInfo,
      fromList,
      finalDecision,
      canCreate,
      source
    });

    return {
      exists: finalDecision,
      canCreate,
      source,
      fromInfo,
      fromList
    };
  }

  /**
   * 🛡️ PROBLEMA 1 CORRIGIDO: Verificar se é 404 REAL
   * Diferenciar 404 real de erro técnico disfarçado
   * 
   * @param {Error} error - Erro da API
   * @returns {boolean} True se é 404 real
   */
  isReal404Error(error) {
    // Verificar status HTTP
    if (error?.response?.status === 404) {
      // Verificar se o corpo da resposta confirma 404
      const data = error?.response?.data;
      
      // Evolution API pode retornar diferentes formatos de 404
      const isConfirmed404 = (
        data?.message?.toLowerCase().includes('not found') ||
        data?.error?.toLowerCase().includes('not found') ||
        data?.code === 'INSTANCE_NOT_FOUND' ||
        data?.status === 'NOT_FOUND' ||
        typeof data === 'string' && data.toLowerCase().includes('not found')
      );
      
      // Se tiver corpo 404 ou for status 404 limpo → é real
      return isConfirmed404 || !data || Object.keys(data).length === 0;
    }
    
    return false;
  }

  /**
   * 🛡️ PROBLEMA 2 CORRIGIDO: Buscar instância em múltiplos formatos
   * Evolution API pode retornar diferentes estruturas
   * 
   * @param {Array} instances - Lista de instâncias
   * @param {string} instanceName - Nome da instância buscada
   * @returns {boolean} True se encontrou
   */
  findInstanceInList(instances, instanceName) {
    if (!Array.isArray(instances) || instances.length === 0) {
      return false;
    }

    console.log('\n🧪 CHECKING INSTANCE MATCH');
    console.log('SEARCHING FOR:', instanceName);

    instances.forEach((instance, index) => {
      console.log(`\nINSTANCE ${index}:`);
      console.log(JSON.stringify(instance, null, 2));
    });

    return instances.some(instance => {
      // 🔄 Verificar múltiplos campos possíveis
      const possibleNames = [
        instance.instanceName,
        instance.name,
        instance.instance,
        instance.id,
        instance.instance_id
      ];
      
      const matched = possibleNames.some(name => name === instanceName);

      console.log({
        possibleNames,
        target: instanceName,
        matched
      });

      return matched;
    });
  }

  /**
   * Obter informações da instância - APENAS PARA DADOS OPERACIONAIS
   * NÃO USAR COMO FONTE DE EXISTÊNCIA!
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>} Informações da instância
   */
  async getInstanceInfo(instanceName) {
    try {
      logger.debug(`Getting instance info: ${instanceName}`);

      const response = await this.client.get(`/instance/info/${instanceName}`);

      // Response direto da API com a instância específica
      const instance = response.data;

      return {
        instanceName: instance.instanceName,
        status: instance.status,
        owner: instance.owner,
        profilePicUrl: instance.profilePicUrl,
        phone: instance.phone
      };

    } catch (error) {
      logger.error(`Failed to get instance info for ${instanceName}:`, {
        message: error.message,
        status: error?.response?.status,
        data: error?.response?.data
      });
      
      // 📡 PRESERVAR INFORMAÇÕES CRÍTICAS DO ERRO
      const enhancedError = new Error(`Evolution API Error: ${error.response?.data?.message || error.message}`);
      enhancedError.response = error.response;
      enhancedError.originalError = error;
      
      throw enhancedError;
    }
  }
}

module.exports = EvolutionService;
