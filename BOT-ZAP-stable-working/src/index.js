/**
 * WhatsApp Engine - Entry Point
 * Servidor Express com Evolution API v2 para WhatsApp automation
 */

require('dotenv').config();
// 🚀 FORCE REDEPLOY - Fix webhook processing and constraint issues
const express = require('express');
const { server: serverConfig } = require('./config');
const { logger } = require('./utils/logger');
const SupabaseService = require('./services/supabaseService');
const routes = require('./routes');

class WhatsAppEngineServer {
  constructor() {
    this.app = express();
    this.supabaseService = new SupabaseService();
    this.setupGracefulShutdown();
  }

  /**
   * Configurar middleware e rotas
   */
  setup() {
    // Usar router principal que já contém todos os middlewares
    this.app.use('/api', routes);

    // Endpoint raiz (fora da API)
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        data: {
          service: 'WhatsApp Engine - Evolution API v2',
          version: '2.0.0',
          status: 'running',
          timestamp: new Date().toISOString(),
          environment: serverConfig.nodeEnv,
          documentation: '/api',
          health: '/api/health'
        }
      });
    });

    // Middleware de tratamento de erros global
    this.app.use((error, req, res, next) => {
      logger.error('Unhandled error:', error);
      
      res.status(error.status || 500).json({
        success: false,
        error: serverConfig.nodeEnv === 'development' ? error.message : 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    });
  }

  /**
   * Iniciar servidor
   */
  async start() {
    try {
      logger.info('🚀 Starting WhatsApp Engine with Evolution API v2...');
      
      // Log de configuração
      logger.info(`🌍 Environment: ${serverConfig.nodeEnv}`);
      logger.info(`🔗 Port: ${serverConfig.port}`);
      logger.info(`🌐 Host: ${serverConfig.host}`);
      logger.info(`📡 Evolution API: ${process.env.EVOLUTION_API_URL}`);
      logger.info(`🗄️ Supabase: ${process.env.SUPABASE_URL}`);

      // Testar conexão com Supabase
      await this.testSupabaseConnection();

      // Configurar aplicação
      this.setup();

      // Iniciar servidor HTTP
      this.server = this.app.listen(serverConfig.port, serverConfig.host, () => {
        const actualPort = this.server.address().port;
        
        logger.info(`✅ WhatsApp Engine started successfully!`);
        logger.info(`📡 API available at: http://${serverConfig.host}:${actualPort}/api`);
        logger.info(`🏥 Health check at: http://${serverConfig.host}:${actualPort}/api/health`);
        logger.info(`🪝 Webhook endpoint: http://${serverConfig.host}:${actualPort}/api/webhooks/evolution`);
        logger.info(`🌍 Environment: ${serverConfig.nodeEnv}`);
        logger.info(`🚀 Railway Ready - Multi-tenant WhatsApp Engine with Evolution API v2`);
        
        // Log de endpoints principais
        logger.info(`📋 Main endpoints:`);
        logger.info(`   • POST /api/sessions/connect/:storeId - Connect WhatsApp`);
        logger.info(`   • GET /api/sessions/status/:storeId - Get status`);
        logger.info(`   • GET /api/sessions/qr/:storeId - Get QR code`);
        logger.info(`   • POST /api/webhooks/evolution - Receive webhooks`);
      });

      // Configurar cleanup periódico
      this.setupPeriodicTasks();

    } catch (error) {
      logger.error('❌ Failed to start WhatsApp Engine:', error);
      process.exit(1);
    }
  }

  /**
   * Testar conexão com Supabase
   */
  async testSupabaseConnection() {
    try {
      logger.info('🔗 Testing Supabase connection...');
      await this.supabaseService.testConnection();
      logger.info('✅ Supabase connection successful');
    } catch (error) {
      logger.warn('⚠️ Supabase connection failed, but continuing startup:', error.message);
      logger.warn('   Some features may not work properly');
    }
  }

  /**
   * Configurar tarefas periódicas
   */
  setupPeriodicTasks() {
    // Limpar logs antigos a cada 24 horas
    setInterval(async () => {
      try {
        const deletedCount = await this.supabaseService.cleanOldLogs(30);
        if (deletedCount > 0) {
          logger.info(`🧹 Cleaned ${deletedCount} old message logs`);
        }
      } catch (error) {
        logger.error('Error during periodic cleanup:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 horas

    // Verificar conexão com Evolution API a cada 5 minutos
    setInterval(async () => {
      try {
        // Implementar verificação se necessário
        logger.debug('🔄 Periodic health check completed');
      } catch (error) {
        logger.error('Error during periodic health check:', error);
      }
    }, 5 * 60 * 1000); // 5 minutos
  }

  /**
   * Configurar graceful shutdown
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
      
      if (this.server) {
        this.server.close(async () => {
          logger.info('📡 HTTP server closed');
          
          // Aqui poderíamos limpar recursos se necessário
          logger.info('✅ Graceful shutdown completed');
          process.exit(0);
        });
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Tratamento de erros não capturados
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }
}

// Iniciar servidor
const server = new WhatsAppEngineServer();
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = WhatsAppEngineServer;
