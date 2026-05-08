/**
 * Supabase Service - Camada de persistência
 * Encapsula todas operações com Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const { supabase: config } = require('../config');
const { supabaseLogger } = require('../utils/logger');

class SupabaseService {
  constructor() {
    this.client = createClient(config.url, config.serviceRoleKey, config.options);
  }

  /**
   * Testar conexão com Supabase
   */
  async testConnection() {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .select('count')
        .limit(1);

      if (error) throw error;

      supabaseLogger.info('Supabase connection test successful');
      return true;
    } catch (error) {
      supabaseLogger.error('Supabase connection test failed:', error);
      throw error;
    }
  }

  /**
   * Salvar/atualizar sessão WhatsApp
   * 
   * @param {string} storeId - ID do restaurante
   * @param {Object} sessionData - Dados da sessão
   * @returns {Promise<Object>} Sessão salva
   */
  async saveSession(storeId, sessionData) {
    try {
      const instanceName = `store_${storeId}`;

      const payload = {
        store_id: storeId,
        instance_name: instanceName,
        connection_status: sessionData.status || 'disconnected',
        phone: sessionData.phone || null,
        profile_name: sessionData.profileName || null,
        qr_code: sessionData.qr || null,
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .upsert(payload, {
          onConflict: 'store_id',
          returning: 'representation'
        })
        .select()
        .single();

      if (error) throw error;

      supabaseLogger.info(`Session saved for store ${storeId}`, {
        instanceName,
        status: payload.connection_status
      });

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to save session for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Obter sessão por store_id
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object|null>} Dados da sessão
   */
  async getSession(storeId) {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .select('*')
        .eq('store_id', storeId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        throw error;
      }

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to get session for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Obter sessão por instance_name
   * 
   * @param {string} instanceName - Nome da instância
   * @returns {Promise<Object|null>} Dados da sessão
   */
  async getSessionByInstance(instanceName) {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .select('*')
        .eq('instance_name', instanceName)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to get session by instance ${instanceName}:`, error);
      throw error;
    }
  }

  /**
   * Atualizar status da conexão
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} status - Novo status
   * @param {Object} additionalData - Dados adicionais
   * @returns {Promise<Object>} Sessão atualizada
   */
  async updateConnectionStatus(storeId, status, additionalData = {}) {
    try {
      const payload = {
        connection_status: status,
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...additionalData
      };

      // Limpar QR quando conectar
      if (status === 'connected') {
        payload.qr_code = null;
      }

      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .update(payload)
        .eq('store_id', storeId)
        .select()
        .single();

      if (error) throw error;

      supabaseLogger.info(`Connection status updated for store ${storeId}`, {
        status,
        additionalData: Object.keys(additionalData)
      });

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to update connection status for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Atualizar QR Code
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} qrCode - QR Code em base64
   * @returns {Promise<Object>} Sessão atualizada
   */
  async updateQRCode(storeId, qrCode) {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .update({
          qr_code: qrCode,
          connection_status: 'qr',
          last_activity: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('store_id', storeId)
        .select()
        .single();

      if (error) throw error;

      supabaseLogger.info(`QR Code updated for store ${storeId}`);
      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to update QR Code for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Limpar QR Code (quando conecta)
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object>} Sessão atualizada
   */
  async clearQRCode(storeId) {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .update({
          qr_code: null,
          last_activity: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('store_id', storeId)
        .select()
        .single();

      if (error) throw error;

      supabaseLogger.info(`QR Code cleared for store ${storeId}`);
      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to clear QR Code for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Deletar sessão
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async deleteSession(storeId) {
    try {
      const { error } = await this.client
        .from('whatsapp_sessions')
        .delete()
        .eq('store_id', storeId);

      if (error) throw error;

      supabaseLogger.info(`Session deleted for store ${storeId}`);
      return true;
    } catch (error) {
      supabaseLogger.error(`Failed to delete session for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Listar todas as sessões
   * 
   * @returns {Promise<Array>} Lista de sessões
   */
  async getAllSessions() {
    try {
      const { data, error } = await this.client
        .from('whatsapp_sessions')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      supabaseLogger.error('Failed to get all sessions:', error);
      throw error;
    }
  }

  /**
   * Salvar configuração de auto-resposta
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} messageText - Texto da mensagem
   * @param {boolean} isActive - Se está ativo
   * @returns {Promise<Object>} Configuração salva
   */
  async saveAutoReplyConfig(storeId, messageText, isActive = true) {
    try {
      const payload = {
        store_id: storeId,
        message_text: messageText,
        is_active: isActive,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.client
        .from('whatsapp_auto_messages')
        .upsert(payload, {
          onConflict: 'store_id',
          returning: 'representation'
        })
        .select()
        .single();

      if (error) throw error;

      supabaseLogger.info(`Auto-reply config saved for store ${storeId}`, {
        isActive,
        messageLength: messageText.length
      });

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to save auto-reply config for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Obter configuração de auto-resposta
   * 
   * @param {string} storeId - ID do restaurante
   * @returns {Promise<Object|null>} Configuração
   */
  async getAutoReplyConfig(storeId) {
    try {
      const { data, error } = await this.client
        .from('whatsapp_auto_messages')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      supabaseLogger.error(`Failed to get auto-reply config for store ${storeId}:`, error);
      throw error;
    }
  }

  /**
   * Salvar log de mensagem
   * 
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} Log salvo
   */
  async logMessage(messageData) {
    try {
      const payload = {
        store_id: messageData.storeId,
        instance_name: messageData.instanceName,
        message_id: messageData.messageId,
        remote_jid: messageData.remoteJid,
        message_type: messageData.messageType || 'text',
        message_content: messageData.messageContent,
        direction: messageData.direction, // 'in' ou 'out'
        timestamp: messageData.timestamp || new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      const { data, error } = await this.client
        .from('whatsapp_message_logs')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      supabaseLogger.error('Failed to log message:', error);
      // Não lançar erro para não interromper fluxo principal
      return null;
    }
  }

  /**
   * Verificar cooldown de mensagens
   * 
   * @param {string} storeId - ID do restaurante
   * @param {string} remoteJid - ID do remetente
   * @param {number} cooldownHours - Horas de cooldown
   * @returns {Promise<boolean>} Se está em cooldown
   */
  async isInCooldown(storeId, remoteJid, cooldownHours = 1) {
    try {
      const cooldownTime = new Date(Date.now() - (cooldownHours * 60 * 60 * 1000));

      const { data, error } = await this.client
        .from('whatsapp_message_logs')
        .select('timestamp')
        .eq('store_id', storeId)
        .eq('remote_jid', remoteJid)
        .eq('direction', 'out')
        .gte('timestamp', cooldownTime.toISOString())
        .order('timestamp', { ascending: false })
        .limit(1);

      if (error) throw error;

      return data && data.length > 0;
    } catch (error) {
      supabaseLogger.error(`Failed to check cooldown for store ${storeId}:`, error);
      // Em caso de erro, retornar false para não bloquear
      return false;
    }
  }

  /**
   * Limpar logs antigos
   * 
   * @param {number} daysToKeep - Dias para manter
   * @returns {Promise<number>} Quantidade de registros removidos
   */
  async cleanOldLogs(daysToKeep = 30) {
    try {
      const cutoffDate = new Date(Date.now() - (daysToKeep * 24 * 60 * 60 * 1000));

      const { data, error } = await this.client
        .from('whatsapp_message_logs')
        .delete()
        .lt('timestamp', cutoffDate.toISOString())
        .select('count');

      if (error) throw error;

      const deletedCount = data?.length || 0;
      supabaseLogger.info(`Cleaned ${deletedCount} old message logs`);

      return deletedCount;
    } catch (error) {
      supabaseLogger.error('Failed to clean old logs:', error);
      throw error;
    }
  }
}

module.exports = SupabaseService;
