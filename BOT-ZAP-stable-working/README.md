# WhatsApp Engine - Evolution API v2

Sistema WhatsApp multi-tenant com Evolution API v2 para SaaS. Substituição estável do Baileys com arquitetura profissional e mínimo impacto.

## 🚀 Funcionalidades

- ✅ **Multi-tenant**: Suporte para múltiplos restaurantes
- ✅ **QR Code**: Conexão via QR Code tradicional
- ✅ **Auto-resposta**: Sistema automático com cooldown anti-spam
- ✅ **Webhooks**: Processamento em tempo real de mensagens
- ✅ **Status em tempo real**: Monitoramento de conexão
- ✅ **Logs completos**: Auditoria de todas as mensagens
- ✅ **Segurança**: API keys protegidas, RLS Supabase

## 📋 Pré-requisitos

- Node.js >= 18.0.0
- Conta Evolution API v2
- Projeto Supabase
- Railway (ou outro deploy)

## 🛠️ Instalação

1. **Clone o repositório**
```bash
git clone <repositório>
cd whatsapp-engine
```

2. **Instale dependências**
```bash
npm install
```

3. **Configure variáveis de ambiente**
```bash
cp .env.example .env
# Edite .env com suas credenciais
```

4. **Configure o Supabase**
```sql
-- Execute as tabelas necessárias (ver seção Database)
```

5. **Inicie o servidor**
```bash
npm start
```

## ⚙️ Configuração

### Environment Variables

```env
# Evolution API
EVOLUTION_API_URL=https://api.evolution-api.com
EVOLUTION_API_KEY=sua_api_key
WEBHOOK_URL=https://seu-backend.railway.app/api/webhooks/evolution

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key

# Servidor
PORT=3001
NODE_ENV=production
```

## 🗄️ Database (Supabase)

### Tabelas Necessárias

```sql
-- Sessões WhatsApp
CREATE TABLE whatsapp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE,
  instance_name TEXT NOT NULL UNIQUE,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  phone TEXT,
  profile_name TEXT,
  qr_code TEXT,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Configurações Auto-resposta
CREATE TABLE whatsapp_auto_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE,
  message_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Logs de Mensagens
CREATE TABLE whatsapp_message_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT,
  direction TEXT NOT NULL, -- 'in' ou 'out'
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_whatsapp_sessions_store_id ON whatsapp_sessions(store_id);
CREATE INDEX idx_whatsapp_sessions_instance_name ON whatsapp_sessions(instance_name);
CREATE INDEX idx_whatsapp_sessions_status ON whatsapp_sessions(connection_status);
CREATE INDEX idx_whatsapp_message_logs_store_id ON whatsapp_message_logs(store_id);
CREATE INDEX idx_whatsapp_message_logs_remote_jid ON whatsapp_message_logs(remote_jid);
CREATE INDEX idx_whatsapp_message_logs_timestamp ON whatsapp_message_logs(timestamp);
```

### RLS (Row Level Security)

```sql
-- Habilitar RLS
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auto_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_logs ENABLE ROW LEVEL SECURITY;

-- Políticas (ajustar conforme sua arquitetura de autenticação)
CREATE POLICY "Users can view own sessions" ON whatsapp_sessions
  FOR SELECT USING (true);

CREATE POLICY "Service can manage all sessions" ON whatsapp_sessions
  FOR ALL USING (true);

CREATE POLICY "Service can manage all auto messages" ON whatsapp_auto_messages
  FOR ALL USING (true);

CREATE POLICY "Service can manage all message logs" ON whatsapp_message_logs
  FOR ALL USING (true);
```

## 📡 API Endpoints

### Sessões

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/sessions/connect/:storeId` | Conectar WhatsApp |
| GET | `/api/sessions/status/:storeId` | Verificar status |
| GET | `/api/sessions/qr/:storeId` | Obter QR Code |
| POST | `/api/sessions/disconnect/:storeId` | Desconectar |
| DELETE | `/api/sessions/:storeId` | Deletar sessão |
| POST | `/api/sessions/reconnect/:storeId` | Reconectar |
| GET | `/api/sessions` | Listar todas |

### Webhooks

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/webhooks/evolution` | Receber webhooks Evolution |
| GET | `/api/webhooks/health` | Health check |
| GET | `/api/webhooks/check/:instanceName` | Verificar configuração |

### Sistema

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/health` | Health check geral |
| GET | `/` | Informações da API |

## 🔄 Fluxo Completo

### 1. Conexão WhatsApp

```
Frontend → POST /api/sessions/connect/:storeId
    ↓
Backend → Evolution API: POST /instance/create
    ↓
Backend → Evolution API: GET /instance/connect/{instance}
    ↓
Backend → Supabase: Salvar QR Code
    ↓
Frontend ← QR Code (base64)
    ↓
Usuário escaneia QR
    ↓
Evolution → POST /api/webhooks/evolution (CONNECTION_UPDATE)
    ↓
Backend → Supabase: Atualizar status para "connected"
```

### 2. Mensagem Automática

```
Cliente → Mensagem WhatsApp
    ↓
Evolution → POST /api/webhooks/evolution (MESSAGES_UPSERT)
    ↓
Backend → Verificar cooldown
    ↓
Backend → Evolution API: POST /message/sendText/{instance}
    ↓
Cliente ← Resposta automática
```

## 🏗️ Arquitetura

```
src/
├── config/           # Configurações centralizadas
├── controllers/      # Camada de controle
├── routes/          # Definição de endpoints
├── services/        # Lógica de negócio
├── handlers/        # Processamento de eventos
├── utils/           # Funções utilitárias
├── middleware/      # Middleware Express
└── index.js         # Entry point
```

### Adapter Pattern

O sistema usa **Adapter Pattern** para permitir troca de API sem afetar o resto:

- **EvolutionService**: Interface com Evolution API
- **SessionController**: Orquestra fluxos
- **WebhookHandler**: Processa eventos
- **SupabaseService**: Persistência de dados

## 🚀 Deploy Railway

1. **Configure o Repository**
```bash
git add .
git commit -m "Migrate to Evolution API v2"
git push origin main
```

2. **Configure Environment Variables no Railway**
```
EVOLUTION_API_URL=https://api.evolution-api.com
EVOLUTION_API_KEY=sua_api_key
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
WEBHOOK_URL=https://seu-app.railway.app/api/webhooks/evolution
NODE_ENV=production
PORT=${PORT}
```

3. **Configure o Webhook na Evolution**
- URL: `https://seu-app.railway.app/api/webhooks/evolution`
- Eventos: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`

## 🔧 Desenvolvimento

### Rodar Localmente
```bash
NODE_ENV=development npm start
```

### Testar Webhook
```bash
curl -X POST http://localhost:3001/api/webhooks/test \
  -H "Content-Type: application/json" \
  -d '{"eventType": "MESSAGES_UPSERT", "instanceName": "store_test"}'
```

### Logs
```bash
# Ver logs em tempo real
npm start

# Logs estruturados com Pino
tail -f logs/app.log
```

## 📊 Monitoramento

### Health Checks
- `/api/health` - Status geral do sistema
- `/api/webhooks/health` - Status do webhook

### Métricas Importantes
- Sessões ativas
- Mensagens processadas
- Taxa de erro
- Tempo de resposta

## 🛡️ Segurança

- ✅ **API Keys**: Apenas no backend
- ✅ **RLS**: Políticas de acesso Supabase
- ✅ **CORS**: Origins configurados
- ✅ **Rate Limiting**: Proteção contra abuso
- ✅ **Input Validation**: Validação de dados

## 🔒 Boas Práticas

1. **NUNCA** comitar `.env` no repositório
2. **SEMPRE** usar HTTPS em produção
3. **MANTER** API Keys seguras
4. **MONITORAR** logs de erro
5. **LIMPAR** logs antigos periodicamente

## 🐛 Troubleshooting

### Problemas Comuns

**QR Code não aparece**
- Verificar se instância foi criada
- Confirmar webhook configurado
- Checar logs da Evolution API

**Mensagens não chegam**
- Verificar status da conexão
- Confirmar URL do webhook
- Checar se webhook está respondendo 200

**Auto-resposta não funciona**
- Verificar configuração ativa
- Confirmar cooldown
- Checar logs de mensagens

### Logs Úteis
```bash
# Verificar conexão Evolution
GET /api/sessions/test-connection

# Verificar status webhook
GET /api/webhooks/check/store_123

# Verificar sessões ativas
GET /api/sessions
```

## 📝 Changelog

### v2.0.0
- ✅ Migração Baileys → Evolution API v2
- ✅ Adapter Pattern implementado
- ✅ Arquitetura modularizada
- ✅ Sistema de webhooks robusto
- ✅ Multi-tenant aprimorado
- ✅ Logs estruturados com Pino

### v1.0.0
- ✅ Sistema inicial com Baileys
- ✅ Multi-tenant básico
- ✅ Auto-resposta simples

## 📄 Licença

MIT License - Ver arquivo LICENSE para detalhes.

## 🤝 Suporte

- **Issues**: GitHub Issues
- **Documentação**: README.md
- **Evolution API**: [Documentação oficial](https://doc.evolution-api.com/)

---

**Desenvolvido com ❤️ pela FrodFast Team**
