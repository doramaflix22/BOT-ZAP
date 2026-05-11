# 🔄 Guia de Migração Frontend - Evolution API

## **🔧 Mudanças Necessárias**

### **1. URL Base do Backend**
```javascript
// ANTES (URL antiga)
const API_URL = 'https://whatsmotor-production.up.railway.app';

// DEPOIS (URL nova)
const API_URL = 'https://bot-zap-production-9534.up.railway.app';
```

### **2. Endpoints Atualizados**

#### **🔗 Conexão WhatsApp**
```javascript
// ANTES
POST /api/whatsapp/connect/{storeId}

// DEPOIS
POST /api/sessions/connect/{storeId}
```

#### **📊 Status da Sessão**
```javascript
// ANTES
GET /api/whatsapp/status/{storeId}

// DEPOIS
GET /api/sessions/status/{storeId}
```

#### **📱 QR Code**
```javascript
// ANTES
GET /api/whatsapp/qr/{storeId}

// DEPOIS
GET /api/sessions/qr/{storeId}
```

#### **🔌 Desconectar**
```javascript
// ANTES
POST /api/whatsapp/disconnect/{storeId}

// DEPOIS
POST /api/sessions/disconnect/{storeId}
```

#### **🗑️ Deletar Sessão**
```javascript
// ANTES
DELETE /api/whatsapp/{storeId}

// DEPOIS
DELETE /api/sessions/{storeId}
```

#### **🔄 Reconectar**
```javascript
// ANTES
POST /api/whatsapp/reconnect/{storeId}

// DEPOIS
POST /api/sessions/reconnect/{storeId}
```

#### **📋 Listar Sessões**
```javascript
// ANTES
GET /api/whatsapp

// DEPOIS
GET /api/sessions
```

## **🎯 Exemplo de Implementação**

### **Função de Conexão Atualizada**
```javascript
// NOVA IMPLEMENTAÇÃO
async function connectWhatsApp(storeId) {
  try {
    const response = await fetch(`${API_URL}/api/sessions/connect/${storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // payload se necessário
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ WhatsApp connection started');
      return data;
    } else {
      throw new Error(data.error || 'Connection failed');
    }
  } catch (error) {
    console.error('❌ Connection error:', error);
    throw error;
  }
}
```

### **Função de QR Code Atualizada**
```javascript
// NOVA IMPLEMENTAÇÃO
async function getQRCode(storeId) {
  try {
    const response = await fetch(`${API_URL}/api/sessions/qr/${storeId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json();
    
    if (data.success) {
      return data.data; // { type: 'qr_requested', message: 'QR code will be sent via webhook' }
    } else {
      throw new Error(data.error || 'QR generation failed');
    }
  } catch (error) {
    console.error('❌ QR error:', error);
    throw error;
  }
}
```

## **🔄 Respostas da API**

### **Novo Formato de Resposta**
```javascript
// RESPOSTA PADRÃO
{
  "success": true,
  "data": {
    "instanceName": "store_test123",
    "status": "connecting",
    "connectionStatus": "connecting"
  },
  "timestamp": "2026-01-08T06:30:00.000Z"
}

// ERRO PADRÃO
{
  "success": false,
  "error": "Instance already exists",
  "code": "INSTANCE_EXISTS",
  "timestamp": "2026-01-08T06:30:00.000Z"
}
```

## **🚀 Passos para Implementar**

1. **Atualizar URL base** no arquivo de configuração
2. **Mudar endpoints** de `/api/whatsapp/` para `/api/sessions/`
3. **Tratar novas respostas** com formato `{success, data, error}`
4. **Testar integração** com backend atualizado
5. **Ajustar tratamento de erros** para novos códigos

## **🔗 URLs Importes**

- **Backend**: `https://bot-zap-production-9534.up.railway.app`
- **Health Check**: `https://bot-zap-production-9534.up.railway.app/api/health`
- **API Docs**: `https://bot-zap-production-9534.up.railway.app/api`

**CORS já configurado para `https://www.treexonline.online`!** ✅
