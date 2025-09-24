const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WhatsAppClient = require('./whatsapp-client');

const app = express();
app.use(cors({
    origin: ['https://whatsbotadivisorfronted.onrender.com', 'http://localhost'],
    methods: ['GET', 'POST']
}));
app.use(express.json());

let whatsappClient = null;
let qrCode = null;
let whatsappStatus = 'disconnected';
let lastConnectionTime = null;
let cleanupInProgress = false;

// Función para limpiar carpetas de sesión
function cleanupSessionFolders() {
    if (cleanupInProgress) {
        console.log('Limpieza ya en progreso...');
        return Promise.resolve();
    }
    
    cleanupInProgress = true;
    console.log('🧹 Iniciando limpieza de carpetas de sesión...');
    
    const foldersToClean = ['.wwebjs_auth', '.wwebjs_cache'];
    const cleanupPromises = [];
    
    foldersToClean.forEach(folder => {
        const folderPath = path.join(__dirname, folder);
        
        if (fs.existsSync(folderPath)) {
            console.log(`📁 Eliminando carpeta: ${folder}`);
            
            const cleanupPromise = new Promise((resolve) => {
                try {
                    // Eliminar recursivamente
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    console.log(`✅ Carpeta ${folder} eliminada exitosamente`);
                } catch (error) {
                    console.log(`⚠️ Error eliminando ${folder}:`, error.message);
                }
                resolve();
            });
            
            cleanupPromises.push(cleanupPromise);
        } else {
            console.log(`📁 Carpeta ${folder} no existe`);
        }
    });
    
    return Promise.all(cleanupPromises).then(() => {
        console.log('🧹 Limpieza completada');
        cleanupInProgress = false;
        
        // Resetear estado completamente
        whatsappClient = null;
        qrCode = null;
        whatsappStatus = 'disconnected';
        lastConnectionTime = null;
    }).catch(error => {
        console.error('❌ Error durante la limpieza:', error);
        cleanupInProgress = false;
    });
}

// Función para verificar estado de la sesión
async function verifySessionHealth() {
    const authPath = path.join(__dirname, '.wwebjs_auth');
    const cachePath = path.join(__dirname, '.wwebjs_cache');
    
    // Si existen las carpetas pero no hay cliente activo, probablemente están corruptas
    if ((fs.existsSync(authPath) || fs.existsSync(cachePath)) && whatsappStatus === 'disconnected') {
        console.log('⚠️ Detectadas carpetas de sesión huérfanas, limpiando...');
        await cleanupSessionFolders();
    }
}

// Ruta para iniciar WhatsApp
app.post('/start-whatsapp', async (req, res) => {
    try {
        console.log(`🚀 Intentando iniciar WhatsApp. Estado actual: ${whatsappStatus}`);
        
        // Verificar si ya está conectado
        if (whatsappClient && whatsappStatus === 'connected') {
            return res.json({ 
                success: false, 
                message: 'WhatsApp ya está conectado',
                status: whatsappStatus 
            });
        }
        
        // Verificar si ya está iniciando
        if (whatsappStatus === 'generating_qr' || whatsappStatus === 'waiting_scan') {
            return res.json({ 
                success: false, 
                message: 'WhatsApp ya está iniciando...',
                status: whatsappStatus 
            });
        }
        
        // Verificar salud de la sesión antes de iniciar
        await verifySessionHealth();
        
        // Cambiar estado antes de iniciar
        whatsappStatus = 'generating_qr';
        qrCode = null;
        
        try {
            whatsappClient = new WhatsAppClient();
            
            // Configurar timeouts y handlers de error
            const startTimeout = setTimeout(() => {
                console.log('⏰ Timeout iniciando WhatsApp, limpiando...');
                handleWhatsAppError('Timeout al iniciar WhatsApp');
            }, 30000); // 30 segundos timeout
            
            // Limpiar timeout si todo va bien
            global.clearStartTimeout = () => clearTimeout(startTimeout);
            
            await whatsappClient.start();
            
            res.json({ 
                success: true, 
                message: 'WhatsApp iniciando...',
                status: whatsappStatus
            });
            
        } catch (error) {
            console.error('❌ Error al iniciar WhatsApp:', error);
            await handleWhatsAppError(`Error al iniciar: ${error.message}`);
            
            res.json({ 
                success: false, 
                message: 'Error al iniciar WhatsApp. Sesión limpiada, intenta nuevamente.',
                error: error.message,
                status: whatsappStatus
            });
        }
        
    } catch (error) {
        console.error('❌ Error general en start-whatsapp:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor',
            error: error.message 
        });
    }
});

// Ruta para obtener QR y estado
app.get('/get-qr', (req, res) => {
    res.json({ 
        qr: qrCode,
        status: whatsappStatus,
        timestamp: new Date().toISOString(),
        lastConnection: lastConnectionTime
    });
});

// Ruta para detener WhatsApp
app.post('/stop-whatsapp', async (req, res) => {
    try {
        console.log('🛑 Deteniendo WhatsApp...');
        
        if (whatsappClient) {
            try {
                await whatsappClient.stop();
            } catch (error) {
                console.log('⚠️ Error al detener cliente:', error.message);
            }
        }
        
        // Limpiar estado
        whatsappClient = null;
        qrCode = null;
        whatsappStatus = 'disconnected';
        lastConnectionTime = null;
        
        res.json({ 
            success: true, 
            message: 'WhatsApp detenido correctamente',
            status: whatsappStatus 
        });
        
    } catch (error) {
        console.error('❌ Error deteniendo WhatsApp:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al detener WhatsApp',
            error: error.message 
        });
    }
});

// Ruta para limpiar manualmente las carpetas de sesión
app.post('/cleanup-session', async (req, res) => {
    try {
        console.log('🧹 Limpieza manual solicitada...');
        
        // Detener cliente si existe
        if (whatsappClient) {
            try {
                await whatsappClient.stop();
            } catch (error) {
                console.log('⚠️ Error deteniendo cliente durante limpieza:', error.message);
            }
        }
        
        // Limpiar carpetas
        await cleanupSessionFolders();
        
        res.json({ 
            success: true, 
            message: 'Sesión limpiada exitosamente. Ahora puedes iniciar WhatsApp nuevamente.',
            status: whatsappStatus 
        });
        
    } catch (error) {
        console.error('❌ Error en limpieza manual:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al limpiar sesión',
            error: error.message 
        });
    }
});

// Ruta para verificar estado del servidor
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsappStatus: whatsappStatus,
        hasClient: !!whatsappClient,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Función para manejar errores de WhatsApp
async function handleWhatsAppError(errorMessage) {
    console.log(`❌ Manejando error de WhatsApp: ${errorMessage}`);
    
    try {
        // Detener cliente si existe
        if (whatsappClient) {
            try {
                await whatsappClient.stop();
            } catch (stopError) {
                console.log('⚠️ Error deteniendo cliente:', stopError.message);
            }
        }
        
        // Limpiar carpetas de sesión
        await cleanupSessionFolders();
        
        console.log('✅ Error manejado, estado limpiado');
        
    } catch (error) {
        console.error('❌ Error durante manejo de error:', error);
    }
}

// Funciones globales para el cliente
global.setQR = (qr) => { 
    qrCode = qr; 
    whatsappStatus = 'waiting_scan';
    console.log('📱 QR establecido, esperando escaneo...');
    
    // Limpiar timeout de inicio si existe
    if (global.clearStartTimeout) {
        global.clearStartTimeout();
    }
};

global.setReady = () => { 
    qrCode = null; 
    whatsappStatus = 'connected';
    lastConnectionTime = new Date().toISOString();
    console.log('✅ WhatsApp conectado exitosamente');
    
    // Limpiar timeout de inicio si existe
    if (global.clearStartTimeout) {
        global.clearStartTimeout();
    }
};

global.setDisconnected = async () => {
    const wasConnected = whatsappStatus === 'connected';
    
    qrCode = null;
    whatsappStatus = 'disconnected';
    console.log('📱 WhatsApp desconectado');
    
    // Si estaba conectado y se desconectó inesperadamente, limpiar sesión
    if (wasConnected) {
        console.log('⚠️ Desconexión inesperada detectada, limpiando sesión...');
        await cleanupSessionFolders();
    }
};

// Manejar errores no capturados
global.handleWhatsAppError = handleWhatsAppError;

// Verificar estado al iniciar el servidor
verifySessionHealth().then(() => {
    console.log('✅ Verificación inicial de sesión completada');
}).catch(error => {
    console.error('❌ Error en verificación inicial:', error);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log('📋 Rutas disponibles:');
    console.log('   POST /start-whatsapp - Iniciar WhatsApp');
    console.log('   GET  /get-qr - Obtener QR y estado');
    console.log('   POST /stop-whatsapp - Detener WhatsApp');
    console.log('   POST /cleanup-session - Limpiar sesión manualmente');
    console.log('   GET  /health - Estado del servidor');
});

// Manejar cierre graceful del servidor
process.on('SIGTERM', async () => {
    console.log('🛑 Recibida señal SIGTERM, cerrando servidor...');
    if (whatsappClient) {
        await whatsappClient.stop();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Recibida señal SIGINT, cerrando servidor...');
    if (whatsappClient) {
        await whatsappClient.stop();
    }
    process.exit(0);
});