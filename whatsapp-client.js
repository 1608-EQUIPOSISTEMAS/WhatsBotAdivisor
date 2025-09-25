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
            console.log('Iniciando búsqueda en la base de datos...');
            // Buscar en member_black primero
            const memberBlackResponse = await this.checkMemberBlack(messageBody);
            if (memberBlackResponse) {
                await this.sendMemberBlackResponse(message, memberBlackResponse);
                return;
            }
            console.log('No se encontraron coincidencias en member_black');
            // Buscar en foundation
            const foundationResponse = await this.checkFoundation(messageBody);
            if(foundationResponse) {
                await this.sendFoundationResponse(message, foundationResponse);
                return;
            }
            console.log('No se encontraron coincidencias en foundation');

            // Si no encontró nada en member_black, verificar si es "info"
            if (messageBody === 'info') {
                const welcomeMessage = await this.getWelcomeMessage();
                console.log(`Enviando respuesta: ${welcomeMessage}`);
                await this.client.sendMessage(message.from,welcomeMessage);
            }
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            await this.client.sendMessage(message.from,'Error al procesar tu solicitud. Por favor intenta más tarde.');
        }
    }

    

    async checkFoundation(messageBody) {
        try {
            console.log('Consultando foundation en la base de datos...');
            const connection = await mysql.createConnection(config.database);
            //id	welcome	presentation_route	brochure_route	modality_first_route	modality_second_route	sesion	inversion_route	key_words
            const [rows] = await connection.execute(
                'select id, welcome, presentation_route, brochure_route, modality_first_route, modality_second_route, sesion, inversion_route, key_words, final_Text from bot_foundation'
            );
            console.log(`Total foundations obtenidas: ${rows.length}`);
            await connection.end();
            for (const row of rows) {
                console.log(`Revisando foundation: ${messageBody} con keywords: ${row.key_words}`);

                //key_words es un string literal "["congreso","proyectos"]"
                let keywords = [];
                try {
                    keywords = JSON.parse(row.key_words);
                } catch (e) {
                    console.error('Error parsing key_words:', e);
                    continue;
                }
                const coincidencia = keywords.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra.toLowerCase())
                );
                if (coincidencia) {
                    console.log(`Coincidencia encontrada en foundation: ${row.id}`);
                    return row;
                }
                console.log(`No hay coincidencia en foundation: ${row.id}`);
                
            }
            console.log('No se encontraron coincidencias en foundation');
            return null;
        } catch (error) {
            console.error('Error al consultar foundation:', error);
            return null;
        }   
    }

    async sendFoundationResponse(message, foundationData) {
        try {
            console.log('Enviando respuesta de foundation...');
            // 1. Envian welcome
            if (foundationData.welcome) {
                await this.client.sendMessage(message.from,foundationData.welcome);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }
            // 2. Envian presentation_route (imagen)
            if (foundationData.presentation_route) {
                await this.sendImage(message, foundationData.presentation_route);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }
            
            // 3. Envian brochure_route (PDF)
            if (foundationData.brochure_route) {
                await this.sendPDF(message, foundationData.brochure_route);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }   
            
            // 4. Envian modalidad_first_route (imagen)
            if (foundationData.modality_first_route) {
                await this.sendImage(message, foundationData.modality_first_route);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }
            
            // 5. Envian modalidad_second_route (imagen)
            if (foundationData.modality_second_route) {
                await this.sendImage(message, foundationData.modality_second_route);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }

            // 6. Envian sesion (texto)
            if (foundationData.sesion) {
                await this.client.sendMessage(message.from,foundationData.sesion);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }

            // 7. Envian inversion_route (imagen)
            if (foundationData.inversion_route) {
                await this.sendImage(message, foundationData.inversion_route);
                await this.sleep(1000); // Esperar 1 segundo entre envíos
            }

            // 8. Envian final_Text (texto)
            if (foundationData.final_Text) {
                await this.client.sendMessage(message.from,foundationData.final_Text);
            }


            console.log('Respuesta completa enviada');
        } catch (error) {
            console.error('Error enviando respuesta foundation:', error);
            await this.client.sendMessage(message.from,'Error al enviar la información. Por favor intenta más tarde.');
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
                await this.client.sendMessage(message.from,memberData.beneficio);
                await this.sleep(1000);
            }

            // 3. Enviar PDF (ruta_pdf)
            if (memberData.ruta_pdf) {
                await this.sendPDF(message, memberData.ruta_pdf);
                await this.sleep(1000);
            }

            // 4. Enviar precio
            if (memberData.precio) {
                await this.client.sendMessage(message.from,`💰 Precio: ${memberData.precio}`);
            }

            console.log('Respuesta completa enviada');

        } catch (error) {
            console.error('Error enviando respuesta member_black:', error);
            await this.client.sendMessage(message.from,'Error al enviar la información. Por favor intenta más tarde.');
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
                await this.client.sendMessage(message.from,'❌ Imagen no disponible en este momento.');
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
            await this.client.sendMessage(message.from,'❌ Error al enviar la imagen.');
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
                await this.client.sendMessage(message.from,'❌ PDF no disponible en este momento.');
                return;
            }

            // Descargar y crear media desde URL
            const media = await this.createMediaFromUrl(fullUrl, 'document');
            
            if (!media) {
                throw new Error('No se pudo crear el media desde la URL');
            }

            // Enviar PDF
            await this.client.sendMessage(message.from, media, {
            });
            console.log('PDF enviado exitosamente');

        } catch (error) {
            console.error('Error enviando PDF:', error);
            await this.client.sendMessage(message.from,'❌ Error al enviar el documento.');
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