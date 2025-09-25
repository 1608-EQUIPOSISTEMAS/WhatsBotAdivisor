const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');
const config = require('./config');
const axios = require('axios');

class WhatsAppClient {
    constructor(userRole, userPermissions) {
        // Guardar rol y permisos del usuario
        this.userRole = userRole;
        this.userPermissions = userPermissions;
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📱 WHATSAPP CLIENT INICIALIZADO`);
        console.log(`👤 Rol: ${this.userRole}`);
        console.log(`🔐 Permisos: ${this.userPermissions.join(', ')}`);
        console.log(`${'='.repeat(60)}\n`);
        
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
            qrcode.generate(qr, { small: true });
            global.setQR(qr);
        });

        this.client.on('ready', () => {
            console.log('=== WHATSAPP CONECTADO ===');
            console.log(`Usuario activo - Rol: ${this.userRole}, Permisos: ${this.userPermissions.join(', ')}`);
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
            console.log(`\n📩 Mensaje recibido de ${message.from}: ${message.body}`);
            await this.handleMessage(message);
        });
    }

    /**
     * Verifica si el usuario tiene un permiso específico
     */
    hasPermission(requiredPermission) {
        // Si tiene permiso "all", puede todo
        if (this.userPermissions.includes('all')) {
            return true;
        }
        
        // Verificar permiso específico
        return this.userPermissions.includes(requiredPermission);
    }

    async handleMessage(message) {
        // Evitar responder a mensajes de grupos o estados
        if (message.from.includes('@g.us') || message.from.includes('@broadcast')) {
            return;
        }

        const messageBody = message.body.toLowerCase().trim();
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔍 PROCESANDO MENSAJE`);
        console.log(`📱 De: ${message.from}`);
        console.log(`💬 Mensaje: "${messageBody}"`);
        console.log(`👤 Rol activo: ${this.userRole}`);
        console.log(`🔐 Permisos: ${this.userPermissions.join(', ')}`);
        console.log(`${'='.repeat(60)}\n`);
        
        try {
            // Comando "info" - siempre disponible
            if (messageBody === 'info') {
                const welcomeMessage = await this.getWelcomeMessage();
                await this.client.sendMessage(message.from, welcomeMessage);
                console.log('✅ Mensaje de bienvenida enviado');
                return;
            }

            // Buscar en Members (solo si tiene permiso "members" o "all")
            if (this.hasPermission('members')) {
                console.log('✅ Usuario tiene permiso para Members, buscando...');
                const memberResponse = await this.checkMemberBlack(messageBody);
                if (memberResponse) {
                    console.log(`✅ Encontrado en Members: ${memberResponse.nombre}`);
                    await this.sendMemberBlackResponse(message, memberResponse);
                    return;
                }
                console.log('❌ No se encontró en Members');
            } else {
                console.log('⚠️ Usuario SIN permiso para Members');
            }

            // Buscar en Foundation (solo si tiene permiso "fundacion" o "all")
            if (this.hasPermission('fundacion')) {
                console.log('✅ Usuario tiene permiso para Foundation, buscando...');
                const foundationResponse = await this.checkFoundation(messageBody);
                if (foundationResponse) {
                    console.log(`✅ Encontrado en Foundation: ${foundationResponse.id}`);
                    await this.sendFoundationResponse(message, foundationResponse);
                    return;
                }
                console.log('❌ No se encontró en Foundation');
            } else {
                console.log('⚠️ Usuario SIN permiso para Foundation');
            }

            // Si llegó aquí, no se encontró nada
            console.log('❌ No se encontraron coincidencias en ninguna base de datos');
            
        } catch (error) {
            console.error('❌ Error al procesar mensaje:', error);
            await this.client.sendMessage(
                message.from,
                '❌ Error al procesar tu solicitud. Por favor intenta más tarde.'
            );
        }
    }

    async checkFoundation(messageBody) {
        try {
            console.log('📊 Consultando bot_foundation...');
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                'SELECT id, welcome, presentation_route, brochure_route, modality_first_route, modality_second_route, sesion, inversion_route, key_words, final_Text FROM bot_foundation WHERE 1=1'
            );
            
            console.log(`   Registros encontrados: ${rows.length}`);
            await connection.end();
            
            for (const row of rows) {
                let keywords = [];
                try {
                    keywords = JSON.parse(row.key_words);
                } catch (e) {
                    console.error('   Error parsing key_words:', e);
                    continue;
                }
                
                console.log(`   Revisando ID ${row.id} con keywords: ${keywords.join(', ')}`);
                
                const coincidencia = keywords.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra.toLowerCase())
                );
                
                if (coincidencia) {
                    console.log(`   ✅ Coincidencia encontrada!`);
                    return row;
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error al consultar foundation:', error);
            return null;
        }   
    }

    async sendFoundationResponse(message, foundationData) {
        try {
            console.log('📤 Enviando respuesta de Foundation...');
            
            const steps = [
                { field: 'welcome', type: 'text', label: 'Welcome' },
                { field: 'presentation_route', type: 'image', label: 'Presentation' },
                { field: 'brochure_route', type: 'pdf', label: 'Brochure' },
                { field: 'modality_first_route', type: 'image', label: 'Modalidad 1' },
                { field: 'modality_second_route', type: 'image', label: 'Modalidad 2' },
                { field: 'sesion', type: 'text', label: 'Sesión' },
                { field: 'inversion_route', type: 'image', label: 'Inversión' },
                { field: 'final_Text', type: 'text', label: 'Final' }
            ];
            
            for (const step of steps) {
                if (foundationData[step.field]) {
                    console.log(`   📨 Enviando: ${step.label}`);
                    
                    if (step.type === 'text') {
                        await this.client.sendMessage(message.from, foundationData[step.field]);
                    } else if (step.type === 'image') {
                        await this.sendImage(message, foundationData[step.field]);
                    } else if (step.type === 'pdf') {
                        await this.sendPDF(message, foundationData[step.field]);
                    }
                    
                    await this.sleep(1000);
                }
            }

            console.log('✅ Respuesta Foundation enviada completamente');
        } catch (error) {
            console.error('❌ Error enviando respuesta foundation:', error);
            await this.client.sendMessage(
                message.from,
                '❌ Error al enviar la información.'
            );
        }
    }

    async checkMemberBlack(messageBody) {
        try {
            console.log('📊 Consultando members...');
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                'SELECT id, nombre, ruta_post, beneficio, ruta_pdf, precio FROM members WHERE 1=1'
            );
            
            console.log(`   Registros encontrados: ${rows.length}`);
            await connection.end();

            for (const row of rows) {
                const nombrePlan = row.nombre.toLowerCase();
                const palabrasNombre = nombrePlan.split(' ');
                
                console.log(`   Revisando: ${row.nombre}`);
                
                const coincidencia = palabrasNombre.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra)
                );

                if (coincidencia) {
                    console.log(`   ✅ Coincidencia encontrada!`);
                    return row;
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Error al consultar members:', error);
            return null;
        }
    }

    async sendMemberBlackResponse(message, memberData) {
        try {
            console.log('📤 Enviando respuesta de Member...');

            if (memberData.ruta_post) {
                console.log('   📨 Enviando: Imagen');
                await this.sendImage(message, memberData.ruta_post);
                await this.sleep(1000);
            }

            if (memberData.beneficio) {
                console.log('   📨 Enviando: Beneficio');
                await this.client.sendMessage(message.from, memberData.beneficio);
                await this.sleep(1000);
            }

            if (memberData.ruta_pdf) {
                console.log('   📨 Enviando: PDF');
                await this.sendPDF(message, memberData.ruta_pdf);
                await this.sleep(1000);
            }

            if (memberData.precio) {
                console.log('   📨 Enviando: Precio');
                await this.client.sendMessage(message.from, `💰 *Precio:* ${memberData.precio}`);
            }

            console.log('✅ Respuesta Member enviada completamente');

        } catch (error) {
            console.error('❌ Error enviando respuesta member:', error);
            await this.client.sendMessage(
                message.from,
                '❌ Error al enviar la información.'
            );
        }
    }

    async sendImage(message, imagePath) {
        try {
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${imagePath.replace(/^\/+/, '')}`;
            console.log(`      📷 URL imagen: ${fullUrl}`);

            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`      ❌ Imagen no accesible`);
                await this.client.sendMessage(message.from, '❌ Imagen no disponible.');
                return;
            }

            const media = await this.createMediaFromUrl(fullUrl, 'image');
            
            if (!media) {
                throw new Error('No se pudo crear el media');
            }

            await this.client.sendMessage(message.from, media);
            console.log('      ✅ Imagen enviada');

        } catch (error) {
            console.error('      ❌ Error enviando imagen:', error);
            await this.client.sendMessage(message.from, '❌ Error al enviar imagen.');
        }
    }

    async sendPDF(message, pdfPath) {
        try {
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${pdfPath.replace(/^\/+/, '')}`;
            console.log(`      📄 URL PDF: ${fullUrl}`);

            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`      ❌ PDF no accesible`);
                await this.client.sendMessage(message.from, '❌ PDF no disponible.');
                return;
            }

            const media = await this.createMediaFromUrl(fullUrl, 'document');
            
            if (!media) {
                throw new Error('No se pudo crear el media');
            }

            await this.client.sendMessage(message.from, media);
            console.log('      ✅ PDF enviado');

        } catch (error) {
            console.error('      ❌ Error enviando PDF:', error);
            await this.client.sendMessage(message.from, '❌ Error al enviar PDF.');
        }
    }

    async checkUrlAccessibility(url) {
        try {
            const response = await axios.head(url, {
                timeout: 10000,
                validateStatus: (status) => status >= 200 && status < 400
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    async createMediaFromUrl(url, type = 'image') {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const contentType = response.headers['content-type'] || this.getMimeTypeFromUrl(url);
            const filename = this.getFilenameFromUrl(url);

            const media = new MessageMedia(
                contentType,
                Buffer.from(response.data).toString('base64'),
                filename
            );

            return media;

        } catch (error) {
            console.error(`Error creando media: ${error.message}`);
            return null;
        }
    }

    getMimeTypeFromUrl(url) {
        const path = require('path');
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

    getFilenameFromUrl(url) {
        const path = require('path');
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
                return '👋 Hola, bienvenido a nuestro servicio. Escribe "info" para más información.';
            }
        } catch (error) {
            console.error('Error obteniendo mensaje de bienvenida:', error);
            return '👋 Hola, bienvenido. ¿En qué puedo ayudarte?';
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start() {
        console.log('🚀 Iniciando cliente WhatsApp...');
        this.client.initialize();
    }

    stop() {
        console.log('🛑 Deteniendo cliente WhatsApp...');
        this.client.destroy();
        global.setDisconnected();
    }
}

module.exports = WhatsAppClient;