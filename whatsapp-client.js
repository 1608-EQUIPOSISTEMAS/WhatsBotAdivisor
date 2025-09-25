const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Añadir axios para peticiones HTTP

class WhatsAppClient {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                name: "whatsapp-session"
            })
        });
        this.setupEvents();
    }

    setupEvents() {
        this.client.on('qr', (qr) => {
            console.log('=== QR CODE GENERADO ===');
            console.log('QR recibido, enviando al frontend...');
            
            // Mostrar en terminal para debug
            qrcode.generate(qr, { small: true });
            
            // Enviar al frontend
            global.setQR(qr);
        });

        this.client.on('ready', () => {
            console.log('=== WHATSAPP CONECTADO ===');
            console.log('Cliente WhatsApp está listo!');
            global.setReady();
        });

        this.client.on('authenticated', () => {
            console.log('WhatsApp autenticado correctamente');
        });

        this.client.on('auth_failure', (msg) => {
            console.error('Error de autenticación:', msg);
            global.setDisconnected();
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp desconectado:', reason);
            global.setDisconnected();
        });

        this.client.on('message', async (message) => {
            console.log(`Mensaje recibido de ${message.from}: ${message.body}`);
            await this.handleMessage(message);
        });
    }

    async handleMessage(message) {
        // Evitar responder a mensajes de grupos o estados
        if (message.from.includes('@g.us') || message.from.includes('@broadcast')) {
            return;
        }

        const messageBody = message.body.toLowerCase().trim();
        console.log(`Procesando mensaje: "${messageBody}"`);
        
        try {
            // Buscar en member_black primero
            const memberBlackResponse = await this.checkMemberBlack(messageBody);
            if (memberBlackResponse) {
                await this.sendMemberBlackResponse(message, memberBlackResponse);
                return;
            }

            // Si no encontró nada en member_black, verificar si es "info"
            if (messageBody === 'info') {
                const welcomeMessage = await this.getWelcomeMessage();
                console.log(`Enviando respuesta: ${welcomeMessage}`);
                await message.reply(welcomeMessage);
            }
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            await message.reply('Error al procesar tu solicitud. Por favor intenta más tarde.');
        }
    }

    async checkMemberBlack(messageBody) {
        try {
            const connection = await mysql.createConnection(config.database);
            
            // Obtener todos los registros de member_black
            const [rows] = await connection.execute(
                'SELECT id, nombre, ruta_post, beneficio, ruta_pdf, precio FROM members'
            );
            
            await connection.end();

            // Buscar coincidencias en el mensaje
            for (const row of rows) {
                const nombrePlan = row.nombre.toLowerCase();
                
                // Buscar si alguna palabra del nombre del plan está en el mensaje
                const palabrasNombre = nombrePlan.split(' ');
                const coincidencia = palabrasNombre.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra)
                );

                if (coincidencia) {
                    console.log(`Coincidencia encontrada: ${row.nombre}`);
                    return row;
                }
            }

            return null;
        } catch (error) {
            console.error('Error al consultar member_black:', error);
            return null;
        }
    }

    async sendMemberBlackResponse(message, memberData) {
        try {
            console.log('Enviando respuesta de member_black...');

            // 1. Enviar imagen (ruta_post)
            if (memberData.ruta_post) {
                await this.sendImage(message, memberData.ruta_post);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }

            // 2. Enviar texto de beneficio
            if (memberData.beneficio) {
                await message.reply(memberData.beneficio);
                await this.sleep(1000);
            }

            // 3. Enviar PDF (ruta_pdf)
            if (memberData.ruta_pdf) {
                await this.sendPDF(message, memberData.ruta_pdf);
                await this.sleep(1000);
            }

            // 4. Enviar precio
            if (memberData.precio) {
                await message.reply(`💰 Precio: ${memberData.precio}`);
            }

            console.log('Respuesta completa enviada');

        } catch (error) {
            console.error('Error enviando respuesta member_black:', error);
            await message.reply('Error al enviar la información. Por favor intenta más tarde.');
        }
    }

    /**
     * Método mejorado para enviar imágenes desde URL
     */
    async sendImage(message, imagePath) {
        try {
            // Construir la URL completa de la imagen
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${imagePath.replace(/^\/+/, '')}`;
            
            console.log(`Intentando enviar imagen: ${fullUrl}`);

            // Verificar si la URL es accesible
            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`Imagen no accesible: ${fullUrl}`);
                await message.reply('❌ Imagen no disponible en este momento.');
                return;
            }

            // Descargar y crear media desde URL
            const media = await this.createMediaFromUrl(fullUrl, 'image');
            
            if (!media) {
                throw new Error('No se pudo crear el media desde la URL');
            }

            // Enviar imagen
            await this.client.sendMessage(message.from, media);
            console.log('Imagen enviada exitosamente');

        } catch (error) {
            console.error('Error enviando imagen:', error);
            await message.reply('❌ Error al enviar la imagen.');
        }
    }

    /**
     * Método mejorado para enviar PDFs desde URL
     */
    async sendPDF(message, pdfPath) {
        try {
            // Construir la URL completa del PDF
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${pdfPath.replace(/^\/+/, '')}`;
            
            console.log(`Intentando enviar PDF: ${fullUrl}`);

            // Verificar si la URL es accesible
            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`PDF no accesible: ${fullUrl}`);
                await message.reply('❌ PDF no disponible en este momento.');
                return;
            }

            // Descargar y crear media desde URL
            const media = await this.createMediaFromUrl(fullUrl, 'document');
            
            if (!media) {
                throw new Error('No se pudo crear el media desde la URL');
            }

            // Enviar PDF
            await this.client.sendMessage(message.from, media, {
                caption: '📄 Documento adjunto'
            });
            console.log('PDF enviado exitosamente');

        } catch (error) {
            console.error('Error enviando PDF:', error);
            await message.reply('❌ Error al enviar el documento.');
        }
    }

    /**
     * Verifica si una URL es accesible
     */
    async checkUrlAccessibility(url) {
        try {
            const response = await axios.head(url, {
                timeout: 10000, // 10 segundos timeout
                validateStatus: (status) => status >= 200 && status < 400
            });
            return true;
        } catch (error) {
            console.error(`URL no accesible: ${url}`, error.message);
            return false;
        }
    }

    /**
     * Crea un MessageMedia desde una URL
     */
    async createMediaFromUrl(url, type = 'image') {
        try {
            console.log(`Descargando ${type} desde: ${url}`);
            
            // Descargar el archivo
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000, // 30 segundos timeout
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Obtener información del archivo
            const contentType = response.headers['content-type'] || this.getMimeTypeFromUrl(url);
            const filename = this.getFilenameFromUrl(url);
            
            console.log(`Archivo descargado: ${filename}, Tipo: ${contentType}, Tamaño: ${response.data.length} bytes`);

            // Crear MessageMedia desde buffer
            const media = new MessageMedia(
                contentType,
                Buffer.from(response.data).toString('base64'),
                filename
            );

            return media;

        } catch (error) {
            console.error(`Error creando media desde URL: ${url}`, error.message);
            return null;
        }
    }

    /**
     * Obtiene el tipo MIME basado en la extensión del archivo
     */
    getMimeTypeFromUrl(url) {
        const extension = path.extname(url).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg'
        };
        return mimeTypes[extension] || 'application/octet-stream';
    }

    /**
     * Extrae el nombre del archivo desde la URL
     */
    getFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = path.basename(pathname);
            return filename || 'archivo';
        } catch (error) {
            return 'archivo';
        }
    }

    async getWelcomeMessage() {
        try {
            const connection = await mysql.createConnection(config.database);
            const [rows] = await connection.execute(
                'SELECT mensaje_bienvenida FROM configuraciones ORDER BY id DESC LIMIT 1'
            );
            await connection.end();
            
            if (rows.length > 0) {
                return rows[0].mensaje_bienvenida;
            } else {
                return 'Hola, bienvenido a nuestro servicio. ¿En qué podemos ayudarte?';
            }
        } catch (error) {
            console.error('Error conectando a la base de datos:', error);
            throw error;
        }
    }

    /**
     * Función auxiliar para pausas con mejor gestión
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        console.log('Iniciando cliente WhatsApp...');
        this.client.initialize();
    }

    stop() {
        console.log('Deteniendo cliente WhatsApp...');
        this.client.destroy();
        global.setDisconnected();
    }
}

module.exports = WhatsAppClient;