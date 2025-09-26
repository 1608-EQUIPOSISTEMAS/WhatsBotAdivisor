const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');
const config = require('./config');
const axios = require('axios');

class WhatsAppClient {
    constructor(userRole, userPermissions) {
        this.userRole = userRole;
        this.userPermissions = userPermissions;
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`WHATSAPP CLIENT INICIALIZADO`);
        console.log(`Rol: ${this.userRole}`);
        console.log(`Permisos: ${this.userPermissions.join(', ')}`);
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

    hasPermission(requiredPermission) {
        if (this.userPermissions.includes('all')) {
            return true;
        }
        return this.userPermissions.includes(requiredPermission);
    }

    async handleMessage(message) {
        // ⛔ IGNORAR GRUPOS Y ESTADOS - NO PROCESAR NI REGISTRAR
        if (message.from.includes('@g.us') || message.from.includes('@broadcast')) {
            console.log('⛔ Mensaje de grupo o estado ignorado');
            return;
        }

        const messageBody = message.body.toLowerCase().trim();
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`PROCESANDO MENSAJE`);
        console.log(`De: ${message.from}`);
        console.log(`Mensaje: "${messageBody}"`);
        console.log(`Rol activo: ${this.userRole}`);
        console.log(`Permisos: ${this.userPermissions.join(', ')}`);
        console.log(`${'='.repeat(60)}\n`);
        
        try {
            // 1. OBTENER ESTADO DEL CONTACTO
            const contactStatus = await this.getContactStatusAndDate(message.from);
            
            if (contactStatus) {
                console.log(`📋 Estado actual: ${contactStatus.type_status}`);
            } else {
                console.log(`📋 Sin estado guardado`);
            }

            // 2. VERIFICAR SELECCIÓN DE MÉTODO DE PAGO (PRIORIDAD MÁS ALTA)
            if (contactStatus && contactStatus.type_status && contactStatus.type_status.startsWith('payment_method_selection_')) {
                console.log('🔍 Detectado: Estado de selección de método de pago');
                const oneHour = 60 * 60 * 1000;
                const now = new Date();
                const registrationDate = new Date(contactStatus.registration_date);
                
                if (now - registrationDate > oneHour) {
                    console.log(`⏰ Estado payment_method_selection expirado`);
                    await this.updateContactStatus(message.from, 'null');
                    return;
                }
                
                const responseId = contactStatus.type_status.split('_').pop();
                
                console.log(`Response ID extraído: ${responseId}`);
                console.log(`Usuario escribió: "${messageBody}"`);
                
                // Aceptar cualquier input (número o texto)
                console.log('✅ Procesando selección de método de pago...');
                await this.processPaymentMethodSelection(message, responseId, messageBody);
                return;
            }

            // 3. VERIFICAR ESTADOS DE MEMBER 
            if (contactStatus && contactStatus.type_status && contactStatus.type_status.startsWith('member_option_selection_')) {
                console.log('🔍 Detectado: Estado de selección de opción de member');
                const oneHour = 60 * 60 * 1000;
                const now = new Date();
                const registrationDate = new Date(contactStatus.registration_date);
                
                if (now - registrationDate > oneHour) {
                    console.log(`⏰ Estado member_option_selection expirado`);
                    await this.updateContactStatus(message.from, 'null');
                    return;
                }
                
                const memberId = contactStatus.type_status.split('_').pop();
                const opcionNumero = parseInt(messageBody);
                
                console.log(`Member ID extraído: ${memberId}`);
                console.log(`Opción número parseada: ${opcionNumero}`);
                
                if (!isNaN(opcionNumero) && opcionNumero >= 1 && opcionNumero <= 4) {
                    console.log('✅ Procesando selección de opción...');
                    await this.processMemberOptionSelection(message, memberId, opcionNumero);
                    return;
                } else {
                    console.log('❌ Opción no válida, registrando...');
                    await this.logUnrecognizedMessage(message.from, message.body);
                    return;
                }
            }

            // 4. BUSCAR EN MEMBERS (si tiene permiso)
            if (this.hasPermission('members')) {
                console.log('Usuario tiene permiso para Members, buscando...');
                const memberResponse = await this.checkMemberBlack(messageBody);
                if (memberResponse) {
                    console.log(`Encontrado en Members: ${memberResponse.nombre}`);
                    await this.sendMemberBlackResponse(message, memberResponse);
                    return;
                }
                console.log('No se encontró en Members');
            } else {
                console.log('Usuario SIN permiso para Members');
            }

            // 5. BUSCAR EN FOUNDATION (si tiene permiso)
            if (this.hasPermission('fundacion')) {
                if (contactStatus && contactStatus.type_status !== 'null') {
                    console.log(`El contacto ${message.from} tiene estado: ${contactStatus.type_status}`);
                    
                    if (contactStatus.type_status === 'foundation_modality_selection') {
                        const oneHour = 60 * 60 * 1000;
                        const now = new Date();
                        const registrationDate = new Date(contactStatus.registration_date);
                        
                        if (now - registrationDate > oneHour) {
                            console.log(`Estado foundation_modality_selection expirado`);
                            await this.updateContactStatus(message.from, 'null');
                            return;
                        }

                        if(!['1','2','3','4','pase vip','pase premiun','pase general','pase virtual','pase','vip','premiun','virtual','general'].some(palabra => messageBody.includes(palabra))) {
                            return;
                        } else {
                            const foundationData = await this.getDataFoundationById(1); 
                            await this.client.sendMessage(message.from, foundationData.message_method_payment);
                            await this.updateContactStatus(message.from, 'foundation_payment_selection');
                            return;
                        }
                    }

                    if (contactStatus.type_status === 'foundation_payment_selection') {
                        const oneHour = 60 * 60 * 1000;
                        const now = new Date();
                        const registrationDate = new Date(contactStatus.registration_date);
                        
                        if (now - registrationDate > oneHour) {
                            console.log(`Estado foundation_payment_selection expirado`);
                            await this.updateContactStatus(message.from, 'null');
                            return;
                        }

                        if(!['1','2','yape','depósito','deposito','transferencia','tarjeta','tarjeta de crédito','tarjeta de debito','tarjeta de débito'].some(palabra => messageBody.includes(palabra))) {
                            return;
                        } else {
                            const foundationData = await this.getDataFoundationById(1); 

                            if(['1','yape'].some(palabra => messageBody.includes(palabra))){
                                await this.client.sendMessage(message.from,foundationData.yape_text_one);
                                await this.sendImage(message, foundationData.yape_route_one);
                                await this.client.sendMessage(message.from, foundationData.yape_text_second);
                                await this.updateContactStatus(message.from, 'null');   
                                return;
                            }
                            if(['2','depósito','deposito','transferencia','tarjeta','tarjeta de crédito','tarjeta de debito','tarjeta de débito'].some(palabra => messageBody.includes(palabra))){
                                await this.client.sendMessage(message.from,foundationData.card_text_one);
                                await this.client.sendMessage(message.from,foundationData.card_text_second);
                                //reset status to null
                                await this.updateContactStatus(message.from, 'null');
                                return;
                            }
                        }
                    }
                }
                
                //si existe contactStatus y type_status es null y esta dentro de la hora no hacer nada
                if(contactStatus && contactStatus.type_status === 'null') {
                    const oneHour = 60 * 60 * 1000; // 1 hora en milisegundos
                    const now = new Date();
                    const registrationDate = new Date(contactStatus.registration_date);
                    if (now - registrationDate < oneHour) {
                        console.log(`El contacto ${message.from} tiene estado 'null' pero dentro del periodo de 1 hora. No se procesa el mensaje.`);
                        return;
                    }
                    //si ya paso la hora resetear estado a null
                    await this.updateContactStatus(message.from, 'null');
                }   
                
                //si ah pasado 30 min desde el ultimo estado y es null entonces eliminar el contacto de la base de datos
                if(contactStatus && contactStatus.type_status === 'null') {
                    const thirtyMinutes = 30 * 60 * 1000; // 30 minutos en milisegundos
                    const now = new Date();
                    const registrationDate = new Date(contactStatus.registration_date);
                    if (now - registrationDate > thirtyMinutes) {
                        await this.deleteContactFromDatabase(message.from);
                        console.log(`El contacto ${message.from} ha sido eliminado de la base de datos por inactividad.`);
                    }
                    
                }

                console.log('Usuario tiene permiso para Foundation, buscando...');
                const foundationResponse = await this.checkFoundation(messageBody);
                if (foundationResponse) {
                    console.log(`Encontrado en Foundation: ${foundationResponse.id}`);
                    await this.sendFoundationPrincipleResponse(message, foundationResponse,messageBody);
                    return;
                }
                console.log('No se encontró en Foundation');
            } else {
                console.log('Usuario SIN permiso para Foundation');
            }

            console.log('No se encontraron coincidencias en ninguna base de datos');
            
            // Registrar mensaje no reconocido
            console.log('📝 Registrando mensaje no reconocido...');
            await this.logUnrecognizedMessage(message.from, message.body);
            
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            await this.client.sendMessage(
                message.from,
                '❌ Error al procesar tu solicitud. Por favor intenta más tarde.'
            );
        }
    }

    async deleteContactFromDatabase(contact) {
        try {
            const connection = await mysql.createConnection(config.database)
            await connection.execute(
                'DELETE FROM bot_contact_status WHERE contact = ?',
                [contact]
            );
            await connection.end();
            console.log(`Contacto ${contact} eliminado de la base de datos`);
        } catch (error) {
            console.error('Error eliminando contacto de la base de datos:', error);
        }   
    }

    async checkFoundation(messageBody) {
        try {
            console.log('Consultando bot_foundation...');
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                'SELECT id, welcome, presentation_route, brochure_route, modality_first_route, modality_second_route, sesion, inversion_route, key_words, final_Text FROM bot_foundation WHERE 1=1'
            );
            
            console.log(`Registros encontrados: ${rows.length}`);
            await connection.end();
            
            for (const row of rows) {
                let keywords = [];
                try {
                    keywords = JSON.parse(row.key_words);
                } catch (e) {
                    console.error('Error parsing key_words:', e);
                    continue;
                }
                
                console.log(`Revisando ID ${row.id} con keywords: ${keywords.join(', ')}`);
                
                const coincidencia = keywords.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra.toLowerCase())
                );
                
                if (coincidencia) {
                    console.log(`Coincidencia encontrada!`);
                    return row;
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error al consultar foundation:', error);
            return null;
        }   
    }

    getDataFoundationById(id) {
        return new Promise(async (resolve, reject) => {
            try {
                const connection = await mysql.createConnection(config.database);
                const [rows] = await connection.execute(
                    'SELECT * FROM bot_foundation WHERE id = ?',
                    [id]
                );
                await connection.end();
                if (rows.length > 0) {
                    resolve(rows[0]);
                } else {
                    resolve(null);
                }
            } catch (error) {
                console.error('Error obteniendo foundation por ID:', error);
                reject(error);
            }
        });
    }

    async sendFoundationPrincipleResponse(message, foundationData, messageBody=null) {
        try {
            console.log('Enviando respuesta de Foundation...');
            
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
                    console.log(`Enviando: ${step.label}`);
                    
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

            await this.updateContactStatus(message.from, 'foundation_modality_selection', messageBody);  
            console.log('Respuesta completa enviada');
        } catch (error) {
            console.error('Error enviando respuesta foundation:', error);
            await this.client.sendMessage(message.from, '❌ Error al enviar la información.');
        }
    }

    async checkMemberBlack(messageBody) {
        try {
            console.log('Consultando members...');
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                'SELECT id, nombre, ruta_post, beneficio, ruta_pdf, precio FROM members WHERE 1=1'
            );
            
            console.log(`Registros encontrados: ${rows.length}`);
            await connection.end();

            for (const row of rows) {
                const nombrePlan = row.nombre.toLowerCase();
                const palabrasNombre = nombrePlan.split(' ');
                
                console.log(`Revisando: ${row.nombre}`);
                
                const coincidencia = palabrasNombre.some(palabra => 
                    palabra.length > 2 && messageBody.includes(palabra)
                );

                if (coincidencia) {
                    console.log(`Coincidencia encontrada!`);
                    return row;
                }
            }

            return null;
        } catch (error) {
            console.error('Error al consultar members:', error);
            return null;
        }
    }

    async sendMemberBlackResponse(message, memberData) {
        try {
            console.log('Enviando respuesta de Member...');

            if (memberData.ruta_post) {
                console.log('Enviando: Imagen');
                await this.sendImage(message, memberData.ruta_post);
                await this.sleep(1000);
            }

            if (memberData.beneficio) {
                console.log('Enviando: Beneficio');
                await this.client.sendMessage(message.from, memberData.beneficio);
                await this.sleep(1000);
            }

            if (memberData.ruta_pdf) {
                console.log('Enviando: PDF');
                await this.sendPDF(message, memberData.ruta_pdf);
                await this.sleep(1000);
            }

            if (memberData.precio) {
                console.log('Enviando: Precio');
                await this.client.sendMessage(message.from, `💰 *Precio:* ${memberData.precio}`);
                await this.sleep(1000);
            }

            console.log('Consultando opciones del member...');
            const memberOptions = await this.getMemberOptions(memberData.id);
            
            if (memberOptions.length > 0) {
                const optionsMessage = this.formatMemberOptions(memberOptions);
                
                if (optionsMessage) {
                    console.log('Enviando: Opciones del member');
                    await this.client.sendMessage(message.from, optionsMessage);
                    
                    // IMPORTANTE: Esperar antes de guardar estado
                    await this.sleep(500);
                    await this.updateContactStatus(message.from, `member_option_selection_${memberData.id}`);
                    console.log(`✅ Estado guardado: member_option_selection_${memberData.id}`);
                }
            } else {
                console.log('⚠️ No se encontraron opciones para este member');
            }

            console.log('✅ Respuesta Member enviada completamente');

        } catch (error) {
            console.error('❌ Error enviando respuesta member:', error);
            await this.client.sendMessage(message.from, '❌ Error al enviar la información.');
        }
    }

    async getMemberOptions(memberId) {
        try {
            console.log(`Consultando opciones para member_id: ${memberId}`);
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                `SELECT opcion_numero, opcion_texto 
                FROM member_options 
                WHERE member_id = ? 
                ORDER BY opcion_numero ASC`,
                [memberId]
            );
            
            await connection.end();
            console.log(`✅ Opciones encontradas: ${rows.length}`);
            return rows;
        } catch (error) {
            console.error('❌ Error consultando member_options:', error);
            return [];
        }
    }

    formatMemberOptions(options) {
        if (!options || options.length === 0) return null;
        
        let message = '\n📋 *Opciones disponibles:*\n\n';
        options.forEach(option => {
            message += `${option.opcion_numero}. ${option.opcion_texto}\n`;
        });
        message += '\n_Responde con el número de tu opción._';
        
        return message;
    }

    async processMemberOptionSelection(message, memberId, opcionNumero) {
        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`PROCESANDO OPCIÓN SELECCIONADA`);
            console.log(`Member ID: ${memberId}, Opción: ${opcionNumero}`);
            console.log(`${'='.repeat(60)}\n`);
            
            const optionResponse = await this.getOptionResponse(memberId, opcionNumero);
            
            if (!optionResponse) {
                await this.client.sendMessage(message.from, 
                    '❌ Opción no válida. Por favor selecciona una opción del menú.'
                );
                return;
            }
            
            switch (optionResponse.tipo_respuesta) {
                case 'texto':
                    console.log('📝 Tipo: TEXTO');
                    await this.client.sendMessage(message.from, optionResponse.mensaje);
                    
                    // 🔥 SOLUCIÓN: Si el mensaje menciona métodos de pago, cambiar a submenu
                    const mensajeLower = optionResponse.mensaje.toLowerCase();
                    const tienePago = mensajeLower.includes('pago') || 
                                     mensajeLower.includes('yape') || 
                                     mensajeLower.includes('transferencia') ||
                                     mensajeLower.includes('tarjeta') ||
                                     mensajeLower.includes('método');
                    
                    if (tienePago) {
                        console.log('🔥 Mensaje de texto detecta métodos de pago, buscando submenu...');
                        const methods = await this.getPaymentMethods(optionResponse.id);
                        
                        if (methods.length > 0) {
                            const methodsMessage = this.formatPaymentMethods(methods);
                            await this.client.sendMessage(message.from, methodsMessage);
                            await this.sleep(500);
                            const newState = `payment_method_selection_${optionResponse.id}`;
                            await this.updateContactStatus(message.from, newState);
                            console.log(`✅ Estado guardado automáticamente: ${newState}`);
                        } else {
                            await this.updateContactStatus(message.from, 'null');
                        }
                    } else {
                        await this.updateContactStatus(message.from, 'null');
                    }
                    break;
                    
                case 'horario':
                    console.log('🕐 Tipo: HORARIO');
                    const isWithin = this.isWithinBusinessHours();
                    const condicion = isWithin ? 'dentro' : 'fuera';
                    
                    console.log(`Horario laboral: ${isWithin ? 'DENTRO' : 'FUERA'}`);
                    
                    const horarioMsg = await this.getHorarioMessage(optionResponse.id, condicion);
                    
                    if (horarioMsg) {
                        await this.client.sendMessage(message.from, horarioMsg);
                    } else {
                        await this.client.sendMessage(message.from, optionResponse.mensaje);
                    }
                    
                    await this.updateContactStatus(message.from, 'null');
                    break;
                    
                case 'submenu':
                    console.log('💳 Tipo: SUBMENU (métodos de pago)');
                    
                    const methods = await this.getPaymentMethods(optionResponse.id);
                    
                    if (methods.length > 0) {
                        const methodsMessage = this.formatPaymentMethods(methods);
                        await this.client.sendMessage(message.from, methodsMessage);
                        
                        // IMPORTANTE: Esperar antes de guardar estado
                        await this.sleep(500);
                        const newState = `payment_method_selection_${optionResponse.id}`;
                        await this.updateContactStatus(message.from, newState);
                        console.log(`✅ Estado guardado: ${newState}`);
                    } else {
                        await this.client.sendMessage(message.from, 
                            '❌ No hay métodos de pago disponibles en este momento.'
                        );
                        await this.updateContactStatus(message.from, 'null');
                    }
                    break;
                    
                default:
                    console.log('⚠️ Tipo de respuesta desconocido');
                    await this.client.sendMessage(message.from, optionResponse.mensaje || '❌ Error procesando tu solicitud.');
                    await this.updateContactStatus(message.from, 'null');
            }
            
        } catch (error) {
            console.error('❌ Error procesando selección de opción:', error);
            await this.client.sendMessage(message.from, '❌ Error procesando tu selección.');
        }
    }

    async getOptionResponse(memberId, opcionNumero) {
        try {
            console.log(`Consultando option_responses para member_id: ${memberId}, opción: ${opcionNumero}`);
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                `SELECT id, tipo_respuesta, mensaje 
                FROM option_responses 
                WHERE member_id = ? AND opcion_numero = ?
                LIMIT 1`,
                [memberId, opcionNumero]
            );
            
            await connection.end();
            
            if (rows.length > 0) {
                console.log(`✅ Respuesta encontrada: tipo ${rows[0].tipo_respuesta}`);
                return rows[0];
            }
            
            console.log('⚠️ No se encontró respuesta para esta opción');
            return null;
        } catch (error) {
            console.error('❌ Error consultando option_responses:', error);
            return null;
        }
    }

    isWithinBusinessHours() {
        const now = new Date();
        
        const peruOffset = -5;
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const peruTime = new Date(utc + (3600000 * peruOffset));
        
        const day = peruTime.getDay();
        const hour = peruTime.getHours();
        
        if (day >= 1 && day <= 5) {
            return hour >= 9 && hour < 18;
        }
        
        if (day === 0 || day === 6) {
            return hour >= 9 && hour < 13;
        }
        
        return false;
    }

    async getHorarioMessage(responseId, condicion) {
        try {
            console.log(`Consultando horario_responses para response_id: ${responseId}, condición: ${condicion}`);
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                `SELECT mensaje 
                FROM horario_responses 
                WHERE response_id = ? AND condicion = ?
                LIMIT 1`,
                [responseId, condicion]
            );
            
            await connection.end();
            
            if (rows.length > 0) {
                console.log(`✅ Mensaje de horario encontrado`);
                return rows[0].mensaje;
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error consultando horario_responses:', error);
            return null;
        }
    }

    async getPaymentMethods(responseId) {
        try {
            console.log(`Consultando payment_methods para response_id: ${responseId}`);
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                `SELECT DISTINCT metodo 
                FROM payment_methods 
                WHERE response_id = ? 
                ORDER BY metodo ASC`,
                [responseId]
            );
            
            await connection.end();
            console.log(`✅ Métodos de pago encontrados: ${rows.length}`);
            return rows;
        } catch (error) {
            console.error('❌ Error consultando payment_methods:', error);
            return [];
        }
    }

    formatPaymentMethods(methods) {
        if (!methods || methods.length === 0) return null;
        
        let message = '\n💳 *Métodos de pago disponibles:*\n\n';
        
        methods.forEach((method, index) => {
            const numero = index + 1;
            const metodo = method.metodo.charAt(0).toUpperCase() + method.metodo.slice(1);
            message += `${numero}. ${metodo}\n`;
        });
        
        message += '\n_Selecciona el número del método que prefieres._';
        
        return message;
    }

    async processPaymentMethodSelection(message, responseId, metodIndex) {
        try {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`PROCESANDO MÉTODO DE PAGO`);
            console.log(`Response ID: ${responseId}, Entrada del usuario: "${metodIndex}"`);
            console.log(`${'='.repeat(60)}\n`);
            
            const methods = await this.getPaymentMethods(responseId);
            let selectedMethod = null;
            
            // Intentar parsear como número
            const numeroMetodo = parseInt(metodIndex);
            
            if (!isNaN(numeroMetodo) && numeroMetodo >= 1 && numeroMetodo <= methods.length) {
                // Selección por número
                selectedMethod = methods[numeroMetodo - 1].metodo;
                console.log(`✅ Método seleccionado por número (${numeroMetodo}): ${selectedMethod}`);
            } else {
                // Buscar por palabra clave o similitud
                const inputLower = metodIndex.toString().toLowerCase().trim();
                console.log(`🔍 Buscando método por palabra clave: "${inputLower}"`);
                
                for (const method of methods) {
                    const metodoLower = method.metodo.toLowerCase();
                    
                    // Coincidencia exacta
                    if (metodoLower === inputLower) {
                        selectedMethod = method.metodo;
                        console.log(`✅ Coincidencia exacta encontrada: ${selectedMethod}`);
                        break;
                    }
                    
                    // Coincidencia parcial (contiene)
                    if (metodoLower.includes(inputLower) || inputLower.includes(metodoLower)) {
                        selectedMethod = method.metodo;
                        console.log(`✅ Coincidencia parcial encontrada: ${selectedMethod}`);
                        break;
                    }
                }
            }
            
            if (!selectedMethod) {
                console.log(`❌ Método no válido: "${metodIndex}"`);
                await this.client.sendMessage(message.from, 
                    '❌ Método no válido. Por favor selecciona un número del menú o escribe el nombre del método (Yape, Transferencia, Tarjeta).'
                );
                return;
            }
            
            console.log(`✅ Método final seleccionado: ${selectedMethod}`);
            
            const steps = await this.getPaymentSteps(responseId, selectedMethod);
            
            if (steps.length === 0) {
                await this.client.sendMessage(message.from, 
                    '❌ No hay información disponible para este método.'
                );
                await this.updateContactStatus(message.from, 'null');
                return;
            }
            
            console.log(`📤 Enviando ${steps.length} pasos...`);
            
            for (const step of steps) {
                console.log(`Paso ${step.orden}: ${step.tipo}`);
                
                if (step.tipo === 'texto') {
                    await this.client.sendMessage(message.from, step.contenido);
                } else if (step.tipo === 'imagen') {
                    await this.sendImage(message, step.contenido);
                }
                
                await this.sleep(1000);
            }
            
            console.log('✅ Todos los pasos enviados');
            await this.updateContactStatus(message.from, 'null');
            
        } catch (error) {
            console.error('❌ Error procesando método de pago:', error);
            await this.client.sendMessage(message.from, '❌ Error procesando el método de pago.');
        }
    }

    async getPaymentSteps(responseId, metodo) {
        try {
            console.log(`Consultando pasos de pago para método: ${metodo}`);
            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                `SELECT orden, tipo, contenido 
                FROM payment_methods 
                WHERE response_id = ? AND metodo = ? 
                ORDER BY orden ASC`,
                [responseId, metodo]
            );
            
            await connection.end();
            console.log(`✅ Pasos encontrados: ${rows.length}`);
            return rows;
        } catch (error) {
            console.error('❌ Error consultando pasos de pago:', error);
            return [];
        }
    }

    async updateContactStatus(contact, type_status, message = null) {
        try {
            console.log(`\n🔄 Actualizando estado de contacto`);
            console.log(`Contact: ${contact}`);
            console.log(`Nuevo estado: ${type_status}`);

            const connection = await mysql.createConnection(config.database);
            
            const [rows] = await connection.execute(
                'SELECT id, type_status FROM bot_contact_status WHERE contact = ? ORDER BY id DESC LIMIT 1',
                [contact]
            );
            
            if (rows.length > 0) {
                console.log(`Estado anterior: ${rows[0].type_status}`);
                await connection.execute(
                    'UPDATE bot_contact_status SET type_status = ?, registration_date = NOW() WHERE id = ?',
                    [type_status, rows[0].id]
                );
                console.log(`✅ Estado actualizado en registro existente (ID: ${rows[0].id})`);
            } else {
                await connection.execute(
                    'INSERT INTO bot_contact_status (type_status, contact, registration_date) VALUES (?, ?, NOW())',
                    [type_status, contact]
                );

                /*
                CREATE TABLE `bot_history` (
                `id` int NOT NULL AUTO_INCREMENT,
                `concat` varchar(500) not NULL,
                `invoke_text` varchar(2000) NULL,
                `registration_date` datetime DEFAULT NOW(),
                PRIMARY KEY (`id`)
                ) ENGINE=InnoDB AUTO_INCREMENT=1
                */
               await connection.execute(
                    'INSERT INTO bot_history (concat, invoke_text) VALUES (?, ? )',
                    [contact, message]
                );

                console.log(`✅ Estado guardado en nuevo registro`);
            }
            
            await connection.end();
            
            // Verificar que se guardó correctamente
            const connectionVerify = await mysql.createConnection(config.database);
            const [verify] = await connectionVerify.execute(
                'SELECT type_status FROM bot_contact_status WHERE contact = ? ORDER BY id DESC LIMIT 1',
                [contact]
            );
            await connectionVerify.end();
            
            if (verify.length > 0) {
                console.log(`✅ Verificación: Estado actual en BD = ${verify[0].type_status}`);
            }
            
        } catch (error) {
            console.error('❌ Error actualizando estado de contacto:', error);
        }   
    }

    async getContactStatusAndDate(contact) {
        try {
            const connection = await mysql.createConnection(config.database);
            const [rows] = await connection.execute(
                'SELECT type_status, registration_date FROM bot_contact_status WHERE contact = ? ORDER BY id DESC LIMIT 1',
                [contact]
            );
            await connection.end();
            
            if (rows.length > 0) {
                return rows[0];
            } else {
                return null;
            }
        } catch (error) {
            console.error('Error obteniendo estado de contacto:', error);
            return null;
        }
    }

    async logUnrecognizedMessage(contact, message) {
        try {
            console.log(`📝 Registrando mensaje no reconocido de: ${contact}`);
            const connection = await mysql.createConnection(config.database);
            
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS unrecognized_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    contact VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    estado VARCHAR(50) DEFAULT 'responder',
                    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_contact (contact),
                    INDEX idx_estado (estado)
                )
            `);
            
            await connection.execute(
                `INSERT INTO unrecognized_messages (contact, message, estado) 
                VALUES (?, ?, 'responder')`,
                [contact, message]
            );
            
            await connection.end();
            console.log('✅ Mensaje no reconocido registrado');
        } catch (error) {
            console.error('❌ Error registrando mensaje no reconocido:', error);
        }
    }

    async sendImage(message, imagePath) {
        try {
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${imagePath.replace(/^\/+/, '')}`;
            console.log(`URL imagen: ${fullUrl}`);

            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`Imagen no accesible`);
                await this.client.sendMessage(message.from, '❌ Imagen no disponible.');
                return;
            }

            const media = await this.createMediaFromUrl(fullUrl, 'image');
            
            if (!media) {
                throw new Error('No se pudo crear el media');
            }

            await this.client.sendMessage(message.from, media);
            console.log('Imagen enviada');

        } catch (error) {
            console.error('Error enviando imagen:', error);
            await this.client.sendMessage(message.from, '❌ Error al enviar imagen.');
        }
    }

    async sendPDF(message, pdfPath) {
        try {
            const fullUrl = `https://whatsbotadivisorfronted.onrender.com/${pdfPath.replace(/^\/+/, '')}`;
            console.log(`URL PDF: ${fullUrl}`);

            const isAccessible = await this.checkUrlAccessibility(fullUrl);
            if (!isAccessible) {
                console.error(`PDF no accesible`);
                await this.client.sendMessage(message.from, '❌ PDF no disponible.');
                return;
            }

            const media = await this.createMediaFromUrl(fullUrl, 'document');
            
            if (!media) {
                throw new Error('No se pudo crear el media');
            }

            await this.client.sendMessage(message.from, media);
            console.log('PDF enviado');

        } catch (error) {
            console.error('Error enviando PDF:', error);
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