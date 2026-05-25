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
   * Debug profundo de instância Evolution
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object>} Diagnóstico completo
   */
  async debugInstance(instanceName) {
    console.log('🧪 DEBUG START:', instanceName);

    try {
      const info = await this.evolutionService.getInstanceInfo(instanceName);

      console.log('📡 GET INFO RESULT:', JSON.stringify(info, null, 2));

      return {
        exists: true,
        status: info?.status,
        raw: info
      };

    } catch (err) {
      console.log('❌ GET INFO FAILED:', {
        message: err.message,
        status: err?.response?.status,
        data: err?.response?.data
      });

      if (err?.response?.status === 404) {
        return { exists: false, reason: 'NOT_FOUND' };
      }

      return { exists: null, reason: 'UNKNOWN_ERROR', error: err };
    }
  }

  /**
   * Conectar WhatsApp para um restaurante
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} phoneNumber - Número de telefone para WhatsApp
   * @returns {Promise<Object>} Resultado da conexão
   */
  async connect(storeId, phoneNumber = null) {
    const connectStart = Date.now();
    const connectId = `${storeId}_${connectStart}`;
    
    try {
      console.log('\n�🚨🚨 CONNECT STARTED 🚨🚨🚨');
      console.log('Connect ID:', connectId);
      console.log('Timestamp:', new Date().toISOString());
      console.log('Timestamp MS:', connectStart);
      console.log('Instance:', `store_${storeId}`);
      console.log('Store:', storeId);
      console.log('Phone:', phoneNumber);
      console.log('========================\n');

      controllerLogger.info(`Starting WhatsApp connection for store: ${storeId}`);

      // 🛡️ TRAVA ANTI-DUPLICAÇÃO MELHORADA - Verificação mais robusta
      console.log('🔒 CHECKING CONNECTION LOCK...');
      const existingSession = await this.supabaseService.getSession(storeId);

      // 🛡️ VERIFICAÇÃO MULTICAMADA: status + QR + atividade recente
      const isConnecting = existingSession?.connection_status === 'connecting';
      const hasRecentQR = existingSession?.qr_code && existingSession.last_activity;
      const lastActivity = existingSession?.last_activity ? new Date(existingSession.last_activity).getTime() : 0;
      const lockAge = Date.now() - lastActivity;
      const lockTimeout = 2 * 60 * 1000; // 2 minutos

      // 🛡️ BLOQUEAR SE: estiver conectando E (tiver QR recente OU atividade muito recente)
      if (isConnecting && (hasRecentQR || lockAge < 30000)) {
        // Se tiver QR ou atividade nos últimos 30s, bloquear
        if (lockAge < lockTimeout) {
          console.log('⚠️ CONNECTION ALREADY IN PROGRESS - ABORTING');
          console.log('Lock details:', {
            status: existingSession.connection_status,
            hasQR: !!existingSession.qr_code,
            lockAge: lockAge,
            lockTimeout: lockTimeout
          });
          return {
            success: false,
            message: 'Connection already in progress',
            code: 'CONNECTION_IN_PROGRESS',
            lockAge: lockAge
          };
        } else {
          console.log('⚠️ CONNECTION LOCK EXPIRED (lock age:', lockAge, 'ms) - PROCEEDING');
        }
      }
      
      // 🛡️ MARCAR COMO "connecting" ANTES DE TUDO (respeita constraint do banco)
      console.log('🔒 SETTING CONNECTION LOCK...');
      await this.supabaseService.updateConnectionStatus(storeId, 'connecting');
      console.log('✅ CONNECTION LOCK SET');

      // Validar storeId
      if (!storeId || typeof storeId !== 'string' || storeId.length < 3) {
        // Liberar lock em caso de erro
        await this.supabaseService.updateConnectionStatus(storeId, 'error');
        throw new Error('Invalid store ID format');
      }

      // Validar phoneNumber (obrigatório para nova instância)
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new Error('Phone number is required to connect WhatsApp');
      }

      // Limpar phoneNumber (remover caracteres não numéricos, exceto +)
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
      if (!cleanPhone || cleanPhone.length < 10) {
        throw new Error('Invalid phone number format');
      }

      const instanceName = `store_${storeId}`;

      // 🔥 NOVA REGRA DE DECISÃO - getInstanceInfo como fonte principal
      console.log('🔍 STEP 1 - INSTANCE EXISTENCE CHECK (getInstanceInfo primary)');
      const existenceResult = await this.evolutionService.instanceExists(instanceName);
      
      let connectionState = null;
      if (existenceResult.exists) {
        console.log('📡 STEP 2 - GETTING CONNECTION STATE');
        try {
          connectionState = await this.evolutionService.getConnectionState(instanceName);
          console.log('🔌 CONNECTION STATE:', connectionState.status);
        } catch (err) {
          console.log('⚠️ Failed to get connection state:', err.message);
          connectionState = { status: 'unknown', connected: false };
        }
      }

      //  CASO 1: NÃO EXISTE (SÓ CRIA SE canCreate = true)
      if (!existenceResult.exists) {
        // 🛡️ REGRA OBRIGATÓRIA: Só criar se canCreate for true
        if (existenceResult.canCreate) {
          console.log('\n🚨 CREATE INSTANCE TRIGGERED');
          console.log({
            exists: existenceResult.exists,
            canCreate: existenceResult.canCreate,
            source: existenceResult.source
          });
          
          console.log('🔴 INSTANCE CONFIRMED SAFE TO CREATE - CREATING NEW ONE');
          console.log('📋 Creation authority:', existenceResult.source);
          try {
            // 🛡️ FLUXO CORRETO: CREATE → CONNECT → GET QR
            console.log('📱 CREATING INSTANCE WITH PHONE:', cleanPhone);
            const instanceResult = await this.evolutionService.createInstance(storeId, cleanPhone);
            console.log('🚀 CREATE SUCCESS:', instanceResult);
            
            if (!instanceResult.success) {
              throw new Error('Failed to create Evolution instance');
            }

            // 💾 CRIAR SESSÃO NO BANCO IMEDIATAMENTE APÓS CRIAÇÃO
            // 🛡️ FIX: Usar createSession em vez de saveSession para criar sessão apenas uma vez
            console.log('💾 CREATING SESSION IN DATABASE AFTER CREATION...');
            await this.supabaseService.createSession(storeId, instanceName);
            console.log('✅ SESSION CREATED IN DATABASE');

            // �️ EVOLUTION API v2 GERA QR AUTOMATICAMENTE
            // Não precisa mais chamar connectInstance - endpoint não existe mais
            console.log('🔌 QR WILL ARRIVE VIA WEBHOOK (automatic)');
            console.log('✅ INSTANCE CREATED - waiting for webhook');
            
            const connectEnd = Date.now();
            const duration = connectEnd - connectStart;
            
            console.log('\n✅✅✅ CONNECT SUCCESS ✅✅✅');
            console.log('Connect ID:', connectId);
            console.log('Duration:', `${duration}ms`);
            console.log('Instance:', instanceName);
            console.log('✅✅✅ END CONNECT SUCCESS ✅✅✅\n');
            
            return {
              success: true,
              status: 'connecting',
              message: 'New instance created and connected - QR will arrive via webhook',
              data: {
                instanceName,
                connectionStatus: 'connecting'
              }
            };
          } catch (err) {
            console.log('💥 CREATE FAILED:', {
              message: err.message,
              response: err?.response?.data,
              status: err?.response?.status
            });
            throw err;
          }
        } else {
          console.log('⚠️ INSTANCE CREATION NOT AUTHORIZED - AVOIDING DUPLICATES');
          console.log('📋 Rejection reason:', existenceResult.source);
          throw new Error(`Instance creation not authorized (source: ${existenceResult.source}). Cannot create safely.`);
        }
      }

      // 🟢 CASO 2: EXISTE E JÁ CONECTADO
      if (connectionState && connectionState.connected) {
        console.log('🟢 INSTANCE EXISTS AND CONNECTED');
        
        // 🛡️ CRÍTICO: Atualizar banco quando detectar conexão via polling
        // Isso garante sincronização entre Evolution API e banco de dados
        console.log('💾 UPDATING DATABASE WITH CONNECTED STATUS (polling detection)');
        try {
          await this.supabaseService.client
            .from('whatsapp_sessions')
            .update({
              connection_status: 'connected',
              qr_code: null,
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('store_id', storeId);
          
          console.log('✅ DATABASE UPDATED WITH CONNECTED STATUS');
        } catch (dbError) {
          console.error('❌ FAILED TO UPDATE DATABASE:', dbError);
          // Continuar mesmo se falhar - não bloquear o fluxo
        }
        
        return {
          success: true,
          status: 'already_connected',
          message: 'WhatsApp already connected',
          data: {
            instanceName,
            connectionStatus: 'connected',
            phone: connectionState.phone,
            profileName: connectionState.profileName
          }
        };
      }

      // 🟡 CASO 3: EXISTE MAS NÃO CONECTADO (REUTILIZAR - NUNCA CRIAR NOVA)
      if (connectionState && !connectionState.connected) {
        console.log('🟡 INSTANCE EXISTS BUT NOT CONNECTED - REUSING EXISTING INSTANCE');

        // 🛡️ OBTER PHONE DO BANCO (preservar dados existentes)
        const existingSession = await this.supabaseService.getSession(storeId);
        const savedPhone = existingSession?.phone;

        console.log('📋 Session info:', {
          savedPhone: savedPhone ? '***' + savedPhone.slice(-4) : null,
          rawState: connectionState.rawState,
          status: connectionState.status
        });

        // 🔥 FORÇAR GERAÇÃO DE NOVO QR NA INSTÂNCIA EXISTENTE
        // Chama GET /instance/connect/{instance} para disparar QR na Evolution
        // Isso vale para qualquer estado: close, 401, device_removed, etc.
        console.log('♻️ Triggering new QR on existing instance (no new instance created)');

        try {
          const qrResult = await this.evolutionService.getQRCode(instanceName);
          console.log('🔌 QR REQUEST sent to Evolution:', { type: qrResult.type });

          // Se QR retornou diretamente na resposta, salvar no banco imediatamente
          if (qrResult.base64 || qrResult.code) {
            const qrCode = qrResult.base64 || qrResult.code;
            console.log('💾 SAVING DIRECT QR TO DATABASE...');
            await this.supabaseService.client
              .from('whatsapp_sessions')
              .update({
                qr_code: qrCode,
                connection_status: 'connecting',
                last_activity: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('store_id', storeId);
            console.log('✅ DIRECT QR SAVED TO DATABASE');
          } else {
            console.log('🔌 QR will arrive via QRCODE_UPDATED webhook');
          }
        } catch (qrError) {
          console.log('⚠️ QR generation request failed (webhook may still deliver it):', qrError.message);
        }

        return {
          success: true,
          status: 'connecting',
          message: 'Reconnecting existing instance - QR generating',
          data: {
            instanceName,
            connectionStatus: 'connecting',
            phone: savedPhone
          }
        };
      }

      // ❌ CASO 4: EXISTE MAS ESTADO DESCONHECIDO - tentar gerar QR mesmo assim
      console.log('❌ INSTANCE EXISTS BUT STATE UNKNOWN - ATTEMPTING QR RECOVERY');
      try {
        const qrResult = await this.evolutionService.getQRCode(instanceName);
        console.log('🔌 QR RECOVERY sent:', { type: qrResult.type });

        if (qrResult.base64 || qrResult.code) {
          const qrCode = qrResult.base64 || qrResult.code;
          await this.supabaseService.client
            .from('whatsapp_sessions')
            .update({
              qr_code: qrCode,
              connection_status: 'connecting',
              last_activity: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('store_id', storeId);
        }

        return {
          success: true,
          status: 'connecting',
          message: 'Attempting recovery - QR generating',
          data: {
            instanceName,
            connectionStatus: 'connecting'
          }
        };
      } catch (recoveryError) {
        console.log('⚠️ QR recovery request failed:', recoveryError.message);
        return {
          success: true,
          status: 'connecting',
          message: 'Attempting recovery - QR will arrive via webhook',
          data: { instanceName, connectionStatus: 'connecting' }
        };
      }

      throw new Error('Unexpected instance state');

    } catch (error) {
      const connectEnd = Date.now();
      const duration = connectEnd - connectStart;
      
      console.log('\n💥💥💥 CONNECT FAILED 💥💥💥');
      console.log('Connect ID:', connectId);
      console.log('Duration:', `${duration}ms`);
      console.log('Error:', error.message);
      console.log('💥💥💥 END CONNECT FAILED 💥💥💥\n');
      
      controllerLogger.error(`Failed to connect WhatsApp for store ${storeId}:`, error);
      
      // 🛡️ LIBERAR LOCK EM CASO DE ERRO
      try {
        await this.supabaseService.updateConnectionStatus(storeId, 'disconnected'); // 🛡️ STATUS VÁLIDO
        console.log('🔓 CONNECTION LOCK RELEASED (ERROR)');
      } catch (lockError) {
        console.error('Failed to release connection lock:', lockError);
      }
      
      throw error;
    }
  }

  /**
   * Sincronizar banco de dados com a realidade da Evolution API
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} instanceName - Nome da instância
   * @param {Object} connectionState - Dados reais da Evolution (connectionState)
   */
  async syncDatabaseWithEvolution(storeId, instanceName, connectionState) {
    try {
      let status = 'unknown';
      let isConnected = false;
      let phone = null;
      let profileName = null;

      if (!connectionState) {
        status = 'disconnected'; // 🛡️ STATUS VÁLIDO
      } else if (connectionState.connected) {
        status = 'connected';
        isConnected = true;
        // connectionState pode não ter phone/profileName, então tentamos getInstanceInfo
        try {
          const instanceInfo = await this.evolutionService.getInstanceInfo(instanceName);
          phone = instanceInfo.phone;
          profileName = instanceInfo.owner;
        } catch (err) {
          console.log('⚠️ Could not get instance details:', err.message);
        }
      } else {
        status = 'disconnected';
      }

      // 🛡️ PRESERVAR PHONE EXISTENTE - não sobrescrever com null
      const updateData = {
        profile_name: profileName,
        is_connected: isConnected
      };
      
      // Só atualizar phone se tiver valor (não null)
      if (phone) {
        updateData.phone = phone;
      }

      await this.supabaseService.updateConnectionStatus(storeId, status, updateData);

      console.log('✅ Database synced with Evolution reality:', {
        storeId,
        status,
        isConnected,
        phone: phone ? '***' + phone.slice(-4) : 'preserved'
      });

    } catch (error) {
      console.log('⚠️ Failed to sync database with Evolution:', error.message);
      // Não falhar a conexão se sincronização falhar
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
            status: 'disconnected',  // 🛡️ CORRIGIDO: status válido em vez de 'not_found'
            phone: null,
            profileName: null,
            qr: null
          }
        };
      }

      // 🛡️ CRÍTICO: Sempre verificar status real na Evolution API
      // Isso garante sincronização mesmo quando banco está desatualizado
      try {
        const instanceName = `store_${storeId}`;
        const evolutionStatus = await this.evolutionService.getConnectionState(instanceName);

        // 🛡️ MAPEAR STATUS EVOLUTION PARA STATUS DO BANCO antes de comparar
        const mappedEvolutionStatus = this.evolutionService.mapConnectionStatus(evolutionStatus.rawState);

        // Se status divergir, atualizar banco
        if (mappedEvolutionStatus !== session.connection_status) {
          console.log(`🔄 STATUS DIVERGENCE DETECTED - Bank: ${session.connection_status}, Evolution: ${mappedEvolutionStatus}`);
          console.log('💾 UPDATING DATABASE TO MATCH EVOLUTION STATUS');
          
          await this.supabaseService.updateConnectionStatus(
            storeId,
            mappedEvolutionStatus
          );

          session.connection_status = mappedEvolutionStatus;
          
          // 🛡️ Se conectou, limpar QR
          if (mappedEvolutionStatus === 'connected') {
            await this.supabaseService.client
              .from('whatsapp_sessions')
              .update({ qr_code: null })
              .eq('store_id', storeId);
            session.qr_code = null;
          }
          
          console.log('✅ DATABASE SYNCED WITH EVOLUTION STATUS');
        }
      } catch (error) {
        controllerLogger.warn(`Failed to verify Evolution status for store ${storeId}:`, error);
        // Manter status do banco se falhar verificação
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
      console.log('\n📱 GETTING QR CODE FROM DATABASE');
      console.log('Store ID:', storeId);
      
      controllerLogger.debug(`Getting QR code for store: ${storeId}`);

      const session = await this.supabaseService.getSession(storeId);
      
      console.log('📋 SESSION FROM DATABASE:');
      console.log('Session exists:', !!session);
      console.log('Connection Status:', session?.connection_status);
      console.log('QR Code exists:', !!session?.qr_code);
      console.log('QR Length:', session?.qr_code?.length || 0);

      if (!session) {
        console.log('❌ NO SESSION FOUND');
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
        console.log('✅ ALREADY CONNECTED - NO QR');
        return {
          success: true,
          data: {
            qr: null,
            message: 'Already connected'
          }
        };
      }

      // Se tiver QR no banco, SÓ RETORNAR se status for 'connecting'
      // Isso previne QR morto sendo retornado quando desconectado
      if (session.qr_code) {
        console.log('✅ QR FOUND IN DATABASE');
        console.log('QR Length:', session.qr_code.length);
        console.log('Connection Status:', session.connection_status);

        // 🛡️ SÓ RETORNAR QR SE ESTIVER EM ESTADO DE CONEXÃO VÁLIDO
        if (session.connection_status === 'connecting') {
          return {
            success: true,
            data: {
              qr: session.qr_code,
              status: session.connection_status
            }
          };
        } else {
          // 🛡️ QR EXISTE MAS STATUS NÃO É VÁLIDO - LIMPAR E NÃO RETORNAR
          console.log('⚠️ QR EXISTS BUT STATUS IS NOT CONNECTING - CLEARING QR');
          await this.supabaseService.clearQRCode(storeId);
          return {
            success: true,
            data: {
              qr: null,
              status: session.connection_status,
              message: 'QR expired - wait for new QR via webhook'
            }
          };
        }
      }

      return {
        success: true,
        data: {
          qr: null,
          status: session.connection_status,
          message: 'QR not available yet - wait for webhook'
        }
      };

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

      // 🛡️ OBTER PHONE SALVO NO BANCO (obrigatório para connect)
      const session = await this.supabaseService.getSession(storeId);
      const savedPhone = session?.phone;

      if (!savedPhone) {
        throw new Error('Phone number not found in database - cannot reconnect');
      }

      // Primeiro desconectar
      await this.disconnect(storeId);

      // Aguardar um pouco
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Conectar novamente com phone salvo
      return await this.connect(storeId, savedPhone);

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
