/**
 * Session Controller - Controlador de Sessões WhatsApp
 * Orquestra o fluxo de conexão/desconexão via Evolution API
 */

const EvolutionService = require('../services/evolutionService');
const SupabaseService = require('../services/supabaseService');
const { controllerLogger } = require('../utils/logger');

class SessionController {
  constructor() {
    this.evolutionService = new EvolutionService();
    this.supabaseService = new SupabaseService();
  }

  /**
   * Conectar WhatsApp para um restaurante
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Resultado da conexão
   */
  async connect(storeId) {
    try {
      controllerLogger.info(`Starting WhatsApp connection for store: ${storeId}`);

      // Validar storeId
      if (!storeId || typeof storeId !== 'string' || storeId.length < 3) {
        throw new Error('Invalid store ID format');
      }

      // Verificar se já existe sessão ativa
      const existingSession = await this.supabaseService.getSession(storeId);
      
      if (existingSession && existingSession.connection_status === 'connected') {
        controllerLogger.info(`WhatsApp already connected for store: ${storeId}`);
        return {
          success: true,
          status: 'already_connected',
          message: 'WhatsApp already connected',
          data: {
            phone: existingSession.phone,
            profileName: existingSession.profile_name,
            connectionStatus: existingSession.connection_status
          }
        };
      }

      // Criar instância Evolution
      const instanceResult = await this.evolutionService.createInstance(storeId);
      
      if (!instanceResult.success) {
        throw new Error('Failed to create Evolution instance');
      }

      const instanceName = instanceResult.instanceName;

      // Obter QR Code
      const qrCode = await this.evolutionService.getQRCode(instanceName);

      // Salvar sessão inicial no Supabase
      await this.supabaseService.saveSession(storeId, {
        status: 'qr',
        qr: qrCode
      });

      controllerLogger.info(`WhatsApp connection initiated for store: ${storeId}`);

      return {
        success: true,
        status: 'qr_generated',
        message: 'QR Code generated successfully',
        data: {
          instanceName,
          qr: qrCode,
          connectionStatus: 'qr'
        }
      };

    } catch (error) {
      controllerLogger.error(`Failed to connect WhatsApp for store ${storeId}:`, error);
      
      // Salvar erro no Supabase
      await this.supabaseService.saveSession(storeId, {
        status: 'error'
      }).catch(() => {}); // Ignorar erro do salvamento

      throw error;
    }
  }

  /**
   * Obter status da conexão
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Status da conexão
   */
  async getStatus(storeId) {
    try {
      controllerLogger.debug(`Getting WhatsApp status for store: ${storeId}`);

      // Buscar sessão no Supabase
      const session = await this.supabaseService.getSession(storeId);

      if (!session) {
        return {
          success: true,
          data: {
            connected: false,
            status: 'not_found',
            phone: null,
            profileName: null,
            qr: null
          }
        };
      }

      // Se estiver conectado no banco, verificar status real na Evolution
      if (session.connection_status === 'connected') {
        try {
          const instanceName = `store_${storeId}`;
          const evolutionStatus = await this.evolutionService.getConnectionState(instanceName);

          // Se status divergir, atualizar banco
          if (evolutionStatus.status !== session.connection_status) {
            await this.supabaseService.updateConnectionStatus(
              storeId,
              evolutionStatus.status
            );

            session.connection_status = evolutionStatus.status;
          }
        } catch (error) {
          controllerLogger.warn(`Failed to verify Evolution status for store ${storeId}:`, error);
          // Manter status do banco se falhar verificação
        }
      }

      return {
        success: true,
        data: {
          connected: session.connection_status === 'connected',
          status: session.connection_status,
          phone: session.phone,
          profileName: session.profile_name,
          qr: session.qr_code,
          instanceName: session.instance_name,
          lastActivity: session.last_activity
        }
      };

    } catch (error) {
      controllerLogger.error(`Failed to get status for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Obter QR Code
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} QR Code
   */
  async getQRCode(storeId) {
    try {
      controllerLogger.debug(`Getting QR code for store: ${storeId}`);

      const session = await this.supabaseService.getSession(storeId);

      if (!session) {
        return {
          success: true,
          data: {
            qr: null,
            message: 'No session found'
          }
        };
      }

      // Se já estiver conectado, não tem QR
      if (session.connection_status === 'connected') {
        return {
          success: true,
          data: {
            qr: null,
            message: 'Already connected'
          }
        };
      }

      // Se tiver QR no banco, retornar
      if (session.qr_code) {
        return {
          success: true,
          data: {
            qr: session.qr_code,
            status: session.connection_status
          }
        };
      }

      // Tentar obter QR novo da Evolution
      try {
        const instanceName = `store_${storeId}`;
        const qrCode = await this.evolutionService.getQRCode(instanceName);

        // Atualizar QR no banco
        await this.supabaseService.updateQRCode(storeId, qrCode);

        return {
          success: true,
          data: {
            qr: qrCode,
            status: 'qr'
          }
        };

      } catch (error) {
        controllerLogger.warn(`Failed to get fresh QR for store ${storeId}:`, error);
        
        return {
          success: true,
          data: {
            qr: null,
            message: 'QR not available'
          }
        };
      }

    } catch (error) {
      controllerLogger.error(`Failed to get QR code for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Desconectar WhatsApp
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Resultado da desconexão
   */
  async disconnect(storeId) {
    try {
      controllerLogger.info(`Disconnecting WhatsApp for store: ${storeId}`);

      const session = await this.supabaseService.getSession(storeId);

      if (!session) {
        return {
          success: true,
          message: 'No session to disconnect'
        };
      }

      const instanceName = `store_${storeId}`;

      // Fazer logout na Evolution (mantém dados)
      try {
        await this.evolutionService.logoutInstance(instanceName);
      } catch (error) {
        controllerLogger.warn(`Failed to logout Evolution instance ${instanceName}:`, error);
      }

      // Atualizar status no Supabase
      await this.supabaseService.updateConnectionStatus(
        storeId,
        'disconnected'
      );

      controllerLogger.info(`WhatsApp disconnected for store: ${storeId}`);

      return {
        success: true,
        message: 'WhatsApp disconnected successfully',
        data: {
          status: 'disconnected'
        }
      };

    } catch (error) {
      controllerLogger.error(`Failed to disconnect WhatsApp for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Deletar sessão completamente
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Resultado da deleção
   */
  async deleteSession(storeId) {
    try {
      controllerLogger.info(`Deleting WhatsApp session for store: ${storeId}`);

      const instanceName = `store_${storeId}`;

      // Deletar instância na Evolution
      try {
        await this.evolutionService.deleteInstance(instanceName);
      } catch (error) {
        controllerLogger.warn(`Failed to delete Evolution instance ${instanceName}:`, error);
      }

      // Deletar sessão no Supabase
      await this.supabaseService.deleteSession(storeId);

      controllerLogger.info(`WhatsApp session deleted for store: ${storeId}`);

      return {
        success: true,
        message: 'Session deleted successfully'
      };

    } catch (error) {
      controllerLogger.error(`Failed to delete session for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Reconectar sessão
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Resultado da reconexão
   */
  async reconnect(storeId) {
    try {
      controllerLogger.info(`Reconnecting WhatsApp for store: ${storeId}`);

      // Primeiro desconectar
      await this.disconnect(storeId);

      // Aguardar um pouco
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Conectar novamente
      return await this.connect(storeId);

    } catch (error) {
      controllerLogger.error(`Failed to reconnect WhatsApp for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Listar todas as sessões
   * 
   * @returns {Promise<Object>} Lista de sessões
   */
  async getAllSessions() {
    try {
      controllerLogger.debug('Getting all WhatsApp sessions');

      const sessions = await this.supabaseService.getAllSessions();

      // Mapear para formato de resposta
      const formattedSessions = sessions.map(session => ({
        storeId: session.store_id,
        instanceName: session.instance_name,
        status: session.connection_status,
        phone: session.phone,
        profileName: session.profile_name,
        connected: session.connection_status === 'connected',
        lastActivity: session.last_activity,
        hasQR: !!session.qr_code
      }));

      return {
        success: true,
        data: {
          sessions: formattedSessions,
          total: formattedSessions.length,
          connected: formattedSessions.filter(s => s.connected).length
        }
      };

    } catch (error) {
      controllerLogger.error('Failed to get all sessions:', error);
      throw error;
    }
  }

  /**
   * Testar conexão com Evolution API
   * 
   * @returns {Promise<Object>} Status da conexão
   */
  async testConnection() {
    try {
      controllerLogger.info('Testing Evolution API connection');

      // Tentar obter instâncias (endpoint que não requer instance_name)
      const response = await this.evolutionService.client.get('/instance/fetchInstances');

      return {
        success: true,
        message: 'Evolution API connection successful',
        data: {
          instancesCount: response.data?.length || 0,
          apiURL: this.evolutionService.baseURL
        }
      };

    } catch (error) {
      controllerLogger.error('Evolution API connection test failed:', error);
      return {
        success: false,
        message: 'Evolution API connection failed',
        error: error.message
      };
    }
  }
}

module.exports = SessionController;
