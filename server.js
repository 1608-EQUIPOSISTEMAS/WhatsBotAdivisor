const express = require('express');
const cors = require('cors');
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

// Ruta para iniciar WhatsApp
app.post('/start-whatsapp', (req, res) => {
    if (whatsappClient && whatsappStatus === 'connected') {
        return res.json({ success: false, message: 'WhatsApp ya está conectado' });
    }
    
    if (whatsappClient && whatsappStatus !== 'disconnected') {
        return res.json({ success: false, message: 'WhatsApp ya está iniciando...' });
    }
    
    whatsappStatus = 'generating_qr';
    qrCode = null;
    
    whatsappClient = new WhatsAppClient();
    whatsappClient.start();
    
    res.json({ success: true, message: 'WhatsApp iniciando...' });
});

// Ruta para obtener QR y estado
app.get('/get-qr', (req, res) => {
    res.json({ 
        qr: qrCode,
        status: whatsappStatus
    });
});

// Ruta para detener WhatsApp
app.post('/stop-whatsapp', (req, res) => {
    if (whatsappClient) {
        whatsappClient.stop();
        whatsappClient = null;
        qrCode = null;
        whatsappStatus = 'disconnected';
    }
    res.json({ success: true, message: 'WhatsApp detenido' });
});

// Funciones globales para el cliente
global.setQR = (qr) => { 
    qrCode = qr; 
    whatsappStatus = 'waiting_scan';
    console.log('QR establecido, esperando escaneo...');
};

global.setReady = () => { 
    qrCode = null; 
    whatsappStatus = 'connected';
    console.log('WhatsApp conectado exitosamente');
};

global.setDisconnected = () => {
    qrCode = null;
    whatsappStatus = 'disconnected';
    console.log('WhatsApp desconectado');
};

app.listen(3000, () => {
    console.log('Servidor Iniciado');
});