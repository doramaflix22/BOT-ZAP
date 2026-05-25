/**
 * Sessions Routes - Rotas de Gerenciamento de Sessões WhatsApp
 * Endpoints para conectar, desconectar, verificar status e obter QR code
 */

const express = require('express');
const SessionController = require('../controllers/sessionController');
const SupabaseService = require('../services/supabaseService');
const { controllerLogger } = require('../utils/logger');

const router = express.Router();
const sessionController = new SessionController();
const supabaseService = new SupabaseService();

// Middleware de autenticação por API Secret
const requireApiSecret = (req, res, next) => {
  const secret = process.env.BOT_API_SECRET;
  if (!secret) return next(); // sem secret configurado, permite tudo (dev)
  const provided = req.headers['x-api-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'INVALID_SECRET' });
  }
  next();
};

// Middleware para logging de requisições
router.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  controllerLogger.info(`${req.method} ${req.path} - IP: ${clientIp}`);
  next();
});

/**
 * POST /api/sessions/connect/:storeId
 * Conectar WhatsApp para um restaurante
 */
router.post('/connect/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { phoneNumber } = req.body;
    
    // Logging específico com storeId disponível
    controllerLogger.info(`POST /connect/${storeId} - Store: ${storeId}, Phone: ${phoneNumber}`);

    // Validação do storeId
    if (!storeId || typeof storeId !== 'string' || storeId.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Invalid store ID format',
        code: 'INVALID_STORE_ID'
      });
    }

    // Validação do phoneNumber
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required in request body',
        code: 'MISSING_PHONE_NUMBER'
      });
    }

    const result = await sessionController.connect(storeId, phoneNumber);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Connect session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to connect WhatsApp',
      code: 'CONNECT_ERROR'
    });
  }
});

/**
 * GET /api/sessions/status/:storeId
 * Obter status da conexão WhatsApp
 */
router.get('/status/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required',
        code: 'MISSING_STORE_ID'
      });
    }

    const result = await sessionController.getStatus(storeId);

    res.status(200).json({
      success: true,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Get status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get status',
      code: 'STATUS_ERROR'
    });
  }
});

/**
 * GET /api/sessions/qr/:storeId
 * Obter QR Code para conexão
 */
router.get('/qr/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required',
        code: 'MISSING_STORE_ID'
      });
    }

    const result = await sessionController.getQRCode(storeId);

    res.status(200).json({
      success: true,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Get QR code error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get QR code',
      code: 'QR_ERROR'
    });
  }
});

/**
 * POST /api/sessions/disconnect/:storeId
 * Desconectar WhatsApp
 */
router.post('/disconnect/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required',
        code: 'MISSING_STORE_ID'
      });
    }

    const result = await sessionController.disconnect(storeId);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Disconnect session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect WhatsApp',
      code: 'DISCONNECT_ERROR'
    });
  }
});

/**
 * DELETE /api/sessions/:storeId
 * Deletar sessão completamente
 */
router.delete('/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required',
        code: 'MISSING_STORE_ID'
      });
    }

    const result = await sessionController.deleteSession(storeId);

    res.status(200).json({
      success: true,
      message: result.message
    });

  } catch (error) {
    controllerLogger.error('Delete session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete session',
      code: 'DELETE_ERROR'
    });
  }
});

/**
 * POST /api/sessions/reconnect/:storeId
 * Reconectar WhatsApp
 */
router.post('/reconnect/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required',
        code: 'MISSING_STORE_ID'
      });
    }

    const result = await sessionController.reconnect(storeId);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Reconnect session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to reconnect WhatsApp',
      code: 'RECONNECT_ERROR'
    });
  }
});

/**
 * GET /api/sessions
 * Listar todas as sessões
 */
router.get('/', async (req, res) => {
  try {
    const result = await sessionController.getAllSessions();

    res.status(200).json({
      success: true,
      data: result.data
    });

  } catch (error) {
    controllerLogger.error('Get all sessions error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get sessions',
      code: 'LIST_ERROR'
    });
  }
});

/**
 * GET /api/sessions/test-connection
 * Testar conexão com Evolution API
 */
router.get('/test-connection', async (req, res) => {
  try {
    const result = await sessionController.testConnection();

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(503).json(result);
    }

  } catch (error) {
    controllerLogger.error('Test connection error:', error);
    res.status(503).json({
      success: false,
      error: error.message || 'Connection test failed',
      code: 'CONNECTION_TEST_ERROR'
    });
  }
});

/**
 * POST /api/sessions/auto-reply/:storeId
 * Salvar/atualizar configuração de auto-resposta
 * Chamado pelo frontend quando o usuário define a mensagem automática
 */
router.post('/auto-reply/:storeId', requireApiSecret, async (req, res) => {
  try {
    const { storeId } = req.params;
    const { messageText, isActive = true, cooldownHours } = req.body;

    if (!storeId) {
      return res.status(400).json({ success: false, error: 'Store ID is required', code: 'MISSING_STORE_ID' });
    }

    if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'messageText is required', code: 'MISSING_MESSAGE_TEXT' });
    }

    const data = await supabaseService.saveAutoReplyConfig(
      storeId,
      messageText.trim(),
      isActive,
      cooldownHours ?? null
    );

    controllerLogger.info(`Auto-reply config saved for store ${storeId}`);

    res.status(200).json({
      success: true,
      message: 'Auto-reply config saved successfully',
      data
    });

  } catch (error) {
    controllerLogger.error('Save auto-reply config error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save auto-reply config',
      code: 'AUTO_REPLY_SAVE_ERROR'
    });
  }
});

/**
 * GET /api/sessions/auto-reply/:storeId
 * Obter configuração de auto-resposta atual
 */
router.get('/auto-reply/:storeId', requireApiSecret, async (req, res) => {
  try {
    const { storeId } = req.params;

    if (!storeId) {
      return res.status(400).json({ success: false, error: 'Store ID is required', code: 'MISSING_STORE_ID' });
    }

    const data = await supabaseService.getAutoReplyConfig(storeId);

    res.status(200).json({
      success: true,
      data: data || null
    });

  } catch (error) {
    controllerLogger.error('Get auto-reply config error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get auto-reply config',
      code: 'AUTO_REPLY_GET_ERROR'
    });
  }
});

module.exports = router;
